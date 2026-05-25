import type { BlockModuleDef } from '../types';

/**
 * F4HWN bit-packed settings region. 8 bytes total.
 *
 * Verified from briand/uv-k1-k5v3-firmware-custom/App/settings.c:467-519.
 *
 * Base address differs between V1 and V3/K1:
 * - V1: 0x1FF0
 * - V3/K1: 0xA158 (maps to PY25Q16 flash 0x00A158)
 *
 * Profile must supply the base via ModuleBinding.
 *
 * IMPORTANT: writing 0x1FF0 on V3/K1 corrupts the channel-name region,
 * not the F4HWN settings. The address didn't carry over.
 *
 * Note from source: `// TODO: address TBD` near settings.c:469.
 * F4HWN authors haven't fully committed to this layout — verify against
 * each firmware version.
 */
export const f4hwnSettings: BlockModuleDef = {
  kind: 'block',
  id: 'f4hwn_settings',
  // baseOffset deliberately omitted — must be bound per-profile
  size: 8,
  sensitivity: 'shareable',
  fields: [
    // Byte 4: SetTmr + SetOff
    {
      id: 'set_tmr',
      label: 'Auto-sleep enabled',
      group: 'f4hwn.sleep',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 4, bitOffset: 0, bitWidth: 1 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_off',
      label: 'Sleep delay (minutes)',
      description: 'Capped at 120 by firmware.',
      group: 'f4hwn.sleep',
      type: { kind: 'int', min: 0, max: 120, unit: 'min' },
      location: { kind: 'bits', offset: 4, bitOffset: 1, bitWidth: 7 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },

    // Byte 5: SetCtr/SetInv/SetLck/SetMet/SetGui
    {
      id: 'set_ctr',
      label: 'Display contrast',
      group: 'f4hwn.display',
      type: { kind: 'int', min: 1, max: 15 },
      location: { kind: 'bits', offset: 5, bitOffset: 0, bitWidth: 4 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_inv',
      label: 'Display inverted',
      group: 'f4hwn.display',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 5, bitOffset: 4, bitWidth: 1 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_lck',
      label: 'Keypad lock',
      group: 'f4hwn.lock',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 5, bitOffset: 5, bitWidth: 1 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_met',
      label: 'S-meter style',
      group: 'f4hwn.display',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 5, bitOffset: 6, bitWidth: 1 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_gui',
      label: 'GUI variant',
      group: 'f4hwn.display',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 5, bitOffset: 7, bitWidth: 1 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },

    // Byte 6: SetEot + SetTot
    {
      id: 'set_eot',
      label: 'EoT (End of Transmission) tone',
      group: 'f4hwn.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'None' },
          { value: 1, label: 'Beep' },
          { value: 2, label: 'Roger' },
          { value: 3, label: 'MDC' },
        ],
      },
      location: { kind: 'bits', offset: 6, bitOffset: 0, bitWidth: 4 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_tot',
      label: 'TOT (Time-Out Timer) alert',
      group: 'f4hwn.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'Sound' },
          { value: 2, label: 'Visual' },
          { value: 3, label: 'Both' },
        ],
      },
      location: { kind: 'bits', offset: 6, bitOffset: 4, bitWidth: 4 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },

    // Byte 7: SetPtt + SetScn + SetPwr
    {
      id: 'set_ptt',
      label: 'PTT mode',
      group: 'f4hwn.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Classic (hold)' },
          { value: 1, label: 'One-touch (toggle)' },
        ],
      },
      location: { kind: 'bits', offset: 7, bitOffset: 0, bitWidth: 1 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_scn',
      label: 'Fast scan',
      description: 'Inverted in storage: 0 in EEPROM = fast scan ON.',
      group: 'f4hwn.scan',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 7, bitOffset: 1, bitWidth: 1 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'set_pwr',
      label: 'TX Power Mode',
      group: 'f4hwn.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Low1 (<20 mW)' },
          { value: 1, label: 'Low2 (~125 mW)' },
          { value: 2, label: 'Low3 (~250 mW)' },
          { value: 3, label: 'Low4 (~500 mW)' },
          { value: 4, label: 'Low5 (~1 W)' },
          { value: 5, label: 'Mid (~2 W)' },
          { value: 6, label: 'High (~5 W)' },
        ],
      },
      location: { kind: 'bits', offset: 7, bitOffset: 4, bitWidth: 4 },
      applyMode: 'live',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
  ],
};
