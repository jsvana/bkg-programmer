# 03. Schema design

The schema is the type-safe, versioned description of "what bits live
where in EEPROM for a given (radio, firmware) combination."

## Concepts

### Field

The leaf of the schema. A field declares:
- An ID stable across versions
- A type (bool, enum, int, frequency, ASCII, BCD)
- A location (whole bytes, or a bit range within a byte)
- An apply mode: `live`, `reload-settings`, or `reboot`
- Optional metadata (label, description, group, required feature flags)

### Module

A self-contained region of EEPROM. Two flavors:

- **Block module**: a fixed set of fields at a fixed (or
  profile-bound) base offset. Used for settings blocks, calibration,
  the F4HWN bit-packed region.
- **Array module**: a repeating struct (channel record, channel name,
  attribute byte) with a base offset, count, stride, and template.

### Profile

A specific (radio, firmware family, version range) combination.
A profile = an ordered list of module references. Last-write-wins on
module ID, which gives a simple, predictable override mechanism.

### Why composition, not inheritance

Inheritance gets messy when child modules change the *semantics* of
adjacent bits, not just one field. F4HWN's scan-list field is 5 bits
because there are 24 lists; egzumer's is 3 bits. The bits around the
scan-list field have different meanings in each. You can't safely
override "just the scan-list field"; you need to replace the whole byte
layout.

Composition handles this naturally: F4HWN provides a complete
`channel_attrs` module that replaces egzumer's by ID. No partial
overrides, no diamond problems, no hidden gotchas.

## Sample profile

```typescript
import {
  channelRecord, channelName,
  channelAttrsV1, channelAttrsV3,
  calibration, f4hwnSettings,
} from './modules';

export const uvK5V1F4hwn: Profile = {
  id: 'uv-k5-v1-f4hwn',
  appliesTo: {
    radioModels: ['uv-k5-v1', 'uv-k5-v2'],
    firmwareFamily: 'f4hwn',
    versionRange: '*',
  },
  eepromSize: 0x2000,
  modules: [
    { kind: 'array', id: 'channels',     baseOffset: 0x0000, count: 200, stride: 16, template: channelRecord },
    { kind: 'array', id: 'channel_attrs',baseOffset: 0x0D60, count: 207, stride: 1,  template: channelAttrsV1 },
    { kind: 'array', id: 'channel_names',baseOffset: 0x0F50, count: 200, stride: 16, template: channelName },
    { binding: { moduleId: 'calibration',    baseOffset: 0x1E00 } },
    { binding: { moduleId: 'f4hwn_settings', baseOffset: 0x1FF0 } },
  ],
};

export const uvK1F4hwnNr7y: Profile = {
  id: 'uv-k1-f4hwn-nr7y',
  appliesTo: {
    radioModels: ['uv-k1', 'uv-k5-v3'],
    firmwareFamily: 'f4hwn-nr7y',
    versionRange: '*',
  },
  eepromSize: 0xD000,
  modules: [
    { kind: 'array', id: 'channels',     baseOffset: 0x0000, count: 1024, stride: 16, template: channelRecord },
    { kind: 'array', id: 'channel_attrs',baseOffset: 0x8000, count: 1031, stride: 2,  template: channelAttrsV3 },
    { kind: 'array', id: 'channel_names',baseOffset: 0x4000, count: 1024, stride: 16, template: channelName },
    { binding: { moduleId: 'calibration',    baseOffset: 0xB000 } },
    { binding: { moduleId: 'f4hwn_settings', baseOffset: 0xA158 } },
  ],
};
```

Note the F4HWN settings base offset: **0x1FF0 on V1, 0xA158 on V3/K1.**
Getting this wrong corrupts the calibration region.

## See also

- `docs/04-modules-channels.md` — channel record template details
- `docs/05-modules-calibration.md` — calibration module
- `docs/06-validation.md` — build-time overlap detection
- `src/schema/types.ts` — type definitions
- `src/schema/modules/` — module implementations
