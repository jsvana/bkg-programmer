"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./SessionContext";
import { decodeMonoBmp } from "../src/splash/bmp";
import {
  PIXEL_BYTES,
  WIDTH,
  HEIGHT,
  packPageMajor,
  unpackPageMajor,
  type RowBitmap,
} from "../src/splash/bitmap";
import { MAX_CALLSIGN_LEN, renderBadge, toPreviewImageData } from "../src/splash/render";

const BOOT_LOGO_ADDR = 0xc000;
const BOOT_LOGO_SIZE = PIXEL_BYTES; // 1024
const STORAGE_KEY = "bkg-splash-flasher-state";
const PREVIEW_ZOOM = 3;
const WRITE_TIMEOUT_MS = 10_000;

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
  // base64 of the 1024 bytes read from 0xC000 before any write.
  originalBytesB64: string;
  // base64 of the 1024 bytes we wrote (page-major packed).
  writtenBytesB64: string;
  callsign: string;
  bkgNum: number;
  invert: boolean;
  capturedAt: string;
}

export function SplashFlasherPanel() {
  const { state } = useSession();
  const [persisted, setPersisted] = useState<PersistedState | null>(null);
  const [callsign, setCallsign] = useState("");
  const [bkgNumText, setBkgNumText] = useState("");
  const [invert, setInvert] = useState(false);
  const [template, setTemplate] = useState<RowBitmap | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  // Most-recent read of 0xC000, kept in component state (not persisted) so a
  // page reload doesn't accidentally make stale bytes look authoritative.
  const [probeBytesB64, setProbeBytesB64] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load the base template once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/bkg_base_template.bmp");
        if (!res.ok) throw new Error(`fetch ${res.status} ${res.statusText}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const decoded = decodeMonoBmp(bytes);
        if (!cancelled) setTemplate(decoded);
      } catch (err) {
        if (!cancelled) {
          setTemplateError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hydrate persisted state.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (isValidPersisted(parsed)) {
        setPersisted(parsed);
        setCallsign(parsed.callsign);
        setBkgNumText(String(parsed.bkgNum));
        setInvert(parsed.invert);
      } else {
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

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev, line]);
  }, []);

  // Live-rendered preview from the form inputs.
  const previewBitmap = useMemo<RowBitmap | null>(() => {
    if (!template) return null;
    if (typeof document === "undefined") return null;
    const trimmed = callsign.trim().toUpperCase();
    const num = Number.parseInt(bkgNumText, 10);
    if (!trimmed || trimmed.length > MAX_CALLSIGN_LEN) return null;
    if (!Number.isFinite(num) || num < 0) return null;
    try {
      return renderBadge(template, trimmed, num, { invert });
    } catch {
      return null;
    }
  }, [template, callsign, bkgNumText, invert]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !previewBitmap) return;
    canvas.width = WIDTH * PREVIEW_ZOOM;
    canvas.height = HEIGHT * PREVIEW_ZOOM;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(toPreviewImageData(previewBitmap, PREVIEW_ZOOM), 0, 0);
  }, [previewBitmap]);

  const connected = state.kind === "connected";
  const session = connected ? state.session : null;
  const firmwareVersion = connected ? state.result.hello.versionString : "";
  const profileId =
    connected && state.result.firmware.kind === "matched"
      ? state.result.firmware.entry.profileId
      : undefined;

  if (!connected || profileId !== "uv-k1-f4hwn-nr7y") return null;

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

  async function probeRead() {
    if (!session) throw new Error("not connected");
    pushLog(
      `Probe: reading 0x${BOOT_LOGO_ADDR.toString(16)} (${BOOT_LOGO_SIZE} bytes) without writing…`,
    );
    const bytes = await session.readEeprom(BOOT_LOGO_ADDR, BOOT_LOGO_SIZE);
    const allFF = bytes.every((b) => b === 0xff);
    const all00 = bytes.every((b) => b === 0x00);
    setProbeBytesB64(bytesToBase64(bytes));
    pushLog(
      `Probe complete. hash=${shortHash(bytes)}` +
        (allFF ? " (all 0xFF — region unmapped)" : "") +
        (all00 ? " (all 0x00 — region zero, possibly never written)" : "") +
        ".",
    );
  }

  async function saveOriginalAndWrite() {
    if (!session || !previewBitmap) throw new Error("not ready");
    pushLog(
      `Reading 0x${BOOT_LOGO_ADDR.toString(16)} (${BOOT_LOGO_SIZE} bytes) for backup…`,
    );
    const original = await session.readEeprom(BOOT_LOGO_ADDR, BOOT_LOGO_SIZE);
    pushLog(`Original captured. hash=${shortHash(original)}.`);

    const packed = packPageMajor(previewBitmap);
    pushLog(
      `Writing badge to 0x${BOOT_LOGO_ADDR.toString(16)} ` +
        `(${packed.length} bytes, ${WRITE_TIMEOUT_MS}ms/chunk timeout)…`,
    );

    try {
      await session.writeEeprom(BOOT_LOGO_ADDR, packed, { timeoutMs: WRITE_TIMEOUT_MS });
    } catch (err) {
      pushLog(
        `Write call failed (${err instanceof Error ? err.message : String(err)}). ` +
          `Reading back for diagnostic…`,
      );
      try {
        const diag = await session.readEeprom(BOOT_LOGO_ADDR, BOOT_LOGO_SIZE);
        if (bytesEq(diag, packed)) {
          pushLog("Diagnostic read: badge IS present. Write landed; reply lost/slow.");
        } else if (bytesEq(diag, original)) {
          pushLog(
            "Diagnostic read: still original bytes. Write was rejected (region may be write-protected on this firmware build — same behavior as stock K1).",
          );
        } else {
          pushLog(
            `Diagnostic read: partial. hash=${shortHash(diag)}. ` +
              `Matching prefix=${countMatchingPrefix(diag, packed)} bytes.`,
          );
        }
      } catch (readErr) {
        pushLog(
          `Diagnostic read also failed: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
        );
      }
      throw err;
    }

    pushLog(`Reading back 0x${BOOT_LOGO_ADDR.toString(16)} to verify…`);
    const readback = await session.readEeprom(BOOT_LOGO_ADDR, BOOT_LOGO_SIZE);
    if (!bytesEq(readback, packed)) {
      throw new Error(
        `Read-back mismatch (${countMatchingPrefix(readback, packed)} of ${packed.length} bytes match prefix). ` +
          `Write did not land cleanly.`,
      );
    }
    pushLog("Read-back matches. Power-cycle or click Reboot to see the new splash.");

    const num = Number.parseInt(bkgNumText, 10);
    save({
      phase: "written",
      firmwareVersion,
      originalBytesB64: bytesToBase64(original),
      writtenBytesB64: bytesToBase64(packed),
      callsign: callsign.trim().toUpperCase(),
      bkgNum: num,
      invert,
      capturedAt: new Date().toISOString(),
    });
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
      `Reported: splash CHANGED. Firmware reads from 0x${BOOT_LOGO_ADDR.toString(16)}.`,
    );
  }

  function reportUnchanged() {
    if (!persisted) return;
    save({ ...persisted, phase: "reported-unchanged" });
    pushLog(
      `Reported: splash UNCHANGED. Possibilities: ` +
        `(a) wrong polarity — try the invert toggle and re-flash; ` +
        `(b) wrong base address — boot logo may live somewhere else in 0xC000-0xCFFF; ` +
        `(c) firmware caches or expects a different byte layout.`,
    );
  }

  async function restoreOriginal() {
    if (!session || !persisted) throw new Error("not ready");
    const original = base64ToBytes(persisted.originalBytesB64);
    pushLog(`Restoring original bytes to 0x${BOOT_LOGO_ADDR.toString(16)}…`);
    await session.writeEeprom(BOOT_LOGO_ADDR, original, { timeoutMs: WRITE_TIMEOUT_MS });
    const readback = await session.readEeprom(BOOT_LOGO_ADDR, BOOT_LOGO_SIZE);
    if (!bytesEq(readback, original)) {
      throw new Error("Restore verify failed. Original bytes still stored in localStorage.");
    }
    pushLog("Restore verified. Power-cycle to confirm splash is back to original.");
    save({ ...persisted, phase: "restored" });
  }

  function clearState() {
    save(null);
    setLog([]);
  }

  const phase: Phase = persisted?.phase ?? "idle";
  const callsignValid =
    callsign.trim().length > 0 && callsign.trim().length <= MAX_CALLSIGN_LEN;
  const bkgNumParsed = Number.parseInt(bkgNumText, 10);
  const bkgNumValid = Number.isFinite(bkgNumParsed) && bkgNumParsed >= 0;
  const canWrite =
    !busy &&
    template !== null &&
    callsignValid &&
    bkgNumValid &&
    previewBitmap !== null &&
    (phase === "idle" || phase === "restored");

  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18 }}>BKG splash flasher (uv-k1-f4hwn-nr7y)</h2>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>
        Renders a 128×64 BKG badge from your callsign + BKG number and writes
        it to the boot logo region at <code>0x{BOOT_LOGO_ADDR.toString(16)}</code>{" "}
        ({BOOT_LOGO_SIZE} bytes, page-major LSB-top). Backs up the existing
        bytes first so Restore can put things back.
      </p>

      <div
        style={{
          marginTop: 12,
          padding: 10,
          border: "1px solid #c0392b",
          background: "rgba(192, 57, 43, 0.10)",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <strong>This write path is blocked on most NR7Y builds.</strong>{" "}
        briand <em>does</em> have a bitmap-splash code path at{" "}
        <code>ui/welcome.c:247-259</code>: when{" "}
        <code>POWER_ON_DISPLAY_MODE == POWER_ON_DISPLAY_MODE_LOGO</code>, it
        reads a 128×64 bitmap from physical{" "}
        <code>0x011008</code> (= virtual <code>0xC008</code>, after an
        8-byte header). However: (1) it&apos;s gated on{" "}
        <code>#ifdef ENABLE_FEAT_F4HWN_LOGO</code>, which may or may not be
        set in the build you flashed; (2) protocol-level writes to{" "}
        <code>0x{BOOT_LOGO_ADDR.toString(16)}</code> hit briand&apos;s
        per-8-byte sector-erase amplification — each 8-byte sub-write
        triggers a fresh 4 KiB erase + reprogram when the existing sector
        has non-<code>0xFF</code> data, which makes a 248-byte chunk take
        ~10 s and times out our request. Even if the build has the LOGO
        feature, the write needs a multi-minute timeout to land. Fix is
        firmware-side: a contiguous bitmap write path that erases once
        and programs the sector in bulk.
      </div>

      {templateError ? (
        <p style={{ marginTop: 12, color: "#c0392b", fontSize: 13 }}>
          Failed to load template: <code>{templateError}</code>
        </p>
      ) : null}

      <div
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid var(--border)",
          borderRadius: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong style={{ fontSize: 13 }}>Probe (non-destructive)</strong>
          <button onClick={() => runStep(probeRead)} disabled={busy}>
            Read 0x{BOOT_LOGO_ADDR.toString(16)} + preview
          </button>
        </div>
        <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: "var(--muted)" }}>
          Reads the 1024 bytes at the boot logo address and renders them
          both as page-major LSB-top bitmaps. If <em>either</em> rendering
          looks like a recognizable logo, the address + layout are right
          and the only barrier is write-protection. If both look like
          noise, the bitmap lives somewhere else (or in a different byte
          format) on this firmware.
        </p>
        {probeBytesB64 ? (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              alignItems: "flex-start",
            }}
          >
            <ProbeRender b64={probeBytesB64} invert={false} label="As-is" />
            <ProbeRender b64={probeBytesB64} invert={true} label="Inverted" />
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <label style={{ fontSize: 13 }}>
          Callsign (max {MAX_CALLSIGN_LEN}):
          <input
            type="text"
            value={callsign}
            onChange={(e) => setCallsign(e.target.value)}
            disabled={busy || phase !== "idle"}
            maxLength={MAX_CALLSIGN_LEN}
            placeholder="W6JY"
            style={{ marginLeft: 8, width: "100%", marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          BKG number:
          <input
            type="number"
            value={bkgNumText}
            onChange={(e) => setBkgNumText(e.target.value)}
            disabled={busy || phase !== "idle"}
            min={0}
            placeholder="42"
            style={{ marginLeft: 8, width: "100%", marginTop: 4 }}
          />
        </label>
      </div>

      <label style={{ marginTop: 8, fontSize: 13, display: "inline-flex", gap: 6 }}>
        <input
          type="checkbox"
          checked={invert}
          onChange={(e) => setInvert(e.target.checked)}
          disabled={busy || phase !== "idle"}
        />
        Invert polarity (try this if the splash comes up reversed)
      </label>

      <div style={{ marginTop: 16 }}>
        <strong style={{ fontSize: 13 }}>Preview ({WIDTH}×{HEIGHT}, ×{PREVIEW_ZOOM}):</strong>
        <div
          style={{
            marginTop: 6,
            padding: 8,
            background: "var(--border)",
            borderRadius: 6,
            display: "inline-block",
          }}
        >
          {previewBitmap ? (
            <canvas
              ref={previewCanvasRef}
              style={{ display: "block", imageRendering: "pixelated" }}
            />
          ) : (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Fill in callsign and BKG number to preview.
            </span>
          )}
        </div>
      </div>

      {persisted ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          Saved {persisted.capturedAt} (firmware{" "}
          <code>{persisted.firmwareVersion}</code>, callsign{" "}
          <code>{persisted.callsign}</code>, #{persisted.bkgNum}
          {persisted.invert ? ", inverted" : ""}). Phase:{" "}
          <strong>{phase}</strong>.
        </p>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => runStep(saveOriginalAndWrite)} disabled={!canWrite}>
          1. Backup + write badge
        </button>
        <button
          className="secondary"
          onClick={() => runStep(rebootRadio)}
          disabled={busy || phase !== "written"}
        >
          2. Reboot radio
        </button>
        <button onClick={reportChanged} disabled={busy || phase !== "written"}>
          3a. Splash changed
        </button>
        <button onClick={reportUnchanged} disabled={busy || phase !== "written"}>
          3b. Splash unchanged
        </button>
        <button
          onClick={() => runStep(restoreOriginal)}
          disabled={
            busy ||
            (phase !== "reported-changed" &&
              phase !== "reported-unchanged" &&
              phase !== "written")
          }
        >
          4. Restore original
        </button>
        <button className="secondary" onClick={clearState} disabled={busy}>
          Reset
        </button>
      </div>

      {phase === "written" && persisted ? (
        <p style={{ marginTop: 12, fontSize: 13 }}>
          Badge written. Power-cycle the radio (or click Reboot, then
          reconnect). Watch the splash on boot. If you see the BKG badge with{" "}
          <code>{persisted.callsign}</code> / #{persisted.bkgNum} on the right,
          click <em>Splash changed</em>. If it looks wrong or unchanged, click{" "}
          <em>Splash unchanged</em> and try the invert toggle.
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

      {persisted && phase !== "idle" ? (
        <details style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          <summary>Diagnostics</summary>
          <p>
            Original hash:{" "}
            <code>{shortHash(base64ToBytes(persisted.originalBytesB64))}</code>
            <br />
            Written hash:{" "}
            <code>{shortHash(base64ToBytes(persisted.writtenBytesB64))}</code>
            <br />
            Round-trip preview (decoded from the bytes we wrote):
          </p>
          <RoundTripPreview b64={persisted.writtenBytesB64} />
        </details>
      ) : null}
    </Section>
  );
}

function ProbeRender({
  b64,
  invert,
  label,
}: {
  b64: string;
  invert: boolean;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = WIDTH * PREVIEW_ZOOM;
    canvas.height = HEIGHT * PREVIEW_ZOOM;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = unpackPageMajor(base64ToBytes(b64));
    ctx.putImageData(toPreviewImageData(buf, PREVIEW_ZOOM, invert), 0, 0);
  }, [b64, invert]);
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
        {label}
      </div>
      <canvas
        ref={ref}
        style={{
          display: "block",
          imageRendering: "pixelated",
          background: "var(--border)",
          padding: 4,
          borderRadius: 4,
        }}
      />
    </div>
  );
}

function RoundTripPreview({ b64 }: { b64: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = WIDTH * PREVIEW_ZOOM;
    canvas.height = HEIGHT * PREVIEW_ZOOM;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = unpackPageMajor(base64ToBytes(b64));
    ctx.putImageData(toPreviewImageData(buf, PREVIEW_ZOOM), 0, 0);
  }, [b64]);
  return (
    <canvas
      ref={ref}
      style={{ display: "block", imageRendering: "pixelated", marginTop: 4 }}
    />
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
    typeof o.originalBytesB64 === "string" &&
    typeof o.writtenBytesB64 === "string" &&
    typeof o.callsign === "string" &&
    typeof o.bkgNum === "number" &&
    typeof o.invert === "boolean" &&
    typeof o.capturedAt === "string"
  );
}

function countMatchingPrefix(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

function shortHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
