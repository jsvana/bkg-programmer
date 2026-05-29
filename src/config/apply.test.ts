import { describe, expect, test } from 'vitest';
import { EepromSnapshot } from '../backup/snapshot';
import { resolveProfile } from '../schema/resolve';
import { uvK1F4hwnNr7y } from '../schema/profiles/uv-k1-f4hwn-nr7y';
import { moduleRegistry } from '../schema/profiles/index';
import { applyConfig, parseConfig } from './apply';
import type { BkgConfig } from './types';

const nr7y = resolveProfile(uvK1F4hwnNr7y, moduleRegistry);

/** Build a snapshot that covers the regions this test family touches.
 *  We don't need to model the whole 64KB virtual EEPROM — only the
 *  ranges any of the tested config overlays will hit, which the
 *  applyConfig() snapshot-coverage check enforces. */
function makeSnapshot(regions: Array<{ start: number; data: Uint8Array }>): EepromSnapshot {
  const s = new EepromSnapshot();
  for (const r of regions) s.addRegion(r.start, r.data);
  return s;
}

describe('parseConfig', () => {
  test('rejects malformed JSON', () => {
    expect(() => parseConfig('{not json')).toThrow(/Invalid JSON/);
  });
  test('rejects wrong schemaVersion', () => {
    expect(() => parseConfig('{"schemaVersion":99}')).toThrow(/schemaVersion/);
  });
  test('accepts valid envelope', () => {
    const cfg = parseConfig('{"schemaVersion":1}');
    expect(cfg.schemaVersion).toBe(1);
  });
});

describe('applyConfig — convenience keys rejected', () => {
  const current = makeSnapshot([{ start: 0x0000, data: new Uint8Array(16) }]);

  test('callsign produces unsupported-convenience error', () => {
    const cfg: BkgConfig = { schemaVersion: 1, callsign: 'W6JSV' };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors.map((e) => e.kind)).toContain('unsupported-convenience');
    expect(r.errors[0]?.path).toBe('callsign');
    expect(r.fieldChanges).toHaveLength(0);
  });

  test('keyerSpeed produces unsupported-convenience error', () => {
    const cfg: BkgConfig = { schemaVersion: 1, keyerSpeed: 22 };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('unsupported-convenience');
    expect(r.errors[0]?.path).toBe('keyerSpeed');
  });

  test('splash produces unsupported-convenience error', () => {
    const cfg: BkgConfig = { schemaVersion: 1, splash: { foo: 'bar' } };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('unsupported-convenience');
    expect(r.errors[0]?.path).toBe('splash');
  });
});

describe('applyConfig — profile mismatch', () => {
  test('rejects when appliesTo.profileIds excludes active profile', () => {
    const current = makeSnapshot([{ start: 0x0000, data: new Uint8Array(16) }]);
    const cfg: BkgConfig = {
      schemaVersion: 1,
      appliesTo: { profileIds: ['some-other-profile'] },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('profile-mismatch');
  });
});

describe('applyConfig — settings overlay (NR7Y f4hwn_settings)', () => {
  // f4hwn_settings is bound at 0xA158, size 8 bytes.
  const current = makeSnapshot([
    { start: 0xA158, data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]) },
  ]);

  test('writes set_pwr enum (numeric)', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { f4hwn_settings: { set_pwr: 5 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors).toHaveLength(0);
    expect(r.fieldChanges).toHaveLength(1);
    const change = r.fieldChanges[0]!;
    expect(change.fieldPath).toBe('settings.f4hwn_settings.set_pwr');
    // set_pwr lives at byte 7, bits 4-7 → byte 7 = 5 << 4 = 0x50.
    expect(change.byteRange.start).toBe(0xA158 + 7);
    expect(change.byteRange.end).toBe(0xA158 + 8);
    expect(r.target.read(0xA158 + 7, 1)[0]).toBe(0x50);
  });

  test('writes set_pwr enum (label string)', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { f4hwn_settings: { set_pwr: 'Mid (~2 W)' } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors).toHaveLength(0);
    // 'Mid (~2 W)' = value 5 → byte 7 high nibble = 5.
    expect(r.target.read(0xA158 + 7, 1)[0]).toBe(0x50);
  });

  test('multiple settings fields packed into same byte coexist', () => {
    // set_ptt (bit 0), set_scn (bit 1), set_pwr (bits 4-7) all in byte 7.
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: {
        f4hwn_settings: {
          set_ptt: 'One-touch (toggle)',  // value 1
          set_scn: true,                    // bit 1 = 1
          set_pwr: 'High (~5 W)',           // value 6
        },
      },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors).toHaveLength(0);
    // Expected byte 7: bits 4-7=6, bit 1=1, bit 0=1 → 0b0110_0011 = 0x63
    expect(r.target.read(0xA158 + 7, 1)[0]).toBe(0x63);
    expect(r.fieldChanges).toHaveLength(3);
  });

  test('rejects unknown field', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { f4hwn_settings: { totally_made_up: 1 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('unknown-field');
    expect(r.errors[0]?.path).toBe('settings.f4hwn_settings.totally_made_up');
  });

  test('rejects unknown module', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { not_a_module: { x: 1 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('unknown-module');
  });

  test('rejects value out of enum', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { f4hwn_settings: { set_pwr: 99 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('value-bad-enum');
  });
});

describe('applyConfig — settings overlay (NR7Y freq_lock_settings)', () => {
  // freq_lock_settings is bound at 0xA150, size 8 bytes; f_lock is byte 0.
  // Seed byte 0 with the F4HWN default (0) so a write to FCC (1) registers.
  const current = makeSnapshot([
    { start: 0xA150, data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]) },
  ]);

  test('writes f_lock = FCC by enum label', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { freq_lock_settings: { f_lock: 'FCC HAM (144-148, 420-450)' } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors).toHaveLength(0);
    expect(r.fieldChanges).toHaveLength(1);
    const change = r.fieldChanges[0]!;
    expect(change.fieldPath).toBe('settings.freq_lock_settings.f_lock');
    expect(change.byteRange.start).toBe(0xA150);
    expect(change.byteRange.end).toBe(0xA150 + 1);
    // FCC = raw 1.
    expect(r.target.read(0xA150, 1)[0]).toBe(1);
  });

  test('writes f_lock = FCC by numeric raw value', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { freq_lock_settings: { f_lock: 1 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors).toHaveLength(0);
    expect(r.target.read(0xA150, 1)[0]).toBe(1);
  });

  test('rejects out-of-range f_lock value', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { freq_lock_settings: { f_lock: 99 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('value-bad-enum');
  });
});

describe('applyConfig — channels overlay (NR7Y)', () => {
  // For channel index 1 (1-based), record sits at 0x0000-0x000F.
  // Channel name slot sits at 0x4000-0x400F.
  const current = makeSnapshot([
    { start: 0x0000, data: new Uint8Array(16) },
    { start: 0x4000, data: new Uint8Array(16) },
  ]);

  test('sets rx_freq + tx_offset + modulation in one channel', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [
        {
          index: 1,
          fields: {
            rx_freq: '146.94 MHz',
            tx_offset_freq: 600_000,
            tx_offset_dir: '-',
            modulation: 'FM',
            tx_power: 'High',
          },
        },
      ],
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors).toHaveLength(0);

    // rx_freq: 14_694_000 = 0x00E03670 → bytes 0..3 LE: 70 36 E0 00
    const rxBytes = r.target.read(0x0000, 4);
    expect(Array.from(rxBytes)).toEqual([0x70, 0x36, 0xE0, 0x00]);

    // tx_offset_freq: 600_000 / 10 = 60_000 = 0x0000_EA60 → bytes 4..7 LE: 60 EA 00 00
    const offBytes = r.target.read(0x0004, 4);
    expect(Array.from(offBytes)).toEqual([0x60, 0xEA, 0x00, 0x00]);

    // FieldChange count = 5
    expect(r.fieldChanges).toHaveLength(5);
  });

  test('rejects channel index 0', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [{ index: 0, fields: { rx_freq: 146.94 } }],
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('channel-index-out-of-range');
  });

  test('rejects channel index > count', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [{ index: 9999, fields: { rx_freq: 146.94 } }],
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('channel-index-out-of-range');
  });

  test('channel name shortcut writes to channel_names slot', () => {
    const cfg: BkgConfig = {
      schemaVersion: 1,
      channels: [{ index: 1, name: 'MARIN' }],
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors).toHaveLength(0);
    // 'MARIN' = 4D 41 52 49 4E, then 0 0 0 (size: 8 per the schema)
    const nameBytes = r.target.read(0x4000, 8);
    expect(Array.from(nameBytes)).toEqual([0x4D, 0x41, 0x52, 0x49, 0x4E, 0, 0, 0]);
    expect(r.fieldChanges).toHaveLength(1);
    expect(r.fieldChanges[0]?.fieldPath).toBe('channels[0].name.name');
  });
});

describe('applyConfig — coverage check', () => {
  test('errors when current snapshot does not cover target region', () => {
    const current = makeSnapshot([]); // empty snapshot
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { f4hwn_settings: { set_pwr: 5 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    expect(r.errors[0]?.kind).toBe('snapshot-coverage');
  });
});

describe('applyConfig — target snapshot leaves untouched bytes alone', () => {
  test('changing one field preserves neighbors', () => {
    const sentinel = new Uint8Array(8);
    sentinel.fill(0xCC);
    const current = makeSnapshot([{ start: 0xA158, data: sentinel }]);
    const cfg: BkgConfig = {
      schemaVersion: 1,
      settings: { f4hwn_settings: { set_pwr: 0 } },
    };
    const r = applyConfig(cfg, nr7y, current);
    // Bytes 0-6 unchanged (still 0xCC). Byte 7 high nibble cleared (set_pwr=0),
    // low nibble preserved → 0x0C.
    const all = r.target.read(0xA158, 8);
    expect(Array.from(all.subarray(0, 7))).toEqual([0xCC, 0xCC, 0xCC, 0xCC, 0xCC, 0xCC, 0xCC]);
    expect(all[7]).toBe(0x0C);
  });
});
