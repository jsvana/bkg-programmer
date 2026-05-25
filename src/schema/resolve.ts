import type {
  Profile,
  ResolvedProfile,
  ResolvedModule,
  ResolvedBlockModule,
  ResolvedArrayModule,
  ModuleId,
  BlockModuleDef,
  ModuleBinding,
  ArrayModuleDef,
} from './types';

/**
 * Resolve a Profile into a ResolvedProfile by:
 * 1. Looking up ModuleBindings against the registry, supplying baseOffset
 * 2. Applying defaults (readOnly=false, sensitivity='shareable' if unset)
 * 3. Deduping modules by ID — last-write-wins
 *
 * The validator runs against the result.
 */
export function resolveProfile(
  profile: Profile,
  registry: ReadonlyMap<ModuleId, BlockModuleDef>,
): ResolvedProfile {
  // Last-write-wins dedup. We iterate forward, overwriting on duplicate IDs.
  const byId = new Map<ModuleId, ResolvedModule>();

  for (const entry of profile.modules) {
    if ('binding' in entry) {
      // ModuleBinding — look up the referenced module def
      const def = registry.get(entry.binding.moduleId);
      if (!def) {
        throw new Error(
          `Profile "${profile.id}" references module "${entry.binding.moduleId}" ` +
            `which is not in the registry.`,
        );
      }
      byId.set(def.id, resolveBlock(def, entry.binding.baseOffset));
    } else if (entry.kind === 'block') {
      if (entry.baseOffset === undefined) {
        throw new Error(
          `Profile "${profile.id}" includes inline block module "${entry.id}" ` +
            `without baseOffset. Either set baseOffset on the module or use ` +
            `a binding.`,
        );
      }
      byId.set(entry.id, resolveBlock(entry, entry.baseOffset));
    } else if (entry.kind === 'array') {
      byId.set(entry.id, resolveArray(entry));
    } else {
      // exhaustiveness
      const _exhaustive: never = entry;
      throw new Error(`Unknown module entry: ${JSON.stringify(_exhaustive)}`);
    }
  }

  return {
    id: profile.id,
    source: profile,
    modules: [...byId.values()],
  };
}

function resolveBlock(def: BlockModuleDef, baseOffset: number): ResolvedBlockModule {
  return {
    kind: 'block',
    id: def.id,
    baseOffset,
    size: def.size,
    fields: def.fields,
    readOnly: def.readOnly ?? false,
    sensitivity: def.sensitivity ?? 'shareable',
  };
}

function resolveArray(def: ArrayModuleDef): ResolvedArrayModule {
  return {
    kind: 'array',
    id: def.id,
    baseOffset: def.baseOffset,
    count: def.count,
    stride: def.stride,
    template: def.template,
    readOnly: def.readOnly ?? false,
    sensitivity: def.sensitivity ?? 'shareable',
  };
}
