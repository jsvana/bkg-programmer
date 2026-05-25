# 10. Roadmap

What to build, in order, with rationale.

## Phase 1: Foundation (1-2 weekends)

Goal: A working CLI that proves the protocol code is correct.

- [x] Protocol framing (XOR, CRC, frame parse/build) — done in
      `src/protocol/framing.ts`
- [x] Schema type system — done in `src/schema/types.ts`
- [x] Module definitions for V1 and V3/K1 — done in
      `src/schema/modules/`
- [x] Profile definitions — done in `src/schema/profiles/`
- [x] Overlap validator — done in `src/schema/validate.ts`
- [ ] Node.js test harness that can write known frames and verify
      against captured byte traces. **Captures should come from a
      real radio** — use UVTools2 in network-debug mode or sniff
      with a logic analyzer. Build a corpus.
- [ ] CLI tool: `bkg detect --port /dev/ttyUSB0` that opens the port,
      runs detection, prints the result.

**Ship goal:** A maintainer can plug in a radio and see "UV-K5 V1
running F4HWN ..." in the terminal. Nothing more.

## Phase 2: Read flow (1-2 weekends)

Goal: Read and display radio state via the schema.

- [ ] WebSerial transport implementation
- [ ] Session management (hello + timestamp echo + reconnect)
- [ ] Read planner: given a profile, what's the minimum set of read
      commands to cover all modules?
- [ ] EEPROM snapshot data structure with module-aware accessors
- [ ] Decode snapshot → typed values per schema
- [ ] CLI: `bkg dump --port ...` outputs JSON of decoded radio state

**Ship goal:** A user can run `bkg dump` and get back a complete,
typed representation of every settable field in their radio.

## Phase 3: Backup + diff (1 weekend)

Goal: Safety net.

- [ ] Backup format encoder/decoder
- [ ] Diff algorithm (snapshot → snapshot)
- [ ] Diff-display formatter (CLI table, ready for UI port)
- [ ] CLI: `bkg backup --port ... --out file.json` and
      `bkg diff file-a.json file-b.json`

**Ship goal:** A user can back up before flashing and diff after
flashing. No write side yet, but the value proposition is already
real.

## Phase 4: Write side (2-3 weekends — go slow)

Goal: Safe restore.

- [ ] Self-test runner (Phase 3 backup is the safety net)
- [ ] Self-test result cache in IndexedDB
- [ ] Write planner: snapshot + target → WritePlan
- [ ] Preflight checks
- [ ] Write executor with verify loop
- [ ] Rollback path
- [ ] CLI: `bkg restore --port ... --from file.json [--select ...]`

**Ship goal:** A user can restore a backup with full diff confirmation.
Do not skip the self-test. Do not relax the verify loop. The whole
point of this tool is to do this part right.

## Phase 5: UI (open-ended)

Goal: Make it accessible to non-CLI hams.

- [ ] Vite + React + TS scaffold
- [ ] Connect / detect screen with confidence-aware UX
- [ ] Schema-driven settings forms
- [ ] Channel grid editor
- [ ] Backup / restore / diff UI
- [ ] Club preset import/export
- [ ] Deploy to Vercel

**Ship goal:** A club member can program their radio without ever
opening a terminal.

## Phase 6: Firmware registry + flash (later)

Goal: Optionally absorb the flash side.

- [ ] JSON registry of (radio model, firmware family, latest known-good
      release) with GitHub Releases links
- [ ] Cached `releases/latest` fetch via Vercel Edge for rate-limit
      avoidance
- [ ] Optional flash path — only after Phase 1-5 are solid
- [ ] Link to UVTools2 in the meantime

## Anti-roadmap

Things explicitly deferred or rejected:

- **Multi-radio universal programmer.** Scope creep.
- **Automatic retry on verify mismatch.** Masks bugs.
- **Field aliases.** Footgun for "fixing" failing validators.
- **Coverage gating in CI.** False signal.
- **Backend / database / accounts.** Static site, all local data.
- **Telemetry.** No.

## Test radios needed

The honest truth: this tool is only as good as the radios it's been
tested on. Before serving the club, the maintainer should have:

- 1× UV-K5 V1 with stock firmware (for baseline)
- 1× UV-K5 V1 with F4HWN
- 1× UV-K5 V3 or UV-K1 with F4HWN (matches the briand fork)
- Ideally 1× UV-K6 (different model bytes; tests the cross-check)

Capture EEPROM dumps from each. These become the corpus for
round-trip tests.
