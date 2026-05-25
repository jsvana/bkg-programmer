import type { RadioModelId } from '../schema/types';

export type TestStatus = 'pass' | 'fail' | 'skipped';

export interface TestResult {
  status: TestStatus;
  detail?: string;
  durationMs?: number;
}

export interface RebootTiming {
  trials: number[];
  meanMs: number;
  p95Ms: number;
}

export type TrustReadbackMode = 'yes' | 'no' | 'with-reboot-verify';

export interface SelfTestRecommendations {
  rebootWaitMs: number;
  trustReadback: TrustReadbackMode;
}

export interface SelfTestReport {
  ranAt: string;
  radioModel: RadioModelId;
  firmwareVersion: string;
  scratchChannel: number;
  tests: {
    protocolRoundtrip: TestResult;
    persistenceAcrossReboot: TestResult;
    silentDropDetection: TestResult;
    rebootTiming: RebootTiming;
  };
  recommendations: SelfTestRecommendations;
  passed: boolean;
  /** Hash of (model, firmwareVersion) used to cache the result. */
  cacheKey: string;
}

export function makeCacheKey(model: RadioModelId, firmwareVersion: string): string {
  return `${model}:${firmwareVersion}`;
}
