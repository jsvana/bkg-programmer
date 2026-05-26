/**
 * Splash bitmap primitives.
 *
 * The on-the-wire representation we send to the K1 display is page-major
 * LSB-top, the ST7565/ST7567 / UC1701 / SSD1306 convention used by every
 * 128x64 monochrome controller in this family.
 *
 * Internally we keep the image as a Uint8Array of length WIDTH*HEIGHT/8 in
 * **row-major MSB-first** order — same convention as a 1-bit BMP. The two
 * representations are isomorphic; we only convert when we need to talk
 * to the radio.
 *
 * Bit semantics throughout: `1` = foreground (the "on" pixel that draws
 * dark on the K1's positive-mode LCD). `0` = background.
 *
 * NB the K1 firmware's foreground polarity is **not verified against a
 * file:line citation in briand's fork** at the time of writing. If the
 * splash comes up inverted on a real radio, write the same bytes again
 * with `invert: true` in the renderer.
 */

export const WIDTH = 128;
export const HEIGHT = 64;
export const ROW_BYTES = WIDTH / 8; // 16
export const PIXEL_BYTES = (WIDTH * HEIGHT) / 8; // 1024
export const PAGE_BYTES = WIDTH; // one byte per column per page
export const PAGE_COUNT = HEIGHT / 8; // 8

/** Row-major MSB-first 128x64 1-bit buffer, 1024 bytes. */
export type RowBitmap = Uint8Array;

export function makeRowBitmap(): RowBitmap {
  return new Uint8Array(PIXEL_BYTES);
}

export function getPixel(buf: RowBitmap, x: number, y: number): 0 | 1 {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return 0;
  const byteIdx = y * ROW_BYTES + (x >> 3);
  const bit = 7 - (x & 7);
  return (buf[byteIdx]! & (1 << bit)) ? 1 : 0;
}

export function setPixel(buf: RowBitmap, x: number, y: number, on: boolean): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const byteIdx = y * ROW_BYTES + (x >> 3);
  const bit = 7 - (x & 7);
  if (on) buf[byteIdx]! |= 1 << bit;
  else buf[byteIdx]! &= ~(1 << bit) & 0xff;
}

/** Bit-invert every pixel. Mutates in place; returns the same buffer. */
export function invertInPlace(buf: RowBitmap): RowBitmap {
  for (let i = 0; i < buf.length; i++) buf[i] = ~buf[i]! & 0xff;
  return buf;
}

/**
 * Pack the row-major bitmap into page-major LSB-top display bytes.
 *
 * Output layout:
 *   - 8 pages, each 128 bytes (one byte per column)
 *   - byte[page*128 + col] bit b => pixel at (col, page*8 + b)
 *   - bit 0 (LSB) is the top pixel of the page
 *
 * Total: 1024 bytes.
 */
export function packPageMajor(buf: RowBitmap): Uint8Array {
  if (buf.length !== PIXEL_BYTES) {
    throw new Error(`packPageMajor: expected ${PIXEL_BYTES} bytes, got ${buf.length}`);
  }
  const out = new Uint8Array(PIXEL_BYTES);
  for (let page = 0; page < PAGE_COUNT; page++) {
    for (let col = 0; col < WIDTH; col++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const y = page * 8 + b;
        if (getPixel(buf, col, y)) byte |= 1 << b;
      }
      out[page * PAGE_BYTES + col] = byte;
    }
  }
  return out;
}

/** Inverse of packPageMajor: page-major LSB-top -> row-major MSB-first. */
export function unpackPageMajor(packed: Uint8Array): RowBitmap {
  if (packed.length !== PIXEL_BYTES) {
    throw new Error(`unpackPageMajor: expected ${PIXEL_BYTES} bytes, got ${packed.length}`);
  }
  const out = makeRowBitmap();
  for (let page = 0; page < PAGE_COUNT; page++) {
    for (let col = 0; col < WIDTH; col++) {
      const byte = packed[page * PAGE_BYTES + col]!;
      for (let b = 0; b < 8; b++) {
        if (byte & (1 << b)) setPixel(out, col, page * 8 + b, true);
      }
    }
  }
  return out;
}
