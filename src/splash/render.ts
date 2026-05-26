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
// Max font sizes (in 8x supersampled space). Shrink-to-fit clamps these per
// string so a 6-char callsign and a short "#42" both use as much of the
// available 30×30 cell as they can. The K1's tall display pixels mean
// source N-px text reads ~1.5×N at viewing distance — so generous source
// sizes are safe.
const CALL_FONT_PX_MAX = 22 * SCALE;
const NUM_FONT_PX_MAX = 24 * SCALE;
const THRESHOLD = 100;

const RIGHT_PANEL_X = 96;
const RIGHT_PANEL_Y = 0;
const PANEL_W = 32;
const PANEL_H = 64;

const CALLSIGN_CENTER: readonly [number, number] = [16, 16];
const NUMBER_CENTER: readonly [number, number] = [16, 48];
// Fit windows: leave a 1-px margin around the 32×32 cell so glyphs don't
// kiss the panel edge or the divider.
const CALL_MAX_W = 30 * SCALE;
const CALL_MAX_H = 28 * SCALE;
const NUM_MAX_W = 30 * SCALE;
const NUM_MAX_H = 28 * SCALE;
const DIVIDER_Y = 32;
const DIVIDER_X0 = 2;
const DIVIDER_X1 = 30;

const FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const MAX_CALLSIGN_LEN = 6;

export interface RenderOptions {
  /** Invert all pixels in the composited result (firmware polarity flip). */
  invert?: boolean;
}

/**
 * Composite the dynamic right panel onto a copy of `template`. Returns the
 * new bitmap; `template` is not mutated.
 *
 * Requires a `document` global — browser/jsdom only. The unit tests for
 * bitmap.ts cover the parts that need to run headless; this function is
 * exercised by the UI panel.
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

  // Callsign — shrink-to-fit so 4-char calls don't render at the same tiny
  // size required for 6-char calls. The 6-char limit means a fixed size has
  // to be tuned for the worst case, which leaves shorter strings looking
  // half-empty inside their cell.
  drawTextFitted(
    ctx,
    callText,
    CALLSIGN_CENTER[0] * SCALE,
    CALLSIGN_CENTER[1] * SCALE,
    CALL_MAX_W,
    CALL_MAX_H,
    CALL_FONT_PX_MAX,
  );

  // Divider hairline
  ctx.fillRect(
    DIVIDER_X0 * SCALE,
    DIVIDER_Y * SCALE,
    (DIVIDER_X1 - DIVIDER_X0) * SCALE,
    Math.max(1, Math.floor(SCALE / 2)),
  );

  // BKG number — same shrink-to-fit treatment.
  drawTextFitted(
    ctx,
    numText,
    NUMBER_CENTER[0] * SCALE,
    NUMBER_CENTER[1] * SCALE,
    NUM_MAX_W,
    NUM_MAX_H,
    NUM_FONT_PX_MAX,
  );

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

/**
 * Bold, centered, shrink-to-fit. Re-measures up to a few times scaling the
 * font down by the binding-dimension ratio. Width is the usual binding
 * constraint here; the height check guards numeric overflow cases like
 * "#9999".
 */
function drawTextFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  maxHeight: number,
  basePx: number,
): void {
  let px = basePx;
  for (let i = 0; i < 8; i++) {
    ctx.font = `bold ${Math.max(1, Math.floor(px))}px ${FONT_FAMILY}`;
    const m = ctx.measureText(text);
    const approxH = px * 0.8; // bold caps run ~0.8 of font-px tall
    const wOk = m.width <= maxWidth;
    const hOk = approxH <= maxHeight;
    if (wOk && hOk) break;
    const wScale = wOk ? 1 : maxWidth / m.width;
    const hScale = hOk ? 1 : maxHeight / approxH;
    px = Math.floor(px * Math.min(wScale, hScale) * 0.98);
    if (px < 4) break;
  }
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
