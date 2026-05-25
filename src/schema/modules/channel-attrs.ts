import type { StructTemplate } from '../types';

/**
 * V1 channel attributes — 1 byte per channel.
 *
 * Verified from egzumer/uv-k5-firmware-custom/misc.h:178-189.
 */
export const channelAttrsV1: StructTemplate = {
  size: 1,
  fields: [
    {
      id: 'band',
      label: 'Band',
      group: 'attr',
      type: { kind: 'int', min: 0, max: 15 },
      location: { kind: 'bits', offset: 0, bitOffset: 0, bitWidth: 4 },
      applyMode: 'reload-settings',
    },
    {
      id: 'compander',
      label: 'Compander',
      group: 'attr',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'TX' },
          { value: 2, label: 'RX' },
          { value: 3, label: 'TX+RX' },
        ],
      },
      location: { kind: 'bits', offset: 0, bitOffset: 4, bitWidth: 2 },
      applyMode: 'reload-settings',
    },
    {
      id: 'scanlist2',
      label: 'Scan List 2',
      group: 'attr',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 0, bitOffset: 6, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'scanlist1',
      label: 'Scan List 1',
      group: 'attr',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 0, bitOffset: 7, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
  ],
};

/**
 * V3/K1 channel attributes — 2 bytes per channel.
 *
 * Verified from briand/uv-k1-k5v3-firmware-custom/App/misc.h:242-253.
 *
 * Differences from V1:
 * - band shrunk to 3 bits (was 4)
 * - exclude bit added (per-channel scan exclude)
 * - scanlist is now a full byte (24 lists + ALL + reserved)
 */
export const channelAttrsV3: StructTemplate = {
  size: 2,
  fields: [
    {
      id: 'band',
      label: 'Band',
      group: 'attr',
      type: { kind: 'int', min: 0, max: 7 },
      location: { kind: 'bits', offset: 0, bitOffset: 0, bitWidth: 3 },
      applyMode: 'reload-settings',
    },
    {
      id: 'compander',
      label: 'Compander',
      group: 'attr',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'TX' },
          { value: 2, label: 'RX' },
          { value: 3, label: 'TX+RX' },
        ],
      },
      location: { kind: 'bits', offset: 0, bitOffset: 3, bitWidth: 2 },
      applyMode: 'reload-settings',
    },
    {
      id: 'exclude',
      label: 'Exclude from scan',
      group: 'attr',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 0, bitOffset: 7, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'scanlist',
      label: 'Scan List',
      group: 'attr',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          ...Array.from({ length: 24 }, (_, i) => ({
            value: i + 1,
            label: `List ${String(i + 1).padStart(2, '0')}`,
          })),
          { value: 0xFF, label: 'ALL' },
        ],
      },
      location: { kind: 'byte', offset: 1, size: 1 },
      applyMode: 'reload-settings',
    },
  ],
};
