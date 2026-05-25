import { describe, expect, test } from 'vitest';
import { resolveProfile } from '../schema/resolve';
import { uvK1F4hwnNr7y } from '../schema/profiles/uv-k1-f4hwn-nr7y';
import { uvK5Ijv } from '../schema/profiles/uv-k5-ijv';
import { moduleRegistry } from '../schema/profiles/index';
import { requiredRegions } from './needs';
import type { BkgConfig } from './types';

const nr7y = resolveProfile(uvK1F4hwnNr7y, moduleRegistry);
const ijv = resolveProfile(uvK5Ijv, moduleRegistry);

describe('requiredRegions', () => {
  test('empty config requires nothing', () => {
    expect(requiredRegions({ schemaVersion: 1 }, nr7y)).toEqual([]);
  });

  test('settings overlay reads the bound block', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { f4hwn_settings: { set_pwr: 5 } },
    };
    const r = requiredRegions(cfg, nr7y);
    expect(r).toHaveLength(1);
    expect(r[0]?.start).toBe(0xA158);
    expect(r[0]?.length).toBe(8); // 8-byte block
    expect(r[0]?.label).toContain('f4hwn_settings');
  });

  test('channel fields read just the affected record on NR7Y', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [{ index: 5, fields: { rx_freq: '146.94 MHz' } }],
    };
    const r = requiredRegions(cfg, nr7y);
    // channels base 0x0000, stride 16, index 5 → offset 0x40
    expect(r).toHaveLength(1);
    expect(r[0]?.start).toBe(0x40);
    expect(r[0]?.length).toBe(16);
  });

  test('channel name shortcut reads channel_names slot, not channels record', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [{ index: 1, name: 'MARIN' }],
    };
    const r = requiredRegions(cfg, nr7y);
    expect(r).toHaveLength(1);
    expect(r[0]?.start).toBe(0x4000);
    expect(r[0]?.length).toBe(16);
  });

  test('channel with name AND fields reads both, distinct regions', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [{ index: 1, name: 'MARIN', fields: { rx_freq: 146.94 } }],
    };
    const r = requiredRegions(cfg, nr7y);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.start).sort((a, b) => a - b)).toEqual([0x0000, 0x4000]);
  });

  test('adjacent channels coalesce into one read', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [
        { index: 1, fields: { rx_freq: 146.94 } },
        { index: 2, fields: { rx_freq: 147.06 } },
        { index: 3, fields: { rx_freq: 146.52 } },
      ],
    };
    const r = requiredRegions(cfg, nr7y);
    // Three 16-byte records starting at 0x00, 0x10, 0x20 → merged into one 48-byte read.
    expect(r).toHaveLength(1);
    expect(r[0]?.start).toBe(0x00);
    expect(r[0]?.length).toBe(48);
  });

  test('non-adjacent channels stay separate', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [
        { index: 1, fields: { rx_freq: 146.94 } },
        { index: 100, fields: { rx_freq: 147.06 } },
      ],
    };
    const r = requiredRegions(cfg, nr7y);
    expect(r).toHaveLength(2);
  });

  test('IJV ASCII names use 8-byte aligned read window (template size 16)', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [{ index: 1, name: 'TEST' }],
    };
    const r = requiredRegions(cfg, ijv);
    // channel_names base 0x0F50, stride 16. 0x0F50 is 8-aligned; length 16.
    expect(r).toHaveLength(1);
    expect(r[0]?.start).toBe(0x0F50);
    expect(r[0]?.length).toBe(16);
  });

  test('out-of-range channel indices are silently skipped (applyConfig errors them)', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [
        { index: 0, fields: { rx_freq: 146.94 } }, // invalid
        { index: 99999, fields: { rx_freq: 146.94 } }, // invalid
      ],
    };
    expect(requiredRegions(cfg, nr7y)).toEqual([]);
  });

  test('unknown module in settings is silently skipped', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { does_not_exist: { x: 1 } },
    };
    expect(requiredRegions(cfg, nr7y)).toEqual([]);
  });
});
