/**
 * Schema type system for the BKG Programmer.
 *
 * The schema describes "what bits live where in EEPROM for a given
 * (radio, firmware) combination." See docs/03-schema.md for design
 * rationale.
 */

// ============ Identifiers ============

export type RadioModelId =
  | 'uv-k5-v1'
  | 'uv-k5-v2'
  | 'uv-k5-v3'
  | 'uv-k1'
  | 'uv-k6';

export type FirmwareFamilyId =
  | 'stock'
  | 'egzumer'
  | 'f4hwn'
  | 'f4hwn-nr7y'
  | 'unknown';

export type ModuleId = string;
export type ProfileId = string;
export type GroupId = string;

// ============ Field types ============

export type FieldType =
  | { kind: 'bool' }
  | { kind: 'enum'; values: ReadonlyArray<EnumValue> }
  | { kind: 'int'; min: number; max: number; unit?: string }
  | { kind: 'frequency'; min: number; max: number; resolutionHz: number }
  | { kind: 'ascii'; maxLength: number }
  | { kind: 'bcd'; digits: number }
  | { kind: 'opaque' };  // for binary blobs we don't decode

export interface EnumValue {
  value: number;
  label: string;
}

// ============ Field location ============

export type Location =
  | { kind: 'byte'; offset: number; size: 1 | 2 | 4 | 8 | 12 | 16 | 20 }
  | { kind: 'bits'; offset: number; bitOffset: number; bitWidth: number };

// Note: location offsets are relative to the START of the containing
// module/template. The module/profile binding adds the base address.

// ============ Apply mode ============

/**
 * `live`: change takes effect immediately, no radio action needed
 * `reload-settings`: write triggers `SETTINGS_InitEEPROM()` if it
 *   overlaps `[0x0F30, 0x0F40)`; otherwise needs explicit menu navigation
 * `reboot`: requires `0x05DD` reboot or power cycle to take effect
 */
export type ApplyMode = 'live' | 'reload-settings' | 'reboot';

// ============ Sensitivity ============

export type Sensitivity =
  | 'shareable'         // safe to redistribute (channels, settings)
  | 'device-specific'   // calibration, serial-linked data
  | 'sensitive';        // kill codes, AES keys

// ============ Field ============

export interface Field {
  id: string;
  label: string;
  description?: string;
  group?: GroupId;
  type: FieldType;
  location: Location;
  defaultValue?: number | string;
  applyMode: ApplyMode;
  requires?: ReadonlyArray<string>;  // feature flags, e.g. ['ENABLE_FEAT_F4HWN']
  addedIn?: string;                   // version semver
  deprecatedIn?: string;
}

// ============ Modules ============

export interface BlockModuleDef {
  kind: 'block';
  id: ModuleId;
  /** If omitted, profile must supply a binding with baseOffset */
  baseOffset?: number;
  size: number;
  fields: ReadonlyArray<Field>;
  readOnly?: boolean;
  sensitivity?: Sensitivity;
}

export interface StructTemplate {
  size: number;
  fields: ReadonlyArray<Field>;
}

export interface ArrayModuleDef {
  kind: 'array';
  id: ModuleId;
  baseOffset: number;
  count: number;
  stride: number;
  template: StructTemplate;
  readOnly?: boolean;
  sensitivity?: Sensitivity;
}

export type ModuleDef = BlockModuleDef | ArrayModuleDef;

// ============ Profile ============

export interface ModuleBinding {
  binding: {
    moduleId: ModuleId;
    baseOffset: number;
  };
}

export type ProfileModuleEntry = ModuleDef | ModuleBinding;

export interface AppliesTo {
  radioModels: ReadonlyArray<RadioModelId>;
  firmwareFamily: FirmwareFamilyId;
  versionRange: string;  // semver-style or '*' or regex
}

export interface Profile {
  id: ProfileId;
  displayName?: string;
  appliesTo: AppliesTo;
  eepromSize: number;
  modules: ReadonlyArray<ProfileModuleEntry>;
  notes?: string;
}

// ============ Resolved (post-binding) shapes ============

export interface ResolvedBlockModule {
  kind: 'block';
  id: ModuleId;
  baseOffset: number;       // resolved, no longer optional
  size: number;
  fields: ReadonlyArray<Field>;
  readOnly: boolean;
  sensitivity: Sensitivity;
}

export interface ResolvedArrayModule {
  kind: 'array';
  id: ModuleId;
  baseOffset: number;
  count: number;
  stride: number;
  template: StructTemplate;
  readOnly: boolean;
  sensitivity: Sensitivity;
}

export type ResolvedModule = ResolvedBlockModule | ResolvedArrayModule;

export interface ResolvedProfile {
  id: ProfileId;
  source: Profile;
  modules: ReadonlyArray<ResolvedModule>;
}

// ============ Validation result shapes ============

export interface Ownership {
  profileId: string;
  moduleId: string;
  fieldPath: string;
  startBit: number;
  endBit: number;
}

export interface Overlap {
  startBit: number;
  endBit: number;
  a: Ownership;
  b: Ownership;
}

export interface OutOfBounds {
  ownership: Ownership;
  eepromSizeBits: number;
}

export interface TemplateError {
  moduleId: string;
  kind:
    | 'duplicate-field-id'
    | 'field-exceeds-template-size';
  id?: string;
  fieldId?: string;
  fieldEndByte?: number;
  templateSize?: number;
}

export interface ArrayError {
  moduleId: string;
  kind:
    | 'stride-too-small'
    | 'array-exceeds-eeprom';
  stride?: number;
  templateSize?: number;
  lastByte?: number;
  eepromSize?: number;
}

export interface DuplicateError {
  kind: 'module' | 'profile';
  id: string;
}

export interface ValidationReport {
  profileId: string;
  passed: boolean;
  overlaps: Overlap[];
  outOfBounds: OutOfBounds[];
  templateErrors: TemplateError[];
  arrayErrors: ArrayError[];
  duplicateIds: DuplicateError[];
  coverage: { claimedBits: number; totalBits: number };
}
