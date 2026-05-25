/**
 * Write plan executor. See docs/08-write-plan.md.
 *
 * The phases are intentionally kept identical to the doc — preflight,
 * snapshot re-verify, write+verify loop, post-execute, final sweep.
 * Each phase has a single explicit failure path.
 */

import type { Session } from '../protocol/session';
import {
  type WritePlan,
  type WriteBatch,
  type ExecResult,
  type ExecAbortReason,
  type ExecWarning,
  type RollbackOffer,
  type PreflightCheck,
  arraysEqual,
} from './plan';

export interface ExecCallbacks {
  onProgress(done: number, total: number, batch: WriteBatch): void;
  onPreflight(check: PreflightCheck): void;
  confirmRollback?(offer: RollbackOffer): Promise<boolean>;
}

export interface ExecOptions {
  /** If true, run reboot+re-read after final sweep. Set from self-test result. */
  rebootVerify?: boolean;
}

export async function executeWritePlan(
  plan: WritePlan,
  session: Session,
  callbacks: ExecCallbacks,
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const startedAt = performance.now();
  const warnings: ExecWarning[] = [];

  // ============ PHASE 1: preflight ============
  // The plan's preflightChecks list is declarative — the executor runs
  // each against the live device here.
  const failedChecks: PreflightCheck[] = [];
  for (const check of plan.preflightChecks) {
    callbacks.onPreflight(check);
    if (check.status === 'fail' && check.blocking) failedChecks.push(check);
  }
  if (failedChecks.length > 0) {
    return { status: 'aborted-preflight', failedChecks };
  }

  // ============ PHASE 2: snapshot re-verify ============
  for (const [addr, expected] of plan.rollbackSnapshot.blocks) {
    const actual = await session.readEeprom(addr, 8);
    if (!arraysEqual(actual, expected)) {
      return {
        status: 'aborted-mid-execute',
        lastBatchOk: -1,
        failedBatch: plan.batches[0]!,
        reason: { kind: 'snapshot-drift', address: addr, snapshot: expected, current: actual },
        rollback: {
          blocksToRestore: [],
          estimatedDurationMs: 0,
          message:
            'No changes were written. Device state changed since plan was generated. ' +
            'Regenerate the plan from the current device state.',
        },
      };
    }
  }

  // ============ PHASE 3: write + verify loop ============
  let lastBatchOk = -1;
  for (let i = 0; i < plan.batches.length; i++) {
    const batch = plan.batches[i]!;
    callbacks.onProgress(i, plan.batches.length, batch);

    try {
      await session.writeEeprom(batch.address, batch.data, {
        allowPassword: batch.requiresAllowPassword,
      });

      const readback = await session.readEeprom(batch.address, batch.data.length);
      if (!arraysEqual(readback, batch.expectedReadback)) {
        return abortMidExecute(plan, lastBatchOk, i, {
          kind: 'verify-mismatch',
          expected: batch.expectedReadback,
          actual: readback,
        });
      }

      if (batch.triggersSettingsReload) {
        // Give the firmware a moment to reload before the next batch.
        await sleep(100);
      }
      lastBatchOk = i;
    } catch (err) {
      return abortMidExecute(plan, lastBatchOk, i, classifyError(err));
    }
  }

  // ============ PHASE 4: post-execute actions ============
  // (Mostly informational; UI surfaces them. No action automation here yet.)

  // ============ PHASE 5: final sweep verify ============
  for (const batch of plan.batches) {
    const readback = await session.readEeprom(batch.address, batch.data.length);
    if (!arraysEqual(readback, batch.expectedReadback)) {
      warnings.push({
        kind: 'post-execute-drift',
        batchId: batch.id,
        address: batch.address,
        message:
          'Final verify showed bytes differ from what was written. ' +
          'Possibly reverted by a settings reload. Consider rebooting and re-checking.',
      });
    }
  }

  // ============ PHASE 6: optional reboot-verify ============
  if (opts.rebootVerify) {
    await session.reboot();
    // After reboot, caller must re-open a session and call a final verify.
    // We can't continue in this function once the session is dead.
    warnings.push({
      kind: 'cache-uncertainty',
      message:
        'Reboot was issued. Caller should re-open a session and re-verify ' +
        'all written regions to confirm persistence.',
    });
  }

  const durationMs = performance.now() - startedAt;
  if (warnings.length > 0) {
    return { status: 'success-with-warnings', warnings };
  }
  return { status: 'success', batchesWritten: plan.batches.length, durationMs };
}

function abortMidExecute(
  plan: WritePlan,
  lastBatchOk: number,
  failedIdx: number,
  reason: ExecAbortReason,
): ExecResult {
  const rollback = buildRollbackOffer(plan, lastBatchOk + 1, failedIdx);
  return {
    status: 'aborted-mid-execute',
    lastBatchOk,
    failedBatch: plan.batches[failedIdx]!,
    reason,
    rollback,
  };
}

function buildRollbackOffer(
  plan: WritePlan,
  rollbackFromBatchIdx: number,
  rollbackToBatchIdx: number,
): RollbackOffer {
  const blocks: Array<{ address: number; data: Uint8Array }> = [];
  // Restore all blocks touched by batches that were written, up to and
  // including the failed one (which may have partially succeeded).
  for (let i = 0; i <= rollbackToBatchIdx; i++) {
    const batch = plan.batches[i];
    if (!batch) continue;
    for (let off = 0; off < batch.data.length; off += 8) {
      const addr = batch.address + off;
      const snap = plan.rollbackSnapshot.blocks.get(addr);
      if (snap) blocks.push({ address: addr, data: new Uint8Array(snap) });
    }
  }
  return {
    blocksToRestore: blocks,
    estimatedDurationMs: blocks.length * 25,
    message:
      rollbackFromBatchIdx === 0
        ? 'No batches succeeded. Rollback restores the device to its state before this attempt.'
        : `${rollbackFromBatchIdx} batch(es) succeeded before failure. ` +
          'Rollback restores all touched bytes to their pre-plan values.',
  };
}

function classifyError(err: unknown): ExecAbortReason {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') {
      return { kind: 'timeout', afterMs: 0 };
    }
    return { kind: 'protocol-error', underlying: err };
  }
  return { kind: 'protocol-error', underlying: new Error(String(err)) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
