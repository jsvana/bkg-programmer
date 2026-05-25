import { describe, expect, test } from 'vitest';
import type { Field } from '../schema/types';
import { decodeField, encodeValue, writeField, ConfigEncodeError } from './codec';

function makeField(overrides: Partial<Field>): Field {
  return {
    id: 'f',
    label: 'f',
    type: { kind: 'int', min: 0, max: 255 },
    location: { kind: 'byte', offset: 0, size: 1 },
    applyMode: 'live',
    ...overrides,
  } as Field;
}

describe('encodeValue / decodeField — int', () => {
  test('round-trips single byte', () => {
    const f = makeField({ type: { kind: 'int', min: 0, max: 255 } });
    expect(encodeValue(f, 42)).toBe(42);
    const buf = new Uint8Array(1);
    writeField(f, 42, buf);
    expect(decodeField(f, buf)).toEqual({ raw: 42, display: '42' });
  });

  test('accepts 0x-hex string', () => {
    const f = makeField({});
    expect(encodeValue(f, '0xFF')).toBe(255);
  });

  test('rejects out-of-range', () => {
    const f = makeField({ type: { kind: 'int', min: 0, max: 9 } });
    expect(() => encodeValue(f, 10)).toThrow(ConfigEncodeError);
  });

  test('rejects non-integer', () => {
    const f = makeField({});
    expect(() => encodeValue(f, 1.5)).toThrow(ConfigEncodeError);
  });
});

describe('encodeValue / decodeField — bool', () => {
  test('round-trips true', () => {
    const f = makeField({ type: { kind: 'bool' }, location: { kind: 'bits', offset: 0, bitOffset: 3, bitWidth: 1 } });
    const buf = new Uint8Array(1);
    writeField(f, true, buf);
    expect(buf[0]).toBe(0b0000_1000);
    expect(decodeField(f, buf).raw).toBe(1);
  });

  test('rejects non-bool', () => {
    const f = makeField({ type: { kind: 'bool' } });
    expect(() => encodeValue(f, 'true' as never)).toThrow(ConfigEncodeError);
  });
});

describe('encodeValue / decodeField — enum', () => {
  const f = makeField({
    type: {
      kind: 'enum',
      values: [
        { value: 0, label: 'Off' },
        { value: 1, label: 'Beep' },
        { value: 2, label: 'Roger' },
      ],
    },
  });

  test('accepts numeric raw value', () => {
    expect(encodeValue(f, 2)).toBe(2);
  });

  test('accepts string label', () => {
    expect(encodeValue(f, 'Beep')).toBe(1);
  });

  test('rejects unknown numeric', () => {
    expect(() => encodeValue(f, 99)).toThrow(/not in/);
  });

  test('rejects unknown label', () => {
    expect(() => encodeValue(f, 'Honk')).toThrow(/not in/);
  });

  test('decode displays label', () => {
    const buf = new Uint8Array(1);
    writeField(f, 'Roger', buf);
    expect(decodeField(f, buf).display).toBe('Roger');
  });
});

describe('encodeValue / decodeField — frequency', () => {
  // channels rx_freq: 4-byte little-endian, 10 Hz resolution.
  const f = makeField({
    type: { kind: 'frequency', min: 18_000_000, max: 1_300_000_000, resolutionHz: 10 },
    location: { kind: 'byte', offset: 0, size: 4 },
  });

  test('accepts MHz number', () => {
    expect(encodeValue(f, 146.94)).toBe(14_694_000);
  });

  test('accepts Hz number', () => {
    expect(encodeValue(f, 146_940_000)).toBe(14_694_000);
  });

  test('accepts MHz string', () => {
    expect(encodeValue(f, '146.94 MHz')).toBe(14_694_000);
  });

  test('writes little-endian', () => {
    const buf = new Uint8Array(4);
    writeField(f, 146.94, buf);
    // 14_694_000 = 0x00E03670 → LE bytes 0x70 0x36 0xE0 0x00
    expect(Array.from(buf)).toEqual([0x70, 0x36, 0xE0, 0x00]);
  });

  test('round-trips', () => {
    const buf = new Uint8Array(4);
    writeField(f, 146.94, buf);
    const { raw, display } = decodeField(f, buf);
    expect(raw).toBe(14_694_000);
    expect(display).toBe('146.940000 MHz');
  });

  test('rejects below min', () => {
    expect(() => encodeValue(f, 10.0)).toThrow(/outside/);
  });

  test('rejects bad resolution', () => {
    // 146.940001 MHz = 146_940_001 Hz, not a multiple of 10
    expect(() => encodeValue(f, '146940001 Hz')).toThrow(/resolution/);
  });
});

describe('writeField — ASCII', () => {
  const f = makeField({
    type: { kind: 'ascii', maxLength: 8 },
    location: { kind: 'byte', offset: 0, size: 8 },
  });

  test('null-pads short string', () => {
    const buf = new Uint8Array(8);
    writeField(f, 'CH1', buf);
    expect(Array.from(buf)).toEqual([0x43, 0x48, 0x31, 0, 0, 0, 0, 0]);
  });

  test('writes exact-cap string without trailing null', () => {
    const buf = new Uint8Array(8);
    writeField(f, 'ABCDEFGH', buf);
    expect(Array.from(buf)).toEqual([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48]);
  });

  test('rejects too-long string', () => {
    const buf = new Uint8Array(8);
    expect(() => writeField(f, 'TOOLONGNAME', buf)).toThrow(/exceeds cap/);
  });

  test('rejects non-printable', () => {
    const buf = new Uint8Array(8);
    expect(() => writeField(f, 'AB\x01', buf)).toThrow(/non-printable/);
  });
});

describe('writeField — bit packing preserves other bits', () => {
  test('rmw single-bit field leaves adjacent bits alone', () => {
    // F4HWN byte 7: set_ptt at bit 0 (1 bit), set_scn at bit 1 (1 bit),
    // set_pwr at bits 4-7 (4 bits). Start byte = 0b1101_0010 (set_pwr=13,
    // set_scn=1, set_ptt=0). Flip set_ptt to 1 → 0b1101_0011.
    const fPtt: Field = {
      id: 'set_ptt',
      label: 'PTT',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 0, bitOffset: 0, bitWidth: 1 },
      applyMode: 'live',
    };
    const buf = new Uint8Array([0b1101_0010]);
    writeField(fPtt, true, buf);
    expect(buf[0]).toBe(0b1101_0011);
  });

  test('rmw multi-bit field leaves adjacent bits alone', () => {
    const fPwr: Field = {
      id: 'set_pwr',
      label: 'Power',
      type: { kind: 'int', min: 0, max: 15 },
      location: { kind: 'bits', offset: 0, bitOffset: 4, bitWidth: 4 },
      applyMode: 'live',
    };
    // Start: bits 0-3 = 0b0011, bits 4-7 = 0b1101 (=13).
    // Write 5 (0b0101) → bits 4-7 = 0b0101, low nibble unchanged.
    const buf = new Uint8Array([0b1101_0011]);
    writeField(fPwr, 5, buf);
    expect(buf[0]).toBe(0b0101_0011);
  });
});
