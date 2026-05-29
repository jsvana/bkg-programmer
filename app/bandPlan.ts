/**
 * Frequency → modulation guesses for the "Program a channel" wizard.
 *
 * Source: ARRL US amateur band plan (arrl.org/band-plan) for the 17 m
 * through 70 cm segments, plus FCC 47 CFR §87 for the 108-137 MHz civil
 * aviation AM allocation. Trimmed to the radio's tuning range of
 * 18-1300 MHz (src/schema/modules/channel-record.ts:18). LSB segments
 * (80 m / 40 m / 160 m lower halves) are intentionally absent because
 * the firmware modulation enum
 * (src/schema/modules/channel-record.ts:104-114) has no LSB value —
 * FM / AM / USB / CW only. Operators wanting LSB pick USB and accept
 * the inverted sideband.
 */

export type ChannelMode = "FM" | "AM" | "USB" | "CW";

export type ChannelModeSelection =
  | { kind: "auto" }
  | { kind: "explicit"; mode: ChannelMode };

export interface BandSegment {
  /** Inclusive lower bound, MHz. */
  loMhz: number;
  /** Exclusive upper bound, MHz. */
  hiMhz: number;
  mode: ChannelMode;
  /** Short human label, e.g. "2m FM" or "70cm SSB weak-signal". */
  label: string;
}

const SEGMENTS: ReadonlyArray<BandSegment> = [
  // 17 m
  { loMhz: 18.068, hiMhz: 18.110, mode: "CW", label: "17m CW" },
  { loMhz: 18.110, hiMhz: 18.168, mode: "USB", label: "17m SSB" },
  // 15 m
  { loMhz: 21.000, hiMhz: 21.200, mode: "CW", label: "15m CW" },
  { loMhz: 21.200, hiMhz: 21.450, mode: "USB", label: "15m SSB" },
  // 12 m
  { loMhz: 24.890, hiMhz: 24.930, mode: "CW", label: "12m CW" },
  { loMhz: 24.930, hiMhz: 24.990, mode: "USB", label: "12m SSB" },
  // 10 m
  { loMhz: 28.000, hiMhz: 28.300, mode: "CW", label: "10m CW" },
  { loMhz: 28.300, hiMhz: 29.000, mode: "USB", label: "10m SSB" },
  { loMhz: 29.000, hiMhz: 29.700, mode: "FM", label: "10m FM (29.6 calling)" },
  // 6 m
  { loMhz: 50.000, hiMhz: 50.100, mode: "CW", label: "6m CW" },
  { loMhz: 50.100, hiMhz: 50.300, mode: "USB", label: "6m SSB" },
  { loMhz: 50.300, hiMhz: 54.000, mode: "FM", label: "6m FM" },
  // Civil aviation
  { loMhz: 108.000, hiMhz: 137.000, mode: "AM", label: "Aviation AM" },
  // 2 m
  { loMhz: 144.000, hiMhz: 144.275, mode: "USB", label: "2m SSB/CW" },
  { loMhz: 144.275, hiMhz: 148.000, mode: "FM", label: "2m FM" },
  // 1.25 m
  { loMhz: 222.000, hiMhz: 225.000, mode: "FM", label: "1.25m FM" },
  // 70 cm — weak-signal SSB sliver at 432.100-432.300, FM elsewhere
  { loMhz: 420.000, hiMhz: 432.100, mode: "FM", label: "70cm FM" },
  { loMhz: 432.100, hiMhz: 432.300, mode: "USB", label: "70cm SSB" },
  { loMhz: 432.300, hiMhz: 450.000, mode: "FM", label: "70cm FM" },
];

export interface GuessResult {
  mode: ChannelMode;
  /** Matched segment, or null when no segment covered the frequency. */
  segment: BandSegment | null;
  /** Human-readable "why" — segment label or fallback note. */
  reason: string;
}

/**
 * Resolve a modulation for `freqMhz`. Falls back to FM when no segment
 * matches: these radios are FM-first handhelds, and FM is what users
 * programming MURS / FRS / commercial VHF / UHF channels will
 * overwhelmingly want.
 */
export function guessModulation(freqMhz: number): GuessResult {
  if (!Number.isFinite(freqMhz)) {
    return { mode: "FM", segment: null, reason: "Invalid frequency — default FM" };
  }
  for (const seg of SEGMENTS) {
    if (freqMhz >= seg.loMhz && freqMhz < seg.hiMhz) {
      return {
        mode: seg.mode,
        segment: seg,
        reason: `${seg.loMhz.toFixed(3)}–${seg.hiMhz.toFixed(3)} MHz · ${seg.label}`,
      };
    }
  }
  return {
    mode: "FM",
    segment: null,
    reason: "Outside known ham / aviation segments — default FM",
  };
}

/**
 * Map a frequency (MHz) to the briand `FREQUENCY_Band_t` index — the same
 * index stored in `channel_attrs.band`. Mirrors `App/frequencies.c`
 * `FREQUENCY_GetBand` exactly: pick the highest band whose lower bound
 * ≤ frequency. The firmware `.lower` values are in units of 10 Hz; we
 * compare MHz against the equivalent here.
 *
 * Source: App/frequencies.c:30-46, :118-125 (briand fork).
 */
export function bandIndexForMHz(freqMhz: number): number {
  // [band index, lower MHz]
  const tbl: ReadonlyArray<[number, number]> = [
    [6, 470], // BAND7_470MHz
    [5, 400], // BAND6_400MHz
    [4, 350], // BAND5_350MHz
    [3, 174], // BAND4_174MHz
    [2, 137], // BAND3_137MHz
    [1, 108], // BAND2_108MHz
    [0, 50], //  BAND1_50MHz
  ];
  for (const [idx, lower] of tbl) {
    if (freqMhz >= lower) return idx;
  }
  return 0;
}
