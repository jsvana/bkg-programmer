import type { Profile } from '../types';
import {
  channelRecord,
  channelName,
  channelAttrsV1,
  calibration,
  f4hwnSettings,
} from '../modules/index';

export const uvK5V1F4hwn: Profile = {
  id: 'uv-k5-v1-f4hwn',
  displayName: 'UV-K5 V1/V2 with F4HWN',
  appliesTo: {
    radioModels: ['uv-k5-v1', 'uv-k5-v2'],
    firmwareFamily: 'f4hwn',
    versionRange: '*',
  },
  eepromSize: 0x2000,
  modules: [
    {
      kind: 'array',
      id: 'channels',
      baseOffset: 0x0000,
      count: 200,
      stride: 16,
      template: channelRecord,
    },
    {
      kind: 'array',
      id: 'channel_attrs',
      baseOffset: 0x0D60,
      count: 207, // 200 channels + 7 VFO slots
      stride: 1,
      template: channelAttrsV1,
    },
    {
      kind: 'array',
      id: 'channel_names',
      baseOffset: 0x0F50,
      count: 200,
      stride: 16,
      template: channelName,
    },
    { binding: { moduleId: 'calibration', baseOffset: 0x1E00 } },
    { binding: { moduleId: 'f4hwn_settings', baseOffset: 0x1FF0 } },
  ],
  notes:
    'F4HWN settings at 0x1FF0 are V1-specific. V3/K1 uses 0xA158. ' +
    'See docs/01-protocol.md.',
};

// Re-export the bound modules so the resolver can find them by ID
export const v1ResolverModules = { calibration, f4hwnSettings };
