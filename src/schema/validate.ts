import type {
  Profile,
  ResolvedProfile,
  ResolvedModule,
  ResolvedArrayModule,
  ResolvedBlockModule,
  Field,
  Ownership,
  Overlap,
  OutOfBounds,
  TemplateError,
  ArrayError,
  DuplicateError,
  ValidationReport,
} from './types';

/**
 * Validate a resolved profile for EEPROM bit overlaps and related errors.
 *
 * See docs/06-validation.md for the design and rationale.
 */
export function validateProfile(
  profile: Profile,
  resolved: ResolvedProfile,
): ValidationReport {
  const totalBits = profile.eepromSize * 8;
  // Per-bit ownership. null = unclaimed.
  const owner: Array<Ownership | null> = new Array(totalBits).fill(null);

  const overlaps: Overlap[] = [];
  const outOfBounds: OutOfBounds[] = [];
  const templateErrors: TemplateError[] = [];
  const arrayErrors: ArrayError[] = [];
  const duplicateIds: DuplicateError[] = [];

  // Pre-flight: every module ID unique (resolver should guarantee, but verify)
  const seenModuleIds = new Set<string>();
  for (const mod of resolved.modules) {
    if (seenModuleIds.has(mod.id)) {
      duplicateIds.push({ kind: 'module', id: mod.id });
    }
    seenModuleIds.add(mod.id);
  }

  for (const mod of resolved.modules) {
    if (mod.kind === 'array') {
      validateArrayModule(mod, profile.id, owner, {
        overlaps,
        outOfBounds,
        templateErrors,
        arrayErrors,
      });
    } else {
      validateBlockModule(mod, profile.id, owner, {
        overlaps,
        outOfBounds,
        templateErrors,
      });
    }
  }

  const claimedBits = owner.reduce((n, o) => n + (o ? 1 : 0), 0);

  return {
    profileId: profile.id,
    passed:
      overlaps.length === 0 &&
      outOfBounds.length === 0 &&
      templateErrors.length === 0 &&
      arrayErrors.length === 0 &&
      duplicateIds.length === 0,
    overlaps,
    outOfBounds,
    templateErrors,
    arrayErrors,
    duplicateIds,
    coverage: { claimedBits, totalBits },
  };
}

function validateArrayModule(
  mod: ResolvedArrayModule,
  profileId: string,
  owner: Array<Ownership | null>,
  acc: {
    overlaps: Overlap[];
    outOfBounds: OutOfBounds[];
    templateErrors: TemplateError[];
    arrayErrors: ArrayError[];
  },
): void {
  // 1. Validate template-internal layout (one entry, fields don't overlap)
  const templateOwner: Array<Ownership | null> = new Array(mod.template.size * 8).fill(null);
  const seenFieldIds = new Set<string>();

  for (const f of mod.template.fields) {
    if (seenFieldIds.has(f.id)) {
      acc.templateErrors.push({ moduleId: mod.id, kind: 'duplicate-field-id', id: f.id });
      continue;
    }
    seenFieldIds.add(f.id);

    const { startBit, endBit } = fieldBits(f, 0);
    if (endBit > mod.template.size * 8) {
      acc.templateErrors.push({
        moduleId: mod.id,
        kind: 'field-exceeds-template-size',
        fieldId: f.id,
        fieldEndByte: Math.ceil(endBit / 8),
        templateSize: mod.template.size,
      });
      continue;
    }
    claimBits(
      templateOwner,
      startBit,
      endBit,
      {
        profileId,
        moduleId: mod.id,
        fieldPath: f.id,
        startBit,
        endBit,
      },
      acc.overlaps,
    );
  }

  // 2. Stride >= template size
  if (mod.stride < mod.template.size) {
    acc.arrayErrors.push({
      moduleId: mod.id,
      kind: 'stride-too-small',
      stride: mod.stride,
      templateSize: mod.template.size,
    });
    return;
  }

  // 3. Array fits in EEPROM
  const totalArrayBytes = mod.baseOffset + mod.count * mod.stride;
  if (totalArrayBytes > owner.length / 8) {
    acc.arrayErrors.push({
      moduleId: mod.id,
      kind: 'array-exceeds-eeprom',
      lastByte: totalArrayBytes,
      eepromSize: owner.length / 8,
    });
    return;
  }

  // 4. Claim bits in the global owner map for each entry
  for (let i = 0; i < mod.count; i++) {
    const entryBaseByte = mod.baseOffset + i * mod.stride;
    for (const f of mod.template.fields) {
      const local = fieldBits(f, 0);
      const startBit = entryBaseByte * 8 + local.startBit;
      const endBit = entryBaseByte * 8 + local.endBit;
      const ownership: Ownership = {
        profileId,
        moduleId: mod.id,
        fieldPath: `${mod.id}[${i}].${f.id}`,
        startBit,
        endBit,
      };
      if (endBit > owner.length) {
        acc.outOfBounds.push({ ownership, eepromSizeBits: owner.length });
        continue;
      }
      claimBits(owner, startBit, endBit, ownership, acc.overlaps);
    }
  }
}

function validateBlockModule(
  mod: ResolvedBlockModule,
  profileId: string,
  owner: Array<Ownership | null>,
  acc: {
    overlaps: Overlap[];
    outOfBounds: OutOfBounds[];
    templateErrors: TemplateError[];
  },
): void {
  const seenFieldIds = new Set<string>();
  for (const f of mod.fields) {
    if (seenFieldIds.has(f.id)) {
      acc.templateErrors.push({ moduleId: mod.id, kind: 'duplicate-field-id', id: f.id });
      continue;
    }
    seenFieldIds.add(f.id);

    const { startBit, endBit } = fieldBits(f, mod.baseOffset);
    const ownership: Ownership = {
      profileId,
      moduleId: mod.id,
      fieldPath: f.id,
      startBit,
      endBit,
    };
    if (endBit > owner.length) {
      acc.outOfBounds.push({ ownership, eepromSizeBits: owner.length });
      continue;
    }
    claimBits(owner, startBit, endBit, ownership, acc.overlaps);
  }
}

function fieldBits(f: Field, entryBaseByte: number): { startBit: number; endBit: number } {
  if (f.location.kind === 'byte') {
    const startBit = (entryBaseByte + f.location.offset) * 8;
    return { startBit, endBit: startBit + f.location.size * 8 };
  } else {
    const startBit = (entryBaseByte + f.location.offset) * 8 + f.location.bitOffset;
    return { startBit, endBit: startBit + f.location.bitWidth };
  }
}

/**
 * Walk the bit range [startBit, endBit) and try to claim each bit for
 * `newOwner`. Records overlaps (one Overlap per contiguous collision run)
 * but continues claiming so all collisions are detected in one pass.
 */
function claimBits(
  owner: Array<Ownership | null>,
  startBit: number,
  endBit: number,
  newOwner: Ownership,
  overlaps: Overlap[],
): void {
  let runOpen: Overlap | null = null;

  for (let b = startBit; b < endBit; b++) {
    const existing = owner[b];
    if (existing === null || existing === undefined) {
      owner[b] = newOwner;
      runOpen = null;
    } else {
      if (
        runOpen &&
        runOpen.a.fieldPath === existing.fieldPath &&
        runOpen.b.fieldPath === newOwner.fieldPath &&
        runOpen.endBit === b
      ) {
        // extend existing run
        runOpen.endBit = b + 1;
      } else {
        const fresh: Overlap = { startBit: b, endBit: b + 1, a: existing, b: newOwner };
        overlaps.push(fresh);
        runOpen = fresh;
      }
    }
  }
}

/**
 * Human-readable report formatter.
 */
export function formatReport(r: ValidationReport): string {
  if (r.passed) {
    const pct = ((r.coverage.claimedBits / r.coverage.totalBits) * 100).toFixed(1);
    return `\u2713 ${r.profileId}: OK (${pct}% of EEPROM claimed)`;
  }

  const lines: string[] = [`\u2717 ${r.profileId}: FAILED`];

  const byteFor = (b: number) => `0x${(b >> 3).toString(16).padStart(4, '0')}`;
  const bitFor = (b: number) => b & 7;

  for (const o of r.overlaps) {
    lines.push(
      ``,
      `  OVERLAP at byte ${byteFor(o.startBit)} bit ${bitFor(o.startBit)} through ` +
        `byte ${byteFor(o.endBit - 1)} bit ${bitFor(o.endBit - 1)}:`,
      `    ${o.a.moduleId} :: ${o.a.fieldPath}`,
      `    ${o.b.moduleId} :: ${o.b.fieldPath}`,
      `    Both modules claim the same EEPROM bits in this profile.`,
      `    Likely cause: a settings block was added in a fork without removing`,
      `    or renaming the conflicting fields. Check the module list for ${r.profileId}.`,
    );
  }

  for (const o of r.outOfBounds) {
    lines.push(
      ``,
      `  OUT OF BOUNDS:`,
      `    ${o.ownership.moduleId} :: ${o.ownership.fieldPath}`,
      `    ends at bit ${o.ownership.endBit}, EEPROM is ${o.eepromSizeBits} bits.`,
    );
  }

  for (const e of r.arrayErrors) {
    if (e.kind === 'stride-too-small') {
      lines.push(
        ``,
        `  STRIDE TOO SMALL in array ${e.moduleId}:`,
        `    template.size = ${e.templateSize} but stride = ${e.stride}.`,
        `    Consecutive entries would overlap each other.`,
      );
    } else if (e.kind === 'array-exceeds-eeprom') {
      lines.push(
        ``,
        `  ARRAY EXCEEDS EEPROM in ${e.moduleId}:`,
        `    last byte = ${e.lastByte}, EEPROM size = ${e.eepromSize}.`,
      );
    }
  }

  for (const t of r.templateErrors) {
    if (t.kind === 'duplicate-field-id') {
      lines.push(``, `  DUPLICATE FIELD ID in ${t.moduleId}: ${t.id}`);
    } else {
      lines.push(
        ``,
        `  FIELD EXCEEDS TEMPLATE SIZE in ${t.moduleId}:`,
        `    field "${t.fieldId}" ends at byte ${t.fieldEndByte}, template size = ${t.templateSize}.`,
      );
    }
  }

  for (const d of r.duplicateIds) {
    lines.push(``, `  DUPLICATE ${d.kind.toUpperCase()} ID: ${d.id}`);
  }

  return lines.join('\n');
}
