import type { StructTemplate } from '../types';

/**
 * 16-byte channel record. Identical between V1 and V3/K1.
 *
 * Verified from:
 * - egzumer/uv-k5-firmware-custom/settings.c:597-653 (SETTINGS_SaveChannel)
 * - briand/uv-k1-k5v3-firmware-custom matching read paths
 */
export const channelRecord: StructTemplate = {
  size: 16,
  fields: [
    {
      id: 'rx_freq',
      label: 'RX Frequency',
      description: 'Receive frequency in units of 10 Hz',
      group: 'ch.freq',
      type: { kind: 'frequency', min: 18_000_000, max: 1_300_000_000, resolutionHz: 10 },
      location: { kind: 'byte', offset: 0, size: 4 },
      applyMode: 'reload-settings',
    },
    {
      id: 'tx_offset_freq',
      label: 'TX Offset',
      description: 'Offset from RX (not absolute TX frequency). Direction determined by tx_offset_dir.',
      group: 'ch.freq',
      type: { kind: 'frequency', min: 0, max: 100_000_000, resolutionHz: 10 },
      location: { kind: 'byte', offset: 4, size: 4 },
      applyMode: 'reload-settings',
    },
    {
      id: 'rx_code',
      label: 'RX Tone Value',
      description: 'CTCSS index OR DCS value, interpretation depends on rx_code_type',
      group: 'ch.tones',
      type: { kind: 'int', min: 0, max: 0xFF },
      location: { kind: 'byte', offset: 8, size: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'tx_code',
      label: 'TX Tone Value',
      group: 'ch.tones',
      type: { kind: 'int', min: 0, max: 0xFF },
      location: { kind: 'byte', offset: 9, size: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'rx_code_type',
      label: 'RX Tone Type',
      group: 'ch.tones',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'CTCSS' },
          { value: 2, label: 'DCS' },
          { value: 3, label: 'R-DCS' },
        ],
      },
      location: { kind: 'bits', offset: 10, bitOffset: 0, bitWidth: 4 },
      applyMode: 'reload-settings',
    },
    {
      id: 'tx_code_type',
      label: 'TX Tone Type',
      group: 'ch.tones',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'CTCSS' },
          { value: 2, label: 'DCS' },
          { value: 3, label: 'R-DCS' },
        ],
      },
      location: { kind: 'bits', offset: 10, bitOffset: 4, bitWidth: 4 },
      applyMode: 'reload-settings',
    },
    {
      id: 'tx_offset_dir',
      label: 'TX Offset Direction',
      group: 'ch.freq',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off (simplex)' },
          { value: 1, label: '+' },
          { value: 2, label: '-' },
        ],
      },
      location: { kind: 'bits', offset: 11, bitOffset: 0, bitWidth: 4 },
      applyMode: 'reload-settings',
    },
    {
      id: 'modulation',
      label: 'Modulation',
      description:
        'Channel modulation. CW requires firmware built with ' +
        'ENABLE_CW_MODULATOR (NR7Y CW preset on briand). BYP/RAW require ' +
        'ENABLE_BYP_RAW_DEMODULATORS. On firmware lacking the feature, ' +
        'the value is stored but the radio falls back to FM at runtime.',
      group: 'ch.mod',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'FM' },
          { value: 1, label: 'AM' },
          { value: 2, label: 'USB' },
          { value: 3, label: 'CW' },
          { value: 4, label: 'BYP' },
          { value: 5, label: 'RAW' },
        ],
      },
      location: { kind: 'bits', offset: 11, bitOffset: 4, bitWidth: 4 },
      applyMode: 'reload-settings',
    },
    {
      id: 'freq_reverse',
      label: 'Reverse',
      group: 'ch.flags',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 12, bitOffset: 0, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'bandwidth',
      label: 'Bandwidth',
      group: 'ch.mod',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Wide (25 kHz)' },
          { value: 1, label: 'Narrow (12.5 kHz)' },
        ],
      },
      location: { kind: 'bits', offset: 12, bitOffset: 1, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'tx_power',
      label: 'TX Power',
      description:
        '3-bit OUTPUT_POWER. Firmware enum in App/settings.h:133-140. ' +
        'Byte-12 layout per briand App/settings.c:1228 ' +
        '(pVFO->OUTPUT_POWER << 2).',
      group: 'ch.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'User' },
          { value: 1, label: 'Low1' },
          { value: 2, label: 'Low2' },
          { value: 3, label: 'Low3' },
          { value: 4, label: 'Low4' },
          { value: 5, label: 'Low5' },
          { value: 6, label: 'Mid' },
          { value: 7, label: 'High' },
        ],
      },
      location: { kind: 'bits', offset: 12, bitOffset: 2, bitWidth: 3 },
      applyMode: 'reload-settings',
    },
    {
      id: 'busy_lock',
      label: 'Busy Channel Lock',
      description:
        'Single bit per briand App/settings.c:1227 ' +
        '(pVFO->BUSY_CHANNEL_LOCK << 5).',
      group: 'ch.tx',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 12, bitOffset: 5, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'tx_lock',
      label: 'TX Lock',
      description:
        'Disables transmission on this channel. On F4HWN with ' +
        'ENABLE_EXTRA_FILTER, this bit doubles as the NARROWEST flag ' +
        'when modulation is CW or USB (see briand App/settings.c:1219-' +
        '1226). For non-CW/USB channels, the bit is plain TX_LOCK.',
      group: 'ch.tx',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 12, bitOffset: 6, bitWidth: 1 },
      applyMode: 'reload-settings',
      requires: ['ENABLE_FEAT_F4HWN'],
    },
    {
      id: 'dtmf_decoding',
      label: 'DTMF Decoding',
      group: 'ch.dtmf',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 13, bitOffset: 0, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'dtmf_ptt_id',
      label: 'DTMF PTT ID Mode',
      group: 'ch.dtmf',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'BoT' },
          { value: 2, label: 'EoT' },
          { value: 3, label: 'Both' },
        ],
      },
      location: { kind: 'bits', offset: 13, bitOffset: 1, bitWidth: 3 },
      applyMode: 'reload-settings',
    },
    {
      id: 'step',
      label: 'Frequency Step',
      description: 'Index into the frequency step table',
      group: 'ch.freq',
      type: { kind: 'int', min: 0, max: 15, unit: 'index' },
      location: { kind: 'byte', offset: 14, size: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'scrambling',
      label: 'Scrambler',
      group: 'ch.mod',
      type: { kind: 'int', min: 0, max: 10 },
      location: { kind: 'byte', offset: 15, size: 1 },
      applyMode: 'reload-settings',
    },
  ],
};

/**
 * Channel name template — 16 bytes, 10 chars + 6 padding.
 * Shared between V1 and V3/K1.
 */
export const channelName: StructTemplate = {
  size: 16,
  fields: [
    {
      id: 'name',
      label: 'Channel Name',
      group: 'ch.name',
      type: { kind: 'ascii', maxLength: 10 },
      location: { kind: 'byte', offset: 0, size: 8 },
      applyMode: 'reload-settings',
    },
    // bytes 8-15 are padding/reserved; intentionally not declared
  ],
};
