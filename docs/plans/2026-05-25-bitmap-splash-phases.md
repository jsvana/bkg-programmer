# Bitmap boot splash on K1+NR7Y — RESOLVED via host-side chunk fix

**Status (2026-05-25 end of day)**: bitmap boot splash works on stock
NR7Y v1.0.0 with **no firmware modifications required**. The original
"writes time out at 120 s" symptom was a host-side bug, not a firmware
or chip-protection issue.

## What the bug actually was

`session.writeEeprom` chunked at 248 bytes (`0xF8`, the WRITE_EEPROM
protocol max). But the firmware's UART receive buffer
(`App/driver/uart.c:39` and `App/driver/vcp.c:25`) is only **256 bytes**.
The full wire frame for a 248-byte chunk is:

```
2 (SOF AB CD) + 2 (size field) + 12 (CMD_051D header) + 248 (data)
              + 2 (CRC) + 2 (EOF DC BA) = 268 bytes
```

268 > 256, so the firmware's frame parser
(`App/app/uart.c:860`) sees `Size + 8 > ReadBufSize` and rejects the
whole frame without dispatching. No command processed, no reply sent,
host hits the 120 s timeout. The chip never sees the write at all.

**Fix**: clamp `writeEeprom` chunks to `0xE8` (232 bytes), the largest
multiple of 8 that fits: `256 − 8 (framing) − 12 (CMD_051D fixed
header) = 236`, rounded down to multiple of 8 = 232. See
`src/protocol/session.ts:80-100` for the documented constant.

Small writes (e.g. 16-byte welcome-string updates) were always under
the limit, which is why the bug stayed hidden until we tried a
1024-byte bitmap.

## What the firmware fork branch is now

`/Users/jsvana/projects/uv-k1-k5v3-firmware-custom` branch
`bkg/logo-relocation-phase1` commit `7554c349` repoints the boot logo
from physical sector 17 to sector 11. **No longer required**, because
the host-side chunk fix makes sector 17 writable too. Kept as a
record. Not landed on main. Don't distribute.

## BUT we still need a custom firmware build, just for a different reason

Stock NR7Y v1.0.0 is built from the CW preset, which does NOT enable
`ENABLE_FEAT_F4HWN_LOGO` — only the Fusion preset overrides the
default to ON. With LOGO off, the `welcome.c:247-259` bitmap-render
block is `#ifdef`'d out at compile time. Writes to virtual 0xC008
still land in physical 0x011000 just fine (sector 17 is empirically
writable from the runtime), but setting `POWER_ON_DISPLAY_MODE = 4`
does nothing on boot — the firmware skips the splash entirely.

Confirmed empirically 2026-05-25 by flashing stock NR7Y v1.0.0,
writing a BKG bitmap to 0xC008 (took 5×0.1 s with the chunk fix, no
erase amplification on this radio's fresh sector 17), flipping mode
to LOGO, rebooting — splash was blank.

**Fix**: build the same CW preset with `-DENABLE_FEAT_F4HWN_LOGO=ON`
added. Identical to NR7Y v1.0.0 except the LOGO render path is
compiled in. We host this at
`public/firmware/nr7y.cw-bkg-logo.v1.0.0.bin` (88,856 bytes, built
from upstream main of the briand fork on 2026-05-25). The 1-byte
identifier this firmware emits via hello is still `NR7Y v1.0.0` —
not distinguishable from stock NR7Y over the protocol, only by
behavior (does the splash actually display).

## End state for BKG members

1. Flash `public/firmware/nr7y.cw-bkg-logo.v1.0.0.bin` via UVTools
   (DFU mode: hold PTT alone while powering on the K1).
2. Connect bkg-programmer.
3. Enter callsign + BKG number in the splash flasher panel.
4. "Backup + write badge" → ~0.5 s end-to-end.
5. Reboot the radio. BKG badge displays.

If they're already on stock NR7Y, step 1 is required; the chunk fix
in bkg-programmer is necessary but not sufficient.

## What about Phase 2 (in-browser DFU flasher)

Was originally needed because users would have had to UVTools-flash
the custom firmware before using bkg-programmer. Now unnecessary —
stock NR7Y works. Phase 2 was always optional UX polish; lower
priority now.

## Useful artefacts to preserve

- The "saved" phase in `SplashFlasherPanel.tsx` (backup snapshot
  persisted to localStorage *before* any write, so Restore can revert
  partial writes) — keep.
- The header/bitmap split (`BOOT_LOGO_HEADER_ADDR = 0xC000`,
  `BOOT_LOGO_BITMAP_ADDR = 0xC008`) — keep.
- The auto mode-byte flip (POWER_ON_DISPLAY_MODE → LOGO after a
  successful bitmap write) — keep.
- The 120 s per-chunk timeout — keep, since erase amplification on
  stock sector 17 can stretch a single chunk to ~3 s and we want
  generous headroom.

**Read first**: `CLAUDE.md` "F4HWN/NR7Y boot splash mechanics" and
"K1+briand: welcome strings + display-mode live at PHYSICAL addresses"
sections. Both have all the file:line citations to briand's source.

## The goal

Set a custom 128×64 BKG-badge boot splash on the user's UV-K1 running NR7Y
firmware, end-to-end in the browser. Per-operator customization (callsign +
BKG number rendered into the bitmap).

## What works today

- `WelcomeStringsPanel` writes the two text welcome lines + sets
  `POWER_ON_DISPLAY_MODE` byte. Hardware-confirmed 2026-05-25 against
  K1+NR7Y. **Text** boot splash works.
- `SplashFlasherPanel` + `src/splash/*` renders the 128×64 BKG badge from
  callsign + BKG# inputs (Canvas-based, supersample+threshold port of
  `~/Downloads/bkg-k1-flasher/flasher.py`). Page-major LSB-top packer.
  Preview UI. 14 unit tests pass.
- The splash flasher's **write to `0xC008` fails** with a >120 s timeout
  and zero bytes changed. The bitmap region (physical `0x011000`) is
  write-protected at the SPI flash chip level. See "Why this is hard"
  below.

## Why this is hard (don't relitigate)

The boot-logo bitmap lives at PY25Q16 physical `0x011008` (sector 17,
4 KiB sector). On the user's K1 hardware, this sector is write-protected
at the chip level — not by firmware code (we searched, no guard exists)
but by the chip's status-register block-protect bits, set by the
bootloader/flasher and never cleared by runtime firmware. Empirically:

| Sector | Address | Writable from runtime? |
|---|---|---|
| 10 (settings) | `0x00A000` | Yes, fast (welcome-strings panel verified) |
| 17 (boot logo) | `0x011000` | No — 120 s timeout, zero bytes change |
| 16 (calibration) | `0x010000` | Untested but `SETTINGS_FactoryReset` (settings.c:758-766) deliberately excludes both 16 and 17, suggesting both are protected |

The `.bin` firmware file is MCU code only (PY32F071 internal flash at
`0x08000000`, ~80 KB ARM Cortex-M). It does **not** contain the SPI flash
data. Flashing a new `.bin` via UVTools does not touch the boot-logo
sector. EEPROM/SPI-flash content survives firmware reflashes — the NR7Y
README's "reset eeprom after flashing" advice exists for exactly this
reason.

Searched briand, armel/uv-k1, armel/uv-k5, egzumer, DualTachyon, and
Multi-UVTools for any runtime path that writes physical `0x011000+`.
Zero hits. The K1 community has converged on **text-only "logos"** at the
two welcome strings — issue [#340 on armel/uv-k1-k5v3-firmware-custom][i340]
("flashing 60+ radios with team logos") is about text, confirmed by
UVTools' `js/profiles/f4hwn-v43.js:40,343,508` naming the `0x0EB0`
text region `logo`.

Quansheng's authentic-only `0x051F`/`0x0521` opcodes are explicitly
stubbed in briand `App/app/uart.c:821,824` ("Not implementing
non-authentic command"). They might be the official path to write
protected sectors, but recovering them requires USB sniffs from the
official Quansheng programmer against a real radio.

[i340]: https://github.com/armel/uv-k1-k5v3-firmware-custom/issues/340

## Strategy: relocate the logo to a writable sector via firmware patch

Per `App/driver/eeprom_compat.c:40-75`, sectors 11-15 (physical
`0x00B000-0x00FFFF`, 16 KiB total) are entirely unmapped — briand's
`AddrTranslate` doesn't translate any virtual address to them, and no
firmware code touches them. They are presumed writable (untested at chip
level), based on the hypothesis that block-protect covers a contiguous
range from sector 16 upward.

Phase 1 patch repoints the existing `0xC000-0xCFFF` virtual mapping from
physical `0x011000` to physical `0x00B000`, and updates
`LOGO_FLASH_ADDR` in `welcome.c` accordingly. After the patched firmware
is flashed once via UVTools, the existing `SplashFlasherPanel` should
work as-is: writes to virtual `0xC008` now land in sector 11 (writable),
and `welcome.c`'s `PY25Q16_ReadBuffer(0x00B008, ...)` reads from the
same place.

Phase 2 ports UVTools' K1 bootloader protocol into the browser so the
"flash this patched firmware" step doesn't require leaving
`bkg-programmer`.

---

## Phase 1: Firmware patch (next up)

**Repo**: `/Users/jsvana/projects/uv-k1-k5v3-firmware-custom` (briand
fork, owned by `briand` GitHub user = jsvana). Tree is clean as of
2026-05-25.

**Patch — two lines:**

```diff
# App/driver/eeprom_compat.c
-    _MK_MAPPING(0x011000, 0x00C000, 0x00D000),  // Boot Logo sector (4 KB):
+    _MK_MAPPING(0x00B000, 0x00C000, 0x00D000),  // Boot Logo sector (4 KB, relocated for runtime write — see bkg-programmer):
                                                  // [0x00..0x07] 8-byte header (reserved)
                                                  // [0x08..0x407] 128x64 monochrome bitmap, 1024 Bytes
                                                  // ST7565-native: 8 pages * 128 columns, column-major LSB-top
```

```diff
# App/ui/welcome.c
-#define LOGO_FLASH_ADDR     0x011000
+#define LOGO_FLASH_ADDR     0x00B000   // relocated from 0x011000 (write-protected at chip level)
```

**Rebuild + flash workflow (user-side):**

1. Apply the patch in `/Users/jsvana/projects/uv-k1-k5v3-firmware-custom`.
2. Build. The repo has a Docker build (`compile-with-docker.sh`) and a
   GitHub Actions workflow. Local build needs the ARM toolchain.
3. Flash the resulting `.bin` via UVTools (https://armel.github.io/uvtools2/)
   in DFU mode. K1 DFU entry: **hold PTT alone** while powering on (NOT
   PTT+Side1 — that's the K5 sequence and toggles 350MHz TX on K1).
4. **First boot after flashing will show an empty/garbage splash** if
   `POWER_ON_DISPLAY_MODE == LOGO`, because sector 11 is initially all
   `0xFF` (fresh flash). Either accept that or temporarily set mode to
   `ALL` via the radio menu (`POnMsg → ALL`) before triggering the new
   boot.

**Verification on a patched radio (bkg-programmer side):**

Open the splash-flasher panel and click "Read 0xC008 + preview":

| Result | Meaning |
|---|---|
| Renders the briand-default MINI KONG logo | Still on stock NR7Y. Patch not applied/flashed. |
| Returns all `0xFF` (or shows as blank/noise preview) | On patched firmware. Sector 11 unwritten. Ready to write the BKG bitmap. |
| Renders the BKG badge bytes that were last written | On patched firmware with bitmap set. Done. |

**Then test the write path** — click "Backup + write badge". The
expectation:

- First write to fresh sector 11 (cache all `0xFF`): each 8-byte
  sub-write hits the `Erase=false → SectorProgram(8 bytes)` path in
  `App/driver/py25q16.c:316`. ~3 ms per sub-write. **Full 1024-byte
  bitmap should land in ~500 ms**, not 40 s.
- Subsequent writes (sector has previous bitmap): same erase
  amplification as before. ~40 s wall-clock. The 120 s/chunk timeout
  set in `SplashFlasherPanel.tsx` already covers this.

**Risks / things that could still go wrong:**

1. **Sector 11 might also be write-protected.** The block-protect scheme
   could cover sectors 11-31 or some other range that includes 11. If
   so, our writes will time out the same way as `0x011000`. Fallback:
   try sectors 12-15 in turn; one of them should be free. (Block
   protection is typically contiguous from one end.)
2. **The patched firmware might not boot** if there's something subtle
   we're missing about the sector-11 region (e.g., some other code
   touches it that we didn't grep for). User must keep a stock NR7Y
   `.bin` handy to recover via UVTools.
3. **Initial boot with `mode=LOGO` and unwritten sector** will draw
   `0xFF` bytes interpreted as page-major LSB-top — that's all "on"
   pixels = solid dark screen on K1's positive-mode LCD. Cosmetic,
   recoverable by setting bitmap first or changing mode.

**Files to touch in bkg-programmer in this phase:**

None — `SplashFlasherPanel.tsx` already targets virtual `0xC008`, which
the patched firmware re-routes correctly. Just verify it works.

**Note on the WIP `SplashFlasherPanel.tsx` diff (2026-05-25 PM)**: the
panel was refactored in this session to add the settings-block backup,
the auto mode-flip, the chunk-progress logging, and the "saved" phase
for early backup persistence. None of that depends on Phase 1 vs the
old runtime-write strategy — it's all hardening that makes the panel
usable once Phase 1 is in. Do NOT revert.

Optional: add a one-time "detect patched firmware" probe (read 8 bytes
from `0xC000`, compare to known MINI KONG header — if it doesn't match,
we're on patched firmware) and update the panel banner accordingly.

---

## Phase 2: Port UVTools' K1 DFU flasher to bkg-programmer

**Source**: `/tmp/Multi-UVTools/js/flash-k1.js` (496 LOC, MIT-style
license per the repo's `LICENSE`). Adapt to TS, slot into
`src/bootloader/` or similar.

**Key constants** (from `flash-k1.js`):

```js
const BAUDRATE_K1 = 38400;
const MSG_NOTIFY_DEV_INFO = 0x0518;   // radio → host on DFU enter
const MSG_NOTIFY_BL_VER   = 0x0530;   // radio → host: bootloader version
const MSG_PROG_FW         = 0x0519;   // host → radio: 268-byte chunk
const MSG_PROG_FW_RESP    = 0x051A;   // radio → host: ack
```

**XOR obfuscation table** (same one as runtime, 16 bytes):

```js
const OBFUS_TBL = new Uint8Array([
  0x16, 0x6c, 0x14, 0xe6, 0x2e, 0x91, 0x0d, 0x40,
  0x21, 0x35, 0xd5, 0x40, 0x13, 0x03, 0xe9, 0x80
]);
```

**CRITICAL safety**: blocklist + min-version checks. From
`flash-k1.js:36-40`:

```js
const BLOCKED_BOOTLOADERS = [
  "5.00.01",  // UV-K5 V2 — GUARANTEED BRICK with K1 firmware
  "2.00.06",  // UV-K5 V1 — GUARANTEED BRICK with K1 firmware
];
const MIN_K1_BOOTLOADER = "7.02.02";  // or 7.00.07 to match UV-K5 V3
```

Refuse to flash if bootloader version is blocked or below min. We must
get this right — flashing K1 firmware to a K5 will brick the radio.

**DFU entry**: user holds PTT alone while powering on the K1. Radio
emits `MSG_NOTIFY_DEV_INFO` (and possibly `MSG_NOTIFY_BL_VER`) on the
USB serial line at 38400 baud, unsolicited. We listen for that, then
respond with our flashing sequence.

**Hosting the patched `.bin`**: drop into `public/` and serve as a
static asset. Size will be ~80 KB. Versioned filename (e.g.,
`nr7y-bkg-v1.0.0.bin`) so we can ship updates.

**UI**: new `BkgFirmwarePanel.tsx` (or fold into existing
`SplashFlasherPanel`). Two-step flow:

1. **Install BKG firmware** — instructs user to enter DFU mode, polls
   for DFU device, displays bootloader version, runs version safety
   checks, flashes the hosted `.bin`, reports progress per chunk.
2. **Set badge** — existing `SplashFlasherPanel` flow, just works once
   the patched firmware is installed.

**Open question for Phase 2**: do we want to ALSO host stock NR7Y for
one-click revert? Probably yes; trivial extra binary in `public/`.

---

## What a new Claude session should do FIRST

1. Read `CLAUDE.md` end to end (it's the source of truth for this
   project; all the firmware addresses + chip behaviors are documented
   there with citations).
2. Read this file.
3. Check both repos:
   - `git log --oneline -5` in `/Users/jsvana/projects/bkg-programmer`
   - `cd /Users/jsvana/projects/uv-k1-k5v3-firmware-custom && git log
     --oneline -5 bkg/logo-relocation-phase1` (the firmware branch)
4. Ask the user: "Did you build + flash the Phase 1 firmware
   (`bkg/logo-relocation-phase1`)? What did the splash-flasher panel
   show when you tried Read+Preview / Write?" Don't assume.
5. If the WIP `app/SplashFlasherPanel.tsx` is still uncommitted, do NOT
   revert it — see the note inside Phase 1 below. The diff hardens the
   panel for the relocated-sector world; it's wanted.

## Reference paths

| Thing | Path |
|---|---|
| bkg-programmer | `/Users/jsvana/projects/bkg-programmer` |
| briand/NR7Y source (user's fork) | `/Users/jsvana/projects/uv-k1-k5v3-firmware-custom` |
| F4HWN base (clone, for cross-ref) | `/tmp/uv-k5-firmware-custom` |
| armel's fork of briand (clone) | `/tmp/armel-uv-k1` |
| Multi-UVTools (clone, DFU reference) | `/tmp/Multi-UVTools` |
| NR7Y release binary | `~/Downloads/nr7y.cw.v1.0.0.bin` |
| NR7Y README | `~/Downloads/NR7Y_FIRMWARE_README.md` |
| BKG flasher Python reference | `~/Downloads/bkg-k1-flasher/` |

## Constants worth memorizing

| Symbol | Value | Where used |
|---|---|---|
| Boot logo header start | `0xC000` (virtual) / `0x011000` (phys, stock) | 8-byte header |
| Boot logo bitmap start | `0xC008` (virtual) / `0x011008` (phys, stock) | 128×64 = 1024 bytes |
| Bitmap byte format | Page-major LSB-top | 8 pages × 128 cols |
| Welcome string 0 | `0x00A0C8` | 16 bytes ASCII |
| Welcome string 1 | `0x00A0D8` | 16 bytes ASCII |
| Settings block (mode byte at offset 7) | `0x00A0A8` | `POWER_ON_DISPLAY_MODE` |
| `POWER_ON_DISPLAY_MODE_LOGO` | `4` | With F4HWN + LOGO build flags both on |
| Phase 1 relocation target | `0x00B000` (phys) | Sector 11, currently unmapped/unused |
| K1 DFU entry | Hold PTT alone, power on | NOT PTT+Side1 |
| K1 bootloader baud | 38400 | Same as runtime |
