import type { BlockModuleDef, Profile } from '../types';
import {
  channelRecord,
  channelName,
  channelAttrsV3,
  calibration,
  f4hwnSettings,
} from '../modules/index';

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

export const uvK1F4hwnNr7y: Profile = {
  id: 'uv-k1-f4hwn-nr7y',
  displayName: 'UV-K1 / UV-K5 V3 with F4HWN Fusion (NR7Y fork)',
  appliesTo: {
    radioModels: ['uv-k1', 'uv-k5-v3'],
    firmwareFamily: 'f4hwn-nr7y',
    versionRange: '*',
  },
  eepromSize: 0xD000, // virtual size through boot logo region
  modules: [
    {
      kind: 'array',
      id: 'channels',
      baseOffset: 0x0000,
      count: 1024,
      stride: 16,
      template: channelRecord,
    },
    {
      kind: 'array',
      id: 'channel_names',
      baseOffset: 0x4000,
      count: 1024,
      stride: 16,
      template: channelName,
    },
    {
      kind: 'array',
      id: 'channel_attrs',
      baseOffset: 0x8000,
      count: 1031, // 1024 channels + 7 VFO slots
      stride: 2,
      template: channelAttrsV3,
    },
    { binding: { moduleId: 'calibration', baseOffset: 0xB000 } },
    { binding: { moduleId: 'f4hwn_settings', baseOffset: 0xA158 } },
    // Boot logo region per briand's eeprom_compat.c virtual mapping
    // (0xC000-0xCFFF, 4 KiB). Hardware probe 2026-05-25 confirmed: this
    // region IS read-mapped on K1+NR7Y and contains a coherent briand-
    // default "MINI KONG" 128x64 bitmap, page-major LSB-top layout.
    //
    // **The firmware does not display this bitmap.** F4HWN base (armel/
    // uv-k5-firmware-custom ui/welcome.c:50-210, what NR7Y is built on)
    // has a text-only welcome routine and never reads a bitmap. The bytes
    // here are inherited from briand and never rendered. Standard 0x051D
    // WRITE_EEPROM to this region is silently dropped (10s timeout, no
    // reply — same pattern as stock K1's 0x2E00).
    //
    // Kept as a probe block so future patched firmware that reads from
    // 0xC000 can be supported without re-discovering the address.
    probeBlock('boot_logo', 0xC000, 0x1000),
  ],
  notes:
    'F4HWN settings at 0xA158 are V3/K1-specific. Maps to PY25Q16 flash 0x00A158. ' +
    'V1 uses 0x1FF0. Source: App/settings.c:470. ' +
    '\n\n' +
    'Layout verified 2026-05-25 against briand/uv-k1-k5v3-firmware-custom ' +
    'App/driver/eeprom_compat.c virtual mapping: channels 0x0000-0x3FFF ' +
    '(1024×16), names 0x4000-0x7FFF (1024×16), attrs+scanlist names ' +
    '0x8000-0x886E (2 bytes per of 1024+7), settings region 0xA000-0xA170 ' +
    '(F4HWN block starts at 0xA158), calibration 0xB000-0xB1FF (512 bytes, ' +
    'physically remapped to flash 0x010000), boot logo 0xC000-0xCFFF. ' +
    '\n\n' +
    'NR7Y CW mod additions (CW_TONE_FREQUENCY, CW_SIDETONE_LEVEL, ' +
    'CW_KEYER_MODE, CW_KEY_WPM, CW_KEY_INPUT, CW_KEY_INPUT_MENU, ' +
    'CW_BREAKIN_ENABLE, CW_MESSAGE_REPEAT_DELAY) are present in the ' +
    'EEPROM_Config_t struct in App/settings.h but their concrete EEPROM ' +
    'offsets within 0xA000-0xA170 are not yet captured. They almost ' +
    'certainly live in the 0xA160-0xA170 gap (16 bytes unclaimed by ' +
    'f4hwn_settings). Modeling them requires either grepping the briand ' +
    'fork for the SETTINGS_Save* calls that touch them, or a hardware ' +
    'BEFORE/AFTER backup diff after changing a CW menu value. Until then ' +
    'CW values round-trip via backup but are not editable in the UI.',
};

export const v3ResolverModules = { calibration, f4hwnSettings };
