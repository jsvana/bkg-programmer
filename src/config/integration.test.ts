/**
 * End-to-end: parse a JSON config file → applyConfig → planWrites,
 * and assert the resulting WritePlan has the expected shape.
 *
 * Uses the worked example at examples/configs/uv-k1-nr7y-2m-repeaters.json
 * to make sure that file actually drives a real plan against the real
 * profile registry.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EepromSnapshot } from '../backup/snapshot';
import { resolveProfile } from '../schema/resolve';
import { uvK1F4hwnNr7y } from '../schema/profiles/uv-k1-f4hwn-nr7y';
import { uvK5Ijv } from '../schema/profiles/uv-k5-ijv';
import { moduleRegistry } from '../schema/profiles/index';
import { planWrites } from '../writer/planner';
import { applyConfig, parseConfig } from './apply';

describe('integration: NR7Y example config → WritePlan', () => {
  const nr7y = resolveProfile(uvK1F4hwnNr7y, moduleRegistry);

  test('example file parses, applies, and produces a plan', () => {
    const path = join(__dirname, '../../examples/configs/uv-k1-nr7y-2m-repeaters.json');
    const text = readFileSync(path, 'utf8');
    const cfg = parseConfig(text);

    // Cover only the regions this config touches:
    // - channels[0..2]: 0x0000-0x002F (3 records × 16 bytes)
    // - channel_names[0..2]: 0x4000-0x402F
    // - f4hwn_settings: 0xA158-0xA15F
    // Pad each to 8-aligned blocks (already are).
    const current = new EepromSnapshot();
    current.addRegion(0x0000, new Uint8Array(0x30));
    current.addRegion(0x4000, new Uint8Array(0x30));
    current.addRegion(0xA158, new Uint8Array(0x08));

    const result = applyConfig(cfg, nr7y, current);
    expect(result.errors).toEqual([]);
    // 3 channels × ~10 fields each + 3 names + 4 settings ≈ 37
    expect(result.fieldChanges.length).toBeGreaterThan(20);

    const plan = planWrites(nr7y, current, result.target, result.fieldChanges);
    expect(plan.batches.length).toBeGreaterThan(0);
    expect(plan.totals.bytesWritten).toBeGreaterThan(0);
    expect(plan.totals.bytesWritten % 8).toBe(0);

    // Every batch must be 8-aligned and size a multiple of 8 (firmware constraint).
    for (const b of plan.batches) {
      expect(b.address % 8).toBe(0);
      expect(b.data.length % 8).toBe(0);
    }

    // Rollback snapshot must cover every byte we plan to write.
    expect(plan.rollbackSnapshot.rawBytes).toBeGreaterThanOrEqual(plan.totals.bytesWritten);
  });

  test('IJV example renames channels and nothing else writes', () => {
    // IJV channels module is readOnly:true, so any field overlay would
    // produce a readonly-module error. The example uses only the name
    // shortcut, which routes to the channel_names module (write-enabled).
    const ijv = resolveProfile(uvK5Ijv, moduleRegistry);

    const path = join(__dirname, '../../examples/configs/uv-k5-ijv-rename-channels.json');
    const text = readFileSync(path, 'utf8');
    const cfg = parseConfig(text);

    // channel_names for IJV at 0x0F50, 3 slots × 16 bytes = 0x30.
    const current = new EepromSnapshot();
    current.addRegion(0x0F50, new Uint8Array(0x30));

    const result = applyConfig(cfg, ijv, current);
    expect(result.errors).toEqual([]);
    expect(result.fieldChanges).toHaveLength(3);
    for (const fc of result.fieldChanges) {
      expect(fc.fieldPath).toMatch(/^channels\[\d+\]\.name\.name$/);
    }
  });
});
