/**
 * Minimal 128x64 1-bit BMP loader. Built for the bkg_base_template.bmp
 * authored by flasher.py — we don't pretend to handle arbitrary BMPs.
 *
 * BMP format quirks we care about:
 *  - File header is 14 bytes, DIB header is variable; pixel data start is
 *    at the offset stored at byte 10 (uint32 LE).
 *  - 1-bit BMPs store rows **bottom-up** unless the height is negative.
 *  - Each row is padded to a multiple of 4 bytes. For 128 cols / 8 = 16
 *    bytes per row, no padding is needed.
 *  - Color table: 2 entries of 4 bytes each (BGRA). Whichever entry has
 *    the darker luminance is the foreground (the "on" pixel that draws
 *    dark on the K1). PIL writes index 0 = black, index 1 = white when
 *    saving mode "1", so by default `0` bit = foreground. We normalize
 *    output so the returned buffer always has `1` = foreground.
 */

import { HEIGHT, PIXEL_BYTES, ROW_BYTES, WIDTH, makeRowBitmap, type RowBitmap } from './bitmap';

const BMP_MAGIC = 0x4d42; // 'BM' little-endian

export function decodeMonoBmp(bytes: Uint8Array): RowBitmap {
  if (bytes.length < 62) {
    throw new Error(`bmp too short: ${bytes.length} bytes`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint16(0, true);
  if (magic !== BMP_MAGIC) {
    throw new Error(`not a BMP (magic=0x${magic.toString(16)})`);
  }
  const pixelOffset = dv.getUint32(10, true);
  const dibSize = dv.getUint32(14, true);
  const width = dv.getInt32(18, true);
  const heightSigned = dv.getInt32(22, true);
  const bitsPerPixel = dv.getUint16(28, true);

  if (width !== WIDTH || Math.abs(heightSigned) !== HEIGHT) {
    throw new Error(`bmp must be ${WIDTH}x${HEIGHT}, got ${width}x${heightSigned}`);
  }
  if (bitsPerPixel !== 1) {
    throw new Error(`bmp must be 1bpp, got ${bitsPerPixel}`);
  }

  // Color table sits after the DIB header. For 1bpp it's exactly 2 entries
  // of 4 bytes (BGRA). Whichever index encodes the darker color is our
  // foreground bit.
  const paletteStart = 14 + dibSize;
  const c0 = bytes.subarray(paletteStart, paletteStart + 4);
  const c1 = bytes.subarray(paletteStart + 4, paletteStart + 8);
  const lum = (c: Uint8Array) => c[0]! + c[1]! + c[2]!;
  const foregroundIsBit1 = lum(c1) < lum(c0);

  const topDown = heightSigned < 0;
  const expectedRowBytes = ROW_BYTES; // 16, already 4-aligned, no padding
  const pixelData = bytes.subarray(pixelOffset, pixelOffset + expectedRowBytes * HEIGHT);
  if (pixelData.length < expectedRowBytes * HEIGHT) {
    throw new Error(`bmp pixel data truncated: ${pixelData.length} bytes`);
  }

  const out = makeRowBitmap();
  for (let y = 0; y < HEIGHT; y++) {
    const srcRow = topDown ? y : HEIGHT - 1 - y;
    const srcOff = srcRow * expectedRowBytes;
    const dstOff = y * ROW_BYTES;
    for (let i = 0; i < ROW_BYTES; i++) {
      let b = pixelData[srcOff + i]!;
      if (!foregroundIsBit1) b = ~b & 0xff;
      out[dstOff + i] = b;
    }
  }
  if (out.length !== PIXEL_BYTES) {
    throw new Error(`decodeMonoBmp: internal size mismatch: ${out.length}`);
  }
  return out;
}
