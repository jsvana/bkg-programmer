/**
 * Diff between two backups (or a backup and a current snapshot).
 * Drives the "show me what will change" UI before any restore.
 */

import type { ProfileId } from '../schema/types';

export type ChangeSeverity = 'cosmetic' | 'functional' | 'calibration' | 'safety';

export interface FieldChange {
  fieldPath: string;
  fieldLabel: string;
  before: { raw: number; display: string };
  after: { raw: number; display: string };
  severity: ChangeSeverity;
  /** Byte range affected in EEPROM. Used by the planner. */
  byteRange: { start: number; end: number };
}

export interface RegionDiff {
  regionName: string;
  moduleId: string;
  totalBytes: number;
  changedBytes: number;
  fieldChanges: FieldChange[];
}

export interface BackupDiff {
  backupProfileId: ProfileId;
  currentProfileId: ProfileId;
  profileMatch: 'identical' | 'compatible' | 'incompatible';
  regionDiffs: RegionDiff[];
  totals: {
    bytesChanged: number;
    fieldsChanged: number;
    deviceSpecificChanges: number;
  };
}

// Stub — needs schema-aware decoding to populate fieldChanges properly.
export function computeDiff(
  _backup: unknown,
  _current: unknown,
): BackupDiff {
  throw new Error('computeDiff: not yet implemented. Needs schema-aware field decoder.');
}
