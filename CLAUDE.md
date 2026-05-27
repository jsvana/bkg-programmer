# CLAUDE.md

Context for Claude Code (or any LLM-assisted continuation) on this
project. Read this before making changes.

## What this is

A web-based programmer for Quansheng UV-K5 (V1/V2/V3) and UV-K1 radios
running F4HWN-family custom firmware. Scope is intentionally narrow.
See `README.md` and `docs/00-overview.md` for the full pitch.

## Status

Design session output + working skeleton. ~50% of the safety-relevant
code is implemented and unit-testable (protocol framing, schema
validator). The rest is interfaces + skeletons that need real hardware
to finalize. Honest status table is in `README.md`.

## Hard-won facts that will save you days

These are easy to get wrong and expensive to debug. Verify before
overriding.

### F4HWN settings address differs by hardware

- V1 (DP32G030): **0x1FF0**
- V3/K1 (PY32F071): **0xA158** (maps to PY25Q16 flash 0x00A158)

Mixing these up corrupts calibration on the V1 or channel names on the
V3/K1. Source: `App/settings.c:470` in the briand fork.

### Write protocol constraints

- `size` field is u8, must be a **multiple of 8**. Non-multiples are
  rejected or partially processed; don't rely on partial.
- **Max 232 bytes per write command in practice (0xE8), NOT the
  protocol's theoretical 248 (0xF8).** The firmware's UART receive
  buffer is 256 bytes (`App/driver/uart.c:39` `UART_DMA_Buffer[256]`
  and `App/driver/vcp.c:25` `VCP_RxBuf[256]`). A WRITE_EEPROM frame
  with 248 bytes of data is 268 bytes on the wire
  (SOF 2 + size 2 + CMD_051D header 12 + data 248 + CRC 2 + EOF 2)
  and the firmware's parser at `App/app/uart.c:860` rejects it with
  `if ((Size + 8u) > ReadBufSize)`. No command dispatched, no reply,
  host times out. Confirmed empirically against UV-K1+NR7Y v1.0.0 on
  2026-05-25 — every 1024-byte bitmap write timed out at 120 s/chunk
  until the host chunk-size was clamped to 232. Small writes
  (16-byte welcome-string updates etc.) stayed under the limit and
  worked fine, which is why this hid for so long.
  `Session.writeEeprom` auto-chunks at 232.
- Writes to `[0x0E98, 0x0EA0)` on V1 require `bAllowPassword = 1`
  (lockscreen guard).
- Writes overlapping `[0x0F30, 0x0F40)` on V1 trigger
  `SETTINGS_InitEEPROM()` — order these LAST in batch sequences.

### CRC asymmetry

The firmware **validates** inbound CRCs but **emits 0xFFFF placeholder**
on outbound. Outbound CRCs must be correct (CRC-16/XMODEM, poly 0x1021,
init 0x0000); inbound CRCs must NOT be validated. This is implemented
in `src/protocol/framing.ts`. Source: `App/app/uart.c:782`.

### Sessions are stateful

Every read/write echoes a 32-bit timestamp set in the `0x0514` hello.
Reconnecting the port = new session = new hello. Handled in
`src/protocol/session.ts`.

### V3/K1 unmapped EEPROM is silent

Reads return `0xFF`, writes are dropped. **Read-back is the only proof
a write took.** Map of valid regions in
`App/driver/eeprom_compat.c:39-72` in the briand fork, summarized in
`docs/01-protocol.md`.

### K1 DFU mode entry is PTT-only, not PTT+Side1

**UV-K1 Mini Kong: hold PTT alone while powering on.** The classic UV-K5
sequence (PTT + Side1) is wrong on K1 — Side1 + power-on toggles the
hidden **350MHz TX** engineering menu instead. Confirmed 2026-05-25 by
user hardware test; the wrong combo produced "350TX ON" rather than
entering DFU. The toggle is reversible by repeating the same combo
(state flips each time). Don't push the K5 convention onto K1 in copy
users will follow.

Source: empirical (no official docs). UVTools2 and briand/armel READMEs
all say "put radio in DFU mode" without specifying the K1 combo.

### K1+briand: welcome strings + display-mode live at PHYSICAL addresses, not V1-style logical ones

The naive port of F4HWN's V1 welcome code uses logical addresses
`0x0EB0`/`0x0EC0`/`0x0E90`. **These are wrong on K1+briand.** briand's
`App/ui/welcome.c:278-281` and `App/settings.c:255,265` use
`PY25Q16_ReadBuffer` calls directly with **physical** flash addresses,
bypassing the `eeprom_compat.c` `AddrTranslate` layer:

```c
PY25Q16_ReadBuffer(0x00A0C8, WelcomeString0, 16);     // welcome 1
PY25Q16_ReadBuffer(0x00A0D8, WelcomeString1, 16);     // welcome 2
PY25Q16_ReadBuffer(0x00A0A8, Data, 8);                // settings block;
                                                       // Data[7] = POWER_ON_DISPLAY_MODE
```

To target those physical bytes via the `WRITE_EEPROM` (`0x051D`) protocol,
use the virtual addresses that `AddrTranslate` maps identity-onto inside
the settings region — `eeprom_compat.c:56`:

```
_MK_MAPPING(0x00A000, 0x00A000, 0x00A170)  // virt == phys for 0x00A000..0x00A170
```

So write to virtual `0x00A0C8` / `0x00A0D8` / `0x00A0A8` (NOT the V1 ones).

Hardware-confirmed 2026-05-25 that V1-style addresses *do* read/write
successfully at the protocol level on K1+briand, but they land in the
channels region — the firmware never reads them. Verify-after-write
passes; boot screen is unchanged. The fix is the address constants in
`app/WelcomeStringsPanel.tsx`, not the firmware.

### F4HWN/NR7Y boot splash mechanics

Two paths exist in the firmware, both gated by `POWER_ON_DISPLAY_MODE`
(byte 7 of the 8-byte settings block at physical `0x00A0A8`):

**Text path** (F4HWN base + briand). `ui/welcome.c:274+`. Modes `NONE`
or `SOUND` → black screen. Others read welcome 0/1 from physical
`0x00A0C8`/`0x00A0D8` and render them, plus the baked-in `Version` /
`Edition` strings. Only `ALL` (0x00) and `MESSAGE` (0x02) preserve
user-set strings — `VOLTAGE` (0x03) unconditionally overwrites both
strings with "VOLTAGE" / `"x.xxV xx%"`.

**Bitmap path** (briand only, behind `#ifdef ENABLE_FEAT_F4HWN_LOGO`).
`ui/welcome.c:247-259`. Mode `POWER_ON_DISPLAY_MODE_LOGO` reads 1024
bytes from physical `0x011008` (= virtual `0xC008`, after an 8-byte
header reserved for "future magic/version/flags") and blits directly
to status line + frame buffer. The bitmap format is **ST7565-native:
8 pages × 128 columns, column-major LSB-top** — the convention our
`src/splash/bitmap.ts` already produces.

**Why protocol writes to the bitmap region are effectively blocked.**
briand's `PY25Q16_WriteBuffer` (`driver/py25q16.c:253-332`) caches the
target 4 KiB sector, and on every write where new data differs from
cache AND the cache contains any non-`0xFF` byte, it erases the whole
sector and reprograms it. `eeprom_compat.c:100` calls this from
`EEPROM_WriteBuffer` in 8-byte chunks, and `app/uart.c:458-470` loops
those 8-byte chunks for the 0x051D command. Result: writing a 248-byte
chunk over the existing MINI KONG default bitmap triggers 31 × ~300 ms
sector erases ≈ 10 s, which beats our protocol timeout. A working write
needs either (a) a per-write timeout bumped to ~90 s/chunk, (b) firmware
that batches the bitmap write into a single sector-erase + bulk program,
or (c) a custom opcode that takes the whole 1024 bytes at once.

**Path to a real custom bitmap splash on NR7Y:**

1. Confirm `ENABLE_FEAT_F4HWN_LOGO` is set in the NR7Y build (or
   re-enable in a fork).
2. Add a value to `POWER_ON_DISPLAY_MODE` enum (already exists in briand —
   `POWER_ON_DISPLAY_MODE_LOGO`, value 4 per usual ordering).
3. Either bump `bkg-programmer`'s write timeout for `0xC000-0xCFFF` to
   ≥ 90 s, or patch `app/uart.c` (or `eeprom_compat.c`) to add a
   bulk-bitmap opcode that does one erase + program.
4. Set `POWER_ON_DISPLAY_MODE = LOGO` (write to physical `0x00A0AF`).

### Stock K1 has read-mapped, write-protected regions

Distinct from "unmapped" above: stock K1 v7.03.01 maps `0x2E00`
(boot logo), `0x3000` (byte-identical mirror of `0x2E00`), and
`0x3200` (aux bitmap) for **reads** — they return real bitmap data,
not `0xFF`. But the standard `0x051D` WRITE_EEPROM command to those
addresses is **silently dropped: no reply at all**, not even an
error frame. Confirmed 2026-05-25 for both `0x2E00` and `0x3000` by
10s timeout + diagnostic read showing original bytes still in place.
`0x3200` aux bitmap assumed same protection (untested, low priority
since the splash question is already settled).

Implication: **you cannot program the splash on stock K1 via the
standard write opcode.** Two known paths around this:

1. **Quansheng's authentic-only opcodes `0x051F` and `0x0521`** — every
   open-source firmware port (DualTachyon `App/app/uart.c:505-511`,
   armel/briand/uvk5cec) explicitly stubs these as `// Not implementing
   non-authentic command`. They are almost certainly the path the
   official Quansheng programmer uses to write protected regions.
   Reverse-engineering them requires capturing USB serial traffic from
   the official tool against a real radio.
2. **Custom firmware (F4HWN, briand, egzumer)** typically remaps these
   regions for writes. UVTools2 flashes the firmware; we don't.

Bumping the timeout doesn't help — the radio never responds. Use a
10s timeout on writes to suspected-flash regions anyway in case the
sector erase is slow on regions that *are* writable.

### V3/K1 channel attributes are cached in RAM

The firmware keeps active channel attrs in a small cache (`misc.h:256-263`
in the briand fork). A read-back after write may report success even
if the EEPROM wasn't touched. This is the entire reason the self-test
exists (`docs/09-self-test.md`). **Until the self-test confirms
persistence on a specific firmware version, treat verify as
provisional.**

### Channel attribute layouts differ

- V1: 1 byte per channel. `band` is 4 bits.
- V3/K1: 2 bytes per channel. `band` is 3 bits, with an `exclude` bit
  added and a full byte for `scanlist` (24 lists + ALL).

Two separate modules: `channelAttrsV1` and `channelAttrsV3`. Profiles
pick one. Sources: `misc.h:178-189` (egzumer) and `misc.h:242-253`
(briand).

### Channel record is shared

The 16-byte channel record is identical between V1 and V3/K1. Channel
names (16 bytes, 10 chars + 6 padding) too. Only the array base
offsets differ.

### UV-K6 is a marketing rename of UV-K5(8), not a new platform

PCB-identical to the K5 family per independent teardowns (rigpix.com
catalogs it as *"UV-K6 also referred to as UV-K5(8)"*; m5duk.com,
citing teardown photos: *"There is no difference in technical
specifications between the models K5, K5(8), K5(99) and K6"* — only
the LCD backlight color varies). The custom-firmware ecosystem treats
them as one target (joaquimorg's repo describes itself as the *"UV-K5
/K6/5R firmware"*; one binary covers the family).

Implication for this project: **K6 is not a new model.** No new
profile, no new registry entry, no new bit layouts. The MCU revision
warning sellers slap on K6 listings ("looks the same but different
processor") is the same DP32G030 (V1-class) vs PY32F071 (V3-class)
split this project already encodes as `uv-k5-v1` vs `uv-k5-v3`. K6
units land in one of those buckets depending on silicon revision,
not a third one.

What we did: added `'uv-k6'` to `candidateModels` on every K5-family
registry entry (`f4hwn-nr7y-fusion`, `f4hwn-v1`, `ijv-k5-v1`) so the
UI surfaces "UV-K6" as a candidate name alongside the K5 variants.
That's the entire change. DFU combo is the K5 combo (PTT + power),
NOT the K1 combo — don't carry the K1 instructions into K6 copy.

Don't re-litigate by adding a `uv-k6-*` profile file. If a K6 ever
shows up whose EEPROM disagrees with the K5 V1 or V3 profile, fix
the existing profile; don't fork.

## Design decisions worth not relitigating

These were debated and settled during the design session. Reopen only
with strong reason.

### Composition over inheritance for modules

Profiles are lists of modules, deduped by ID with last-write-wins. No
parent profiles, no partial overrides, no diamond problems. When bit
semantics change between firmware versions, the whole module gets
replaced. See `docs/03-schema.md`.

### Build-time overlap validation, not runtime

The validator in `src/schema/validate.ts` runs against every profile
at `npm run validate-schema`, wired to `prebuild`. You can't deploy a
schema with overlapping bit claims. Coverage % is diagnostic, not a
gate. See `docs/06-validation.md`.

### Read-modify-write at the 8-byte block level

Because every EEPROM write must be 8-aligned and a multiple of 8
bytes, changing one bit-field requires reading the surrounding 7
bytes first. The planner does this and marks the preserved byte
indices on each batch. If verify later shows preserved bytes
changed, that's drift, not write failure. See `docs/08-write-plan.md`.

### Verify after every batch, mandatory

No "fast mode" toggle. The bug reports it'll prevent are worth more
than ~10 seconds on a full restore. Final sweep verify also
mandatory.

### No automatic retry on verify mismatch

Verify mismatch is signal that something is wrong. Retrying masks
the underlying problem. Single retry on protocol errors (CRC,
timeout) is fine; retrying on verify is not.

### Reload-trigger batches go last

Writes overlapping `[0x0F30, 0x0F40)` cause `SETTINGS_InitEEPROM()`.
Anything written before this batch is observed; anything after may
not be until next reboot. Planner enforces ordering: data first,
calibration before triggers, reload-triggers last, AES last.

### Backup format is JSON-with-base64, not flat dumps

V3/K1 virtual EEPROM is 64 KB with significant holes. Flat dumps
waste bandwidth and obscure structure. JSON with per-region base64
is shareable, diffable, and survives intermediary tools. See
`docs/07-backup-format.md`.

### Self-test is per (model, firmware version)

Cached in IndexedDB. Result drives executor's `trustReadback` mode
(`yes` | `with-reboot-verify` | `no`). See `docs/09-self-test.md`.

## What was deliberately NOT done

Don't add these without strong reason. They were considered and
rejected in the design session.

- **Universal multi-radio programmer.** Scope creep; existing tools
  cover the breadth case. We do depth on K5/K1/F4HWN instead.
- **Firmware flashing.** Use UVTools2. Rebuilding the flasher adds
  risk without value.
- **Automatic verify-retry.** Masks bugs.
- **Field aliases / overlapping-by-design fields.** Once the escape
  hatch exists, contributors will use it to silence the validator.
- **Backend / accounts / telemetry.** Static SPA only, all local
  data, no Anthropic.
- **Coverage % as CI gate.** False signal. Higher coverage isn't
  better.

## Open questions requiring hardware

These are flagged in `README.md` and inline in the relevant files.
Don't guess at them; capture from real radios.

1. Does write-then-read actually test EEPROM persistence on V3/K1?
   (Run the self-test.)
2. Exact location of Quansheng model identifier bytes on V3/K1.
   (V1 is ~0x1ED0. **Stock UV-K1: confirmed at 0x0EC0** — captured
   2026-05-25. V3 stock location still TBD.)
3. Battery voltage read availability (`0x0527` is behind
   `ENABLE_EXTRA_UART_CMD`, not always compiled in).
4. Reboot timing after `0x05DD`. (Measure in self-test Test D.)
5. Power calibration table internal layout (0x000-0xBF and 0xD0-0x13F
   inside the calibration region — currently opaque blobs).
6. Real version-string captures for the firmware registry
   (`src/detection/registry.ts` has placeholder patterns).
   - **Stock UV-K1 Mini Kong**: captures `7.03.01` (matches `/^7\.\d+\.\d+$/`).
     Profile `uv-k1-stock` verified 2026-05-25 by BEFORE/AFTER backup diff
     after setting channel 1's name to "TESTCHAN" in the radio menu — the
     write landed at exactly `0x0F50`, the V1 channel_names base.
     **Stock K1 uses the V1 layout**, NOT F4HWN's V3-style virtual mapping.
     The F4HWN K1 profile maps the radio differently because F4HWN's
     `eeprom_compat.c` remaps it; stock does no such thing.
     Confirmed mapped EEPROM extent: 0x0000-0x3407 (~13 KB). Past that is
     unmapped. Menu caps at 200 channels (despite "1024 channels" marketing,
     which appears to require custom firmware).
     Extras beyond V1: boot logo at 0x2E00 (stored twice, byte-identical
     copies at 0x2E00 and 0x3000, both 512 bytes, 128×32 packed-page
     1-bpp bitmap); aux bitmap at 0x3200 (also 128×32, different image).
     **All three are read-mapped but write-protected on stock** — the
     standard 0x051D write opcode returns no reply at all (10s timeout
     confirmed for 0x2E00). See "Stock K1 has read-mapped, write-protected
     regions" above. The splash cannot be reprogrammed via this protocol
     on stock firmware.
     Model string "UV-K1" is at **0x0EC0** on stock K1, not 0x1ED0 like V1.
     Default passwords "77777"/"88888" at 0x0EE8/0x0EF0.
   - **F4HWN Fusion NR7Y CW mod on UV-K1**: captures `NR7Y v1.0.0`
     (matches `/^NR7Y\b/i`). Profile `uv-k1-f4hwn-nr7y` verified
     2026-05-25 by hello-reply round trip on a real UV-K1 Mini Kong.
     Briand's virtual EEPROM mapping (see
     briand/uv-k1-k5v3-firmware-custom `App/driver/eeprom_compat.c`)
     agrees byte-for-byte with the profile's offsets: channels
     0x0000-0x3FFF, names 0x4000-0x7FFF, attrs+scanlist 0x8000-0x886E,
     14 VFO entries 0x9000-0x90D6, settings region 0xA000-0xA170
     (F4HWN block at 0xA158), calibration 0xB000-0xB1FF (physically
     remapped to flash 0x010000), boot logo 0xC000-0xCFFF.
     **This firmware does NOT preserve a model identifier string.**
     The 0x0EC0 location where stock K1 holds "UV-K1" falls inside
     briand's remapped channel-data region and returns channel bytes,
     not ASCII. Registry entry uses `modelBytesPreserved: false` and
     UI shows the radio as AMBIGUOUS (uv-k1 / uv-k5-v3) because the
     same firmware runs on both. NR7Y adds CW keyer fields
     (CW_TONE_FREQUENCY, CW_KEY_WPM, CW_KEYER_MODE, etc.) declared
     in `App/settings.h` `EEPROM_Config_t`, but their concrete EEPROM
     offsets within 0xA160-0xA170 are not yet captured — modeling
     them requires either grepping the briand fork for
     `SETTINGS_Save*` calls touching them, or a BEFORE/AFTER backup
     diff after changing a CW menu value. Self-test verdict pending.

     **`ENABLE_FEAT_F4HWN_LOGO` is NOT enabled by default in the CW
     preset that produces NR7Y v1.0.0.** Only the Fusion preset
     overrides the default to ON. With LOGO off, the welcome.c
     bitmap-render block (`#ifdef ENABLE_FEAT_F4HWN_LOGO`) is
     compiled out, so setting `POWER_ON_DISPLAY_MODE = 4`
     (POWER_ON_DISPLAY_MODE_LOGO) does nothing on boot — the firmware
     silently falls through and skips the splash entirely. Writes to
     virtual 0xC008 still land in physical 0x011000 (sector 17) just
     fine (verified empirically 2026-05-25), but the bytes are never
     drawn. To get a working bitmap splash, the firmware must be
     rebuilt with `-DENABLE_FEAT_F4HWN_LOGO=ON`. `bkg-programmer`
     hosts a pre-built such firmware in `public/firmware/` (see
     `docs/plans/2026-05-25-bitmap-splash-phases.md`).
   - **Stock UV-K5 V1/V2**, **egzumer**, **F4HWN-on-K5-V1**: still
     need real captures.

## How to add a new firmware variant

1. Capture a hello reply from a radio running it; note the version
   string.
2. Add a `FirmwareEntry` to `src/detection/registry.ts` with a
   regex matching the version string.
3. If the bit layout matches an existing profile (most F4HWN forks
   do), reuse it via `profileId`. If not, copy an existing
   profile and modify modules.
4. If bit semantics changed for a setting, write a new module
   rather than editing an existing one. Profiles dedupe by module
   ID; new profile lists the new module last to override.
5. Run `npm run validate-schema`. Fix any overlap errors.
6. Add the firmware to the registry's candidate models so
   detection works.
7. If possible, capture an EEPROM dump and add a round-trip test.

## How to add a new field

1. Find the right module in `src/schema/modules/`.
2. Add the field with a stable ID. Pick `applyMode` carefully:
   `live` for things the firmware reads on every use,
   `reload-settings` for things that load at boot/menu-change,
   `reboot` for things that load only at power-on.
3. Run `npm run validate-schema`. If it overlaps with another
   field, you either (a) misread the firmware source, or
   (b) the field belongs in a new module that replaces the
   conflicting one.
4. If the field is part of a forked firmware's new feature, mark
   `requires: ['ENABLE_FEAT_X']` so the UI can hide it on builds
   without that feature.

## How to debug a verify mismatch

1. Is the address in a valid mapped region for this radio?
   (Check `eeprom_compat.c` for V3/K1.)
2. Is the write size a multiple of 8? Check `Session.writeEeprom`
   isn't being called with raw user data of odd length.
3. Is the session timestamp correct? Sessions die on reconnect.
4. Is the radio in lockscreen? Hello reply has the flag.
5. Did the self-test pass for this firmware version? If
   persistence-across-reboot failed, the firmware caches this
   region and you need `trustReadback: 'with-reboot-verify'`.
6. Are two tabs talking to the same port? Check IndexedDB
   `bkg-locks`.

## Source repos to consult

These are the upstream-of-upstream and the active forks. When
firmware behavior is unclear, grep these:

- `briand/uv-k1-k5v3-firmware-custom` (V3/K1 reference)
- `egzumer/uv-k5-firmware-custom` (V1 reference)
- `armel/uv-k5-firmware-custom` (F4HWN main)
- `DualTachyon/uv-k5-firmware` (upstream stock)

Specific files we relied on:

- `App/app/uart.c` — command dispatcher (handlers around lines
  286-540, dispatch at 766+, XOR key at 163)
- `App/settings.c` — settings load/save, calibration handlers
  (briand: calibration at 522-570; F4HWN settings load at
  467-519)
- `App/driver/eeprom_compat.c` — V3/K1 virtual EEPROM mapping
- `App/driver/uart.c` — baud rate, low-level UART config
- `App/misc.h` — channel attribute structs (line ranges in
  module files)
- `tools/serialtool/msg.py` — canonical Python reference for
  protocol codec (MIT-licensed)

## Coding conventions

- TypeScript strict mode + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`. Don't relax these without reason.
- ESM modules. Relative imports in `src/` and `scripts/` do NOT use
  `.js` extensions (Turbopack can't resolve them; tsx handles
  bare/extensionless fine).
- Tests live next to source as `*.test.ts`, run via Vitest.
  `npm test` uses `--passWithNoTests` until real tests land.
- No external runtime dependencies in `src/` — pure TS. The browser
  UI is Next.js (App Router) under `app/`, with client components
  importing from `src/` directly.
- Prefer `Uint8Array` over `Buffer` for portability.
- DataView for endian-explicit reads/writes; never trust the
  platform default.

## When the LLM is uncertain

If you find yourself reasoning about firmware behavior without a
specific file:line citation, stop. Either:

1. Grep the source repos listed above and add the citation.
2. Flag the assumption inline and to the user.
3. Punt to "needs hardware verification" and add to the open
   questions list.

The whole point of this design is that we know what we know and
admit what we don't. Don't paper over uncertainty with plausible-
sounding implementations — the radios will tell us we were wrong,
loudly and expensively.

## Design Context

The same epistemic discipline applies to the UI. Full design context
lives in `.impeccable.md`; in summary:

### Users

Amateur radio operators (technical hobbyists) configuring Quansheng
UV-K5/UV-K1 handhelds running F4HWN-family firmware. Technically
literate; they read firmware source, talk in hex offsets and CRCs.

### Brand Personality

**Precise. Honest. Technical.** Workshop-tool feel — closer to an
oscilloscope front panel than a SaaS dashboard. Cites firmware
file:line citations without apology. Surfaces uncertainty rather
than papering over it.

### Aesthetic Direction

- Service-manual utilitarian with measurement-equipment cues.
- Three distinct top-level tools (Flash firmware / Program / Splash);
  hub picks one and the workspace commits to it.
- Connection state is persistent across all tools as a status rail,
  not a panel.
- System-driven light + dark theme.
- Anti-references: SaaS stat cards, gradient hero text, glassmorphism,
  decorative icon-above-heading layouts, AI-cyan accents.

### Design Principles

1. **One tool at a time.** Hub uses prominence to guide; once chosen,
   the workspace commits.
2. **Status is structural.** Port / radio / firmware / lockscreen flag
   live in a persistent rail, not in a panel.
3. **Cite, don't reassure.** When firmware behavior is empirically
   unknown, say so on screen. Monospace for anything that came from
   the radio.
4. **Disciplined neutrals, single accent.** Warm-tinted grays toward
   an amber signal hue. No gradients.
5. **No nested cards.** Flat sections separated by hairline rules.
