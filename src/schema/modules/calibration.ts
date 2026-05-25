import type { BlockModuleDef } from '../types';

/**
 * Calibration region. 512 bytes.
 *
 * Same internal layout on V1 and V3/K1; only the base address differs:
 * - V1: 0x1E00
 * - V3/K1: 0xB000
 *
 * The profile supplies the base via ModuleBinding.
 *
 * Verified by comparing:
 * - egzumer/uv-k5-firmware-custom/settings.c:282-324 (V1)
 * - briand/uv-k1-k5v3-firmware-custom/App/settings.c:522-570 (V3/K1)
 *
 * Both read identical-shape data from the same relative offsets.
 *
 * READ-ONLY by default. Two layers of enforcement (writer-side refusal,
 * UI gating). See docs/05-modules-calibration.md.
 */
export const calibration: BlockModuleDef = {
  kind: 'block',
  id: 'calibration',
  // baseOffset deliberately omitted — must be bound per-profile
  size: 0x200,
  readOnly: true,
  sensitivity: 'device-specific',
  fields: [
    {
      id: 'power_calib_tables',
      label: 'Power Calibration Tables (opaque)',
      description:
        'TX power calibration. Do not edit unless you have an RF lab and ' +
        'know the byte layout. Treat as opaque blob; back up before any change.',
      group: 'cal.opaque',
      type: { kind: 'opaque' },
      location: { kind: 'byte', offset: 0x000, size: 1 },
      applyMode: 'reboot',
    },
    // The opaque blob actually spans 0x000-0x0BF (192 bytes) but we declare
    // it as a single 1-byte field at offset 0 to satisfy the type system.
    // The writer treats the whole readOnly module as one unit anyway.
    // TODO: extend Location to allow size: 192 or add an opaque-blob primitive.
    {
      id: 'rssi_calib_high_bands',
      label: 'RSSI Calibration (bands 3-6)',
      description: 'S-meter thresholds for VHF mid / UHF / aviation / SW. Four u16 LE thresholds.',
      group: 'cal.rssi',
      type: { kind: 'int', min: 0, max: 0xFFFF },
      location: { kind: 'byte', offset: 0xC0, size: 8 },
      applyMode: 'reboot',
    },
    {
      id: 'rssi_calib_low_bands',
      label: 'RSSI Calibration (bands 0-2)',
      description: 'S-meter thresholds for HF / VHF low / VHF high.',
      group: 'cal.rssi',
      type: { kind: 'int', min: 0, max: 0xFFFF },
      location: { kind: 'byte', offset: 0xC8, size: 8 },
      applyMode: 'reboot',
    },
    {
      id: 'battery_calib',
      label: 'Battery Voltage Calibration',
      description: 'Six u16 LE ADC points: empty, 10%, 30%, 50%, 70%, full.',
      group: 'cal.battery',
      type: { kind: 'int', min: 0, max: 0xFFFF },
      location: { kind: 'byte', offset: 0x140, size: 12 },
      applyMode: 'reboot',
    },
    {
      id: 'vox1_thresholds',
      label: 'VOX High Thresholds',
      description: 'Ten u16 LE levels (VOX_LEVEL = 1..10).',
      group: 'cal.vox',
      type: { kind: 'int', min: 0, max: 0xFFFF },
      location: { kind: 'byte', offset: 0x150, size: 20 },
      applyMode: 'reboot',
    },
    {
      id: 'vox0_thresholds',
      label: 'VOX Low (hysteresis) Thresholds',
      description: 'Ten u16 LE levels paired with vox1_thresholds.',
      group: 'cal.vox',
      type: { kind: 'int', min: 0, max: 0xFFFF },
      location: { kind: 'byte', offset: 0x168, size: 20 },
      applyMode: 'reboot',
    },
    {
      id: 'misc_calib',
      label: 'Miscellaneous Calibration',
      description: 'Eight bytes of less-documented calibration data.',
      group: 'cal.misc',
      type: { kind: 'int', min: 0, max: 0xFF },
      location: { kind: 'byte', offset: 0x188, size: 8 },
      applyMode: 'reboot',
    },
  ],
};
