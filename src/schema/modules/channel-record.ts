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
      group: 'ch.mod',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'FM' },
          { value: 1, label: 'AM' },
          { value: 2, label: 'USB' },
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
      group: 'ch.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Low' },
          { value: 1, label: 'Mid' },
          { value: 2, label: 'High' },
        ],
      },
      location: { kind: 'bits', offset: 12, bitOffset: 2, bitWidth: 2 },
      applyMode: 'reload-settings',
    },
    {
      id: 'busy_lock',
      label: 'Busy Channel Lock',
      group: 'ch.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'Carrier' },
          { value: 2, label: 'CTCSS/DCS' },
        ],
      },
      location: { kind: 'bits', offset: 12, bitOffset: 4, bitWidth: 4 },
      applyMode: 'reload-settings',
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
