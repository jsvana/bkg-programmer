# 06. Build-time validation

The validator catches one specific failure mode: two modules in the
same profile claim overlapping EEPROM bits. This is the failure mode
that produces the worst symptom — silent data corruption that only
shows up when a user changes setting A and setting B mysteriously
changes too.

You won't catch this in unit tests because each module looks fine in
isolation. You'll catch it three months later when someone reports a
bug you can't reproduce.

The validator runs at `npm run validate-schema`, wired into the
`prebuild` hook. If it fails, you can't `npm run build`.

## Algorithm

Per profile:

1. Resolve modules: walk the profile's module list, taking later
   modules with the same ID as overriding earlier ones.
2. Allocate a per-bit ownership map for the full EEPROM size (~64 KB
   bits = 8 KB of bookkeeping on V3/K1; trivial).
3. For each field in each module, compute its bit range and try to
   claim those bits.
4. If a bit is already claimed by another field: record an overlap.
5. Report.

Adjacent checks bundled in:
- Field IDs unique within a module
- Module IDs unique within a profile  
- Template `size <= stride` for array modules
- Array fits within `eepromSize`
- All field locations fit within their containing module / template

## Output format

Successful run:
```
✓ uv-k5-v1-f4hwn: OK (43.2% of EEPROM claimed)
✓ uv-k1-f4hwn-nr7y: OK (51.8% of EEPROM claimed)
```

Coverage % is a diagnostic only. **Don't gate on it.** Higher coverage
isn't better — it might mean you're claiming bytes you have no
business touching (calibration, reserved regions).

Failure run:
```
✗ uv-k5-v1-f4hwn: FAILED

  OVERLAP at byte 0x1FF7 bit 0 through byte 0x1FF7 bit 3:
    egzumer-settings :: legacy_ptt_flags
    f4hwn-settings :: set_ptt
    Both modules claim the same EEPROM bits in this profile.
    Likely cause: a settings block was added in a fork without
    removing or renaming the conflicting fields. Check the module
    list for uv-k5-v1-f4hwn.
```

The error message names both sides of the conflict by their full
field path. Five seconds to identify the file to edit.

## Things the validator does NOT catch

These are not failures of the design; they're failures of scope.

1. **Schema-vs-firmware drift.** If F4HWN moves `set_pwr` from
   byte 0x1FF7 to 0x1FF6 and you forget to update the schema, the
   validator passes but the radio gets wrong settings. Defense:
   round-trip tests against captured EEPROM dumps from known
   firmware versions. Not implemented yet.

2. **Field values that violate their declared type.** The validator
   checks layout, not values. An enum field with an invalid value is
   a serialization concern, not a schema concern.

3. **Semantically wrong claims.** If you mark the calibration region
   as a writable settings module, the validator won't complain.
   Defense: explicit `readOnly: true` flags on modules that should
   never be written, plus enforcement in the writer.

4. **The "alias" question.** What if you legitimately want two views
   of the same byte (raw + decoded)? Don't add this. Once an escape
   hatch exists, contributors will use it to "fix" failing
   validations instead of fixing the bug. If you eventually need
   aliases, require both fields to declare each other by name so the
   validator can verify mutual intent.

## Implementation

See `src/schema/validate.ts`. Run via `npm run validate-schema`.
