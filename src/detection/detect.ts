/**
 * Three-stage detection. See docs/02-detection.md.
 */

import type { Session } from '../protocol/session';
import type { RadioModelId, ProfileId } from '../schema/types';
import { findFirmwareByVersion, type FirmwareEntry } from './registry';
import type { HelloReply } from '../protocol/commands';

export type Confidence = 'high' | 'medium' | 'low' | 'conflict' | 'unusable';

export interface DetectionResult {
  confidence: Confidence;
  hello: HelloReply;
  firmware?: FirmwareEntry | undefined;
  candidateModels: ReadonlyArray<RadioModelId>;
  modelBytesString?: string | undefined;       // raw ASCII from 0x1ED0 region
  notes: ReadonlyArray<string>;
  /** Suggested profile, if confidence is at least medium. */
  suggestedProfileId?: ProfileId | undefined;
}

/**
 * Run the full detection flow against an open session.
 * Stage 1 (hello) is implicit — the session already did it.
 */
export async function detect(session: Session): Promise<DetectionResult> {
  const notes: string[] = [];

  // Stage 2: fingerprint version string
  const firmware = findFirmwareByVersion(session.hello.versionString);
  if (!firmware) {
    notes.push(`Unknown firmware version string: "${session.hello.versionString}"`);
    return {
      confidence: 'low',
      hello: session.hello,
      candidateModels: [],
      notes,
    };
  }

  // Stage 3: cross-check model bytes from EEPROM
  // V1 model bytes are at 0x1ED0; stock K1 at 0x0EC0. Other locations TBD.
  // The firmware entry's modelBytesAddress tells us where to look.
  let modelBytesString: string | undefined;
  let confidence: Confidence = 'medium';
  const modelBytesAddress = firmware.modelBytesAddress ?? 0x1ED0;
  if (firmware.modelBytesPreserved) {
    try {
      const bytes = await session.readEeprom(modelBytesAddress, 16);
      modelBytesString = decodeModelBytes(bytes);
      const matched = modelBytesMatchCandidate(modelBytesString, firmware.candidateModels);
      if (matched === 'match') {
        confidence = 'high';
        notes.push(
          `Model bytes at 0x${modelBytesAddress.toString(16).toUpperCase()} confirm: ${modelBytesString}`,
        );
      } else if (matched === 'conflict') {
        confidence = 'conflict';
        notes.push(
          `Model bytes "${modelBytesString}" contradict firmware fingerprint. Refusing to flash.`,
        );
      } else {
        notes.push(
          `Model bytes "${modelBytesString}" inconclusive; staying at medium confidence.`,
        );
      }
    } catch (err) {
      notes.push(`Could not read model bytes: ${(err as Error).message}`);
    }
  }

  return {
    confidence,
    hello: session.hello,
    firmware,
    candidateModels: firmware.candidateModels,
    modelBytesString,
    notes,
    suggestedProfileId: confidence === 'conflict' ? undefined : firmware.profileId,
  };
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
