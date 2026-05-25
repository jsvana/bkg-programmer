/**
 * Three-axis detection. See docs/02-detection.md.
 *
 * The result splits into three independent judgments:
 *   - radio:           what hardware are we talking to?
 *   - firmware:        what firmware is on it?
 *   - programmability: can we safely write to it?
 *
 * They are computed independently and combined by `canFlash()`.
 */

import type { Session } from '../protocol/session';
import type { RadioModelId, ProfileId } from '../schema/types';
import { findFirmwareByVersion, type FirmwareEntry } from './registry';
import { lookupSelfTest } from './selfTestResults';
import type { HelloReply } from '../protocol/commands';

// ============ Radio identity ============

export type RadioIdentity =
  | { kind: 'confirmed'; models: ReadonlyArray<RadioModelId>; via: 'model-bytes' }
  | { kind: 'inferred'; models: ReadonlyArray<RadioModelId>; via: 'firmware-fingerprint' }
  | { kind: 'ambiguous'; models: ReadonlyArray<RadioModelId> }
  | {
      kind: 'conflict';
      firmwareCandidates: ReadonlyArray<RadioModelId>;
      modelBytesSays: string;
    }
  | { kind: 'unknown' };

// ============ Firmware identity ============

export type FirmwareIdentity =
  | { kind: 'matched'; entry: FirmwareEntry }
  | { kind: 'unknown'; versionString: string };

// ============ Programmability ============

export type Programmability =
  | { kind: 'verified'; profileId: ProfileId; trustReadback: 'yes' }
  | {
      kind: 'verified-with-reboot';
      profileId: ProfileId;
      trustReadback: 'with-reboot-verify';
    }
  | {
      kind: 'provisional';
      profileId: ProfileId;
      reason: 'self-test-not-run' | 'self-test-failed';
    }
  | { kind: 'unsupported'; reason: 'no-profile' | 'firmware-unknown' }
  | { kind: 'blocked'; reason: 'radio-identity-conflict' | 'dfu-mode' };

// ============ Combined result ============

export interface DetectionResult {
  hello: HelloReply;
  radio: RadioIdentity;
  firmware: FirmwareIdentity;
  programmability: Programmability;
  /** Raw ASCII from the model-bytes region, if it was read. */
  modelBytesString?: string;
  notes: ReadonlyArray<string>;
}

/**
 * Run the full detection flow against an open session.
 * Stage 1 (hello) is implicit — the session already did it.
 */
export async function detect(session: Session): Promise<DetectionResult> {
  const notes: string[] = [];

  // --- Firmware identity (Stage 2) ---
  const firmwareEntry = findFirmwareByVersion(session.hello.versionString);
  const firmware: FirmwareIdentity = firmwareEntry
    ? { kind: 'matched', entry: firmwareEntry }
    : { kind: 'unknown', versionString: session.hello.versionString };

  if (!firmwareEntry) {
    notes.push(`Unknown firmware version string: "${session.hello.versionString}"`);
  }

  // --- Radio identity (Stage 3) ---
  const { radio, modelBytesString } = await resolveRadioIdentity(
    session,
    firmwareEntry,
    notes,
  );

  // --- Programmability (derived) ---
  const programmability = resolveProgrammability(
    radio,
    firmware,
    session.hello.versionString,
  );

  const result: DetectionResult = {
    hello: session.hello,
    radio,
    firmware,
    programmability,
    notes,
  };
  if (modelBytesString !== undefined) {
    result.modelBytesString = modelBytesString;
  }
  return result;
}

async function resolveRadioIdentity(
  session: Session,
  firmwareEntry: FirmwareEntry | undefined,
  notes: string[],
): Promise<{ radio: RadioIdentity; modelBytesString?: string }> {
  if (!firmwareEntry) {
    return { radio: { kind: 'unknown' } };
  }

  const candidates = firmwareEntry.candidateModels;

  if (!firmwareEntry.modelBytesPreserved) {
    // Can't cross-check; trust the firmware fingerprint alone.
    return {
      radio:
        candidates.length === 1
          ? { kind: 'inferred', models: candidates, via: 'firmware-fingerprint' }
          : { kind: 'ambiguous', models: candidates },
    };
  }

  const modelBytesAddress = firmwareEntry.modelBytesAddress ?? 0x1ED0;
  let modelBytesString: string | undefined;
  try {
    const bytes = await session.readEeprom(modelBytesAddress, 16);
    modelBytesString = decodeModelBytes(bytes);
  } catch (err) {
    notes.push(`Could not read model bytes: ${(err as Error).message}`);
    return {
      radio:
        candidates.length === 1
          ? { kind: 'inferred', models: candidates, via: 'firmware-fingerprint' }
          : { kind: 'ambiguous', models: candidates },
    };
  }

  const matched = modelBytesMatchCandidate(modelBytesString, candidates);
  if (matched === 'match') {
    notes.push(
      `Model bytes at 0x${modelBytesAddress.toString(16).toUpperCase()} confirm: ${modelBytesString}`,
    );
    return {
      radio: { kind: 'confirmed', models: candidates, via: 'model-bytes' },
      modelBytesString,
    };
  }
  if (matched === 'conflict') {
    notes.push(
      `Model bytes "${modelBytesString}" contradict firmware fingerprint. Refusing to flash.`,
    );
    return {
      radio: {
        kind: 'conflict',
        firmwareCandidates: candidates,
        modelBytesSays: modelBytesString,
      },
      modelBytesString,
    };
  }

  notes.push(
    `Model bytes "${modelBytesString}" inconclusive; relying on firmware fingerprint.`,
  );
  return {
    radio:
      candidates.length === 1
        ? { kind: 'inferred', models: candidates, via: 'firmware-fingerprint' }
        : { kind: 'ambiguous', models: candidates },
    modelBytesString,
  };
}

function resolveProgrammability(
  radio: RadioIdentity,
  firmware: FirmwareIdentity,
  versionString: string,
): Programmability {
  if (radio.kind === 'conflict') {
    return { kind: 'blocked', reason: 'radio-identity-conflict' };
  }
  if (firmware.kind === 'unknown') {
    return { kind: 'unsupported', reason: 'firmware-unknown' };
  }
  const { entry } = firmware;
  if (!entry.profileId) {
    return { kind: 'unsupported', reason: 'no-profile' };
  }

  // Within a single firmware build the protocol implementation is
  // identical across hardware revisions of the same MCU family, so a
  // self-test verdict for any candidate model is reasonable evidence
  // for all of them. First match wins.
  const candidates =
    radio.kind === 'confirmed' ||
    radio.kind === 'inferred' ||
    radio.kind === 'ambiguous'
      ? radio.models
      : entry.candidateModels;

  let verdict;
  for (const model of candidates) {
    verdict = lookupSelfTest(model, versionString);
    if (verdict) break;
  }

  if (!verdict) {
    return {
      kind: 'provisional',
      profileId: entry.profileId,
      reason: 'self-test-not-run',
    };
  }
  if (verdict.trustReadback === 'yes') {
    return { kind: 'verified', profileId: entry.profileId, trustReadback: 'yes' };
  }
  if (verdict.trustReadback === 'with-reboot-verify') {
    return {
      kind: 'verified-with-reboot',
      profileId: entry.profileId,
      trustReadback: 'with-reboot-verify',
    };
  }
  return {
    kind: 'provisional',
    profileId: entry.profileId,
    reason: 'self-test-failed',
  };
}

/**
 * Whether write operations should be permitted. The UI may still offer
 * an override for `provisional`; `blocked` and `unsupported` are hard
 * stops.
 */
export function canFlash(
  r: DetectionResult,
): { allowed: boolean; reason?: string } {
  const p = r.programmability;
  switch (p.kind) {
    case 'verified':
    case 'verified-with-reboot':
      return { allowed: true };
    case 'provisional':
      return {
        allowed: false,
        reason:
          p.reason === 'self-test-not-run'
            ? 'Self-test has not been run for this firmware version.'
            : 'Self-test failed for this firmware version.',
      };
    case 'unsupported':
      return {
        allowed: false,
        reason:
          p.reason === 'firmware-unknown'
            ? 'Firmware version is not recognized.'
            : 'No profile is registered for this firmware.',
      };
    case 'blocked':
      return {
        allowed: false,
        reason:
          p.reason === 'radio-identity-conflict'
            ? 'Firmware fingerprint and EEPROM model bytes disagree.'
            : 'Radio is in DFU/bootloader mode.',
      };
  }
}

function decodeModelBytes(bytes: Uint8Array): string {
  // Trim at first null or non-printable
  const usable: number[] = [];
  for (const b of bytes) {
    if (b === 0 || b < 0x20 || b > 0x7E) break;
    usable.push(b);
  }
  return String.fromCharCode(...usable);
}

function modelBytesMatchCandidate(
  modelStr: string,
  candidates: ReadonlyArray<RadioModelId>,
): 'match' | 'no-info' | 'conflict' {
  const upper = modelStr.toUpperCase();
  if (!upper.includes('UV-K')) return 'no-info';
  // crude mapping. Refine as we see real-world strings.
  const map: Record<string, RadioModelId[]> = {
    'UV-K5': ['uv-k5-v1', 'uv-k5-v2', 'uv-k5-v3'],
    'UV-K6': ['uv-k6'],
    'UV-K1': ['uv-k1'],
  };
  for (const [prefix, mapped] of Object.entries(map)) {
    if (upper.startsWith(prefix)) {
      const intersect = mapped.some((m) => candidates.includes(m));
      return intersect ? 'match' : 'conflict';
    }
  }
  return 'no-info';
}
