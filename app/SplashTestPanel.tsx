"use client";

import { useEffect, useState } from "react";
import { useSession } from "./SessionContext";
import type { Session } from "../src/protocol/session";

const ADDR_A = 0x2e00;
const ADDR_B = 0x3000;
const SPLASH_SIZE = 512;
const STORAGE_KEY = "bkg-splash-test-state";

type TargetAddr = typeof ADDR_A | typeof ADDR_B;

type Phase =
  | "idle"
  | "saved"
  | "written"
  | "reported-changed"
  | "reported-unchanged"
  | "restored";

interface PersistedState {
  phase: Phase;
  firmwareVersion: string;
  target: TargetAddr;
  // Both originals are always captured at "Save originals" time so that
  // restore works regardless of which target we end up writing.
  originalAB64: string; // bytes at ADDR_A (0x2E00)
  originalBB64: string; // bytes at ADDR_B (0x3000)
  capturedAt: string;
}

export function SplashTestPanel() {
  const { state } = useSession();
  const [persisted, setPersisted] = useState<PersistedState | null>(null);
  // Target selection only matters before "Save originals" is clicked; after
  // that, the saved record locks the target in.
  const [pendingTarget, setPendingTarget] = useState<TargetAddr>(ADDR_A);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (isValidPersisted(parsed)) {
        setPersisted(parsed);
      } else {
        // Stale (pre-target-selector) state. Drop it so the UI doesn't crash.
        console.warn("[SplashTestPanel] discarding stale localStorage state");
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  function save(next: PersistedState | null) {
    setPersisted(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function pushLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runStep(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const connected = state.kind === "connected";
  const session = connected ? state.session : null;
  const firmwareVersion = connected ? state.result.hello.versionString : "";
  const profileId =
    connected && state.result.firmware.kind === "matched"
      ? state.result.firmware.entry.profileId
      : undefined;

  // Only show for stock K1, which is the only profile with confirmed splash addresses.
  if (!connected || profileId !== "uv-k1-stock") return null;

  async function saveOriginals() {
    if (!session) throw new Error("not connected");
    pushLog(`Reading 0x${ADDR_A.toString(16)} (${SPLASH_SIZE} bytes)…`);
    const a = await session.readEeprom(ADDR_A, SPLASH_SIZE);
    pushLog(`Reading 0x${ADDR_B.toString(16)} (${SPLASH_SIZE} bytes)…`);
    const b = await session.readEeprom(ADDR_B, SPLASH_SIZE);
    save({
      phase: "saved",
      firmwareVersion,
      target: pendingTarget,
      originalAB64: bytesToBase64(a),
      originalBB64: bytesToBase64(b),
      capturedAt: new Date().toISOString(),
    });
    pushLog(
      `Saved. 0x${ADDR_A.toString(16)} hash=${shortHash(a)}, ` +
        `0x${ADDR_B.toString(16)} hash=${shortHash(b)}. ` +
        `Target: 0x${pendingTarget.toString(16)}.`,
    );
  }

  async function writeTestPattern() {
    if (!session || !persisted) throw new Error("not ready");
    const { target } = persisted;
    const other = target === ADDR_A ? ADDR_B : ADDR_A;
    const originalTarget = base64ToBytes(
      target === ADDR_A ? persisted.originalAB64 : persisted.originalBB64,
    );
    const originalOther = base64ToBytes(
      other === ADDR_A ? persisted.originalAB64 : persisted.originalBB64,
    );
    // Preserve first 8 bytes (in case firmware validates a header there);
    // fill rest with 0xFF so the top half of the display lights solid.
    const pattern = new Uint8Array(SPLASH_SIZE);
    pattern.set(originalTarget.subarray(0, 8), 0);
    pattern.fill(0xff, 8);
    pushLog(
      `Writing test pattern to 0x${target.toString(16)} ` +
        `(first 8 bytes preserved, 10s/chunk timeout)…`,
    );
    try {
      await session.writeEeprom(target, pattern, { timeoutMs: 10000 });
    } catch (err) {
      // If the write timed out, the radio may still have processed it but
      // failed to reply. Read back to see what actually landed.
      pushLog(
        `Write call failed (${err instanceof Error ? err.message : String(err)}). ` +
          `Reading 0x${target.toString(16)} to diagnose…`,
      );
      try {
        const diag = await session.readEeprom(target, SPLASH_SIZE);
        if (bytesEq(diag, pattern)) {
          pushLog("Diagnostic read: pattern IS present. Write landed; reply was lost or slow.");
        } else if (bytesEq(diag, originalTarget)) {
          pushLog("Diagnostic read: still original bytes. Write was rejected.");
        } else {
          const matchPrefix = countMatchingPrefix(diag, pattern);
          pushLog(
            `Diagnostic read: partial — first ${matchPrefix} bytes match pattern, ` +
              `rest differs. Hash=${shortHash(diag)}.`,
          );
        }
      } catch (readErr) {
        pushLog(
          `Diagnostic read also failed: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
        );
      }
      throw err;
    }

    pushLog(`Reading back 0x${target.toString(16)}…`);
    const readback = await session.readEeprom(target, SPLASH_SIZE);
    if (!bytesEq(readback, pattern)) {
      throw new Error(`Read-back mismatch: write did not land at 0x${target.toString(16)}.`);
    }
    pushLog("Read-back matches pattern.");

    pushLog(`Confirming 0x${other.toString(16)} is untouched…`);
    const otherNow = await session.readEeprom(other, SPLASH_SIZE);
    if (!bytesEq(otherNow, originalOther)) {
      throw new Error(
        `Untouched address 0x${other.toString(16)} changed unexpectedly — something else wrote there.`,
      );
    }
    pushLog("Other address unchanged. Ready for power-cycle.");

    save({ ...persisted, phase: "written" });
  }

  async function rebootRadio() {
    if (!session) throw new Error("not connected");
    pushLog("Sending reboot command (0x05DD). Session will close — reconnect after radio boots.");
    await session.reboot();
  }

  function reportChanged() {
    if (!persisted) return;
    save({ ...persisted, phase: "reported-changed" });
    pushLog(
      `Reported: splash CHANGED. → 0x${persisted.target.toString(16)} is read by firmware.`,
    );
  }

  function reportUnchanged() {
    if (!persisted) return;
    const other = persisted.target === ADDR_A ? ADDR_B : ADDR_A;
    save({ ...persisted, phase: "reported-unchanged" });
    pushLog(
      `Reported: splash UNCHANGED. → firmware likely reads from 0x${other.toString(16)} ` +
        `(or caches the image).`,
    );
  }

  async function restoreOriginal() {
    if (!session || !persisted) throw new Error("not ready");
    const { target } = persisted;
    const original = base64ToBytes(
      target === ADDR_A ? persisted.originalAB64 : persisted.originalBB64,
    );
    pushLog(`Restoring original bytes to 0x${target.toString(16)}…`);
    await session.writeEeprom(target, original, { timeoutMs: 10000 });
    const readback = await session.readEeprom(target, SPLASH_SIZE);
    if (!bytesEq(readback, original)) {
      throw new Error("Restore verify failed. Original bytes still stored in localStorage.");
    }
    pushLog("Restore verified. Power-cycle once more to confirm splash is back to normal.");
    save({ ...persisted, phase: "restored" });
  }

  function clearState() {
    save(null);
    setLog([]);
  }

  const phase: Phase = persisted?.phase ?? "idle";

  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18 }}>Splash logo probe (uv-k1-stock)</h2>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>
        Determines whether the firmware reads the boot logo from{" "}
        <code>0x2E00</code>, the mirror at <code>0x3000</code>, or both, and
        whether the chosen address accepts writes at all. Writes a test pattern
        to the selected target only, asks you to power-cycle, then restores the
        original.
      </p>

      <div style={{ marginTop: 12, fontSize: 13 }}>
        <strong>Target:</strong>{" "}
        {persisted ? (
          <code>0x{persisted.target.toString(16)}</code>
        ) : (
          <>
            <label style={{ marginRight: 12 }}>
              <input
                type="radio"
                name="splash-target"
                checked={pendingTarget === ADDR_A}
                onChange={() => setPendingTarget(ADDR_A)}
                disabled={busy}
              />{" "}
              <code>0x{ADDR_A.toString(16)}</code> (primary)
            </label>
            <label>
              <input
                type="radio"
                name="splash-target"
                checked={pendingTarget === ADDR_B}
                onChange={() => setPendingTarget(ADDR_B)}
                disabled={busy}
              />{" "}
              <code>0x{ADDR_B.toString(16)}</code> (mirror)
            </label>
          </>
        )}
        {persisted ? (
          <span style={{ color: "var(--muted)", marginLeft: 8 }}>
            (locked once saved — Reset to change)
          </span>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 10,
          border: "1px solid #b88a00",
          background: "rgba(184, 138, 0, 0.08)",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <strong>Destructive.</strong> Overwrites bytes the firmware may render
        on boot. Original bytes are saved to localStorage before any write; if
        anything goes wrong you can reload this page and click <em>Restore</em>.
      </div>

      {persisted ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          Saved {persisted.capturedAt} (firmware{" "}
          <code>{persisted.firmwareVersion}</code>). Phase:{" "}
          <strong>{phase}</strong>.
        </p>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => runStep(saveOriginals)}
          disabled={busy || phase !== "idle"}
        >
          1. Save originals
        </button>
        <button
          onClick={() => runStep(writeTestPattern)}
          disabled={busy || phase !== "saved"}
        >
          2. Write test pattern
        </button>
        <button
          className="secondary"
          onClick={() => runStep(rebootRadio)}
          disabled={busy || phase !== "written"}
        >
          3. Reboot radio
        </button>
        <button
          onClick={reportChanged}
          disabled={busy || phase !== "written"}
        >
          4a. Splash changed
        </button>
        <button
          onClick={reportUnchanged}
          disabled={busy || phase !== "written"}
        >
          4b. Splash unchanged
        </button>
        <button
          onClick={() => runStep(restoreOriginal)}
          disabled={
            busy ||
            (phase !== "reported-changed" && phase !== "reported-unchanged")
          }
        >
          5. Restore original
        </button>
        <button
          className="secondary"
          onClick={clearState}
          disabled={busy}
        >
          Reset
        </button>
      </div>

      {phase === "written" && persisted ? (
        <p style={{ marginTop: 12, fontSize: 13 }}>
          Test pattern written to <code>0x{persisted.target.toString(16)}</code>.
          Power-cycle the radio (or click Reboot, then reconnect). Watch the
          splash: if the <strong>top half</strong> of the display is now{" "}
          <strong>solid white</strong>, click <em>Splash changed</em>. Otherwise
          click <em>Splash unchanged</em>.
        </p>
      ) : null}

      {error ? (
        <p
          style={{
            marginTop: 16,
            color: "#c0392b",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </p>
      ) : null}

      {log.length > 0 ? (
        <pre
          style={{
            marginTop: 16,
            padding: 10,
            background: "var(--border)",
            borderRadius: 6,
            fontSize: 12,
            maxHeight: 240,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {log.join("\n")}
        </pre>
      ) : null}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 20,
        marginTop: 20,
      }}
    >
      {children}
    </section>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isValidPersisted(x: unknown): x is PersistedState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.phase === "string" &&
    typeof o.firmwareVersion === "string" &&
    (o.target === ADDR_A || o.target === ADDR_B) &&
    typeof o.originalAB64 === "string" &&
    typeof o.originalBB64 === "string" &&
    typeof o.capturedAt === "string"
  );
}

function countMatchingPrefix(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

function shortHash(bytes: Uint8Array): string {
  // Cheap FNV-1a; not crypto, just a fingerprint for the log.
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
