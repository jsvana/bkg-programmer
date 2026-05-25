/**
 * Field codec — encode/decode between user-facing values and the raw
 * bytes that live in EEPROM.
 *
 * Every read or write of a Field goes through here. This is what
 * docs/07-backup-format.md's diff stub (src/backup/diff.ts) is missing:
 * a schema-aware encoder/decoder. The config loader and the diff
 * computation can both build on it.
 *
 * Endianness: all multi-byte byte locations are little-endian, matching
 * the protocol convention (see src/protocol/framing.ts and DualTachyon
 * tools/serialtool/msg.py). Bit fields read LSB-first within a byte.
 *
 * NOT covered (intentional):
 *   - `bcd` and `opaque` types: not used by any current field; codec
 *     errors loudly if encountered, rather than guessing semantics.
 */

import type { Field, FieldType, Location, EnumValue } from '../schema/types';
import type { ConfigValue } from './types';

// =============================================================
// Read path
// =============================================================

/**
 * Decode a field from the bytes of its containing block/struct.
 * `recordBytes` is the full struct (size matching the field's
 * declared template), so all field locations are valid indices.
 *
 * Returns the raw integer (the on-disk representation) and a
 * display string (the user-facing rendering, e.g. enum label,
 * formatted ASCII, or "146.940000 MHz").
 */
export function decodeField(field: Field, recordBytes: Uint8Array): {
  raw: number;
  display: string;
} {
  const raw = readRaw(field.location, recordBytes);
  return { raw, display: renderDisplay(field.type, raw, recordBytes, field.location) };
}

function readRaw(loc: Location, bytes: Uint8Array): number {
  if (loc.kind === 'byte') {
    if (loc.offset + loc.size > bytes.length) {
      throw new Error(
        `Field byte range [${loc.offset}, ${loc.offset + loc.size}) exceeds record of ${bytes.length} bytes`,
      );
    }
    let v = 0;
    for (let i = loc.size - 1; i >= 0; i--) {
      v = (v * 256) + (bytes[loc.offset + i] ?? 0);
    }
    return v;
  }
  // bits
  const byte = bytes[loc.offset] ?? 0;
  const mask = ((1 << loc.bitWidth) - 1) << loc.bitOffset;
  return (byte & mask) >>> loc.bitOffset;
}

function renderDisplay(
  type: FieldType,
  raw: number,
  bytes: Uint8Array,
  loc: Location,
): string {
  switch (type.kind) {
    case 'bool':
      return raw === 0 ? 'false' : 'true';
    case 'enum': {
      const match = type.values.find((v) => v.value === raw);
      return match ? match.label : `(unknown=${raw})`;
    }
    case 'int':
      return type.unit ? `${raw} ${type.unit}` : String(raw);
    case 'frequency': {
      const hz = raw * type.resolutionHz;
      const mhz = hz / 1_000_000;
      return `${mhz.toFixed(6)} MHz`;
    }
    case 'ascii': {
      // Read up to location.size bytes (must be byte-located).
      if (loc.kind !== 'byte') {
        throw new Error('ASCII field must use byte-kind location');
      }
      const slice = bytes.subarray(loc.offset, loc.offset + loc.size);
      let end = slice.length;
      for (let i = 0; i < slice.length; i++) {
        if (slice[i] === 0) {
          end = i;
          break;
        }
      }
      let s = '';
      for (let i = 0; i < end; i++) {
        const c = slice[i] ?? 0;
        s += c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : '�';
      }
      return JSON.stringify(s);
    }
    case 'bcd':
    case 'opaque':
      return `(raw=${raw})`;
  }
}

// =============================================================
// Write path
// =============================================================

/**
 * Convert a user-facing config value into the raw integer for the
 * field. Throws ConfigEncodeError with a structured kind so callers
 * can attach config paths and accumulate errors.
 */
export function encodeValue(field: Field, value: ConfigValue): number {
  const { type } = field;
  switch (type.kind) {
    case 'bool': {
      if (typeof value !== 'boolean') {
        throw new ConfigEncodeError('value-wrong-type', `expected boolean, got ${typeof value}`);
      }
      return value ? 1 : 0;
    }
    case 'enum':
      return encodeEnum(type.values, value);
    case 'int':
      return encodeInt(type.min, type.max, value);
    case 'frequency': {
      const hz = encodeFrequencyHz(value);
      if (hz < type.min || hz > type.max) {
        throw new ConfigEncodeError(
          'value-out-of-range',
          `frequency ${hz} Hz outside [${type.min}, ${type.max}]`,
        );
      }
      if (hz % type.resolutionHz !== 0) {
        throw new ConfigEncodeError(
          'value-out-of-range',
          `frequency ${hz} Hz not a multiple of resolution ${type.resolutionHz} Hz`,
        );
      }
      return hz / type.resolutionHz;
    }
    case 'ascii':
      // ASCII isn't a single integer; it spans multiple bytes. The
      // codec returns a sentinel and writeField() handles ASCII
      // directly by branching on field.type.kind.
      throw new ConfigEncodeError(
        'value-wrong-type',
        'ASCII fields cannot be encoded as a single integer; use writeField()',
      );
    case 'bcd':
    case 'opaque':
      throw new ConfigEncodeError(
        'value-wrong-type',
        `field type "${type.kind}" not supported by codec`,
      );
  }
}

function encodeEnum(values: ReadonlyArray<EnumValue>, value: ConfigValue): number {
  if (typeof value === 'number') {
    const ok = values.some((v) => v.value === value);
    if (!ok) {
      const allowed = values.map((v) => `${v.value} (${v.label})`).join(', ');
      throw new ConfigEncodeError('value-bad-enum', `enum value ${value} not in [${allowed}]`);
    }
    return value;
  }
  if (typeof value === 'string') {
    const match = values.find((v) => v.label === value);
    if (!match) {
      const allowed = values.map((v) => `"${v.label}"`).join(', ');
      throw new ConfigEncodeError('value-bad-enum', `enum label "${value}" not in [${allowed}]`);
    }
    return match.value;
  }
  throw new ConfigEncodeError(
    'value-wrong-type',
    `enum expects number or string, got ${typeof value}`,
  );
}

function encodeInt(min: number, max: number, value: ConfigValue): number {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) {
    n = Number.parseInt(value.slice(2), 16);
  } else {
    throw new ConfigEncodeError(
      'value-wrong-type',
      `int expects number (or 0x-prefixed hex string), got ${typeof value}`,
    );
  }
  if (!Number.isInteger(n)) {
    throw new ConfigEncodeError('value-wrong-type', `int expects integer, got ${n}`);
  }
  if (n < min || n > max) {
    throw new ConfigEncodeError(
      'value-out-of-range',
      `int ${n} outside [${min}, ${max}]`,
    );
  }
  return n;
}

/**
 * Accepts:
 *   - number: assumed to be Hz already
 *   - string "146.94 MHz" | "146940 kHz" | "146940000 Hz" | "146.94"
 *     (bare number string in MHz, only for hand-written configs)
 *
 * Returns Hz.
 */
function encodeFrequencyHz(value: ConfigValue): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ConfigEncodeError('value-wrong-type', `frequency must be finite`);
    }
    // Heuristic: bare numbers under 10_000 are MHz; otherwise Hz.
    // The schema's min is 18_000_000 Hz so anything under 10_000 can't
    // be a sensible Hz value.
    return value < 10_000 ? Math.round(value * 1_000_000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(hz|khz|mhz|ghz)?$/i);
    if (!m) {
      throw new ConfigEncodeError(
        'value-wrong-type',
        `frequency string "${value}" not recognized (try "146.94 MHz" or 146940000)`,
      );
    }
    const num = Number.parseFloat(m[1]!);
    const unit = (m[2] ?? 'mhz').toLowerCase();
    const mul =
      unit === 'hz' ? 1 :
      unit === 'khz' ? 1_000 :
      unit === 'mhz' ? 1_000_000 :
      1_000_000_000;
    return Math.round(num * mul);
  }
  throw new ConfigEncodeError(
    'value-wrong-type',
    `frequency expects number or string, got ${typeof value}`,
  );
}

/**
 * Write a field into a (mutable) record buffer. Handles bit-packing
 * (read-modify-write of the affected byte) and ASCII (null-padded).
 *
 * Returns the byte range within `recordBytes` that was modified, so
 * callers can build the absolute byteRange for a FieldChange by
 * adding the record's base offset.
 */
export function writeField(
  field: Field,
  value: ConfigValue,
  recordBytes: Uint8Array,
): { offset: number; length: number; rawEncoded: number } {
  if (field.type.kind === 'ascii') {
    return writeAscii(field, value, recordBytes);
  }
  const raw = encodeValue(field, value);
  return writeRaw(field.location, raw, recordBytes);
}

function writeRaw(loc: Location, raw: number, bytes: Uint8Array): {
  offset: number;
  length: number;
  rawEncoded: number;
} {
  if (loc.kind === 'byte') {
    if (loc.offset + loc.size > bytes.length) {
      throw new Error(
        `byte location [${loc.offset}, ${loc.offset + loc.size}) exceeds record of ${bytes.length} bytes`,
      );
    }
    let v = raw >>> 0;
    for (let i = 0; i < loc.size; i++) {
      bytes[loc.offset + i] = v & 0xFF;
      v = Math.floor(v / 256);
    }
    return { offset: loc.offset, length: loc.size, rawEncoded: raw };
  }
  // bits
  if (loc.offset >= bytes.length) {
    throw new Error(`bits location byte ${loc.offset} exceeds record of ${bytes.length} bytes`);
  }
  const mask = ((1 << loc.bitWidth) - 1) << loc.bitOffset;
  const cur = bytes[loc.offset] ?? 0;
  bytes[loc.offset] = ((cur & ~mask) | ((raw << loc.bitOffset) & mask)) & 0xFF;
  return { offset: loc.offset, length: 1, rawEncoded: raw };
}

function writeAscii(field: Field, value: ConfigValue, bytes: Uint8Array): {
  offset: number;
  length: number;
  rawEncoded: number;
} {
  if (typeof value !== 'string') {
    throw new ConfigEncodeError('value-wrong-type', `ASCII expects string, got ${typeof value}`);
  }
  if (field.type.kind !== 'ascii' || field.location.kind !== 'byte') {
    throw new Error('writeAscii called with non-ASCII or non-byte-located field');
  }
  const cap = Math.min(field.type.maxLength, field.location.size);
  if (value.length > cap) {
    throw new ConfigEncodeError(
      'value-out-of-range',
      `ASCII value "${value}" (${value.length} chars) exceeds cap of ${cap}`,
    );
  }
  // Validate ASCII range. Allow space (0x20) through tilde (0x7E).
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7E) {
      throw new ConfigEncodeError(
        'value-wrong-type',
        `ASCII value contains non-printable char 0x${code.toString(16)} at position ${i}`,
      );
    }
  }
  const off = field.location.offset;
  const size = field.location.size;
  for (let i = 0; i < size; i++) {
    bytes[off + i] = i < value.length ? value.charCodeAt(i) : 0;
  }
  return { offset: off, length: size, rawEncoded: 0 };
}

// =============================================================
// Error class
// =============================================================

export class ConfigEncodeError extends Error {
  constructor(
    public readonly kind:
      | 'value-wrong-type'
      | 'value-out-of-range'
      | 'value-bad-enum',
    message: string,
  ) {
    super(message);
    this.name = 'ConfigEncodeError';
  }
}
