/**
 * Firmware registry. Data-driven so adding a new firmware variant
 * is a PR to a JSON-shaped object, not a code change.
 */

import type { RadioModelId, FirmwareFamilyId, ProfileId } from '../schema/types';

export interface FirmwareEntry {
  /** Stable ID used in backups, profile bindings, etc. */
  id: string;
  family: FirmwareFamilyId;
  /** Human-readable display name. */
  displayName: string;
  /**
   * Regex patterns matched against the 16-byte version string from hello reply.
   * First match wins. Order entries from most specific to least.
   */
  versionStringPatterns: ReadonlyArray<RegExp>;
  /** Candidate radio models this firmware runs on. */
  candidateModels: ReadonlyArray<RadioModelId>;
  /** Profile to use for this firmware. */
  profileId: ProfileId;
  /** Whether the firmware preserves a model identifier string (cross-check is reliable). */
  modelBytesPreserved: boolean;
  /** EEPROM address of the model identifier ASCII bytes. Defaults to 0x1ED0 (V1). */
  modelBytesAddress?: number;
  /** Optional pointer to release / docs. */
  source?: { url?: string; repo?: string };
  /** Notes for the registry maintainer. */
  notes?: string;
}

export const firmwareRegistry: ReadonlyArray<FirmwareEntry> = [
  // TODO: populate from real version string captures.
  {
    id: 'f4hwn-nr7y-fusion',
    family: 'f4hwn-nr7y',
    displayName: 'F4HWN Fusion (NR7Y fork) for UV-K1 / UV-K5 V3',
    versionStringPatterns: [/^NR7Y/i, /F4HWN.*K1/i],
    candidateModels: ['uv-k1', 'uv-k5-v3'],
    profileId: 'uv-k1-f4hwn-nr7y',
    modelBytesPreserved: true,
    source: { repo: 'briand/uv-k1-k5v3-firmware-custom' },
  },
  {
    id: 'f4hwn-v1',
    family: 'f4hwn',
    displayName: 'F4HWN for UV-K5 V1/V2',
    versionStringPatterns: [/EGZUMER[-_ ]?F4HWN/i, /F4HWN/i],
    candidateModels: ['uv-k5-v1', 'uv-k5-v2'],
    profileId: 'uv-k5-v1-f4hwn',
    modelBytesPreserved: true,
    source: { repo: 'armel/uv-k5-firmware-custom' },
  },
  {
    id: 'uv-k1-stock-7x',
    family: 'stock',
    displayName: 'UV-K1 Mini Kong stock firmware (7.x)',
    // Captured from a real radio (7.03.01). Pattern covers any 7.x.y on K1.
    // Deliberately ordered LAST so any F4HWN/NR7Y match above wins.
    versionStringPatterns: [/^7\.\d+\.\d+$/],
    candidateModels: ['uv-k1'],
    profileId: 'uv-k1-stock',
    modelBytesPreserved: true,
    modelBytesAddress: 0x0EC0,
    source: { url: 'https://uv-k1.com/' },
    notes:
      'V1-layout profile verified 2026-05-25 by TESTCHAN write at 0x0F50. ' +
      'Model string "UV-K1" at 0x0EC0. Profile is read-only pending ' +
      'self-test persistence verification.',
  },
  // Add stock UV-K5 V1/V2 and egzumer entries as captures land.
];

export function findFirmwareByVersion(versionString: string): FirmwareEntry | undefined {
  for (const entry of firmwareRegistry) {
    if (entry.versionStringPatterns.some((re) => re.test(versionString))) {
      return entry;
    }
  }
  return undefined;
}
