/**
 * Self-test verdict lookup.
 *
 * Hand-curated table of `(radioModel, firmwareVersion) → verdict` mappings,
 * populated by copying `SelfTestReport.recommendations` from a passing
 * self-test run. Keyed via `makeCacheKey` so the format matches what the
 * self-test runner emits.
 *
 * TODO: replace with an IndexedDB lookup once self-test reports persist
 * to local storage. See docs/09-self-test.md.
 */

import type { RadioModelId } from '../schema/types';
import { makeCacheKey, type TrustReadbackMode } from '../self-test/report';

export interface SelfTestVerdict {
  trustReadback: TrustReadbackMode;
  /** Measured wait time after 0x05DD reboot, in ms (p95 + margin). */
  rebootWaitMs?: number;
  /** Free-text explanation, primarily for `trustReadback: 'no'`. */
  reason?: string;
  /** ISO 8601 timestamp of when the self-test was captured. */
  ranAt?: string;
}

const verdicts: Record<string, SelfTestVerdict> = {
  // IJV V2.9R5 on UV-K5 V1. Self-test captured 2026-05-25:
  //   protocolRoundtrip:        pass (80ms)
  //   persistenceAcrossReboot:  pass
  //   silentDropDetection:      skipped (no unmapped address provided)
  //   rebootTiming:             p95 2532ms across 3 trials → wait 2733ms
  [makeCacheKey('uv-k5-v1', 'V2.9R5')]: {
    trustReadback: 'yes',
    rebootWaitMs: 2733,
    ranAt: '2026-05-25T18:27:14.791Z',
  },
};

export function lookupSelfTest(
  radioModel: RadioModelId,
  firmwareVersion: string,
): SelfTestVerdict | undefined {
  return verdicts[makeCacheKey(radioModel, firmwareVersion)];
}
