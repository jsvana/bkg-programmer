# 08. Write plan and verify logic

The load-bearing safety piece. This is what stands between "restore
worked" and "I just spent 90 seconds writing the wrong bytes to
calibration."

## Failure modes the design must defend against

1. **Silently dropped writes** — V3/K1 unmapped addresses return
   success on write but discard data. Read-back is the only proof.
2. **Lockscreen activates mid-batch** — user touches the radio,
   subsequent protected-range writes silently fail.
3. **Snapshot drift** — user changed something on the radio between
   plan and execute.
4. **Battery dies mid-write** — worst case. Half-written calibration.
5. **Settings-reload trigger mid-batch** — writes to `[0x0F30, 0x0F40)`
   cause `SETTINGS_InitEEPROM()`, which can invalidate in-flight RAM
   state.
6. **AES challenge fails** — custom AES key blocks all writes.
7. **Frame CRC / cable glitch** — transient noise.
8. **Concurrent sessions** — two WebSerial tabs corrupting each other.

## The model

See `src/writer/plan.ts` for full types. Key concepts:

```typescript
interface WritePlan {
  planId: string;
  generatedAt: string;
  profile: ResolvedProfile;
  batches: WriteBatch[];
  preflightChecks: PreflightCheck[];
  postExecuteActions: PostExecuteAction[];
  rollbackSnapshot: RollbackSnapshot;
  totals: { /* ... */ };
}

interface WriteBatch {
  id: string;
  order: number;
  address: number;                        // 8-aligned
  data: Uint8Array;                       // multiple of 8 bytes
  sources: FieldChange[];                 // for UI traceability
  preservedByteIndices: number[];         // RMW bytes from current state
  requiresAllowPassword: boolean;
  triggersSettingsReload: boolean;
  region: RegionKind;
  sensitivity: Sensitivity;
  expectedReadback: Uint8Array;
}
```

`preservedByteIndices` matters because of read-modify-write:
when a user changes one bit-field in a byte, the planner writes the
full 8-byte aligned block, with the unchanged bytes copied from a
fresh read. If verify shows those preserved bytes changed, it's not
a write failure — it's drift.

## The planner

Input: resolved profile, current device state, target state, opts.
Output: a `WritePlan`.

```
1. Per-8-byte-block diff. Group changes by (addr >> 3) << 3.
2. For each block: start with current 8 bytes, apply user changes,
   mark which bytes were preserved.
3. Coalesce adjacent dirty blocks into batches of `batchBytes` (default 32).
4. Order batches: data first, calibration before triggers,
   reload-triggers last, AES last.
5. Build rollback snapshot from current state for every block touched.
6. Generate preflight checks.
7. Estimate duration.
```

## The executor

```
Phase 1 — Preflight
  Run all checks. Abort on blocking failures.

Phase 2 — Snapshot re-verify
  For every block in the rollback snapshot, read the device.
  If different from snapshot: abort with snapshot-drift.

Phase 3 — Write + verify loop (per batch)
  3a. Send write command with appropriate flags
  3b. Read back the same bytes
  3c. Compare to expectedReadback
  3d. If reload-trigger batch, sleep ~100ms

Phase 4 — Post-execute actions
  Reboot, recapture-backup, etc.

Phase 5 — Final sweep verify
  Re-read everything, compare to plan.
  Catches edge cases like settings reload reverting earlier writes.
```

## Batch ordering rules

Critical for correctness:

1. **Data first, triggers last.** Writes to `[0x0F30, 0x0F40)`
   cause settings reload — anything written before this batch is
   observed; anything after may not be until next reboot.
2. **Calibration after non-calibration.** If interrupted, you'd
   rather have lost a channel name change than a half-written cal
   region.
3. **AES last.** A failed AES write can lock the radio out
   permanently if the snapshot doesn't include a clean pre-AES
   state.

## Rollback strategy

There is no true rollback in EEPROM. The "rollback" you can offer is:
re-write the snapshot bytes back to the touched addresses.

- If all writes succeeded: rollback perfectly restores prior state.
- If some writes were dropped: rollback restores affected blocks to
  pre-plan state. The dropped writes never happened, so the result
  is consistent.
- If writes succeeded but the read-back layer was lying (cache, not
  EEPROM): rollback ALSO went into cache; reboot to settle and
  re-verify.

Rollback isn't a special path. It's just another `WritePlan`,
executed by the same engine with the same verify loop. Safety for
free.

## Preflight checks

| Check | Blocking? | What it does |
| --- | --- | --- |
| fresh-detection | yes | Re-hello; abort if firmware version changed since plan |
| snapshot-still-valid | yes | Each rollback block matches device |
| lockscreen-off | warn | Detect from hello reply's bIsInLockScreen |
| no-aes-challenge-required | yes | Detect from hello reply's bHasCustomAesKey |
| battery-ok | warn/fail | If `0x0527` available and < 3.4 V, fail |
| no-concurrent-session | yes | IndexedDB lock keyed by serial |
| serial-port-stable | no | Diagnostic |

The IndexedDB-based session lock is worth its own note: WebSerial
doesn't enforce exclusive access. Two tabs can hold a port open
simultaneously. Use an IDB transaction as a mutex keyed by
`bkg-session:${radioSerial}`. Steal locks older than 30 minutes
(stale).

## Things to push back on

1. **Batch size default.** 32 bytes is fast but coarse. For
   non-developer hams, 16 or 24 gives better rollback granularity at
   minimal cost. Make user-configurable.

2. **Final sweep verify cost.** Doubles protocol traffic. For a full
   channel restore that's ~10 seconds extra; for a small edit it's
   noise. Don't make this optional. The bug reports it'll save are
   worth more than the time cost.

3. **The verify lie.** Read-back can lie if the firmware caches.
   The self-test (see `docs/09-self-test.md`) measures this. If it
   reports cache-only behavior for certain regions, the executor
   must add a forced reboot+re-verify after writes to those regions.

4. **Snapshot drift on UI return.** A user opens the tool, leaves
   the tab, comes back 10 minutes later, clicks "Restore." Real
   chance they touched the radio. Don't punish them — offer
   "Regenerate plan from current state" as a button.

5. **What I deliberately didn't include**: automatic retry on
   verify mismatch. Retrying masks the underlying problem. Single
   retry on protocol-layer errors is fine; retrying on verify
   mismatch is not.
