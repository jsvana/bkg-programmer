/**
 * BKG badge renderer — TS port of flasher.py.
 *
 * Produces a 128x64 1-bit `RowBitmap` for a given (callsign, bkg_num) by
 * compositing the operator panel onto the base template.
 *
 * Parity with flasher.py: NOT byte-identical. Browser Canvas font rendering
 * differs from PIL+FreeType (and from machine to machine). The supersample +
 * threshold pipeline keeps the output visually equivalent, but if you need
 * deterministic pixels across platforms, embed a hand-rolled 5x7 bitmap
 * font here per the spec's caveat #1.
 */

import {
  HEIGHT,
  WIDTH,
  invertInPlace,
  makeRowBitmap,
  setPixel,
  type RowBitmap,
} from './bitmap';

const SCALE = 8;
const CALL_FONT_PX = 58; // in 8x space
const NUM_FONT_PX = 66;  // in 8x space
const THRESHOLD = 100;

const RIGHT_PANEL_X = 96;
const RIGHT_PANEL_Y = 0;
const PANEL_W = 32;
const PANEL_H = 64;

const CALLSIGN_CENTER: readonly [number, number] = [16, 16];
const NUMBER_CENTER: readonly [number, number] = [16, 48];
const DIVIDER_Y = 32;
const DIVIDER_X0 = 2;
const DIVIDER_X1 = 30;

export const MAX_CALLSIGN_LEN = 6;

export interface RenderOptions {
  /** Invert all pixels in the composited result (firmware polarity flip). */
  invert?: boolean;
}

/**
 * Render the right panel into the destination bitmap. Mutates `dst`.
 *
 * Requires a `document` global — browser/jsdom only. The unit tests for
 * bitmap.ts / bmp.ts cover the parts that need to run headless; this
 * function is exercised by the UI panel.
 */
export function renderBadge(
  template: RowBitmap,
  callsign: string,
  bkgNum: number,
  opts: RenderOptions = {},
): RowBitmap {
  if (callsign.length === 0) throw new Error('callsign required');
  if (callsign.length > MAX_CALLSIGN_LEN) {
    throw new Error(`callsign exceeds ${MAX_CALLSIGN_LEN} chars: ${callsign}`);
  }
  if (!Number.isInteger(bkgNum) || bkgNum < 0) {
    throw new Error(`bkg_num must be a non-negative integer: ${bkgNum}`);
  }

  if (typeof document === 'undefined') {
    throw new Error('renderBadge requires a DOM (browser-only)');
  }

  const callText = callsign.toUpperCase();
  const numText = `#${String(bkgNum).padStart(3, '0')}`;

  // Render at 8x and threshold down — same idea as PIL LANCZOS + point().
  const big = document.createElement('canvas');
  big.width = PANEL_W * SCALE;
  big.height = PANEL_H * SCALE;
  const ctx = big.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('failed to get 2d context');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, big.width, big.height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Callsign
  ctx.font = `bold ${CALL_FONT_PX}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  drawCenteredText(ctx, callText, CALLSIGN_CENTER[0] * SCALE, CALLSIGN_CENTER[1] * SCALE);

  // Divider hairline
  ctx.fillRect(
    DIVIDER_X0 * SCALE,
    DIVIDER_Y * SCALE,
    (DIVIDER_X1 - DIVIDER_X0) * SCALE,
    Math.max(1, Math.floor(SCALE / 2)),
  );

  // BKG number
  ctx.font = `bold ${NUM_FONT_PX}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  drawCenteredText(ctx, numText, NUMBER_CENTER[0] * SCALE, NUMBER_CENTER[1] * SCALE);

  // Downsample to 32x64 by averaging the 8x8 blocks. We do this manually
  // (rather than via ctx.drawImage scaling) so the threshold is applied to
  // a known luminance value, not whatever the browser's resampler produces.
  const big_data = ctx.getImageData(0, 0, big.width, big.height);
  const result = template.slice(); // copy
  for (let py = 0; py < PANEL_H; py++) {
    for (let px = 0; px < PANEL_W; px++) {
      let sum = 0;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const sx = px * SCALE + dx;
          const sy = py * SCALE + dy;
          const i = (sy * big.width + sx) * 4;
          // The buffer is black (0) where we drew nothing and white (255)
          // where text/divider was drawn. R channel is enough.
          sum += big_data.data[i]!;
        }
      }
      const avg = sum / (SCALE * SCALE);
      // Polarity: flasher.py draws white text on black bg. In K1 / SSD1306
      // wire terms, the *background* of the panel is the "on" bit (dark on
      // K1) and the text is the "off" bit (lit, visible). So canvas-white
      // (the drawn text) => 0 in our 1=on buffer, canvas-black => 1.
      setPixel(result, RIGHT_PANEL_X + px, RIGHT_PANEL_Y + py, avg < THRESHOLD);
    }
  }

  return opts.invert ? invertInPlace(result) : result;
}

function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
): void {
  ctx.fillText(text, cx, cy);
}

/**
 * Convert a RowBitmap to an ImageData suitable for preview rendering at a
 * given integer zoom. `1` bits draw dark; `0` bits draw light. The
 * `invertPreview` toggle exists only for the preview UI — it does NOT
 * affect what's written to the radio (use RenderOptions.invert for that).
 */
export function toPreviewImageData(
  buf: RowBitmap,
  zoom: number,
  invertPreview = false,
): ImageData {
  if (typeof ImageData === 'undefined') {
    throw new Error('toPreviewImageData requires a DOM');
  }
  const w = WIDTH * zoom;
  const h = HEIGHT * zoom;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const byteIdx = y * (WIDTH / 8) + (x >> 3);
      const bit = 7 - (x & 7);
      let on = (buf[byteIdx]! & (1 << bit)) !== 0;
      if (invertPreview) on = !on;
      // Foreground = dark; background = K1 backlight blue
      const r = on ? 0x12 : 0x66;
      const g = on ? 0x12 : 0xaa;
      const b = on ? 0x18 : 0xff;
      for (let dy = 0; dy < zoom; dy++) {
        for (let dx = 0; dx < zoom; dx++) {
          const i = ((y * zoom + dy) * w + (x * zoom + dx)) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 0xff;
        }
      }
    }
  }
  return new ImageData(data, w, h);
}
