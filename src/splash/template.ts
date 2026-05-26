/**
 * Static base template for the BKG splash, generated in-canvas at runtime.
 *
 * Replaces the prior `public/bkg_base_template.bmp` + `bmp.ts` loader. The
 * runtime generator lets us iterate on layout/font-size without round-
 * tripping through an external image tool, and bakes display-pixel-
 * aspect compensation into the source.
 *
 * Polarity: UNIFORM dark background with lit foreground across the whole
 * splash. Concretely:
 *   - The whole 128×64 buffer is bit-1 (dark on K1's positive-mode LCD) by
 *     default; text and badge foreground pixels are bit-0 (lit).
 *   - Static left text "BKG 4 LYFE" and the central badge art use that
 *     polarity here.
 *   - The dynamic right panel rendered by render.ts already uses the same
 *     polarity, so the two halves of the screen now read as a single
 *     unified surface instead of the old mixed-polarity layout.
 *   - The user-facing `invert` toggle still flips the final composite, so
 *     a radio that wants opposite polarity is one click away.
 *
 * Pixel-aspect compensation: the UV-K1 LCD's physical pixels are ~1.5×
 * as tall as wide. Anything that should look round on the radio is drawn
 * ~1.5× wider than tall in source. The central BKG badge is embedded as
 * a 72×64 1-bit asset (the original hand-authored art with circular
 * wordmark + fist emblem) and area-averaged down to a wider-than-tall
 * target so it reads as roughly round on the radio.
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
const THRESHOLD = 128;

// Layout in source-pixel units. Total surface is 128×64.
const LEFT_X0 = 0;
const LEFT_X1 = 24;            // 24 cols for "BKG 4 LYFE" stacked vertically
const CENTER_X0 = LEFT_X1;
const CENTER_X1 = 96;          // 72 cols for the central BKG badge (= asset native width)
const RIGHT_X0 = 96;           // 96..128 reserved for dynamic right panel

// Left text stack. Three lines, vertically distributed inside 0..64.
const LEFT_LINES = ['BKG', '4', 'LYFE'] as const;
const LEFT_LINE_Y = [14, 32, 50] as const; // vertical centers, source coords
const LEFT_FONT_PX = 14 * SCALE;            // generous start; shrink-to-fit clamps width
const LEFT_MAX_TEXT_W = (LEFT_X1 - LEFT_X0 - 2) * SCALE;
const LEFT_MAX_TEXT_H = 14 * SCALE;

// Central badge target geometry. The art asset is 72×64 in its native form
// (square aspect — designed for square-pixel displays). The K1's LCD pixels
// are ~1.5× as tall as wide, so we squash vertically to give a wider-than-
// tall target (W/H ≈ 1.5) and let the display's vertical stretch restore
// the roundness. Width is set to the asset's full native 72 cols — no
// horizontal downsample, which is the single biggest source of resampling
// artifacts on thin pixel-art features like the badge's ring outline and
// the "BKG KNUCKLES" wordmark.
const CENTER_TARGET_W = CENTER_X1 - CENTER_X0;             // 72 (= asset W)
const CENTER_TARGET_H = Math.round(CENTER_TARGET_W / 1.5); // 48
const CENTER_TARGET_X = CENTER_X0;                         // 24
const CENTER_TARGET_Y = Math.floor((HEIGHT - CENTER_TARGET_H) / 2); // 8

// 72×64 1-bit BKG badge (circular "BKG KNUCKLES" wordmark + fist emblem).
// Row-major MSB-first, 1 = foreground (should be LIT on K1). 9 bytes/row ×
// 64 rows = 576 bytes total. Extracted verbatim from the original hand-
// authored bkg_base_template.bmp (cropped to columns 24..96); kept here
// verbatim so the splash flasher has no runtime asset dependency.
const CENTER_ART_W = 72;
const CENTER_ART_H = 64;
const CENTER_ART_ROW_BYTES = 9; // ceil(72/8)
const CENTER_ART_B64 =
  '/////+AH/////////j/8f///////8/APz///////zgGAc///////MIABDP/////+xASQIz/////' +
  '7kJW9Cd/////2QtSjwm/////tHPWjkLf////aDlM7EFv///+kD0ACoyX///9phAfgI5L///7RQ' +
  'HAONgt///+hoYABjAW///1IZgAAZhK///oLCAAAEHhf//qNMHgeDElv//QDYP//BlCv//R4QMP' +
  'jAzA/P+g8gYHBwQZXP+gRP4GA/J4X/9iKfwGA/kwLP9HCwQGAw0gLH9F0wYGBgSOLn/DkgMPDgS' +
  'cNH6AkgP//gQPF/6PIwfgfgRcF/6KoQ4ABwxAF/6Pof4AB/hPF/6BIC4AB2BJH/6AIAYABgANH' +
  '/6AAAcADgAAH/6AAB/AH4AAH/6AIA///wAAH/6AIAB/4AAAF/6AIAAAAABAF/6AIAAAAABAF/6' +
  'AIAAAAABAFD6AEAAAAAAAFf9AEAAAAACAPD9AEAAAAACALD9ACAAAAAEALf/gCA+ZHgEALD+gB' +
  'AybMgIAXD+gQgyeYAQgX//QIQ+eZgQA///QAYzbYghAv//qEMzZNzCB///sCC+ZnGABf//0ABA' +
  'AAIAC///6AQQAAwgW///7QgGAGAgt///9oOA/wCRL///+0MwAAuCX////aFhAC0Ev////sAitj' +
  'wDf////2QKlgAm/////5gDIgAN/////+wAAAA3//////MAAADP//////zgAAc///////88ADz' +
  '////////j/+f////////+AH////';

export interface TemplateOptions {
  invert?: boolean;
}

/**
 * Render the static base template. Browser-only — requires a `document`
 * global. Cheap (one off-screen canvas + per-pixel threshold), but call
 * once per page load and cache the result; nothing here depends on
 * per-render inputs.
 */
export function generateBaseTemplate(opts: TemplateOptions = {}): RowBitmap {
  if (typeof document === 'undefined') {
    throw new Error('generateBaseTemplate requires a DOM (browser-only)');
  }

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('failed to get 2d context');

  // BLACK canvas → undrawn pixels threshold to bit 1 (dark/bg on K1).
  // White drawings (text) → bit 0 (lit/foreground on K1). This gives the
  // whole static template the same dark-bg/lit-fg polarity as the dynamic
  // right panel.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Left stack: "BKG / 4 / LYFE", each shrink-to-fit inside the left column.
  const leftCx = ((LEFT_X0 + LEFT_X1) / 2) * SCALE;
  for (let i = 0; i < LEFT_LINES.length; i++) {
    drawTextFitted(
      ctx,
      LEFT_LINES[i]!,
      leftCx,
      LEFT_LINE_Y[i]! * SCALE,
      LEFT_MAX_TEXT_W,
      LEFT_MAX_TEXT_H,
      LEFT_FONT_PX,
    );
  }

  // Threshold the canvas (left text only here — the center badge is blitted
  // from the embedded asset below, not drawn with canvas) to 1-bit.
  // avg < threshold (dark canvas) → bit 1 (bg). avg >= threshold (white
  // drawn pixel) → bit 0 (lit text).
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = makeRowBitmap();
  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      let sum = 0;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const sx = px * SCALE + dx;
          const sy = py * SCALE + dy;
          const i = (sy * canvas.width + sx) * 4;
          sum += imageData.data[i]!; // R channel; canvas is grayscale here
        }
      }
      const avg = sum / (SCALE * SCALE);
      setPixel(result, px, py, avg < THRESHOLD);
    }
  }

  // Central BKG badge: blit the embedded 72×64 art, area-averaged down to
  // the wider-than-tall target so it reads as round on the K1's tall pixels.
  // Polarity: the art's 1=fg becomes bit-0 (lit) in the buffer to match
  // the rest of the dark-bg/lit-fg layout.
  blitCenterBadge(result);

  // Right panel is already bit-1 (dark) from the canvas-black threshold —
  // no separate fill needed. render.ts overdraws this region anyway.

  return opts.invert ? invertInPlace(result) : result;
}

/**
 * Decode the base64 art asset to a row-major MSB-first byte array. Memoized
 * lazily — the decode is cheap (<1 ms) but only useful once per page load.
 */
let centerArtCache: Uint8Array | null = null;
function getCenterArt(): Uint8Array {
  if (centerArtCache) return centerArtCache;
  const bin = atob(CENTER_ART_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out.length !== CENTER_ART_ROW_BYTES * CENTER_ART_H) {
    throw new Error(
      `center art size mismatch: expected ${CENTER_ART_ROW_BYTES * CENTER_ART_H}, got ${out.length}`,
    );
  }
  centerArtCache = out;
  return out;
}

function getArtPixel(art: Uint8Array, x: number, y: number): 0 | 1 {
  if (x < 0 || x >= CENTER_ART_W || y < 0 || y >= CENTER_ART_H) return 0;
  const byteIdx = y * CENTER_ART_ROW_BYTES + (x >> 3);
  const bit = 7 - (x & 7);
  return (art[byteIdx]! & (1 << bit)) ? 1 : 0;
}

/**
 * Center-sample nearest-neighbor blit. Since the target width equals the
 * source width (72 = 72), the horizontal sampling is identity — every
 * source column is preserved verbatim. Only the vertical axis is
 * downsampled (64 → 48), which picks roughly every 4th row to drop.
 *
 * Why NN here instead of area-average: area-averaging continuous-tones
 * 1-bit pixel art into a smaller raster softens thin features
 * (ring outline, "BKG KNUCKLES" wordmark) — the partial-coverage values
 * straddle the threshold and break into dashes. NN preserves the sharp
 * pixel-art character at the cost of a periodic dropped row in the
 * vertical direction (which the human eye reads as a slight aspect
 * compression, not as artifacting).
 *
 * Polarity: the embedded art already encodes the badge correctly for the
 * dark-surround layout — its bit-1 covers BOTH the dark surround
 * (corners of the bounding rect outside the circle) AND the dark badge
 * details (ring, fist, "BKG" wordmark), and its bit-0 is precisely the
 * lit "card" interior of the circle. So we blit verbatim:
 *   art bit-1 → buffer bit-1 (dark on K1)  — surround + badge details
 *   art bit-0 → buffer bit-0 (lit on K1)   — badge card interior
 *
 * Edge mask: the asset was hand-extracted with the badge's circle
 * inscribed tightly in the 72×64 bounding rect. At the widest part of
 * the circle (wordmark band rows) the lit interior reaches all the way
 * to asset col 0..3 and col 68..71. Against the now-dark surround those
 * edge lit pixels read as garbled character fragments right next to the
 * left text. We force-dark any lit pixel within EDGE_MASK_COLS of either
 * horizontal edge — yielding a clean dark halo around the badge at the
 * cost of slightly flattening its leftmost/rightmost extent.
 */
const EDGE_MASK_COLS = 4;
function blitCenterBadge(dst: RowBitmap): void {
  const art = getCenterArt();
  for (let ty = 0; ty < CENTER_TARGET_H; ty++) {
    const sy = Math.floor((ty + 0.5) * CENTER_ART_H / CENTER_TARGET_H);
    for (let tx = 0; tx < CENTER_TARGET_W; tx++) {
      const sx = Math.floor((tx + 0.5) * CENTER_ART_W / CENTER_TARGET_W);
      let bit = getArtPixel(art, sx, sy);
      if (
        bit === 0 &&
        (sx < EDGE_MASK_COLS || sx >= CENTER_ART_W - EDGE_MASK_COLS)
      ) {
        bit = 1; // suppress lit pixels at the badge's left/right edges
      }
      setPixel(dst, CENTER_TARGET_X + tx, CENTER_TARGET_Y + ty, bit === 1);
    }
  }
}

const FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Draw bold text centered at (cx, cy), scaling the font down if needed to
 * fit inside (maxWidth, maxHeight). `basePx` is the desired (max) size in
 * supersampled pixels.
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
  // Start at basePx, shrink until both width and height fit. Width comes from
  // measureText; height we approximate as 0.8 × font-px (matches bold caps).
  let px = basePx;
  for (let i = 0; i < 8; i++) {
    ctx.font = `bold ${Math.max(1, Math.floor(px))}px ${FONT_FAMILY}`;
    const m = ctx.measureText(text);
    const wOk = m.width <= maxWidth;
    const approxH = px * 0.8;
    const hOk = approxH <= maxHeight;
    if (wOk && hOk) break;
    const wScale = wOk ? 1 : maxWidth / m.width;
    const hScale = hOk ? 1 : maxHeight / approxH;
    px = Math.floor(px * Math.min(wScale, hScale) * 0.98); // 0.98 = small safety margin
    if (px < 4) break;
  }
  ctx.fillText(text, cx, cy);
}
