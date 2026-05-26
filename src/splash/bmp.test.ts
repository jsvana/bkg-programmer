import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeMonoBmp } from './bmp';
import { HEIGHT, PIXEL_BYTES, WIDTH, getPixel } from './bitmap';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(here, '../../public/bkg_base_template.bmp');

describe('decodeMonoBmp', () => {
  it('decodes the BKG base template into a 1024-byte buffer', async () => {
    const raw = await readFile(TEMPLATE_PATH);
    const buf = decodeMonoBmp(new Uint8Array(raw));
    expect(buf.length).toBe(PIXEL_BYTES);
  });

  it('produces a non-empty bitmap (template has actual content)', async () => {
    const raw = await readFile(TEMPLATE_PATH);
    const buf = decodeMonoBmp(new Uint8Array(raw));
    const set = Array.from(buf).reduce((acc, b) => acc + popcount(b), 0);
    // Template has substantial foreground content; if it's <1% or >99% lit
    // something's wrong with the decoder.
    const total = WIDTH * HEIGHT;
    expect(set).toBeGreaterThan(total * 0.05);
    expect(set).toBeLessThan(total * 0.95);
  });

  it('decodes the right panel as solid foreground (template fills it; flasher overdraws)', async () => {
    // PIL inspection of the source BMP: every pixel in x>=96 is value 0
    // (black, "on" in K1 polarity). After our normalize-to-1=foreground
    // conversion, those bits should be set. flasher.py paste()s the
    // rendered right panel over the top, so the template's content there
    // doesn't matter visually — but the decoder must round-trip it
    // faithfully.
    const raw = await readFile(TEMPLATE_PATH);
    const buf = decodeMonoBmp(new Uint8Array(raw));
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 96; x < WIDTH; x++) {
        expect(getPixel(buf, x, y)).toBe(1);
      }
    }
  });

  it('rejects non-BMP input', () => {
    const garbage = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => decodeMonoBmp(garbage)).toThrow();
  });
});

function popcount(b: number): number {
  let c = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) c++;
  return c;
}
