/**
 * Self-test runner. See docs/09-self-test.md.
 *
 * Goal: prove that write-then-read actually verifies EEPROM persistence,
 * not just RAM cache.
 *
 * This is a skeleton. The Session-driven steps work; the orchestration
 * and the IndexedDB result cache are stubbed.
 */

import { Session } from '../protocol/session';
import type { Transport } from '../protocol/transport';
import type { RadioModelId } from '../schema/types';
import {
  type SelfTestReport,
  type TestResult,
  type RebootTiming,
  makeCacheKey,
} from './report';

export interface SelfTestOptions {
  /** Channel number user has confirmed is unused. */
  scratchChannel: number;
  /** Radio model (after detection). */
  radioModel: RadioModelId;
  /** Address of the scratch channel's name (16 bytes). */
  scratchChannelNameAddress: number;
  /** Address known to be unmapped (for silent-drop test). null = skip. */
  unmappedTestAddress: number | null;
  /** How long to wait after `0x05DD` reboot before retrying hello. */
  rebootWaitMs?: number;
}

export interface SelfTestCallbacks {
  onStep(step: string, detail?: string): void;
}

export async function runSelfTest(
  initialSession: Session,
  transport: Transport,
  opts: SelfTestOptions,
  cb: SelfTestCallbacks,
): Promise<SelfTestReport> {
  const ranAt = new Date().toISOString();
  const firmwareVersion = initialSession.hello.versionString;

  cb.onStep('backup', `Backing up scratch channel ${opts.scratchChannel}`);
  const backup = await initialSession.readEeprom(opts.scratchChannelNameAddress, 16);

  // ---- Test A: protocol roundtrip ----
  cb.onStep('test-a', 'Roundtrip without reboot');
  const pattern = generatePattern();
  const testA = await safe(async () => {
    await initialSession.writeEeprom(opts.scratchChannelNameAddress, pattern);
    const read = await initialSession.readEeprom(opts.scratchChannelNameAddress, 16);
    if (!bytesEqual(read, pattern)) {
      throw new Error('Read-back did not match write. Protocol layer broken.');
    }
  });

  // ---- Test B: persistence across reboot (×3 for timing) ----
  cb.onStep('test-b', 'Persistence across reboot (3 trials)');
  const trials: number[] = [];
  let testB: TestResult = { status: 'skipped' };
  let session = initialSession;

  if (testA.status === 'pass') {
    for (let trial = 0; trial < 3; trial++) {
      const trialPattern = generatePattern();
      await session.writeEeprom(opts.scratchChannelNameAddress, trialPattern);

      const rebootStart = performance.now();
      await session.reboot();
      await sleep(opts.rebootWaitMs ?? 2500);

      // Try to re-open session. Retry with backoff until ~6s elapsed.
      const reopened = await tryReopenSession(transport, rebootStart, 6000);
      if (!reopened.session) {
        testB = {
          status: 'fail',
          detail: `Radio did not respond to hello after reboot (waited ${
            performance.now() - rebootStart
          }ms).`,
        };
        break;
      }
      trials.push(reopened.elapsedMs);
      session = reopened.session;

      const post = await session.readEeprom(opts.scratchChannelNameAddress, 16);
      if (!bytesEqual(post, trialPattern)) {
        testB = {
          status: 'fail',
          detail:
            `Trial ${trial + 1}: bytes did not survive reboot. Write was cache-only. ` +
            `Wrote: ${hex(trialPattern)}, Read after reboot: ${hex(post)}.`,
        };
        break;
      }
    }
    if (testB.status === 'skipped') testB = { status: 'pass' };
  }

  // ---- Test C: silent-drop detection ----
  let testC: TestResult = { status: 'skipped', detail: 'No unmapped address provided' };
  if (opts.unmappedTestAddress !== null) {
    cb.onStep('test-c', `Silent-drop at 0x${opts.unmappedTestAddress.toString(16)}`);
    testC = await safe(async () => {
      const before = await session.readEeprom(opts.unmappedTestAddress!, 8);
      if (!before.every((b) => b === 0xFF)) {
        throw new Error(
          `Address 0x${opts.unmappedTestAddress!.toString(16)} did not read 0xFF ` +
            `(got ${hex(before)}). Possibly mapped after all.`,
        );
      }
      const probe = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE]);
      await session.writeEeprom(opts.unmappedTestAddress!, probe);
      const after = await session.readEeprom(opts.unmappedTestAddress!, 8);
      if (!after.every((b) => b === 0xFF)) {
        throw new Error(
          `Address 0x${opts.unmappedTestAddress!.toString(16)} accepted a write. ` +
            `Schema hole map is wrong.`,
        );
      }
    });
  }

  // ---- Restore backup ----
  cb.onStep('restore', 'Restoring scratch channel');
  await session.writeEeprom(opts.scratchChannelNameAddress, backup);
  const restored = await session.readEeprom(opts.scratchChannelNameAddress, 16);
  if (!bytesEqual(restored, backup)) {
    cb.onStep('restore-error', 'Restore verification failed — user should re-check scratch channel');
  }

  // ---- Compile results ----
  const timing: RebootTiming =
    trials.length > 0
      ? {
          trials,
          meanMs: trials.reduce((a, b) => a + b, 0) / trials.length,
          p95Ms: percentile(trials, 0.95),
        }
      : { trials: [], meanMs: 0, p95Ms: 0 };

  const passed =
    testA.status === 'pass' &&
    testB.status === 'pass' &&
    (testC.status === 'pass' || testC.status === 'skipped');

  const recommendations =
    testB.status === 'pass'
      ? { rebootWaitMs: Math.ceil(timing.p95Ms + 200), trustReadback: 'yes' as const }
      : {
          rebootWaitMs: 3000,
          trustReadback: 'with-reboot-verify' as const,
        };

  return {
    ranAt,
    radioModel: opts.radioModel,
    firmwareVersion,
    scratchChannel: opts.scratchChannel,
    tests: {
      protocolRoundtrip: testA,
      persistenceAcrossReboot: testB,
      silentDropDetection: testC,
      rebootTiming: timing,
    },
    recommendations,
    passed,
    cacheKey: makeCacheKey(opts.radioModel, firmwareVersion),
  };
}

// ---------- helpers ----------

async function safe(fn: () => Promise<void>): Promise<TestResult> {
  const start = performance.now();
  try {
    await fn();
    return { status: 'pass', durationMs: performance.now() - start };
  } catch (err) {
    return {
      status: 'fail',
      detail: (err as Error).message,
      durationMs: performance.now() - start,
    };
  }
}

function generatePattern(): Uint8Array {
  // "SELFTEST" + timestamp (u32) + random (u32) = 16 bytes
  const buf = new Uint8Array(16);
  buf.set(new TextEncoder().encode('SELFTEST'), 0);
  const ts = Math.floor(Date.now() / 1000);
  const dv = new DataView(buf.buffer);
  dv.setUint32(8, ts, true);
  dv.setUint32(12, (Math.random() * 0xFFFFFFFF) >>> 0, true);
  return buf;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(' ');
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryReopenSession(
  transport: Transport,
  startTime: number,
  budgetMs: number,
): Promise<{ session: Session | null; elapsedMs: number }> {
  const deadline = startTime + budgetMs;
  while (performance.now() < deadline) {
    try {
      const session = await Session.open(transport);
      return { session, elapsedMs: performance.now() - startTime };
    } catch {
      await sleep(250);
    }
  }
  return { session: null, elapsedMs: performance.now() - startTime };
}
