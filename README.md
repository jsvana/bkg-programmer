# BKG Programmer

A web-based programming tool for Quansheng UV-K5 / UV-K1 amateur radios
running the F4HWN family of firmwares.

This repository contains the **design** and a partial **skeleton implementation**
of the BKG Programmer, produced during a deep design session. Real code is
present where it could be written and verified without hardware in the loop;
TypeScript skeletons and interfaces are present where implementation requires
a physical radio for validation.

## Status

This is a starter kit, not a finished product.

| Area | Status |
| --- | --- |
| Protocol framing (XOR, CRC, SOF/EOF) | ✅ Implemented, unit-testable |
| Command builders (hello / read / write / reboot) | ✅ Implemented |
| WebSerial transport | 🟡 Interface defined, implementation stub |
| Schema type system | ✅ Implemented |
| Schema modules (channels, names, attrs, calibration, F4HWN settings) | ✅ Defined for V1 and V3/K1 |
| Schema profiles (V1+F4HWN, K1+F4HWN/NR7Y) | ✅ Defined |
| Overlap validator | ✅ Implemented, runs in CI |
| Detection flow | 🟡 Interface defined, implementation stub |
| Backup format | ✅ Type-defined, encoder/decoder stub |
| Write planner | 🟡 Algorithm sketched, partial code |
| Write executor | 🟡 Algorithm sketched, partial code |
| Self-test runner | 🟡 Interface defined, implementation stub |
| UI | ❌ Not started |
| Firmware registry | 🟡 Schema defined, no entries |

## Get oriented

Read the docs in order:

1. [`docs/00-overview.md`](docs/00-overview.md) — what this tool does, what it doesn't
2. [`docs/01-protocol.md`](docs/01-protocol.md) — the Quansheng serial protocol, verified against firmware source
3. [`docs/02-detection.md`](docs/02-detection.md) — how to identify what radio you're talking to
4. [`docs/03-schema.md`](docs/03-schema.md) — the schema type system
5. [`docs/04-modules-channels.md`](docs/04-modules-channels.md) — channel records, V1 vs V3/K1
6. [`docs/05-modules-calibration.md`](docs/05-modules-calibration.md) — the calibration region
7. [`docs/06-validation.md`](docs/06-validation.md) — build-time overlap detection
8. [`docs/07-backup-format.md`](docs/07-backup-format.md) — backup format and diff-before-restore
9. [`docs/08-write-plan.md`](docs/08-write-plan.md) — safe restore: plan, verify, rollback
10. [`docs/09-self-test.md`](docs/09-self-test.md) — proving write-and-verify works
11. [`docs/10-roadmap.md`](docs/10-roadmap.md) — what to build first

## Quick start

```bash
npm install
npm run validate-schema   # runs the overlap validator against all profiles
npm test                  # runs unit tests for protocol layer
npm run typecheck         # full TS check
```

## License

Apache-2.0. Protocol research is derived from inspection of:

- [briand/uv-k1-k5v3-firmware-custom](https://github.com/briand/uv-k1-k5v3-firmware-custom)
- [egzumer/uv-k5-firmware-custom](https://github.com/egzumer/uv-k5-firmware-custom)
- [DualTachyon/uv-k5-firmware](https://github.com/DualTachyon/uv-k5-firmware) (the upstream)

All findings about protocol structure, EEPROM layouts, and bit fields cite
specific source files and line numbers in the respective repos.

## Open questions & things to verify with hardware

These are flagged throughout the docs but collected here:

1. **Does write-then-read actually test EEPROM persistence on V3/K1?**
   The firmware has a cache layer; run the self-test (see `docs/09-self-test.md`)
   on real hardware before trusting verify.
2. **Exact location of the Quansheng model identifier bytes** (assumed around
   0x1ED0 on V1 stock; behavior on V3/K1 unverified).
3. **Battery voltage read availability.** Command `0x0527` is behind
   `ENABLE_EXTRA_UART_CMD` and not always compiled in. Detection needed.
4. **F4HWN settings region address on V3/K1**: confirmed `0xA158` from
   `App/settings.c:470` (PY25Q16 flash). Not `0x1FF0` (that's the V1 address).
   This is a major footgun if you mis-port between versions.
5. **Channel attribute byte layouts**: V1 is 1 byte per channel, V3/K1 is 2
   bytes per channel with different bit allocations. Verified from struct
   defs in `misc.h` of each repo.
6. **Reboot timing**: how long after `0x05DD` until the radio responds again.
   Measure empirically in the self-test.
