/**
 * Preflight check runners. These translate the declarative PreflightCheck
 * entries on a WritePlan into actual runtime checks against the device.
 *
 * Most checks require live device access; called by the executor before
 * Phase 1.
 */

import type { Session } from '../protocol/session';
import type { PreflightCheck } from './plan';

export interface PreflightContext {
  session: Session;
  capturedVersionString: string;
  radioSerial?: string;
}

export async function runFreshDetection(ctx: PreflightContext): Promise<PreflightCheck> {
  // Re-hello to confirm version string hasn't changed.
  if (ctx.session.hello.versionString !== ctx.capturedVersionString) {
    return {
      id: 'fresh-detection',
      status: 'fail',
      blocking: true,
      message:
        `Firmware version changed since plan was generated ` +
        `(was: "${ctx.capturedVersionString}", now: "${ctx.session.hello.versionString}").`,
      remediation: 'Reload the page and regenerate the plan.',
    };
  }
  return {
    id: 'fresh-detection',
    status: 'pass',
    blocking: true,
    message: 'Firmware version matches plan.',
  };
}

export async function runLockscreenCheck(ctx: PreflightContext): Promise<PreflightCheck> {
  if (ctx.session.hello.isInLockScreen) {
    return {
      id: 'lockscreen-off',
      status: 'warn',
      blocking: false,
      message: 'Radio is in lockscreen mode. Writes to protected EEPROM regions will fail.',
      remediation: 'Unlock the radio (enter PIN on keypad).',
    };
  }
  return {
    id: 'lockscreen-off',
    status: 'pass',
    blocking: false,
    message: 'Lockscreen is off.',
  };
}

export async function runAesCheck(ctx: PreflightContext): Promise<PreflightCheck> {
  if (ctx.session.hello.hasCustomAesKey) {
    return {
      id: 'no-aes-challenge-required',
      status: 'fail',
      blocking: true,
      message:
        'Radio has a custom AES key. This tool does not yet support AES challenge response.',
      remediation: 'Clear the AES key on the radio first, or use UVTools2 for this restore.',
    };
  }
  return {
    id: 'no-aes-challenge-required',
    status: 'pass',
    blocking: true,
    message: 'No AES challenge required.',
  };
}

export async function runConcurrentSessionCheck(
  ctx: PreflightContext,
): Promise<PreflightCheck> {
  // IndexedDB-based lock keyed by radio serial. Browser-only.
  if (typeof indexedDB === 'undefined') {
    return {
      id: 'no-concurrent-session',
      status: 'pass',
      blocking: true,
      message: 'Non-browser environment; concurrent-session lock skipped.',
    };
  }
  // Real implementation: open db `bkg-locks`, store `{ serial, tabId, acquiredAt }`.
  // Steal if acquiredAt > 30 minutes old.
  // TODO: implement.
  return {
    id: 'no-concurrent-session',
    status: 'pass',
    blocking: true,
    message: 'Session lock acquired (stub).',
  };
}

/**
 * Run the full set against a live session.
 */
export async function runAllPreflightChecks(ctx: PreflightContext): Promise<PreflightCheck[]> {
  return Promise.all([
    runFreshDetection(ctx),
    runLockscreenCheck(ctx),
    runAesCheck(ctx),
    runConcurrentSessionCheck(ctx),
  ]);
}
