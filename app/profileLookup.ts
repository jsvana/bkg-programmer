/**
 * Look up addresses from a profile by module/field. The self-test and
 * backup panels need to derive concrete EEPROM addresses for the
 * connected radio's profile.
 */

import { profiles } from "../src/schema/profiles/index";
import type { Profile, ProfileId, ArrayModuleDef } from "../src/schema/types";

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
