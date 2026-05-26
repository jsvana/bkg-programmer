import { describe, expect, it } from 'vitest';
import {
  HEIGHT,
  PIXEL_BYTES,
  WIDTH,
  getPixel,
  makeRowBitmap,
  packPageMajor,
  setPixel,
  unpackPageMajor,
} from './bitmap';

describe('packPageMajor', () => {
  it('packs a single pixel at the top-left to bit 0 of byte 0', () => {
    const buf = makeRowBitmap();
    setPixel(buf, 0, 0, true);
    const packed = packPageMajor(buf);
    expect(packed.length).toBe(PIXEL_BYTES);
    expect(packed[0]).toBe(0b00000001);
    // Every other byte should be zero.
    expect(packed.slice(1).every((b) => b === 0)).toBe(true);
  });

  it('packs a single pixel at (5, 3) to bit 3 of byte 5', () => {
    const buf = makeRowBitmap();
    setPixel(buf, 5, 3, true);
    const packed = packPageMajor(buf);
    expect(packed[5]).toBe(1 << 3);
  });

  it('packs a single pixel at (0, 8) to bit 0 of byte 128 (page 1, col 0)', () => {
    const buf = makeRowBitmap();
    setPixel(buf, 0, 8, true);
    const packed = packPageMajor(buf);
    expect(packed[128]).toBe(0b00000001);
  });

  it('packs a single pixel at (127, 63) to bit 7 of byte 1023 (page 7, col 127)', () => {
    const buf = makeRowBitmap();
    setPixel(buf, 127, 63, true);
    const packed = packPageMajor(buf);
    expect(packed[1023]).toBe(0b10000000);
  });

  it('packs a full column at x=10 with all 64 rows set', () => {
    const buf = makeRowBitmap();
    for (let y = 0; y < HEIGHT; y++) setPixel(buf, 10, y, true);
    const packed = packPageMajor(buf);
    for (let page = 0; page < 8; page++) {
      expect(packed[page * 128 + 10]).toBe(0xff);
    }
  });

  it('packs a full row at y=12 with all 128 cols set', () => {
    const buf = makeRowBitmap();
    for (let x = 0; x < WIDTH; x++) setPixel(buf, x, 12, true);
    const packed = packPageMajor(buf);
    // y=12 lives in page 1, bit 4 of each byte
    for (let col = 0; col < WIDTH; col++) {
      expect(packed[128 + col]).toBe(1 << 4);
    }
    // Everything else clear
    for (let i = 0; i < packed.length; i++) {
      if (i >= 128 && i < 256) continue;
      expect(packed[i]).toBe(0);
    }
  });

  it('round-trips through unpackPageMajor', () => {
    const buf = makeRowBitmap();
    // Sprinkle a recognizable pattern
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if ((x + y) % 7 === 0) setPixel(buf, x, y, true);
      }
    }
    const packed = packPageMajor(buf);
    const restored = unpackPageMajor(packed);
    expect(restored).toEqual(buf);
  });

  it('always produces exactly 1024 bytes', () => {
    const buf = makeRowBitmap();
    expect(packPageMajor(buf).length).toBe(1024);
  });
});

describe('setPixel / getPixel', () => {
  it('reads back what was written', () => {
    const buf = makeRowBitmap();
    setPixel(buf, 42, 17, true);
    expect(getPixel(buf, 42, 17)).toBe(1);
    expect(getPixel(buf, 43, 17)).toBe(0);
    expect(getPixel(buf, 42, 18)).toBe(0);
    setPixel(buf, 42, 17, false);
    expect(getPixel(buf, 42, 17)).toBe(0);
  });

  it('silently ignores out-of-bounds writes', () => {
    const buf = makeRowBitmap();
    setPixel(buf, -1, 0, true);
    setPixel(buf, WIDTH, 0, true);
    setPixel(buf, 0, -1, true);
    setPixel(buf, 0, HEIGHT, true);
    expect(buf.every((b) => b === 0)).toBe(true);
  });
});
