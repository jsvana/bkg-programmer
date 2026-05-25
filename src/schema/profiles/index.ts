import { uvK5V1F4hwn, v1ResolverModules } from './uv-k5-v1-f4hwn';
import { uvK1F4hwnNr7y, v3ResolverModules } from './uv-k1-f4hwn-nr7y';
import { uvK1Stock } from './uv-k1-stock';
import type { Profile, ModuleId, BlockModuleDef } from '../types';

export const profiles: ReadonlyArray<Profile> = [
  uvK5V1F4hwn,
  uvK1F4hwnNr7y,
  uvK1Stock,
];

/**
 * Lookup table for ModuleBinding resolution. The profile lists modules
 * inline OR by binding-to-id; the resolver needs a way to find the
 * referenced module definition.
 */
export const moduleRegistry: ReadonlyMap<ModuleId, BlockModuleDef> = new Map([
  ['calibration', v1ResolverModules.calibration],
  ['f4hwn_settings', v1ResolverModules.f4hwnSettings],
] satisfies Array<[ModuleId, BlockModuleDef]>);

// v3ResolverModules contain the same module definitions (same imports);
// listed in both files for clarity but they're literally identical references.
void v3ResolverModules;

export { uvK5V1F4hwn, uvK1F4hwnNr7y, uvK1Stock };
