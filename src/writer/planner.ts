/**
 * planWrites: build a WritePlan from a diff of current vs. target snapshots.
 *
 * See docs/08-write-plan.md for the algorithm.
 *
 * This is a working skeleton. The TODOs flag steps that need a real field
 * decoder (which isn't built yet) to compute byte ranges from FieldChanges.
 */

import type { ResolvedProfile } from '../schema/types';
import type { EepromSnapshot } from '../backup/snapshot';
import type { FieldChange } from '../backup/diff';
import {
  type WritePlan,
  type WriteBatch,
  type RollbackSnapshot,
  type PlanOpts,
  type PreflightCheck,
  type PostExecuteAction,
  DEFAULT_BATCH_BYTES,
  alignDown8,
} from './plan';

export function planWrites(
  resolved: ResolvedProfile,
  current: EepromSnapshot,
  target: EepromSnapshot,
  changes: ReadonlyArray<FieldChange>,
  opts: PlanOpts = {},
): WritePlan {
  const batchBytes = opts.batchBytes ?? DEFAULT_BATCH_BYTES;
  if (batchBytes % 8 !== 0) {
    throw new Error('batchBytes must be a multiple of 8');
  }

  // ----- 1. Per-8-byte-block diff -----
  // For each change, walk its byte range, group changes by aligned 8-byte block.
  const dirtyBlocks = new Map<
    number,
    {
      data: Uint8Array;
      preserved: Set<number>;
      sources: FieldChange[];
    }
  >();

  for (const change of changes) {
    const start = change.byteRange.start;
    const end = change.byteRange.end;
    for (let addr = alignDown8(start); addr < end; addr += 8) {
      let block = dirtyBlocks.get(addr);
      if (!block) {
        // Initialize from current state - RMW preservation
        const currentBytes = current.read(addr, 8);
        block = {
          data: new Uint8Array(currentBytes),
          preserved: new Set([0, 1, 2, 3, 4, 5, 6, 7]),
          sources: [],
        };
        dirtyBlocks.set(addr, block);
      }
      // Apply user-intended bytes from target snapshot for the overlap
      const overlapStart = Math.max(addr, start);
      const overlapEnd = Math.min(addr + 8, end);
      const targetBytes = target.read(overlapStart, overlapEnd - overlapStart);
      for (let i = 0; i < targetBytes.length; i++) {
        const byteOffsetInBlock = overlapStart - addr + i;
        block.data[byteOffsetInBlock] = targetBytes[i]!;
        block.preserved.delete(byteOffsetInBlock);
      }
      if (!block.sources.includes(change)) block.sources.push(change);
    }
  }

  // ----- 2. Coalesce into batches -----
  const sortedAddrs = [...dirtyBlocks.keys()].sort((a, b) => a - b);
  const batches: WriteBatch[] = [];
  let cursor = 0;
  let batchCounter = 0;

  while (cursor < sortedAddrs.length) {
    const baseAddr = sortedAddrs[cursor]!;
    const blocks: Array<[number, NonNullable<ReturnType<typeof dirtyBlocks.get>>]> = [];
    while (
      cursor < sortedAddrs.length &&
      sortedAddrs[cursor]! < baseAddr + batchBytes &&
      sortedAddrs[cursor]! === baseAddr + blocks.length * 8
    ) {
      const addr = sortedAddrs[cursor]!;
      blocks.push([addr, dirtyBlocks.get(addr)!]);
      cursor++;
    }
    batches.push(buildBatch(baseAddr, blocks, resolved, batchCounter++));
  }

  // ----- 3. Order batches: safety-relevant last -----
  batches.sort(safeBatchOrder);
  batches.forEach((b, i) => {
    b.order = i;
  });

  // ----- 4. Rollback snapshot -----
  const rollback: RollbackSnapshot = {
    capturedAt: new Date().toISOString(),
    blocks: new Map(),
    rawBytes: 0,
  };
  for (const batch of batches) {
    for (let off = 0; off < batch.data.length; off += 8) {
      const addr = batch.address + off;
      rollback.blocks.set(addr, new Uint8Array(current.read(addr, 8)));
      rollback.rawBytes += 8;
    }
  }

  // ----- 5. Preflight checks -----
  const preflightChecks: PreflightCheck[] = [
    // Filled in at execute time by the executor's preflight runner.
    // We declare which checks to run here; results are computed against
    // a live device.
  ];

  // ----- 6. Post-execute actions -----
  const postExecuteActions: PostExecuteAction[] = [];
  if (batches.some((b) => b.triggersSettingsReload)) {
    postExecuteActions.push({
      kind: 'reload-settings-confirmed',
      required: false,
      reason: 'Settings reload trigger was written; settings should be live.',
    });
  }
  if (batches.some((b) => b.region === 'calibration')) {
    postExecuteActions.push({
      kind: 'recapture-backup',
      required: true,
      reason: 'Calibration was modified; recapture a fresh backup.',
    });
  }

  // ----- 7. Duration estimate -----
  const ms = batches.length * 25 + 200;

  return {
    planId: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    generatedAt: new Date().toISOString(),
    profile: resolved,
    batches,
    preflightChecks,
    postExecuteActions,
    rollbackSnapshot: rollback,
    totals: {
      batches: batches.length,
      bytesWritten: batches.reduce((n, b) => n + b.data.length, 0),
      deviceSpecificBytes: batches
        .filter((b) => b.sensitivity === 'device-specific')
        .reduce((n, b) => n + b.data.length, 0),
      estimatedDurationMs: ms,
      estimatedDurationP95Ms: ms * 2,
    },
  };
}

function buildBatch(
  baseAddr: number,
  blocks: Array<[number, { data: Uint8Array; preserved: Set<number>; sources: FieldChange[] }]>,
  _resolved: ResolvedProfile,
  index: number,
): WriteBatch {
  const data = new Uint8Array(blocks.length * 8);
  const preservedIndices: number[] = [];
  const sources: FieldChange[] = [];

  blocks.forEach(([addr, blk], i) => {
    data.set(blk.data, i * 8);
    blk.preserved.forEach((p) => preservedIndices.push(i * 8 + p));
    for (const s of blk.sources) {
      if (!sources.includes(s)) sources.push(s);
    }
    void addr;
  });

  // TODO: classify region from address ranges against resolved profile modules
  // For now, defaults; the executor still works because flags only affect ordering.
  const region = classifyRegion(baseAddr);
  const sensitivity = region === 'calibration' ? 'device-specific' : 'shareable';

  return {
    id: `batch-${String(index).padStart(4, '0')}`,
    order: index,
    address: baseAddr,
    data,
    sources,
    preservedByteIndices: preservedIndices,
    requiresAllowPassword: addressRequiresPassword(baseAddr, data.length),
    triggersSettingsReload: addressTriggersReload(baseAddr, data.length),
    region,
    sensitivity,
    expectedReadback: new Uint8Array(data),
  };
}

function classifyRegion(addr: number): WriteBatch['region'] {
  // V1 calibration: 0x1E00-0x1FFF; V3/K1: 0xB000-0xB1FF
  if ((addr >= 0x1E00 && addr < 0x2000) || (addr >= 0xB000 && addr < 0xB200)) {
    return 'calibration';
  }
  // F4HWN settings: V1=0x1FF0, V3/K1=0xA158
  if (addr === 0x1FF0 || addr === 0xA158) return 'settings';
  // Channel name regions
  if ((addr >= 0x0F50 && addr < 0x1370) || (addr >= 0x4000 && addr < 0x8000)) {
    return 'channel-names';
  }
  // Channel attrs
  if ((addr >= 0x0D60 && addr < 0x0E2F) || (addr >= 0x8000 && addr < 0x8810)) {
    return 'channel-attrs';
  }
  // Channels
  if (addr < 0x0D60 || (addr >= 0x4000 && addr < 0x4000)) return 'channels';
  return 'other';
}

function addressRequiresPassword(addr: number, _len: number): boolean {
  // V1 lockscreen-protected range: [0x0E98, 0x0EA0)
  return addr >= 0x0E98 && addr < 0x0EA0;
}

function addressTriggersReload(addr: number, len: number): boolean {
  // V1 settings reload trigger: writes overlapping [0x0F30, 0x0F40)
  const end = addr + len;
  return !(end <= 0x0F30 || addr >= 0x0F40);
}

/**
 * Ordering rule: data writes first, calibration before triggers,
 * reload-triggers last, AES last.
 */
function safeBatchOrder(a: WriteBatch, b: WriteBatch): number {
  const rank = (b: WriteBatch): number => {
    if (b.region === 'aes') return 4;
    if (b.triggersSettingsReload) return 3;
    if (b.region === 'calibration') return 2;
    return 1;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.address - b.address;
}
