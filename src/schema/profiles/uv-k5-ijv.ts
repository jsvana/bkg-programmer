import type { Profile, BlockModuleDef } from '../types';
import {
  channelRecordIjv,
  channelName,
  channelAttrsV1,
  calibration,
} from '../modules/index';

/** Opaque read-only window for empirical mapping. No field interpretation. */
function probeBlock(id: string, baseOffset: number, size: number): BlockModuleDef {
  return { kind: 'block', id, baseOffset, size, fields: [], readOnly: true };
}

/**
 * Settings block at 0x0E30-0x0F50 on IJV V2.9R5. Field positions below were
 * derived empirically (capture, flip in radio menu, recapture, byte-diff)
 * on 2026-05-25. Bytes not yet attributed to a named field are simply
 * absent from `fields[]` — the block as a whole still reads/writes 0x120
 * bytes via the size field, so backups capture them.
 */
const ijvSettings: BlockModuleDef = {
  kind: 'block',
  id: 'ijv_settings',
  // baseOffset omitted — supplied by binding in the profile.
  size: 0x0120,
  readOnly: true,
  sensitivity: 'sensitive', // contains lockscreen codes
  fields: [
    {
      id: 'squelch_level',
      label: 'Squelch Level',
      description:
        'Global squelch threshold. 0 = open (no squelch), 9 = tightest. ' +
        'Verified by single-byte diff between SQL=4 and SQL=1 captures ' +
        'on V2.9R5 hardware (2026-05-25): abs address 0x0E73 went ' +
        '0x04 → 0x01 while all other captured bytes were identical.',
      group: 'rx',
      type: { kind: 'int', min: 0, max: 9 },
      // 0x0E73 - 0x0E30 = 0x43 within this block.
      location: { kind: 'byte', offset: 0x43, size: 1 },
      applyMode: 'live',
    },
    {
      id: 'boot_line_1',
      label: 'Boot Screen Line 1',
      description:
        'First line of the boot/welcome screen. ASCII, null-padded. ' +
        'Inferred by sight (not by diff) — the user\'s callsign "W6JSV" ' +
        'was found here in a captured backup. Trailing 5 bytes of the ' +
        '16-byte window hold non-ASCII data, so the visible text caps ' +
        'at 10 chars and the slot likely overruns into a flag byte cluster.',
      group: 'branding',
      // 0x0EA0 - 0x0E30 = 0x70
      type: { kind: 'ascii', maxLength: 10 },
      location: { kind: 'byte', offset: 0x70, size: 12 },
      applyMode: 'reboot',
    },
    {
      id: 'boot_line_2',
      label: 'Boot Screen Line 2',
      description:
        'Second line of the boot/welcome screen. ASCII, null-padded. ' +
        'Inferred from "WELCOME" appearing here. Full 16-byte slot, ' +
        'all-zero tail in the captured backup.',
      group: 'branding',
      // 0x0EB0 - 0x0E30 = 0x80
      type: { kind: 'ascii', maxLength: 12 },
      location: { kind: 'byte', offset: 0x80, size: 12 },
      applyMode: 'reboot',
    },
    // Five short codes follow at 0x0EE0, 0x0EE8, 0x0EF0, 0x0EF8, 0x0F08
    // (each an 8-byte slot holding a null-padded 3-5 char ASCII string).
    // Defaults "102", "77777", "88888", "123", "456" — the 77777/88888 pair
    // matches stock K1's documented default lockscreen passwords at the same
    // *relative* offset (CLAUDE.md notes 0x0EE8/0x0EF0 on stock K1). Naming
    // them speculatively in IJV without confirming the menu mapping would
    // be guessing, so they're left unfielded — the block still captures the
    // bytes via its size, they just don't get a labeled UI field yet.
  ],
};

/**
 * Quansheng UV-K5 V1/V2 running IJV mod (V2.9Rx and V3.60 lines).
 *
 * **IJV is closed-source.** The author does not publish the firmware
 * source code; see egzumer/uv-k5-firmware-custom discussion #422
 * ("IJV refuses to share his code, so I'm unable to even take a look
 * for his improvements"). This profile is therefore built from what
 * IJV provably inherits from the DualTachyon/upstream K5 V1 layout:
 * the on-EEPROM channel record, channel-attrs byte, and channel-name
 * structures plus the calibration region. Everything past that —
 * settings struct, custom AES key handling, scanlist bits, the F4HWN-
 * style settings region at 0x1FF0 (if present) — is opaque to us
 * until empirical mapping or a leak proves otherwise.
 *
 * IJV manual (universirius.com) identifies three release lines:
 *   - V2.9R5      — K5 V1/V2, "for average users"  (matched here)
 *   - V3.60       — K5 V1/V2, "technical use"       (matched here)
 *   - V4          — K1 / K5v3 only                  (NOT matched here;
 *                   different hardware family, needs its own profile)
 *
 * Write policy (as of 2026-05-25):
 *   - `channel_names` is **write-enabled** so the self-test can run.
 *     The slot at 0x0F50 + (N-1)*16 was the single most empirically
 *     verified address we have for IJV — the "4cB01" rename diff
 *     proved both the address and the encoding match stock V1.
 *     Persistence across reboot is still TBD; that's exactly what
 *     the self-test is meant to determine.
 *   - Everything else is still read-only until self-test passes.
 *     boot_line_1 / boot_line_2 in ijv_settings, the channels and
 *     scratch_channels arrays, and the probe block remain locked.
 *
 * See CLAUDE.md's "How to debug a verify mismatch" and Open Question
 * #1 for the persistence/cache caveat.
 *
 * Verified shared with stock K5 V1 (DualTachyon upstream):
 *   - channels at 0x0000, 200 × 16 bytes — but using `channelRecordIjv`
 *     template (NOT stock `channelRecord`). IJV repacks byte 12:
 *     tx_power lives at bits 3–4, not stock's bits 2–3. See
 *     channel-record-ijv.ts for the 3-state diff that verified it.
 *   - channel_attrs at 0x0D60, 207 × 1 byte (V1 1-byte attrs)
 *   - channel_names at 0x0F50, 200 × 16 bytes
 *     **Empirically verified on V2.9R5 hardware 2026-05-25**: renaming
 *     channel 1 to "4cB01" in the radio menu placed the bytes
 *     `34 63 42 30 31 00 …` (10-char + 6 null pad) at backup region
 *     offset 0x0F50+0. Next slot at +0x10 reads "CH002\0…". IJV uses
 *     the V1 channel-name layout unchanged.
 *   - scratch_channels at 0x0C80, 14 × 16 bytes — band-VFO working
 *     copies (likely 7 bands × A/B = 14 slots). Same channelRecordIjv
 *     shape as the main array. The TX-power knob writes to whichever
 *     slot corresponds to the currently-active band's VFO; the 3-state
 *     capture on 2026-05-25 hit slot 5 because channel 1 (144.025 MHz,
 *     2m) was active at the time, so slot 5 held the live mirror of
 *     channel 1's record.
 *   - channels_mirror at 0x2000, 0x110 bytes — byte-for-byte duplicate
 *     of channels[0..16]. Past 0x2110 is all-0xFF (verified by 8 KB
 *     probe). IJV does NOT extend EEPROM in any meaningful sense; this
 *     mirror is the entirety of the past-stock-cap mapped region.
 *   - calibration at 0x1E00, 512 bytes (V1 base; layout shared with
 *     V3/K1 per egzumer/settings.c:282-324)
 *   - ijv_settings at 0x0E30, 288 bytes — block contains squelch_level
 *     at +0x43 (verified 2026-05-25 by SQL=4 vs SQL=1 single-byte
 *     diff), plus boot_line_1 / boot_line_2 inferred-by-sight.
 *
 * Deliberately omitted (needs empirical mapping on V2.9R5 hardware):
 *   - Settings struct / channel mode / squelch / scanlist edges
 *   - Whether IJV uses a 0x1FF0 settings region like F4HWN does
 *     (likely repurposed differently; do NOT bind f4hwn_settings here)
 *   - Custom AES key region (0x0F30..0x0F40 reload-trigger applies)
 *   - Boot logo / branding bytes
 *
 * Detection notes: `modelBytesPreserved: false` in the registry until
 * we confirm IJV preserves the V1 model identifier at 0x1ED0.
 * Reading the wrong address and matching anyway would falsely upgrade
 * confidence to 'high'; reading and getting "UV-???" would trip the
 * 'conflict' branch in detect.ts and block all flashing. Stay at
 * medium until verified.
 */
export const uvK5Ijv: Profile = {
  id: 'uv-k5-ijv',
  displayName: 'UV-K5 V1/V2 with IJV mod (V2.9 / V3.60) — read-only',
  appliesTo: {
    radioModels: ['uv-k5-v1', 'uv-k5-v2'],
    firmwareFamily: 'ijv',
    versionRange: '2.9|3.60',
  },
  // IJV maps a 272-byte mirror of channels[0..16] at 0x2000–0x2110;
  // past 0x2110 is all-0xFF (unmapped). The mirror appears to be a
  // redundancy scheme — same pattern stock K1 uses for its dual-buffer
  // boot logo. No other "extended" EEPROM territory exists.
  eepromSize: 0x2110,
  modules: [
    {
      kind: 'array',
      id: 'channels',
      baseOffset: 0x0000,
      count: 200,
      stride: 16,
      template: channelRecordIjv,
      readOnly: true,
    },
    {
      kind: 'array',
      id: 'channel_attrs',
      baseOffset: 0x0D60,
      count: 207, // 200 channels + 7 VFO slots
      stride: 1,
      template: channelAttrsV1,
      readOnly: true,
    },
    {
      kind: 'array',
      id: 'channel_names',
      baseOffset: 0x0F50,
      count: 200,
      stride: 16,
      template: channelName,
      // Write-enabled — channel-name layout is the most empirically
      // verified address on IJV (see "4cB01" diff in module JSDoc).
      // Persistence across reboot is what the self-test validates.
    },
    { binding: { moduleId: 'calibration', baseOffset: 0x1E00 } },
    { binding: { moduleId: 'ijv_settings', baseOffset: 0x0E30 } },
    // Scratch / VFO storage. 14 slots × 16 bytes = 0xE0. The IJV menu's
    // TX-power knob writes to this region (slot 5 byte 12 in the
    // captures), so it uses the same channel-record shape as the
    // primary 200-channel array — just with VFO/scratch semantics.
    {
      kind: 'array',
      id: 'scratch_channels',
      baseOffset: 0x0C80,
      count: 14,
      stride: 16,
      template: channelRecordIjv,
      readOnly: true,
    },
    // Remaining unmapped window between channel_names and calibration.
    // Likely DTMF, FM presets, scanlist edges — yet to be mapped.
    probeBlock('probe_post_names', 0x1BD0, 0x0230),
    // Byte-for-byte mirror of channels[0..16] (272 bytes). Verified
    // 2026-05-25 by 8 KB probe: 0x2000-0x2110 exactly equals
    // 0x0000-0x0110, and 0x2110+ is all-0xFF. Likely a redundancy /
    // wear-leveling scheme similar to stock K1's dual-buffer boot
    // logo. Read-only — writes here would diverge from the primary
    // channels array until something causes a resync, and we don't
    // know IJV's resync trigger.
    //
    // The "IJV MOD" splash hunt is closed: searching the probe for
    // 'IJV' / 'MOD' / 'V2.9R' returned zero hits across all regions.
    // Boot text lives in firmware ROM, not EEPROM.
    probeBlock('channels_mirror', 0x2000, 0x0110),
  ],
  notes:
    'IJV is closed-source. Profile covers the layout IJV provably ' +
    'inherits from stock K5 V1 and stops there. No settings/AES/scanlist ' +
    'decoding until empirical mapping or a citable source lands. ' +
    'V4 (K1/K5v3) is a separate hardware family and not covered here.',
};

// Re-export bound modules so the resolver can find them by ID.
// (calibration is shared with the v1 F4HWN profile; ijvSettings is
// IJV-specific. The Map in profiles/index.ts dedupes by ID.)
export const ijvResolverModules = { calibration, ijvSettings };
