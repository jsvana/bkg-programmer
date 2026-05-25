# 07. Backup format

The backup file is the canonical representation of a radio's state at
a point in time. It's used for:

1. Safety — taken before any destructive operation
2. Distribution — club presets shared between members
3. Recovery — restore-from-backup if something goes wrong
4. Diagnostics — embedded in bug reports

## Format principles

1. **JSON-with-base64 over binary.** Hams share things in Discord, in
   club chats, as QSL attachments. JSON is readable; binary isn't.
   Performance is irrelevant for an 8-64 KB payload.

2. **Regions, not flat dumps.** V3/K1's virtual EEPROM is 64 KB with
   holes. Storing 32 KB of `0xFF` to represent unmapped space is
   dishonest and wastes bandwidth.

3. **Sensitivity tags.** Each region declares whether it's safe to
   share. The "Share with club" button filters mechanically — no
   human judgment in the loop.

## Schema

See `src/backup/format.ts` for the TypeScript types. Sketch:

```typescript
interface BkgBackup {
  $schema: 'https://bkg.club/schemas/backup-v1.json';
  schemaVersion: 1;
  kind: 'full' | 'calibration-only' | 'channels-only' | 'settings-only' | 'partial';

  capturedAt: string;       // ISO 8601 UTC
  capturedBy: string;       // callsign or label
  notes?: string;
  toolVersion: string;

  radio: {
    userConfirmedModel: RadioModelId;
    detectedModel?: RadioModelId;
    serial?: string;
    serialSource: 'eeprom' | 'user' | 'unknown';
    firmwareVersionRaw: string;
    firmwareFamily: FirmwareFamilyId;
    profileId: ProfileId;
    hasCustomAesKey: boolean;
    isLocked: boolean;
  };

  regions: ReadonlyArray<{
    name: string;
    moduleId: ModuleId;
    start: number;
    length: number;
    encoding: 'base64';
    bytes: string;
    sensitivity: 'shareable' | 'device-specific' | 'sensitive';
  }>;

  integrity: {
    algorithm: 'sha256';
    regionHashes: Record<string, string>;
    canonical: string;
  };
}
```

## Sensitivity levels

| Level | Examples | Share behavior |
| --- | --- | --- |
| `shareable` | Channels, scan lists, menu preferences | Included by default |
| `device-specific` | Calibration, serial-linked data | Stripped from shares unless user opts in with warning |
| `sensitive` | DTMF kill codes, custom AES keys | **Always stripped** from any share path |

## Diff before restore

The most important operation isn't backup or restore — it's the diff
between current state and a backup, displayed to the user with enough
detail to choose which changes to apply.

```typescript
interface BackupDiff {
  backupProfileId: ProfileId;
  currentProfileId: ProfileId;
  profileMatch: 'identical' | 'compatible' | 'incompatible';

  regionDiffs: RegionDiff[];
  totals: {
    bytesChanged: number;
    fieldsChanged: number;
    deviceSpecificChanges: number;   // surface this prominently
  };
}

interface FieldChange {
  fieldPath: string;
  fieldLabel: string;
  before: { raw: number; display: string };
  after: { raw: number; display: string };
  severity: 'cosmetic' | 'functional' | 'calibration' | 'safety';
}
```

`severity` drives the UI:
- `cosmetic`: channel name, contrast. Collapsed group by default.
- `functional`: frequency, scan list. Shown prominently.
- `calibration`: any cal region change. Warning banner.
- `safety`: TX band lock, kill codes. Require typed "I understand"
  to apply.

## Restore flow

1. Read current radio state (regions covered by both backup and
   current profile).
2. Compute diff.
3. Render grouped by severity, then by region.
4. Each change has a checkbox. Calibration changes default to
   unchecked.
5. "Apply selected" → generate write plan.
6. Confirmation: "Will write N bytes across M regions. K changes
   are calibration. Continue?"
7. Execute via the write planner (see `docs/08-write-plan.md`).

## Storage and naming

- **In-browser**: IndexedDB, keyed by radio serial number (or
  user-entered nickname if serial unavailable).
- **On disk**: Download as both `.json` (canonical) and `.bin`
  (regions concatenated, with `.json` sidecar indexing them — for
  CHIRP/UVTools2 interop).
- **Filename**: `bkg-{callsign}-{serial-or-nick}-{model}-{YYYYMMDD-HHMMSS}.{ext}`

## Diagnostic data worth embedding

Every backup also embeds the raw 28-byte hello reply (`0x0515`),
including the AES challenge values. If two club members report
different behavior with "the same" firmware, the raw reply often
reveals different builds. Bug reports with this metadata are 10×
easier to triage.
