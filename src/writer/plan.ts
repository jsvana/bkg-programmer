/**
 * Write plan data model. See docs/08-write-plan.md for the design.
 */

import type { ResolvedProfile, ModuleId, Sensitivity } from '../schema/types';
import type { FieldChange } from '../backup/diff';

export type RegionKind =
  | 'channels'
  | 'channel-names'
  | 'channel-attrs'
  | 'settings'
  | 'calibration'
  | 'aes'
  | 'other';

export interface WriteBatch {
  id: string;                              // 'batch-0001'
  order: number;
  address: number;                         // 8-aligned
  data: Uint8Array;                        // length multiple of 8

  /** User changes that motivated this batch (for UI traceability). */
  sources: ReadonlyArray<FieldChange>;

  /**
   * Indices into `data` (0..data.length-1) of bytes that were COPIED from
   * the current device state (RMW preservation), not specified by the user.
   * If a verify shows these changed, the device drifted under us.
   */
  preservedByteIndices: ReadonlyArray<number>;

  // Wire-level flags
  requiresAllowPassword: boolean;
  triggersSettingsReload: boolean;
  region: RegionKind;
  sensitivity: Sensitivity;

  /** Sanity-redundant copy of `data` for verify. */
  expectedReadback: Uint8Array;
}

export type PreflightStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheck {
  id:
    | 'fresh-detection'
    | 'profile-still-matches'
    | 'snapshot-still-valid'
    | 'lockscreen-off'
    | 'no-aes-challenge-required'
    | 'battery-ok'
    | 'no-concurrent-session'
    | 'serial-port-stable';
  status: PreflightStatus;
  blocking: boolean;
  message: string;
  remediation?: string;
}

export type PostExecuteActionKind =
  | 'reload-settings-confirmed'
  | 'reboot-radio'
  | 'reconnect-prompt'
  | 'recapture-backup';

export interface PostExecuteAction {
  kind: PostExecuteActionKind;
  required: boolean;
  reason: string;
}

export interface RollbackSnapshot {
  capturedAt: string;
  /**
   * For every 8-byte block this plan touches: what's there RIGHT NOW.
   * Map key = address (multiple of 8). Value = 8 bytes.
   */
  blocks: Map<number, Uint8Array>;
  rawBytes: number;
}

export interface WritePlanTotals {
  batches: number;
  bytesWritten: number;
  deviceSpecificBytes: number;
  estimatedDurationMs: number;
  estimatedDurationP95Ms: number;
}

export interface WritePlan {
  planId: string;
  generatedAt: string;
  profile: ResolvedProfile;
  batches: ReadonlyArray<WriteBatch>;
  preflightChecks: ReadonlyArray<PreflightCheck>;
  postExecuteActions: ReadonlyArray<PostExecuteAction>;
  rollbackSnapshot: RollbackSnapshot;
  totals: WritePlanTotals;
}

// Executor result shapes

export type ExecAbortReason =
  | { kind: 'verify-mismatch'; expected: Uint8Array; actual: Uint8Array }
  | { kind: 'snapshot-drift'; address: number; snapshot: Uint8Array; current: Uint8Array }
  | { kind: 'protocol-error'; underlying: Error }
  | { kind: 'timeout'; afterMs: number }
  | { kind: 'lockscreen-engaged' }
  | { kind: 'user-cancelled' };

export interface RollbackOffer {
  blocksToRestore: Array<{ address: number; data: Uint8Array }>;
  estimatedDurationMs: number;
  message: string;
}

export type ExecWarning =
  | { kind: 'post-execute-drift'; batchId: string; address: number; message: string }
  | { kind: 'cache-uncertainty'; message: string };

export type ExecResult =
  | { status: 'success'; batchesWritten: number; durationMs: number }
  | { status: 'aborted-preflight'; failedChecks: PreflightCheck[] }
  | {
      status: 'aborted-mid-execute';
      lastBatchOk: number;
      failedBatch: WriteBatch;
      reason: ExecAbortReason;
      rollback: RollbackOffer;
    }
  | { status: 'success-with-warnings'; warnings: ExecWarning[] };

export interface PlanOpts {
  batchBytes?: 8 | 16 | 24 | 32 | 40 | 48 | 56 | 64;
}

export const DEFAULT_BATCH_BYTES = 32;

/** Helper: address aligned down to 8-byte boundary. */
export function alignDown8(addr: number): number {
  return addr & ~0x7;
}

/** Helper: byte arrays equal. */
export function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
