import { uvK5V1F4hwn, v1ResolverModules } from './uv-k5-v1-f4hwn';
import {
  uvK1F4hwnNr7y,
  v3ResolverModules,
  nr7yResolverModules,
  freqLockResolverModules,
} from './uv-k1-f4hwn-nr7y';
import { uvK1Stock } from './uv-k1-stock';
import { uvK5Ijv, ijvResolverModules } from './uv-k5-ijv';
import type { Profile, ModuleId, BlockModuleDef } from '../types';

export const profiles: ReadonlyArray<Profile> = [
  uvK5V1F4hwn,
  uvK1F4hwnNr7y,
  uvK1Stock,
  uvK5Ijv,
];

/**
 * Lookup table for ModuleBinding resolution. The profile lists modules
 * inline OR by binding-to-id; the resolver needs a way to find the
 * referenced module definition.
 */
export const moduleRegistry: ReadonlyMap<ModuleId, BlockModuleDef> = new Map([
  ['calibration', v1ResolverModules.calibration],
  ['f4hwn_settings', v1ResolverModules.f4hwnSettings],
  ['ijv_settings', ijvResolverModules.ijvSettings],
  ['nr7y_cw_settings', nr7yResolverModules.nr7yCwSettings],
  ['freq_lock_settings', freqLockResolverModules.freqLockSettings],
] satisfies Array<[ModuleId, BlockModuleDef]>);

// v3ResolverModules's contents are duplicate references to modules already
// registered above; listed alongside the v3 profile for clarity.
void v3ResolverModules;

export { uvK5V1F4hwn, uvK1F4hwnNr7y, uvK1Stock, uvK5Ijv };
