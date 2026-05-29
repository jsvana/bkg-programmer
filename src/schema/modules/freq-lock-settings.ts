import type { BlockModuleDef, EnumValue } from '../types';

/**
 * TX frequency-lock settings block (the byte the firmware calls
 * `gSetting_F_LOCK`). 8 bytes total — only byte 0 is modeled here.
 *
 * This is a SEPARATE region from `f4hwn_settings` (0xA158). The F_LOCK
 * byte lives in the older "0x0F40" settings block:
 * - V1 (DP32G030):  0x0F40
 * - V3/K1 (PY32F071): virtual/physical 0x00A150 (identity-mapped inside
 *   the settings region 0xA000..0xA170 per
 *   briand/uv-k1-k5v3-firmware-custom App/driver/eeprom_compat.c:56).
 *
 * Profile must supply the base via ModuleBinding.
 *
 * Byte map (verified against briand/uv-k1-k5v3-firmware-custom):
 *   [0]  gSetting_F_LOCK    App/settings.c:374 (read), :1089 (write).
 *                           `(Data[0] < F_LOCK_LEN) ? Data[0] : F_LOCK_DEF`.
 *   [1..7]                  350TX / KILLED / 200TX / 500TX / 350EN /
 *                           Scramble / misc flags — most compiled out under
 *                           ENABLE_FEAT_F4HWN. Left unmodeled.
 *
 * On V1, writes to [0x0F30, 0x0F40) trigger SETTINGS_InitEEPROM(); the
 * F_LOCK byte itself sits at 0x0F40 (just outside the trigger window),
 * so writing it does not force a reload — it takes effect on the next
 * settings reload / reboot. Hence applyMode 'reload-settings'.
 */

/**
 * F_LOCK enum values, matching the firmware's `TxLockModes_t`
 * (App/settings.h:85-103) as compiled for the NR7Y CW / F4HWN "default"
 * preset: ENABLE_FEAT_F4HWN_CA on, ENABLE_FEAT_F4HWN_PMR off,
 * ENABLE_FEAT_F4HWN_GMRS_FRS_MURS off (CMakePresets.json "default"/"CW").
 *
 * Labels condense the multi-line submenu strings in App/ui/menu.c:338-356.
 * F_LOCK_FCC is value 1 in every build — it precedes all the
 * build-flag-conditional entries — so the FCC default is stable.
 */
export const fLockValues: ReadonlyArray<EnumValue> = [
  { value: 0, label: 'Default (137-174, 400-470)' },
  { value: 1, label: 'FCC HAM (144-148, 420-450)' },
  { value: 2, label: 'CA HAM (144-148, 430-450)' },
  { value: 3, label: 'CE HAM (144-146, 430-440)' },
  { value: 4, label: 'GB HAM (144-148, 430-440)' },
  { value: 5, label: '137-174, 400-430' },
  { value: 6, label: '137-174, 400-438' },
  { value: 7, label: 'Disable all TX' },
  { value: 8, label: 'Unlock all TX' },
];

/** Raw F_LOCK value for the FCC HAM band plan. Always 1 (see above). */
export const F_LOCK_FCC = 1;

export const freqLockSettings: BlockModuleDef = {
  kind: 'block',
  id: 'freq_lock_settings',
  // baseOffset deliberately omitted — must be bound per-profile.
  size: 8,
  sensitivity: 'shareable',
  fields: [
    {
      id: 'f_lock',
      label: 'F-Lock (TX frequency lock)',
      description:
        'Restricts which bands the radio will transmit on. "FCC HAM" limits ' +
        'TX to the US 2 m (144-148 MHz) and 70 cm (420-450 MHz) amateur bands. ' +
        'Firmware: gSetting_F_LOCK, App/settings.c:374; menu "F Lock", ' +
        'App/ui/menu.c:338. Enum values follow the NR7Y/F4HWN-default build ' +
        '(CA on, PMR/GMRS off).',
      group: 'tx.lock',
      type: { kind: 'enum', values: fLockValues },
      location: { kind: 'byte', offset: 0, size: 1 },
      // Read during the settings-load pass, not live; takes effect on the
      // next reload-settings / reboot.
      applyMode: 'reload-settings',
    },
  ],
};
