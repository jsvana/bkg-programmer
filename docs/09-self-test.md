# 09. Self-test

## Hypothesis being tested

"When I write 8 bytes and read them back, am I actually reading EEPROM,
or am I reading the firmware's RAM cache, which would lie about
persistence?"

This isn't paranoia. The V3/K1 firmware explicitly has a cache-based
architecture for channel attributes. Source:
`briand/uv-k1-k5v3-firmware-custom/App/misc.h:256-263`:

> "Instead of keeping all 1038 channel attributes in RAM (~2,000 bytes),
> we now keep only the active ones in a small cache."

The firmware loads attributes from flash on demand. If the read path
serves from cache and the write path updates both, verify passes
correctly. If the write path updates only cache, verify also passes —
until reboot, when the cache repopulates from flash and your changes
vanish.

The only test that distinguishes is **round-tripping a unique value
through a reboot.**

## Procedure

### 1. User designates a scratch channel

Suggest highest-numbered unused channel by default. Channel *names* are
the safest target — purely cosmetic, never affect RF behavior, can't
crash anything if written wrong.

### 2. Backup the scratch channel

Read the full 16-byte channel record, 16-byte channel name, and
attribute bytes. Hold in memory.

### 3. Test A: Protocol roundtrip (sanity)

- Generate unique 16-byte pattern: `b"SELFTEST" + timestamp_u32 +
  random_u32` (so it's never the same).
- Write to scratch channel name region.
- Read back immediately.
- **Must match** or the protocol layer is broken before we test
  persistence.

### 4. Test B: Persistence across reboot (the real test)

- Send `0x05DD` reboot command.
- Wait for radio to come back (typically 2-4 seconds).
- Re-handshake with a new session (new timestamp).
- Read scratch channel name.
- If it matches the pre-reboot pattern: **persistent write confirmed**.
- If it doesn't: cache-only write detected. Log it, stop, surface to
  user as "this firmware version requires forced reboot after writes
  to this region — the executor will handle this automatically."

### 5. Test C: Silent-drop detection (V3/K1 only)

V1 has no significant unmapped regions; skip on V1.

- Pick an EEPROM address known to be in a hole on V3/K1 (consult the
  mapping table in `docs/01-protocol.md`).
- Read first — should be `0xFF`.
- Write a non-`0xFF` pattern.
- Read again — should still be `0xFF` (firmware dropped the write).
- If it's the written pattern, the firmware DOES write to that address,
  meaning the schema's hole map is wrong.

### 6. Test D: Reboot timing characterization

Run Test B three times, recording how long the radio takes to respond
to hello after `0x05DD`. Use the p95 as the recommended `rebootWaitMs`
in the executor config.

### 7. Restore backup

Write the original scratch channel bytes back. Verify.

### 8. Final verify

Read scratch channel state. Confirm it matches the pre-test backup
exactly. If not, surface a loud error — the user needs to know.

## Output

```typescript
interface SelfTestReport {
  ranAt: string;
  radioModel: RadioModelId;
  firmwareVersion: string;
  scratchChannel: number;
  tests: {
    protocolRoundtrip: TestResult;
    persistenceAcrossReboot: TestResult;     // THE one
    silentDropDetection: TestResult | 'skipped';
    rebootTiming: { trials: number[]; meanMs: number; p95Ms: number };
  };
  recommendations: {
    rebootWaitMs: number;
    trustReadback: 'yes' | 'no' | 'with-reboot-verify';
  };
  passed: boolean;
  cacheKey: string;     // hash of (model, firmware version)
}
```

## When to run

- **Once per (radio model, firmware version) tuple.** Cache results in
  IndexedDB.
- **Before any first-time full restore** on a new device.
- **Optionally in CI** if you have a USB-connected test radio on the
  build machine.

## How the result drives the executor

If `trustReadback === 'with-reboot-verify'`, the executor adds a
forced reboot + re-read pass at the end of every restore plan that
touches cached regions. Slower, but correct.

If `trustReadback === 'yes'`, the executor skips that pass.

The per-firmware-version cache means hams who never re-flash pay the
cost once and never again. Hams who try every firmware version pay
it each time, but they're the kind of users who'd want the
verification anyway.

## Safety

Even if the test crashes mid-flight, the worst case is a scratch
channel with a weird name. The user can fix it on the radio's keypad
in 10 seconds. The test never touches calibration, settings, or any
region that affects radio behavior.

The `0x05DD` reboot is the same command the firmware uses internally
when finalizing a flash. It's well-tested. If the radio doesn't come
back, that indicates a deeper problem with the bootloader, not with
our test.
