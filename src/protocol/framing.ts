/**
 * Quansheng UV-K5/UV-K1 protocol framing.
 *
 * Wire format:
 *   0xAB 0xCD | len_lo len_hi | <obfuscated body of `len` bytes> | crc_lo crc_hi | 0xDC 0xBA
 *
 * The body and CRC are both XOR-obfuscated with a 16-byte rolling key.
 * See docs/01-protocol.md for the full reference.
 */

export const SOF = Uint8Array.of(0xAB, 0xCD);
export const EOF_BYTES = Uint8Array.of(0xDC, 0xBA);

/**
 * 16-byte XOR key. Source: App/app/uart.c:163 in
 * briand/uv-k1-k5v3-firmware-custom.
 */
export const XOR_KEY = Uint8Array.of(
  0x16, 0x6C, 0x14, 0xE6, 0x2E, 0x91, 0x0D, 0x40,
  0x21, 0x35, 0xD5, 0x40, 0x13, 0x03, 0xE9, 0x80,
);

/** In-place XOR obfuscation/deobfuscation. Same operation both directions. */
export function obfuscate(body: Uint8Array, offset = 0, length?: number): void {
  const end = length === undefined ? body.length : offset + length;
  for (let i = offset; i < end; i++) {
    body[i] = body[i]! ^ XOR_KEY[(i - offset) % 16]!;
  }
}

/**
 * CRC-16/XMODEM (poly 0x1021, init 0x0000, no reflection, no XOR-out).
 * Computed over the DEOBFUSCATED body excluding the CRC itself.
 */
export function crc16Xmodem(buf: Uint8Array): number {
  let crc = 0;
  for (const byte of buf) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc & 0xFFFF;
}

export interface Frame {
  cmd: number;
  payload: Uint8Array;
}

/**
 * Build a complete wire frame from a command ID and payload.
 *
 * Layout of the deobfuscated body:
 *   cmd (u16 LE) | plen (u16 LE) | payload[plen] | crc (u16 LE)
 *
 * The body + CRC are obfuscated together starting from the CRC's predecessor
 * (i.e., from offset 0 of the deobfuscated body).
 */
export function buildFrame(cmd: number, payload: Uint8Array): Uint8Array {
  const plen = payload.length;

  // Deobfuscated body: cmd (2) + plen (2) + payload (plen)
  const bodyLen = 4 + plen;
  const body = new Uint8Array(bodyLen + 2); // +2 for CRC
  const dv = new DataView(body.buffer);
  dv.setUint16(0, cmd, true);
  dv.setUint16(2, plen, true);
  body.set(payload, 4);

  // CRC over the bodyLen bytes (not including CRC slot)
  const crc = crc16Xmodem(body.subarray(0, bodyLen));
  dv.setUint16(bodyLen, crc, true);

  // Obfuscate the entire body + CRC (bodyLen + 2 bytes)
  obfuscate(body);

  // Frame: SOF (2) + size (2) + obfuscated body+CRC + EOF (2)
  const frame = new Uint8Array(2 + 2 + body.length + 2);
  frame.set(SOF, 0);
  new DataView(frame.buffer).setUint16(2, bodyLen, true);
  frame.set(body, 4);
  frame.set(EOF_BYTES, 4 + body.length);
  return frame;
}

export class FrameError extends Error {
  constructor(message: string, public readonly raw?: Uint8Array) {
    super(message);
    this.name = 'FrameError';
  }
}

/**
 * Parse a complete wire frame back into a Frame.
 *
 * Per the asymmetry note in docs/01-protocol.md, inbound CRCs from the
 * radio are NOT validated by us — the firmware emits 0xFFFF as a
 * placeholder. We parse but don't enforce.
 */
export function parseFrame(raw: Uint8Array): Frame {
  if (raw.length < 8) throw new FrameError('frame too short', raw);
  if (raw[0] !== SOF[0] || raw[1] !== SOF[1]) {
    throw new FrameError('bad SOF', raw);
  }
  const bodyLen = new DataView(raw.buffer, raw.byteOffset).getUint16(2, true);
  if (raw.length !== 2 + 2 + bodyLen + 2 + 2) {
    throw new FrameError(
      `length mismatch: bodyLen=${bodyLen}, raw.length=${raw.length}`,
      raw,
    );
  }
  const eofStart = 4 + bodyLen + 2;
  if (raw[eofStart] !== EOF_BYTES[0] || raw[eofStart + 1] !== EOF_BYTES[1]) {
    throw new FrameError('bad EOF', raw);
  }

  // Copy and deobfuscate the body + CRC (bodyLen + 2 bytes)
  const body = raw.slice(4, 4 + bodyLen + 2);
  obfuscate(body);

  const dv = new DataView(body.buffer, body.byteOffset);
  const cmd = dv.getUint16(0, true);
  const plen = dv.getUint16(2, true);
  if (4 + plen + 2 !== body.length) {
    throw new FrameError(
      `inner length mismatch: plen=${plen}, body.length=${body.length}`,
      raw,
    );
  }
  const payload = body.slice(4, 4 + plen);
  return { cmd, payload };
}
