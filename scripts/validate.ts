/**
 * CLI entry: validates every profile in the registry against the overlap
 * validator. Exits non-zero on any failure.
 *
 * Run: npm run validate-schema
 */

import { profiles, moduleRegistry } from '../src/schema/profiles/index';
import { resolveProfile } from '../src/schema/resolve';
import { validateProfile, formatReport } from '../src/schema/validate';

let failed = 0;

for (const profile of profiles) {
  try {
    const resolved = resolveProfile(profile, moduleRegistry);
    const report = validateProfile(profile, resolved);
    console.log(formatReport(report));
    if (!report.passed) failed++;
  } catch (err) {
    console.error(`\u2717 ${profile.id}: FAILED to resolve`);
    console.error(`  ${(err as Error).message}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} profile(s) failed validation.`);
  process.exit(1);
} else {
  console.log(`\nAll ${profiles.length} profile(s) passed validation.`);
}
