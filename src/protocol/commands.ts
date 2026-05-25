/**
 * Command builders. Each function returns a payload (the part inside the
 * frame body, after cmd and plen). The framing layer wraps it.
 */

import { buildFrame, parseFrame, type Frame } from './framing';

export type { Frame };

export const CMD = {
  HELLO: 0x0514,
  HELLO_REPLY: 0x0515,
  READ_EEPROM: 0x051B,
  READ_EEPROM_REPLY: 0x051C,
  WRITE_EEPROM: 0x051D,
  WRITE_EEPROM_REPLY: 0x051E,
  REBOOT: 0x05DD,
  // bootloader-related, used for flash:
  BOOTLOADER_NOTIFY_DEV_INFO: 0x0518,
  BOOTLOADER_NOTIFY_BL_VER: 0x0530,
} as const;

// ============ Hello ============

export function buildHello(timestamp: number): Uint8Array {
  const payload = new Uint8Array(16);
  new DataView(payload.buffer).setUint32(0, timestamp >>> 0, true);
  // bytes 4-15 are padding (zero)
  return buildFrame(CMD.HELLO, payload);
}

export interface HelloReply {
  versionString: string;          // 16 bytes, null-padded
  hasCustomAesKey: boolean;
  isInLockScreen: boolean;
  aesChallenge: [number, number, number, number];
  raw: Uint8Array;                // full payload, for diagnostics
}

export function parseHelloReply(payload: Uint8Array): HelloReply {
  if (payload.length < 28) {
    throw new Error(`hello reply too short: ${payload.length} bytes`);
  }
  const versionBytes = payload.subarray(0, 16);
  const nullIdx = versionBytes.indexOf(0);
  const versionString = new TextDecoder('ascii').decode(
    nullIdx >= 0 ? versionBytes.subarray(0, nullIdx) : versionBytes,
  );
  const hasCustomAesKey = payload[16] !== 0;
  const isInLockScreen = payload[17] !== 0;
  const dv = new DataView(payload.buffer, payload.byteOffset);
  return {
    versionString,
    hasCustomAesKey,
    isInLockScreen,
    aesChallenge: [
      dv.getUint32(20, true),
      dv.getUint32(24, true),
      dv.getUint32(28, true) ?? 0,
      dv.getUint32(32, true) ?? 0,
    ] as [number, number, number, number],
    raw: payload,
  };
}

// ============ Read EEPROM ============

export function buildReadEeprom(
  address: number,
  size: number,
  timestamp: number,
): Uint8Array {
  if (size > 0x80) throw new Error(`read size > 0x80: ${size}`);
  const payload = new Uint8Array(8);
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, address, true);
  dv.setUint8(2, size);
  dv.setUint8(3, 0);                // padding
  dv.setUint32(4, timestamp >>> 0, true);
  return buildFrame(CMD.READ_EEPROM, payload);
}

export interface ReadEepromReply {
  address: number;
  size: number;
  data: Uint8Array;
}

export function parseReadEepromReply(payload: Uint8Array): ReadEepromReply {
  if (payload.length < 4) throw new Error('read reply too short');
  const dv = new DataView(payload.buffer, payload.byteOffset);
  const address = dv.getUint16(0, true);
  const size = dv.getUint8(2);
  const data = payload.slice(4, 4 + size);
  return { address, size, data };
}

// ============ Write EEPROM ============

export interface WriteOpts {
  allowPassword?: boolean;
}

export function buildWriteEeprom(
  address: number,
  data: Uint8Array,
  timestamp: number,
  opts: WriteOpts = {},
): Uint8Array {
  if (data.length === 0 || data.length % 8 !== 0) {
    throw new Error(`write data must be non-empty multiple of 8: got ${data.length}`);
  }
  if (data.length > 0xFF) {
    throw new Error(`write data > 0xFF bytes: ${data.length}`);
  }
  const payload = new Uint8Array(8 + data.length);
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, address, true);
  dv.setUint8(2, data.length);
  dv.setUint8(3, opts.allowPassword ? 1 : 0);
  dv.setUint32(4, timestamp >>> 0, true);
  payload.set(data, 8);
  return buildFrame(CMD.WRITE_EEPROM, payload);
}

// ============ Reboot ============

export function buildReboot(): Uint8Array {
  return buildFrame(CMD.REBOOT, new Uint8Array(0));
}

// ============ Helpers ============

/**
 * Detect a frame in a stream buffer. Returns the frame bytes (sliced) and
 * the consumed length if a complete frame is found, otherwise null.
 *
 * Useful for stream-oriented WebSerial reading where multiple frames may
 * arrive together or be split across reads.
 */
export function tryExtractFrame(
  buf: Uint8Array,
): { frame: Frame; consumed: number } | null {
  // Find SOF
  let i = 0;
  while (i < buf.length - 1) {
    if (buf[i] === 0xAB && buf[i + 1] === 0xCD) break;
    i++;
  }
  if (i >= buf.length - 1) return null;

  // Need at least SOF (2) + len (2) + EOF (2) = 6 bytes minimum
  if (buf.length - i < 8) return null;

  const bodyLen = (buf[i + 2]! | (buf[i + 3]! << 8)) >>> 0;
  const totalLen = 2 + 2 + bodyLen + 2 + 2;
  if (buf.length - i < totalLen) return null;

  const raw = buf.slice(i, i + totalLen);
  try {
    return { frame: parseFrame(raw), consumed: i + totalLen };
  } catch {
    // bad frame — advance past SOF and retry
    return null;
  }
}
