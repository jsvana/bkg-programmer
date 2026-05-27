import type { BlockModuleDef } from '../types';

/**
 * NR7Y CW-modulator settings block. 8 bytes.
 *
 * Verified against briand/uv-k1-k5v3-firmware-custom (NR7Y CW preset):
 *   App/settings.c:358-369  (READ path)
 *   App/settings.c:1065-1081 (WRITE path)
 * Cross-checked with chirp/fusion.nr7y.chirp.v1.0.py:740 which uses the
 * same physical address.
 *
 * Base address: physical/virtual 0x00A140 on V3/K1 (identity-mapped
 * inside the settings region 0xA000..0xA170 per
 * App/driver/eeprom_compat.c:56). Bound per-profile.
 *
 * Byte map:
 *   [0]  bits 0-3  cw_tone_frequency_idx   0..10  -> 450..950 Hz step 50
 *        bits 4-6  cw_sidetone_level       0..6   (0 = off)
 *        bit  7    unused                  (firmware writes 0)
 *   [1]  bits 0-6  cw_key_wpm              10..40 (firmware default 18)
 *        bit  7    cw_keyer_mode           0 = Iambic A, 1 = Iambic B
 *   [2]  bits 0-4  cw_key_input_menu       0..7
 *        bit  5    unused
 *        bit  6    cw_breakin_enable       0=off, 1=on
 *        bit  7    cw_byte2_invalid        0 = struct valid (REQUIRED).
 *                                          Firmware reads `Data[2] < 0x80`;
 *                                          if bit 7 is set, defaults are
 *                                          loaded and your other writes
 *                                          in this byte are ignored.
 *   [3]  bits 0-6  cw_message_repeat_delay seconds (10..120 typical)
 *        bit  7    cw_byte3_invalid        same validity-marker pattern
 *                                          as byte 2.
 *   [4..7]                                 unused, firmware writes 0xFF.
 *
 * Validity markers (bit 7 of bytes 2 and 3): the firmware uses
 * 0xFF-on-uninitialised-EEPROM detection. Any field that needs to be
 * honoured on the next reload-settings cycle must have its byte's bit 7
 * cleared. The schema models them as explicit bool fields so callers
 * touching this region can ensure they end up at 0.
 */
export const nr7yCwSettings: BlockModuleDef = {
  kind: 'block',
  id: 'nr7y_cw_settings',
  // baseOffset deliberately omitted — supplied via ModuleBinding.
  size: 8,
  sensitivity: 'shareable',
  fields: [
    // Byte 0 — sidetone
    {
      id: 'cw_tone_frequency_idx',
      label: 'CW Tone Frequency',
      description:
        'Stored index 0..10. Actual frequency = 450 + idx*50 Hz (450..950 Hz). ' +
        'Firmware: gEeprom.CW_TONE_FREQUENCY = 45 + (Data[0] & 0xf) * 5 (in 10-Hz units).',
      group: 'cw.tone',
      type: { kind: 'int', min: 0, max: 10, unit: 'step' },
      location: { kind: 'bits', offset: 0, bitOffset: 0, bitWidth: 4 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },
    {
      id: 'cw_sidetone_level',
      label: 'CW Sidetone Level',
      description:
        'Volume index 0..6 (0 = off). Firmware scales by 21 for the actual ' +
        'audio level (max 6*21 = 126, default 4*21 = 105).',
      group: 'cw.tone',
      type: { kind: 'int', min: 0, max: 6 },
      location: { kind: 'bits', offset: 0, bitOffset: 4, bitWidth: 3 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },

    // Byte 1 — speed + iambic mode
    {
      id: 'cw_key_wpm',
      label: 'CW Keyer Speed',
      description:
        'Words-per-minute. Firmware clamps to [10,40] on load; out-of-range ' +
        'values fall back to default 18.',
      group: 'cw.keyer',
      type: { kind: 'int', min: 10, max: 40, unit: 'WPM' },
      location: { kind: 'bits', offset: 1, bitOffset: 0, bitWidth: 7 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },
    {
      id: 'cw_keyer_mode',
      label: 'CW Keyer Mode',
      group: 'cw.keyer',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Iambic A' },
          { value: 1, label: 'Iambic B' },
        ],
      },
      location: { kind: 'bits', offset: 1, bitOffset: 7, bitWidth: 1 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },

    // Byte 2 — key input wiring + break-in + validity marker
    {
      id: 'cw_key_input_menu',
      label: 'CW Key Input Mode',
      description:
        'Index into the CW_KEY_INPUT submenu (also stored separately as ' +
        'the bitmap via CW_KEY_INPUT_menu_to_bitmap[]). See ' +
        'App/settings.h:64-72.',
      group: 'cw.keyer',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'PTT HandKey' },
          { value: 1, label: 'Port HandKey' },
          { value: 2, label: 'Side Btn Iambic' },
          { value: 3, label: 'Side Btn Iambic Reversed' },
          { value: 4, label: 'Port Iambic' },
          { value: 5, label: 'Port Iambic Reversed' },
          { value: 6, label: 'Port+Btn Iambic' },
          { value: 7, label: 'Port+Btn Iambic Reversed' },
        ],
      },
      location: { kind: 'bits', offset: 2, bitOffset: 0, bitWidth: 5 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },
    {
      id: 'cw_breakin_enable',
      label: 'CW Break-in',
      description:
        'When ON, transmits RF while keying. When OFF, sidetone only ' +
        '(no RF). Firmware default: ON.',
      group: 'cw.keyer',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 2, bitOffset: 6, bitWidth: 1 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },
    {
      id: 'cw_byte2_invalid',
      label: 'CW Byte 2 Invalid Marker',
      description:
        'MUST be 0 for the firmware to honour key-input-mode and break-in. ' +
        'Set by firmware to 0 on every save (App/settings.c:1073). If you ' +
        'are writing to byte 2 of this block, also write 0 here, otherwise ' +
        'the firmware will discard the byte and revert to defaults on next ' +
        'load. Schema exposes it so the writer can explicitly clear it on ' +
        'uninitialised-EEPROM radios where the byte starts as 0xFF.',
      group: 'cw.internal',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 2, bitOffset: 7, bitWidth: 1 },
      defaultValue: 0,
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },

    // Byte 3 — message repeat delay + validity marker
    {
      id: 'cw_message_repeat_delay',
      label: 'CW Message Repeat Delay',
      description: 'Seconds between auto-repeat playbacks of a CW macro.',
      group: 'cw.macro',
      type: { kind: 'int', min: 0, max: 120, unit: 's' },
      location: { kind: 'bits', offset: 3, bitOffset: 0, bitWidth: 7 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },
    {
      id: 'cw_byte3_invalid',
      label: 'CW Byte 3 Invalid Marker',
      description:
        'Same validity-marker pattern as cw_byte2_invalid. Clear to 0 ' +
        'whenever cw_message_repeat_delay is being set.',
      group: 'cw.internal',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 3, bitOffset: 7, bitWidth: 1 },
      defaultValue: 0,
      applyMode: 'reload-settings',
      requires: ['ENABLE_CW_MODULATOR'],
    },
  ],
};
