# 04. Channel modules

The channel data is the bulk of what users actually program. This doc
covers the 16-byte channel record (identical between V1 and V3/K1) and
the attribute byte layouts (different).

## Channel record (shared by V1 and V3/K1)

Verified from `egzumer/uv-k5-firmware-custom/settings.c:597-653`
(`SETTINGS_SaveChannel`) and the V3/K1 fork's matching read paths.

```
byte  field
0-3   rx_freq                  u32 LE, units of 10 Hz
4-7   tx_offset_freq           u32 LE, units of 10 Hz (offset, not absolute)
8     rx_code                  CTCSS index OR DCS value byte
9     tx_code                  same
10    [7:4] tx_code_type | [3:0] rx_code_type
                                0=Off, 1=CTCSS, 2=DCS, 3=R-DCS
11    [7:4] modulation | [3:0] tx_offset_dir
                                Mod: 0=FM 1=AM 2=USB
                                Dir: 0=Off 1=+ 2=-
12    [7:4] busy_lock | [3:2] tx_power | [1] bandwidth | [0] freq_reverse
                                BCL: 0=Off 1=Carrier 2=CTCSS/DCS
                                Power: 0=Low 1=Mid 2=High
                                BW: 0=Wide 1=Narrow
13    [3:1] dtmf_ptt_id_tx_mode | [0] dtmf_decoding_enable
14    step_setting              Index into frequency step table
15    scrambling_type           0=Off, 1-10 = scrambler index
```

## Channel attributes — V1 vs V3/K1

This is where V1 and V3/K1 diverge. Two distinct modules; profiles
choose the correct one.

### V1: 1 byte per channel (egzumer / F4HWN)

Verified from `egzumer/uv-k5-firmware-custom/misc.h:178-189`.

```
bit  field
0-3  band
4-5  compander  (0=Off, 1=TX, 2=RX, 3=TX+RX)
6    scanlist2
7    scanlist1
```

### V3/K1: 2 bytes per channel

Verified from `briand/uv-k1-k5v3-firmware-custom/App/misc.h:242-253`.

```
byte 0
  bit 0-2   band         (3 bits; bit reclaimed compared to V1)
  bit 3-4   compander
  bit 5     unused
  bit 6     unused
  bit 7     exclude      (per-channel scan exclude — NEW)
byte 1
  bit 0-7   scanlist     (8 bits → 24 lists + ALL + reserved)
```

## Address layout

| Region | V1 | V3/K1 |
| --- | --- | --- |
| Channel records | 0x0000 (200 × 16 B) | 0x0000 (1024 × 16 B) |
| Channel attrs | 0x0D60 (207 × 1 B) | 0x8000 (1031 × 2 B) |
| Channel names | 0x0F50 (200 × 16 B) | 0x4000 (1024 × 16 B) |

The `+7` in attribute counts is for VFO state slots that follow the
channel attribute array. Mark indices ≥ channel count as `vfo` in the
UI and require explicit advanced mode to touch them — users almost
never mean to edit VFO state directly.

## Pitfalls

1. **TX offset, not TX frequency.** Bytes 4-7 store the offset from RX,
   not an absolute TX frequency. Encoding/decoding logic must apply
   `tx_offset_dir` to compute the actual TX frequency.

2. **CTCSS/DCS value byte interpretation depends on code_type.** Same
   byte, different meaning depending on whether it's CTCSS or DCS.
   Look up the index against a table; don't display raw bytes.

3. **The shared `channelRecord` template hides V1/V3 differences that
   AREN'T in the 16-byte record.** Don't be lulled into thinking the
   entire channel system is identical — only the 16-byte record is.
   Attributes and names live in different regions with different
   layouts.

4. **Channel names are 16 bytes but only 10 are used.** The last 6 are
   padding/reserved. Stock and most customs put the name in bytes
   0-9; some customs use trailing bytes for extra metadata. Treat
   bytes 10-15 as opaque.
