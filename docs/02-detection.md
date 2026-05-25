# 02. Detection

How to figure out what radio you're talking to. The challenge: the wire
protocol returns a firmware version string but no MCU type, no hardware
revision, and no model identifier. Every existing tool that claims
auto-detection is fingerprinting strings and hoping.

## Three-stage approach

Each stage adds confidence. None is reliable alone.

### Stage 1: Probe for firmware

Send `0x0514` (hello). Possible outcomes:

- **Response received**: radio is running firmware. Parse the version
  string from the reply. Pattern-match against known fingerprints.
- **No response, but unsolicited `0x0518`/`0x0530` frames**: radio is in
  DFU/bootloader mode. Different protocol, different detection path.
- **No response, no bootloader frames**: wrong port, wrong baud, radio
  off, or cable broken.

### Stage 2: Fingerprint the firmware

The 16-byte version string is the strongest signal. Examples observed:

| Pattern | Family | Likely hardware |
| --- | --- | --- |
| `NR7Y <commit>` | f4hwn-nr7y | UV-K1 / UV-K5 V3 |
| `EGZUMER-F4HWN ...` | f4hwn | UV-K5 V1 / V2 |
| `EGZUMER ...` | egzumer | UV-K5 V1 / V2 |
| `k5_2.01.26` (etc) | stock | any K5/K6/K1 |

The same firmware can run on multiple hardware variants in the same MCU
family. The fingerprint narrows the candidate set but rarely resolves to
one.

### Stage 3: Cross-check EEPROM model bytes

Stock Quansheng firmware writes a model identifier string somewhere
around `0x1ED0` on V1 (verify exact offset for V3/K1). Most custom
firmwares **don't** overwrite this region, so the bytes survive flashing.

Read those bytes. If they parse as a known model (e.g., "UV-K5", "UV-K6")
and the model is in the Stage 1 candidate set, confidence rises to high.

If they're `0xFF` or junk (some firmwares DO wipe this), confidence stays
at whatever Stage 1 produced.

If they contradict Stage 1 (firmware fingerprint says V3, model bytes say
K6), **refuse to proceed**. This is the saving-radios case — better to
stop than flash the wrong firmware.

### Stage 4: User confirmation

For anything below `high` confidence, show candidate models with photos
highlighting distinguishing features (USB-C location, antenna connector,
side button shape). User picks. If their pick contradicts Stages 1-2,
refuse to flash.

## Confidence: three independent axes

A single confidence value used to collapse three different judgments
into one. That made the "conflict" state overloaded — it meant
"firmware fingerprint and EEPROM disagree about the hardware," but
also implicitly meant "refuse to flash." The split below separates
each judgment, so the UI can show what is and isn't known, and
flashing is gated by an explicit derived rule rather than a side
effect of one enum value.

### Axis 1: Radio identity

What hardware are we talking to?

| State | Meaning | Source |
| --- | --- | --- |
| `confirmed` | Hello + EEPROM model bytes agree | Stages 1 + 3 |
| `inferred` | One candidate from hello; no EEPROM cross-check available | Stage 1, narrowed |
| `ambiguous` | Multiple candidates from hello, none resolved | Stage 1 only |
| `conflict` | Firmware fingerprint and model bytes contradict | Stages 1 + 3 disagree |
| `unknown` | No firmware match, so no candidates | Stage 2 unknown |

### Axis 2: Firmware identity

What firmware is on it?

| State | Meaning |
| --- | --- |
| `matched` | Version string matched a registry entry |
| `unknown` | No regex in the registry matched |

### Axis 3: Programmability

Can we safely write to this radio? Derived from the first two plus
the per-firmware self-test result (`docs/09-self-test.md`).

| State | Meaning | Trust mode |
| --- | --- | --- |
| `verified` | Profile exists and self-test passed | `trustReadback: yes` |
| `verified-with-reboot` | Profile exists; self-test requires reboot to confirm persistence | `trustReadback: with-reboot-verify` |
| `provisional` | Profile exists but self-test hasn't run (or failed) | unknown |
| `unsupported` | No profile, or firmware unknown | — |
| `blocked` | Radio identity conflict, or radio in DFU | — |

### Combined flash-gate matrix

`canFlash()` is the single source of truth. It looks only at axis 3:

| Programmability | Flash allowed? |
| --- | --- |
| `verified` | ✅ allowed |
| `verified-with-reboot` | ✅ allowed |
| `provisional` | ⚠️  blocked by default; UI may offer override |
| `unsupported` | ❌ blocked |
| `blocked` | ❌ blocked |

## Pitfalls

1. **Custom firmware can overwrite anything.** The 0x1ED0 model bytes are
   often preserved but not guaranteed. Mark per-firmware in the registry
   whether the cross-check is trustworthy.

2. **Version strings drift.** F4HWN beta builds, custom forks, recompiles
   with different `VERSION_STRING` defines — your fingerprint patterns
   will go stale. Make the registry data-driven and easy to update via
   PR.

3. **DFU mode means you can't read EEPROM.** Detection in bootloader
   mode relies entirely on bootloader version strings. Show the user a
   prompt to exit DFU mode if they want runtime configuration.

4. **The user might know better than you.** Always provide an override
   "I have a [model]" button. If the user contradicts a `medium`
   detection, trust them but log it. If they contradict a `high`
   detection that includes EEPROM cross-check, require typed
   confirmation ("I understand my radio might be misdetected, model
   bytes say UV-K5 V2").
