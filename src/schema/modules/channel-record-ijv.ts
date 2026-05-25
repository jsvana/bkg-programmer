import type { StructTemplate } from '../types';
import { channelRecord } from './channel-record';

/**
 * IJV-specific 16-byte channel record (V2.9Rx and V3.60).
 *
 * Inherits bytes 0–11 and 13–15 from the stock K5 V1 `channelRecord`
 * template — these are deeply baked into firmware and the channel-name
 * sibling (also verified IJV-compatible) sits right after, so the
 * pre-byte-12 region is almost certainly intact. The override below
 * is **byte 12 only**, where IJV demonstrably repacks the bits.
 *
 * Byte 12 repacking (empirically verified on V2.9R5, 2026-05-25):
 *
 *   3-state TX-power capture written to byte 12 of scratch_channels[5]
 *   (abs 0x0CDC). scratch_channels[5] was the live VFO working copy
 *   of channel 1 (144.025 MHz, 2m band) at the time, so the menu's
 *   TX-power knob wrote there; channel 1's own record at 0x000C
 *   ended up with the final value after the menu Save.
 *
 *     TX Low  → 0x02 = 0000 0010
 *     TX Mid  → 0x0A = 0000 1010
 *     TX High → 0x12 = 0001 0010
 *
 *   Bit 1 is constant (bandwidth = narrow). Bits 3–4 cycle
 *   00 → 01 → 10 across Low/Mid/High. So:
 *
 *     IJV byte 12:                    Stock byte 12 (egzumer):
 *       bit 0:  freq_reverse            bit 0:  freq_reverse
 *       bit 1:  bandwidth               bit 1:  bandwidth
 *       bit 2:  (unknown — was 0)       bits 2–3: tx_power
 *       bits 3–4: tx_power  ← shifted   bits 4–7: busy_lock
 *       bits 5–7: (unknown — were 000)
 *
 *   So IJV slid tx_power one bit left and likely repurposed bit 2
 *   plus the upper nibble for something else (busy-lock is the
 *   stock-likely candidate but bit positions are not yet verified).
 *
 * Honesty caveat: only `tx_power` is empirically verified on IJV.
 * `freq_reverse` and `bandwidth` are inherited from stock at the
 * same bit positions; their bit values in the captures we have are
 * consistent with stock semantics but we have not done dedicated
 * diffs to confirm. `busy_lock` is intentionally not declared —
 * if `tx_power` shifted, `busy_lock` almost certainly did too, and
 * we have no diff yet. Bit 2 and bits 5–7 are left unfielded.
 *
 * Backups still capture all 16 bytes via the array's stride; only
 * the field decoding is partial.
 */

// Stock byte-12 field ids that we want to replace on IJV.
const STOCK_BYTE_12_IDS = new Set([
  'freq_reverse',
  'bandwidth',
  'tx_power',
  'busy_lock',
]);

export const channelRecordIjv: StructTemplate = {
  size: 16,
  fields: [
    // Inherit everything except byte 12's packed fields.
    ...channelRecord.fields.filter((f) => !STOCK_BYTE_12_IDS.has(f.id)),
    {
      id: 'freq_reverse',
      label: 'Reverse',
      description:
        'Reverse RX/TX. Bit position inherited from stock K5; not ' +
        'diff-verified on IJV but bit values in captured backups are ' +
        'consistent with stock semantics.',
      group: 'ch.flags',
      type: { kind: 'bool' },
      location: { kind: 'bits', offset: 12, bitOffset: 0, bitWidth: 1 },
      applyMode: 'reload-settings',
    },
    {
      id: 'bandwidth',
      label: 'Bandwidth',
      description:
        'Bit position inherited from stock K5. Captured VFO slots ' +
        'show bit 1 set, consistent with stock narrow=1 semantics; ' +
        'not diff-verified on IJV.',
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
        'IJV shifts tx_power one bit higher than stock K5: stock uses ' +
        'bits 2–3, IJV uses bits 3–4. Verified by 3-state capture on ' +
        'V2.9R5 (2026-05-25): Low→0b00, Mid→0b01, High→0b10 at ' +
        'scratch_channels[5] byte 12 (live VFO mirror of channel 1).',
      group: 'ch.tx',
      type: {
        kind: 'enum',
        values: [
          { value: 0, label: 'Low' },
          { value: 1, label: 'Mid' },
          { value: 2, label: 'High' },
        ],
      },
      location: { kind: 'bits', offset: 12, bitOffset: 3, bitWidth: 2 },
      applyMode: 'reload-settings',
    },
    // bit 2 and bits 5–7 of byte 12 deliberately not declared:
    //  - bit 2: was 0 across all three TX-power captures; semantics unknown
    //  - bits 5–7: were 000 across all three captures; likely the new home
    //    of busy_lock (stock-shifted by one too?) but unverified.
  ],
};
