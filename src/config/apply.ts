/**
 * applyConfig: turn a BkgConfig overlay into the inputs the existing
 * writer/planner expects — a list of FieldChange entries and a target
 * EepromSnapshot reflecting "what the radio should look like after."
 *
 * The path looks like:
 *
 *   user JSON file
 *      ↓ parseConfig()
 *   BkgConfig
 *      ↓ applyConfig(cfg, resolvedProfile, currentSnapshot)
 *   { fieldChanges, target, warnings, errors }
 *      ↓ planWrites(resolved, current, target, fieldChanges)
 *   WritePlan
 *      ↓ executor
 *   bytes on the radio
 *
 * Today, the loader rejects three convenience top-level keys
 * (`callsign`, `keyerSpeed`, `splash`) with structured errors. They're
 * declared in the file format for forward compatibility — the schema
 * work to back them is tracked in CLAUDE.md's open questions list.
 */

import { EepromSnapshot } from '../backup/snapshot';
import type { FieldChange, ChangeSeverity } from '../backup/diff';
import type {
  ResolvedProfile,
  ResolvedModule,
  ResolvedBlockModule,
  ResolvedArrayModule,
  Field,
} from '../schema/types';
import { decodeField, writeField, ConfigEncodeError } from './codec';
import {
  type BkgConfig,
  type ConfigValue,
  type ConfigWarning,
  type ConfigError,
  type ChannelOverlay,
  type ChannelAttrOverlay,
  CONFIG_SCHEMA_VERSION,
} from './types';

export interface ApplyResult {
  fieldChanges: FieldChange[];
  /** Target snapshot covering the same regions as current, with the
   *  config-requested changes applied. Pass alongside `current` to
   *  planner.planWrites. */
  target: EepromSnapshot;
  warnings: ConfigWarning[];
  errors: ConfigError[];
}

export function applyConfig(
  config: BkgConfig,
  resolved: ResolvedProfile,
  current: EepromSnapshot,
): ApplyResult {
  const warnings: ConfigWarning[] = [];
  const errors: ConfigError[] = [];

  // ----- 0. Shape-validate the config envelope -----
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    errors.push({
      kind: 'parse',
      path: 'schemaVersion',
      message: `unsupported schemaVersion ${String(config.schemaVersion)}; expected ${CONFIG_SCHEMA_VERSION}`,
    });
  }
  if (config.appliesTo?.profileIds && !config.appliesTo.profileIds.includes(resolved.id)) {
    errors.push({
      kind: 'profile-mismatch',
      path: 'appliesTo.profileIds',
      message: `config restricted to [${config.appliesTo.profileIds.join(', ')}] but active profile is "${resolved.id}"`,
    });
  }

  // Convenience keys: rejected by design (today). See CLAUDE.md open Qs.
  if (config.callsign !== undefined) {
    errors.push({
      kind: 'unsupported-convenience',
      path: 'callsign',
      message: `top-level "callsign" not yet wired to a schema field on profile "${resolved.id}". ` +
        `On IJV this maps to ijv_settings.boot_line_1 once that block is write-enabled; on NR7Y/F4HWN ` +
        `the boot text storage isn't modeled yet.`,
    });
  }
  if (config.keyerSpeed !== undefined) {
    errors.push({
      kind: 'unsupported-convenience',
      path: 'keyerSpeed',
      message: `top-level "keyerSpeed" not yet wired to a schema field. NR7Y declares CW_KEY_WPM ` +
        `in EEPROM_Config_t but the offset within 0xA160-0xA170 has not been captured.`,
    });
  }
  if (config.splash !== undefined) {
    errors.push({
      kind: 'unsupported-convenience',
      path: 'splash',
      message: `top-level "splash" not yet supported. NR7Y maps boot logo at 0xC000-0xCFFF but no ` +
        `field-level module defines it; stock K1 write-protects this region.`,
    });
  }

  // If the envelope is bad, bail before doing work.
  if (errors.length > 0) {
    return { fieldChanges: [], target: cloneSnapshot(current), warnings, errors };
  }

  // ----- 1. Build the working byte set, keyed by aligned region.
  // We mutate this and convert back to an EepromSnapshot at the end.
  const work = currentRegionsCloned(current);
  const fieldChanges: FieldChange[] = [];

  // ----- 2. channels overlay -----
  if (config.channels) {
    applyChannelOverlay(config.channels, resolved, current, work, fieldChanges, warnings, errors);
  }

  // ----- 3. channelAttrs overlay -----
  if (config.channelAttrs) {
    applyChannelAttrOverlay(config.channelAttrs, resolved, current, work, fieldChanges, warnings, errors);
  }

  // ----- 4. settings overlay -----
  if (config.settings) {
    applySettingsOverlay(config.settings, resolved, current, work, fieldChanges, warnings, errors);
  }

  // ----- 5. Materialize target snapshot -----
  const target = new EepromSnapshot();
  for (const [start, data] of work) {
    target.addRegion(start, data);
  }

  return { fieldChanges, target, warnings, errors };
}

// =============================================================
// Channels
// =============================================================

function applyChannelOverlay(
  overlays: ReadonlyArray<ChannelOverlay>,
  resolved: ResolvedProfile,
  current: EepromSnapshot,
  work: Map<number, Uint8Array>,
  fieldChanges: FieldChange[],
  _warnings: ConfigWarning[],
  errors: ConfigError[],
): void {
  const channels = findArrayModule(resolved, 'channels');
  const names = findArrayModule(resolved, 'channel_names');

  overlays.forEach((ov, i) => {
    const path = `channels[${i}]`;
    if (!Number.isInteger(ov.index) || ov.index < 1) {
      errors.push({
        kind: 'channel-index-out-of-range',
        path: `${path}.index`,
        message: `channel index ${ov.index} must be a positive integer (1-based)`,
      });
      return;
    }

    // Fields against the channels record.
    if (ov.fields && Object.keys(ov.fields).length > 0) {
      if (!channels) {
        errors.push({
          kind: 'unknown-module',
          path,
          message: `profile "${resolved.id}" has no "channels" array module`,
        });
      } else if (channels.readOnly) {
        errors.push({
          kind: 'readonly-module',
          path,
          message: `profile "${resolved.id}" marks "channels" read-only; cannot apply channel field overlay`,
        });
      } else {
        applyArrayElement(channels, ov.index, ov.fields, path, current, work, fieldChanges, errors);
      }
    }

    // Name shortcut → channel_names array.
    if (ov.name !== undefined) {
      if (!names) {
        errors.push({
          kind: 'unknown-module',
          path: `${path}.name`,
          message: `profile "${resolved.id}" has no "channel_names" array module`,
        });
      } else if (names.readOnly) {
        errors.push({
          kind: 'readonly-module',
          path: `${path}.name`,
          message: `profile "${resolved.id}" marks "channel_names" read-only`,
        });
      } else {
        applyArrayElement(
          names,
          ov.index,
          { name: ov.name },
          `${path}.name`,
          current,
          work,
          fieldChanges,
          errors,
        );
      }
    }
  });
}

// =============================================================
// Channel attrs
// =============================================================

function applyChannelAttrOverlay(
  overlays: ReadonlyArray<ChannelAttrOverlay>,
  resolved: ResolvedProfile,
  current: EepromSnapshot,
  work: Map<number, Uint8Array>,
  fieldChanges: FieldChange[],
  _warnings: ConfigWarning[],
  errors: ConfigError[],
): void {
  const attrs = findArrayModule(resolved, 'channel_attrs');
  overlays.forEach((ov, i) => {
    const path = `channelAttrs[${i}]`;
    if (!Number.isInteger(ov.index) || ov.index < 1) {
      errors.push({
        kind: 'channel-index-out-of-range',
        path: `${path}.index`,
        message: `channel index ${ov.index} must be a positive integer (1-based)`,
      });
      return;
    }
    if (!attrs) {
      errors.push({
        kind: 'unknown-module',
        path,
        message: `profile "${resolved.id}" has no "channel_attrs" array module`,
      });
      return;
    }
    if (attrs.readOnly) {
      errors.push({
        kind: 'readonly-module',
        path,
        message: `profile "${resolved.id}" marks "channel_attrs" read-only`,
      });
      return;
    }
    applyArrayElement(attrs, ov.index, ov.fields, path, current, work, fieldChanges, errors);
  });
}

// =============================================================
// Settings
// =============================================================

function applySettingsOverlay(
  settings: NonNullable<BkgConfig['settings']>,
  resolved: ResolvedProfile,
  current: EepromSnapshot,
  work: Map<number, Uint8Array>,
  fieldChanges: FieldChange[],
  _warnings: ConfigWarning[],
  errors: ConfigError[],
): void {
  for (const [moduleId, fieldMap] of Object.entries(settings)) {
    const path = `settings.${moduleId}`;
    const mod = resolved.modules.find((m) => m.id === moduleId);
    if (!mod) {
      errors.push({
        kind: 'unknown-module',
        path,
        message: `profile "${resolved.id}" has no module "${moduleId}"`,
      });
      continue;
    }
    if (mod.kind !== 'block') {
      errors.push({
        kind: 'unknown-module',
        path,
        message: `module "${moduleId}" is not a block module (kind=${mod.kind}); ` +
          `use channels/channelAttrs overlays for array modules`,
      });
      continue;
    }
    if (mod.readOnly) {
      errors.push({
        kind: 'readonly-module',
        path,
        message: `profile "${resolved.id}" marks "${moduleId}" read-only`,
      });
      continue;
    }
    applyBlock(mod, fieldMap, path, current, work, fieldChanges, errors);
  }
}

// =============================================================
// Block / element writer
// =============================================================

function applyArrayElement(
  arrayMod: ResolvedArrayModule,
  oneBasedIndex: number,
  fieldMap: { readonly [fieldId: string]: ConfigValue },
  pathPrefix: string,
  current: EepromSnapshot,
  work: Map<number, Uint8Array>,
  fieldChanges: FieldChange[],
  errors: ConfigError[],
): void {
  const elementIndex = oneBasedIndex - 1;
  if (elementIndex < 0 || elementIndex >= arrayMod.count) {
    errors.push({
      kind: 'channel-index-out-of-range',
      path: `${pathPrefix}.index`,
      message: `index ${oneBasedIndex} outside [1, ${arrayMod.count}] for "${arrayMod.id}"`,
    });
    return;
  }
  const recordBase = arrayMod.baseOffset + elementIndex * arrayMod.stride;
  const recordSize = arrayMod.template.size;

  if (!current.covers(recordBase, recordSize)) {
    errors.push({
      kind: 'snapshot-coverage',
      path: pathPrefix,
      message: `current snapshot does not cover [0x${recordBase.toString(16)}, ` +
        `0x${(recordBase + recordSize).toString(16)}) needed for "${arrayMod.id}[${oneBasedIndex}]"`,
    });
    return;
  }

  const currentRecord = current.read(recordBase, recordSize);
  const targetRecord = readWork(work, recordBase, recordSize);
  applyFieldMapToRecord(
    arrayMod.template.fields,
    fieldMap,
    pathPrefix,
    recordBase,
    currentRecord,
    targetRecord,
    fieldChanges,
    errors,
  );
}

function applyBlock(
  block: ResolvedBlockModule,
  fieldMap: { readonly [fieldId: string]: ConfigValue },
  pathPrefix: string,
  current: EepromSnapshot,
  work: Map<number, Uint8Array>,
  fieldChanges: FieldChange[],
  errors: ConfigError[],
): void {
  if (!current.covers(block.baseOffset, block.size)) {
    errors.push({
      kind: 'snapshot-coverage',
      path: pathPrefix,
      message: `current snapshot does not cover [0x${block.baseOffset.toString(16)}, ` +
        `0x${(block.baseOffset + block.size).toString(16)}) needed for "${block.id}"`,
    });
    return;
  }
  const currentRecord = current.read(block.baseOffset, block.size);
  const targetRecord = readWork(work, block.baseOffset, block.size);
  applyFieldMapToRecord(
    block.fields,
    fieldMap,
    pathPrefix,
    block.baseOffset,
    currentRecord,
    targetRecord,
    fieldChanges,
    errors,
  );
}

function applyFieldMapToRecord(
  fields: ReadonlyArray<Field>,
  fieldMap: { readonly [fieldId: string]: ConfigValue },
  pathPrefix: string,
  recordBase: number,
  currentRecord: Uint8Array,
  targetRecord: Uint8Array,
  fieldChanges: FieldChange[],
  errors: ConfigError[],
): void {
  for (const [fieldId, value] of Object.entries(fieldMap)) {
    const field = fields.find((f) => f.id === fieldId);
    const path = `${pathPrefix}.${fieldId}`;
    if (!field) {
      errors.push({
        kind: 'unknown-field',
        path,
        message: `field "${fieldId}" not declared on this module`,
      });
      continue;
    }
    const before = decodeField(field, currentRecord);
    try {
      const w = writeField(field, value, targetRecord);
      const after = decodeField(field, targetRecord);
      fieldChanges.push({
        fieldPath: path,
        fieldLabel: field.label,
        before,
        after,
        severity: severityForField(field),
        byteRange: { start: recordBase + w.offset, end: recordBase + w.offset + w.length },
      });
    } catch (err) {
      if (err instanceof ConfigEncodeError) {
        errors.push({ kind: err.kind, path, message: err.message });
      } else {
        throw err;
      }
    }
  }
}

function severityForField(field: Field): ChangeSeverity {
  // The diff infrastructure (see docs/07-backup-format.md) classifies
  // changes for UI display. Until we have a richer "danger" annotation
  // on fields, approximate:
  if (field.group === 'ch.name' || field.group === 'branding') return 'cosmetic';
  if (field.group?.startsWith('cal') ?? false) return 'calibration';
  return 'functional';
}

// =============================================================
// Helpers
// =============================================================

function findArrayModule(
  resolved: ResolvedProfile,
  id: string,
): ResolvedArrayModule | undefined {
  const m = resolved.modules.find((x) => x.id === id);
  if (!m) return undefined;
  return m.kind === 'array' ? m : undefined;
}

/** Pull a deep-copied mutable byte window for the given absolute range
 *  from the work map. If the range hasn't been touched yet, seeds it
 *  by copying from the work map's existing region — falling back to a
 *  fresh zero-filled buffer if neither covers it (shouldn't happen
 *  after a covers() check at the caller). */
function readWork(work: Map<number, Uint8Array>, address: number, length: number): Uint8Array {
  for (const [start, data] of work) {
    if (address >= start && address + length <= start + data.length) {
      return data.subarray(address - start, address - start + length);
    }
  }
  throw new Error(
    `readWork: range [0x${address.toString(16)}, 0x${(address + length).toString(16)}) not in work map`,
  );
}

function currentRegionsCloned(current: EepromSnapshot): Map<number, Uint8Array> {
  const m = new Map<number, Uint8Array>();
  for (const r of current.getRegions()) {
    m.set(r.start, new Uint8Array(r.data));
  }
  return m;
}

function cloneSnapshot(current: EepromSnapshot): EepromSnapshot {
  const clone = new EepromSnapshot();
  for (const r of current.getRegions()) {
    clone.addRegion(r.start, new Uint8Array(r.data));
  }
  return clone;
}

// =============================================================
// Parsing
// =============================================================

/**
 * Parse JSON text into a BkgConfig. Performs only shape-level checks
 * sufficient to keep applyConfig safe — deep field-by-field validation
 * happens during applyConfig, where the resolved profile is available.
 */
export function parseConfig(text: string): BkgConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Config must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Config schemaVersion must be ${CONFIG_SCHEMA_VERSION}; got ${JSON.stringify(obj.schemaVersion)}`,
    );
  }
  // The remaining shape-checks happen in applyConfig — that's where we
  // can produce structured errors with paths. Cast through unknown to
  // keep TS strict mode happy.
  return raw as BkgConfig;
}

// Re-exports
export type { ResolvedModule };
