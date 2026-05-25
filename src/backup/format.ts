/**
 * Backup file format. See docs/07-backup-format.md.
 */

import type {
  RadioModelId,
  FirmwareFamilyId,
  ProfileId,
  ModuleId,
  Sensitivity,
} from '../schema/types';

export const SCHEMA_VERSION = 1;
export const SCHEMA_URL = 'https://bkg.club/schemas/backup-v1.json';

export type BackupKind =
  | 'full'
  | 'calibration-only'
  | 'channels-only'
  | 'settings-only'
  | 'partial';

export interface BkgBackup {
  $schema: typeof SCHEMA_URL;
  schemaVersion: typeof SCHEMA_VERSION;
  kind: BackupKind;

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

  regions: ReadonlyArray<BackupRegion>;

  integrity: {
    algorithm: 'sha256';
    /** Map of region name → hex sha256 of base64-decoded bytes. */
    regionHashes: Record<string, string>;
    /** Canonical-JSON hash of the entire backup excluding this field. */
    canonical: string;
  };
}

export interface BackupRegion {
  name: string;
  moduleId: ModuleId;
  start: number;
  length: number;
  encoding: 'base64';
  bytes: string;
  sensitivity: Sensitivity;
}

/** Strip regions per requested share mode. */
export function redactForSharing(
  backup: BkgBackup,
  mode: 'shareable-only' | 'include-device-specific',
): BkgBackup {
  const allowed: Sensitivity[] =
    mode === 'shareable-only'
      ? ['shareable']
      : ['shareable', 'device-specific'];
  return {
    ...backup,
    regions: backup.regions.filter((r) => allowed.includes(r.sensitivity)),
  };
}

// Encoder / decoder stubs — implementation pending
export async function encodeBackup(_payload: unknown): Promise<BkgBackup> {
  throw new Error('encodeBackup: not yet implemented');
}

export async function decodeBackup(_text: string): Promise<BkgBackup> {
  throw new Error('decodeBackup: not yet implemented');
}
