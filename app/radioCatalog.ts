/**
 * Display data for the radio-identity picker.
 *
 * Images live under `/public/radios/` (sourced from quansheng.store —
 * see `public/radios/NOTICE.md` for attribution and known issues).
 *
 * Each entry separates two things:
 *
 *   - `shared`: properties of the visible hardware family. Hardware
 *     revisions that look identical in marketing photos share both
 *     the image AND this list verbatim.
 *
 *   - `differentiator`: the single feature a user can check on their
 *     physical radio to confirm which revision they have within that
 *     visual family. This is the ONLY field the picker uses when
 *     asking "V1 or V2?" — keep it specific and visible.
 */

import type { RadioModelId } from '../src/schema/types';

export interface RadioCatalogEntry {
  displayName: string;
  /** Public-relative URL of the marketing photo, or undefined if none. */
  image?: string;
  /** Visible properties of the hardware family. */
  shared: ReadonlyArray<string>;
  /** The one feature that uniquely identifies this revision. */
  differentiator: string;
}

export const radioCatalog: Record<RadioModelId, RadioCatalogEntry> = {
  'uv-k5-v1': {
    displayName: 'UV-K5 V1',
    image: '/radios/uv-k5.jpg',
    shared: [
      'Slim K5 body shape',
      'Monochrome LCD',
      '"QUANSHENG" logo on front; no "Mini Kong" branding',
    ],
    differentiator:
      'Barrel-style charging port (round connector, no USB-C).',
  },
  'uv-k5-v2': {
    displayName: 'UV-K5 V2',
    image: '/radios/uv-k5.jpg',
    shared: [
      'Slim K5 body shape',
      'Monochrome LCD',
      '"QUANSHENG" logo on front; no "Mini Kong" branding',
    ],
    differentiator:
      'USB-C charging port. Often sold as "UV-K5(8)" or "K5 Plus".',
  },
  'uv-k5-v3': {
    displayName: 'UV-K5 V3',
    image: '/radios/uv-k5-99.jpg',
    shared: [
      'K5 body shape',
      'USB-C charging port',
    ],
    differentiator:
      'Color LCD (not monochrome). Often badged "V3" on the box or boot screen; sold as "UV-K5(99)".',
  },
  'uv-k6': {
    displayName: 'UV-K6',
    shared: [
      'Otherwise visually identical to UV-K5(8)',
      'USB-C charging port',
    ],
    differentiator: '"UV-K6" labelling on the front panel.',
  },
  'uv-k1': {
    displayName: 'UV-K1 (Mini Kong)',
    image: '/radios/uv-k1.jpg',
    shared: [
      'Chunkier, taller body than the K5',
      'USB-C charging port',
      'Larger battery (extended runtime variant)',
    ],
    differentiator: '"Mini Kong" printed on the front panel.',
  },
};
