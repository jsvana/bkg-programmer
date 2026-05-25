# 00. Overview

## What this tool is

A web-based programmer for the Quansheng UV-K5 (V1, V2, V3) and UV-K1 radios
running the F4HWN family of custom firmwares. It runs entirely in the browser
via WebSerial — no backend, no Anthropic, no telemetry. Users connect a
programming cable, the tool reads the current radio state, lets them edit it,
and writes it back with safety checks.

## What this tool is NOT

- **Not a firmware flasher.** Use [UVTools2](https://github.com/armel/uvtools2)
  for that. Flashing is destructive; the existing tool is good; rebuilding it
  for branding adds risk without value.
- **Not a CHIRP replacement.** CHIRP handles channels for many radios; this
  tool focuses on the F4HWN-specific menu settings, calibration backup, and
  club-preset distribution that CHIRP doesn't cover.
- **Not a universal Quansheng programmer.** Scope is intentionally narrow:
  UV-K5 V1/V2/V3 and UV-K1 running F4HWN-family firmware. Adding other
  radios/firmwares is possible but explicitly deferred.

## Design principles

1. **Safety beats features.** Verify every write. Back up before changing
   anything. Refuse risky operations rather than risk bricking a radio.
2. **Schema-driven.** Every settable bit is declared in a TypeScript schema.
   Adding a new firmware version is a schema PR, not a code change.
3. **Composition over inheritance.** Profiles are lists of modules, not
   subclasses. Module replacement is by ID, no parent-chain walking.
4. **Build-time validation.** Overlapping EEPROM claims fail at `npm run
   build`. Never ship a broken schema to a user.
5. **Honest about uncertainty.** Confidence levels are surfaced, not hidden.
   When the tool isn't sure what radio you have, it asks.

## Why this exists

Programming Quansheng radios is a mess. Different hardware revisions (V1,
V2, V3, K1, K6) need different flashers. Different custom firmwares
(egzumer, F4HWN main, F4HWN forks) have different EEPROM layouts. CHIRP
covers channels but not menu settings. UVTools2 flashes but doesn't
program. Tools target one combination and fail silently on others.

This tool tries to be opinionated about one narrow combination, do it
right, and be explicit about what it doesn't support.

## Architecture

```
┌────────────────────────────────────────────────────┐
│                  Web UI (TBD)                       │
│            Connect → Detect → Read → Edit → Write   │
└──────────────────────┬─────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐   ┌─────▼─────┐   ┌────▼─────┐
   │detection│   │  backup   │   │  writer  │
   │         │   │  + diff   │   │  plan +  │
   │         │   │           │   │  execute │
   └────┬────┘   └─────┬─────┘   └────┬─────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
              ┌────────▼─────────┐
              │   schema layer   │
              │  (modules and     │
              │   profiles)       │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │  protocol layer   │
              │  (framing, hello, │
              │   read, write)    │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │  WebSerial port   │
              └───────────────────┘
```

Each layer can be tested in isolation. The protocol layer has no UI
knowledge. The schema layer has no transport knowledge. This makes a Rust
CLI version a future trivial addition: same schemas, same protocol code
(ported), different shell.
