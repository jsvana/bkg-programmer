/**
 * Look up addresses from a profile by module/field. The self-test and
 * backup panels need to derive concrete EEPROM addresses for the
 * connected radio's profile.
 */

import { profiles, moduleRegistry } from "../src/schema/profiles/index";
import { resolveProfile } from "../src/schema/resolve";
import type {
  Profile,
  ProfileId,
  ArrayModuleDef,
  ResolvedProfile,
} from "../src/schema/types";

export function findProfile(profileId: ProfileId): Profile | undefined {
  return profiles.find((p) => p.id === profileId);
}

export function getChannelNameAddress(
  profile: Profile,
  channel: number,
): number | null {
  const mod = profile.modules.find(
    (m): m is ArrayModuleDef =>
      "kind" in m && m.kind === "array" && m.id === "channel_names",
  );
  if (!mod) return null;
  if (channel < 1 || channel > mod.count) return null;
  return mod.baseOffset + (channel - 1) * mod.stride;
}

export function getChannelCount(profile: Profile): number {
  const mod = profile.modules.find(
    (m): m is ArrayModuleDef =>
      "kind" in m && m.kind === "array" && m.id === "channels",
  );
  return mod?.count ?? 0;
}

/**
 * True if `channel_names` is declared read-only on this profile. Used to
 * gate the self-test (which writes to a scratch channel name).
 */
export function isChannelNamesReadOnly(profile: Profile): boolean {
  const mod = profile.modules.find(
    (m): m is ArrayModuleDef =>
      "kind" in m && m.kind === "array" && m.id === "channel_names",
  );
  return mod?.readOnly === true;
}

/**
 * True if any module on the profile is read-only — i.e. the profile is
 * tentative / unverified. Used to surface a warning banner.
 */
export function isProfileTentative(profile: Profile): boolean {
  return profile.modules.some(
    (m) => "kind" in m && (m.kind === "block" || m.kind === "array") && m.readOnly === true,
  );
}

export function resolveProfileById(profileId: ProfileId): ResolvedProfile | null {
  const profile = findProfile(profileId);
  if (!profile) return null;
  return resolveProfile(profile, moduleRegistry);
}

export interface AsciiFieldLocation {
  address: number;
  size: number;
  maxLength: number;
  label: string;
}

/**
 * Look up the absolute address + slot size of an ASCII field inside a
 * specific module (block). Returns null if the field doesn't exist or
 * isn't an ASCII field.
 */
export function findAsciiField(
  resolved: ResolvedProfile,
  moduleId: string,
  fieldId: string,
): AsciiFieldLocation | null {
  const mod = resolved.modules.find(
    (m) => m.kind === "block" && m.id === moduleId,
  );
  if (!mod || mod.kind !== "block") return null;
  const field = mod.fields.find((f) => f.id === fieldId);
  if (!field) return null;
  if (field.type.kind !== "ascii") return null;
  if (field.location.kind !== "byte") return null;
  return {
    address: mod.baseOffset + field.location.offset,
    size: field.location.size,
    maxLength: field.type.maxLength,
    label: field.label,
  };
}
