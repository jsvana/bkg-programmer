# 05. Calibration module

The calibration region holds factory-tuned values: RSSI thresholds,
battery voltage points, VOX levels, TX power tables. Editing these can
permanently impair the radio if done wrong. The schema marks the whole
module `readOnly` by default.

## Good news: same layout on V1 and V3/K1

Verified by comparing:
- V1: `egzumer/uv-k5-firmware-custom/settings.c:282-324`
  (`SETTINGS_LoadCalibration`)
- V3/K1: `briand/uv-k1-k5v3-firmware-custom/App/settings.c:522-570`

Both load identical-shape data from the same relative offsets within
their respective 512-byte calibration regions. Only the **base address**
differs:

- V1: base = `0x1E00`
- V3/K1: base = `0xB000`

This means one schema module, parameterized by base offset, serves
both profiles.

## Layout within the 512-byte region

| Offset | Size | Contents |
| --- | --- | --- |
| 0x000–0x0BF | 192 B | TX/RX power calibration tables (opaque) |
| **0x0C0–0x0C7** | 8 B | RSSI calibration template (high bands: 3-6) |
| **0x0C8–0x0CF** | 8 B | RSSI calibration template (low bands: 0-2) |
| 0x0D0–0x13F | 112 B | More power/frequency calibration (opaque) |
| **0x140–0x14B** | 12 B | Battery: 6× u16 voltage points |
| **0x150–0x163** | 20 B | VOX1 thresholds: 10× u16 |
| **0x168–0x17B** | 20 B | VOX0 thresholds (hysteresis): 10× u16 |
| 0x17C–0x187 | 12 B | (reserved/unknown) |
| **0x188–0x18F** | 8 B | Misc calibration |
| 0x190–0x1FF | 112 B | More, less-documented |

Bold rows are the well-understood fields. The non-bold ranges are
treated as opaque blobs — exposed in the UI as "Power Calibration
Tables (read-only blob)" with a hex view, but no decoded fields.

## Read-only enforcement

Two layers:

1. **Writer-side refusal.** The write API refuses to touch a field in a
   `readOnly: true` module unless the caller passes
   `{ allowCalibrationWrite: true }`.
2. **UI gating.** The calibration tab is read-only by default. An
   "I know what I'm doing" toggle flips it editable and surfaces a
   banner: "You are editing factory calibration. The only recovery is
   restore from backup."

## The actually-important calibration feature: backup

For the BKG tool, **calibration backup matters more than calibration
editing.** Most users will never edit calibration; all of them should
have a saved backup before any flash or firmware change.

UI should:

1. **On first connect**, check IndexedDB for a backup of this radio
   (keyed by serial number). If absent: "No calibration backup for
   serial XXX. Back up now? (Strongly recommended.)"
2. **Before any flash**, refuse unless a backup exists or the user
   explicitly opts out with typed confirmation.
3. **On restore**, diff the current vs. backup and show exactly what
   would change before committing.

See `docs/07-backup-format.md` for the backup format.
