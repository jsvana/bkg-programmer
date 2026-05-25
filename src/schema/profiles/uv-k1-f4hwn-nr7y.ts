import type { Profile } from '../types';
import {
  channelRecord,
  channelName,
  channelAttrsV3,
  calibration,
  f4hwnSettings,
} from '../modules/index';

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
  ],
  notes:
    'F4HWN settings at 0xA158 are V3/K1-specific. Maps to PY25Q16 flash 0x00A158. ' +
    'V1 uses 0x1FF0. Source: App/settings.c:470.',
};

export const v3ResolverModules = { calibration, f4hwnSettings };
