import type { Profile, BlockModuleDef } from '../types';
import { channelRecord, channelName, channelAttrsV1, calibration } from '../modules/index';

/** Opaque read-only block — no field interpretation, just bytes for probing. */
function probeBlock(id: string, baseOffset: number, size: number): BlockModuleDef {
  return {
    kind: 'block',
    id,
    baseOffset,
    size,
    fields: [],
    readOnly: true,
  };
}

/**
 * Quansheng UV-K1 Mini Kong, stock firmware (captured v7.03.01).
 *
 * **Stock K1 uses the V1-style EEPROM layout, NOT the V3/F4HWN virtual
 * mapping.** Verified 2026-05-25 by setting `TESTCHAN` on channel 1 in the
 * radio menu and finding the string at exactly 0x0F50 — the V1 channel_names
 * base. The F4HWN K1 profile uses a V3-style virtual EEPROM only because
 * F4HWN's `eeprom_compat.c` layer remaps the radio; stock firmware does no
 * such thing.
 *
 * Verified regions (V1 layout):
 *  - channels at 0x0000, 200 × 16 bytes
 *  - channel_attrs at 0x0D60, 207 × 1 byte (V1 1-byte attrs)
 *  - channel_names at 0x0F50, 200 × 16 bytes
 *  - calibration around 0x1E00 (V1 location; bits not re-verified for K1)
 *
 * Mapped EEPROM extent: 0x0000-0x3407 (~13 KB). Everything past 0x3408 reads
 * 0xFF (unmapped). Mini Kong's marketing "1024 channels" appears to be a
 * custom-firmware claim — stock K1 menu caps at 200, matching the V1 layout
 * exactly.
 *
 * Extras beyond V1 layout (0x2E00-0x33FF):
 *  - boot_logo_primary at 0x2E00 (512 B)
 *  - boot_logo_secondary at 0x3000 (512 B, byte-identical to primary)
 *  - aux_bitmap at 0x3200 (512 B, distinct pattern — purpose TBD)
 *
 * Model identifier string "UV-K1" lives at 0x0EC0 on stock K1 (not 0x1ED0
 * like V1). Default user passwords "77777"/"88888" at 0x0EE8/0x0EF0.
 *
 * Still unknown:
 *  - Exact bit semantics of channel_attrs / calibration on stock K1
 *    (addresses match V1, internal layout not re-verified).
 *  - Settings region 0x1BD0-0x1E00 has data but field-level decoding pending.
 *  - aux_bitmap purpose.
 *
 * Profile remains marked read-only until self-test confirms persistence
 * (Open Question #1 from CLAUDE.md).
 */
export const uvK1Stock: Profile = {
  id: 'uv-k1-stock',
  displayName: 'UV-K1 Mini Kong (stock 7.x firmware) — V1 layout, read-only',
  appliesTo: {
    radioModels: ['uv-k1'],
    firmwareFamily: 'stock',
    versionRange: '7.*',
  },
  eepromSize: 0x3408,
  modules: [
    {
      kind: 'array',
      id: 'channels',
      baseOffset: 0x0000,
      count: 200,
      stride: 16,
      template: channelRecord,
      readOnly: true,
    },
    {
      kind: 'array',
      id: 'channel_attrs',
      baseOffset: 0x0D60,
      count: 207,
      stride: 1,
      template: channelAttrsV1,
      readOnly: true,
    },
    {
      kind: 'array',
      id: 'channel_names',
      baseOffset: 0x0F50,
      count: 200,
      stride: 16,
      template: channelName,
      readOnly: true,
    },
    {
      binding: { moduleId: 'calibration', baseOffset: 0x1E00 },
    },
    // Boot logo stored in duplicate, 512 bytes each, byte-identical on the
    // captured hardware. Likely a dual-buffer or fault-tolerance scheme.
    probeBlock('boot_logo_primary', 0x2E00, 0x200),
    probeBlock('boot_logo_secondary', 0x3000, 0x200),
    // Secondary bitmap with distinct pattern — possibly a power-off image,
    // a splash variant, or a glyph table. TBD.
    probeBlock('aux_bitmap', 0x3200, 0x200),
  ],
  notes:
    'Stock UV-K1 = V1 EEPROM layout extended with three 512-byte bitmaps. ' +
    'Mapped extent 0x0000-0x3407. Everything past that is unmapped.',
};
