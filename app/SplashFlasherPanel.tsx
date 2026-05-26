"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./SessionContext";
import {
  PIXEL_BYTES,
  WIDTH,
  HEIGHT,
  packPageMajor,
  unpackPageMajor,
  type RowBitmap,
} from "../src/splash/bitmap";
import { generateBaseTemplate } from "../src/splash/template";
import { MAX_CALLSIGN_LEN, renderBadge, toPreviewImageData } from "../src/splash/render";

// Boot-logo sector layout per briand's ui/welcome.c:36-46:
//   [0xC000..0xC007] 8-byte header (reserved for future magic/version/flags)
//   [0xC008..0xC407] 128x64 monochrome bitmap, 1024 B, page-major LSB-top
// The firmware blits from physical 0x011008 (= virtual 0xC008) when
// POWER_ON_DISPLAY_MODE == POWER_ON_DISPLAY_MODE_LOGO (ui/welcome.c:247-259).
const BOOT_LOGO_HEADER_ADDR = 0xc000;
const BOOT_LOGO_BITMAP_ADDR = 0xc008;
const BOOT_LOGO_HEADER_SIZE = 8;
const BOOT_LOGO_SIZE = PIXEL_BYTES; // 1024

// POWER_ON_DISPLAY_MODE byte 7 of the 8-byte settings block at physical
// 0x00A0A8 (briand settings.c:255,265). Virtual == physical inside the
// settings region per eeprom_compat.c:56.
const MODE_BLOCK_ADDR = 0x00a0a8;
const MODE_BLOCK_LEN = 8;
const MODE_BYTE_INDEX = 7;
// settings.h:28-41 with ENABLE_FEAT_F4HWN + ENABLE_FEAT_F4HWN_LOGO defined.
// NR7Y v1.0.0 has both flags set (verified in App/CMakeLists.txt:215,249).
const MODE_LOGO = 4;

const STORAGE_KEY = "bkg-splash-flasher-state";
const PREVIEW_ZOOM = 3;

// Per-chunk timeout for boot-logo writes. briand's PY25Q16_WriteBuffer
// erases + reprograms the full 4 KiB sector on every 8-byte sub-write
// where new bytes differ from cache and cache has non-0xFF content.
// Theoretical: 31 sub-writes × 300 ms erase ≈ 10 s per 248-byte chunk.
// Observed on real K1+NR7Y hardware (2026-05-25): well over 30 s per
// chunk — actual erase time is closer to 1 s on this chip, or main-loop
// contention during the 31-sub-write busy block stretches wall time
// 3-5×. 120 s leaves margin without making "stuck" cases unrecoverable.
const BITMAP_WRITE_TIMEOUT_MS = 120_000;
// Settings region writes don't have the same amplification (most bytes are
// already non-0xFF settings, but only one or two erases needed for a 16- or
// 8-byte write at most).
const SETTINGS_WRITE_TIMEOUT_MS = 10_000;

type Phase =
  | "idle"
  // Backup snapshot persisted to localStorage but the write did not
  // complete (yet, or at all). Restore is available to revert any partial
  // write; Write button is disabled to avoid re-backing-up over the
  // existing snapshot. Reach this phase by entering saveOriginalAndWrite
  // and having any subsequent step fail before the final save.
  | "saved"
  | "written"
  | "reported-changed"
  | "reported-unchanged"
  | "restored";

interface PersistedState {
  phase: Phase;
  firmwareVersion: string;
  // base64 of the 1024 bytes at 0xC008 before any write (the bitmap content
  // that the firmware actually renders — header at 0xC000 is left alone).
  originalBitmapB64: string;
  // base64 of the original 8-byte settings block at 0x00A0A8.
  originalModeBlockB64: string;
  // base64 of the 1024 bytes we wrote (page-major packed BKG badge).
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

  // Render the static base template once on mount. Generated in-canvas
  // (see src/splash/template.ts) — no external asset to fetch.
  useEffect(() => {
    try {
      setTemplate(generateBaseTemplate());
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : String(err));
    }
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
      `Probe: reading bitmap region 0x${BOOT_LOGO_BITMAP_ADDR.toString(16)} ` +
        `(${BOOT_LOGO_SIZE} bytes, skipping 8-byte header at 0x${BOOT_LOGO_HEADER_ADDR.toString(16)})…`,
    );
    const bytes = await session.readEeprom(BOOT_LOGO_BITMAP_ADDR, BOOT_LOGO_SIZE);
    const allFF = bytes.every((b) => b === 0xff);
    const all00 = bytes.every((b) => b === 0x00);
    setProbeBytesB64(bytesToBase64(bytes));
    pushLog(
      `Probe complete. hash=${shortHash(bytes)}` +
        (allFF ? " (all 0xFF — sector erased, no bitmap present yet)" : "") +
        (all00 ? " (all 0x00 — region zero, possibly never written)" : "") +
        ".",
    );
  }

  async function saveOriginalAndWrite() {
    if (!session || !previewBitmap) throw new Error("not ready");

    // Step 1: backup the bitmap bytes (so Restore can undo) AND the settings
    // block (so we know the current mode and can restore it too).
    pushLog(
      `Reading 0x${BOOT_LOGO_BITMAP_ADDR.toString(16)} (${BOOT_LOGO_SIZE} bytes) for bitmap backup…`,
    );
    const originalBitmap = await session.readEeprom(BOOT_LOGO_BITMAP_ADDR, BOOT_LOGO_SIZE);
    pushLog(`Bitmap captured. hash=${shortHash(originalBitmap)}.`);

    pushLog(
      `Reading 0x${MODE_BLOCK_ADDR.toString(16)} (${MODE_BLOCK_LEN} bytes) for settings backup…`,
    );
    const originalModeBlock = await session.readEeprom(MODE_BLOCK_ADDR, MODE_BLOCK_LEN);
    const currentMode = originalModeBlock[MODE_BYTE_INDEX]!;
    pushLog(
      `Settings block captured. Current POWER_ON_DISPLAY_MODE = 0x${currentMode
        .toString(16)
        .padStart(2, "0")} (${currentMode}).`,
    );

    // Step 2: write the bitmap to 0xC008. The 8-byte header at 0xC000 is
    // preserved automatically — briand's PY25Q16_WriteBuffer caches the
    // whole 4 KiB sector before erase/reprogram, so untouched bytes
    // round-trip through cache. (We do NOT write to 0xC000-0xC007 ourselves.)
    const packed = packPageMajor(previewBitmap);

    // Persist the backup snapshot NOW, before any write. If any step below
    // fails (write timeout, verify mismatch, mode-flip failure), Restore
    // still has the original bytes to revert with. Without this, a
    // mid-write failure would lose the original bitmap entirely — the
    // radio's copy is overwritten and we'd never have written ours to disk.
    const snapshotFields = {
      firmwareVersion,
      originalBitmapB64: bytesToBase64(originalBitmap),
      originalModeBlockB64: bytesToBase64(originalModeBlock),
      writtenBytesB64: bytesToBase64(packed),
      callsign: callsign.trim().toUpperCase(),
      bkgNum: Number.parseInt(bkgNumText, 10),
      invert,
      capturedAt: new Date().toISOString(),
    };
    save({ phase: "saved", ...snapshotFields });
    pushLog("Backup snapshot persisted. Restore is now available if anything below fails.");

    // Largest data payload that fits in the firmware's 256-byte UART
    // buffer alongside the WRITE_EEPROM framing + 12-byte header. 248
    // overflows and the firmware rejects the frame silently. See
    // session.ts writeEeprom for the full derivation.
    const CHUNK = 0xe8; // 232 bytes
    const chunkCount = Math.ceil(packed.length / CHUNK);
    pushLog(
      `Writing badge to 0x${BOOT_LOGO_BITMAP_ADDR.toString(16)} in ` +
        `${chunkCount} chunks of up to ${CHUNK} bytes. Each chunk triggers ` +
        `up to 31 flash sector erases — expect 10-60 s per chunk. ` +
        `Per-chunk timeout: ${BITMAP_WRITE_TIMEOUT_MS / 1000} s. Do not unplug.`,
    );

    try {
      for (let i = 0; i < chunkCount; i++) {
        const offset = i * CHUNK;
        const size = Math.min(CHUNK, packed.length - offset);
        const t0 = Date.now();
        pushLog(`  chunk ${i + 1}/${chunkCount}: writing ${size} bytes at 0x${(BOOT_LOGO_BITMAP_ADDR + offset).toString(16)}…`);
        await session.writeEeprom(
          BOOT_LOGO_BITMAP_ADDR + offset,
          packed.subarray(offset, offset + size),
          { timeoutMs: BITMAP_WRITE_TIMEOUT_MS },
        );
        pushLog(`  chunk ${i + 1}/${chunkCount}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
    } catch (err) {
      pushLog(
        `Write failed (${err instanceof Error ? err.message : String(err)}). ` +
          `Reading back for diagnostic…`,
      );
      try {
        const diag = await session.readEeprom(BOOT_LOGO_BITMAP_ADDR, BOOT_LOGO_SIZE);
        if (bytesEq(diag, packed)) {
          pushLog("Diagnostic: badge IS present. Reply was lost; treating as success.");
        } else if (bytesEq(diag, originalBitmap)) {
          pushLog("Diagnostic: still original bytes. Write was rejected at flash level.");
        } else {
          pushLog(
            `Diagnostic: partial write. hash=${shortHash(diag)}, ` +
              `matching prefix=${countMatchingPrefix(diag, packed)} bytes.`,
          );
        }
      } catch (readErr) {
        pushLog(
          `Diagnostic read also failed: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
        );
      }
      throw err;
    }

    pushLog(`Reading back 0x${BOOT_LOGO_BITMAP_ADDR.toString(16)} to verify bitmap…`);
    const readback = await session.readEeprom(BOOT_LOGO_BITMAP_ADDR, BOOT_LOGO_SIZE);
    if (!bytesEq(readback, packed)) {
      throw new Error(
        `Bitmap read-back mismatch (${countMatchingPrefix(readback, packed)} of ` +
          `${packed.length} bytes match prefix). Write did not land cleanly.`,
      );
    }
    pushLog("Bitmap verified.");

    // Step 3: flip POWER_ON_DISPLAY_MODE to LOGO (0x04). Read-modify-write
    // the 8-byte settings block so we don't clobber the 7 other settings.
    if (currentMode === MODE_LOGO) {
      pushLog("Mode is already LOGO (0x04). Skipping settings write.");
    } else {
      const newModeBlock = new Uint8Array(originalModeBlock);
      newModeBlock[MODE_BYTE_INDEX] = MODE_LOGO;
      pushLog(
        `Writing settings block to flip POWER_ON_DISPLAY_MODE → 0x${MODE_LOGO.toString(16).padStart(2, "0")} (LOGO)…`,
      );
      await session.writeEeprom(MODE_BLOCK_ADDR, newModeBlock, {
        timeoutMs: SETTINGS_WRITE_TIMEOUT_MS,
      });
      pushLog(`Verifying settings block…`);
      const modeReadback = await session.readEeprom(MODE_BLOCK_ADDR, MODE_BLOCK_LEN);
      if (modeReadback[MODE_BYTE_INDEX] !== MODE_LOGO) {
        throw new Error(
          `Mode-byte verify mismatch. Wrote 0x${MODE_LOGO.toString(16)}, read back ` +
            `0x${modeReadback[MODE_BYTE_INDEX]!.toString(16)}. ` +
            `Bitmap is written but mode flip failed; original mode preserved in snapshot.`,
        );
      }
      pushLog("Mode set to LOGO. Reboot to see the BKG splash.");
    }

    save({ phase: "written", ...snapshotFields });
  }

  async function rebootRadio() {
    if (!session) throw new Error("not connected");
    pushLog("Sending reboot command (0x05DD). Session will close — reconnect after radio boots.");
    await session.reboot();
  }

  function reportChanged() {
    if (!persisted) return;
    save({ ...persisted, phase: "reported-changed" });
    pushLog(`Reported: splash CHANGED. BKG bitmap is live on boot.`);
  }

  function reportUnchanged() {
    if (!persisted) return;
    save({ ...persisted, phase: "reported-unchanged" });
    pushLog(
      `Reported: splash UNCHANGED. Possibilities: ` +
        `(a) wrong polarity — try the invert toggle and re-flash; ` +
        `(b) firmware build doesn't have ENABLE_FEAT_F4HWN_LOGO compiled in (check version string vs NR7Y v1.0.0+); ` +
        `(c) mode byte didn't actually take (read back 0x00A0AF and check it equals 0x04).`,
    );
  }

  async function restoreOriginal() {
    if (!session || !persisted) throw new Error("not ready");
    const originalBitmap = base64ToBytes(persisted.originalBitmapB64);
    const originalModeBlock = base64ToBytes(persisted.originalModeBlockB64);

    pushLog(
      `Restoring original bitmap to 0x${BOOT_LOGO_BITMAP_ADDR.toString(16)} (slow)…`,
    );
    {
      const CHUNK = 0xe8; // 232 bytes — see WRITE_EEPROM buffer-size note above
      const chunkCount = Math.ceil(originalBitmap.length / CHUNK);
      for (let i = 0; i < chunkCount; i++) {
        const offset = i * CHUNK;
        const size = Math.min(CHUNK, originalBitmap.length - offset);
        const t0 = Date.now();
        pushLog(`  chunk ${i + 1}/${chunkCount}: writing ${size} bytes…`);
        await session.writeEeprom(
          BOOT_LOGO_BITMAP_ADDR + offset,
          originalBitmap.subarray(offset, offset + size),
          { timeoutMs: BITMAP_WRITE_TIMEOUT_MS },
        );
        pushLog(`  chunk ${i + 1}/${chunkCount}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
    }
    const bitmapReadback = await session.readEeprom(BOOT_LOGO_BITMAP_ADDR, BOOT_LOGO_SIZE);
    if (!bytesEq(bitmapReadback, originalBitmap)) {
      throw new Error(
        "Bitmap restore verify failed. Snapshot preserved in localStorage; retry.",
      );
    }
    pushLog("Bitmap restored.");

    pushLog(`Restoring original settings block to 0x${MODE_BLOCK_ADDR.toString(16)}…`);
    await session.writeEeprom(MODE_BLOCK_ADDR, originalModeBlock, {
      timeoutMs: SETTINGS_WRITE_TIMEOUT_MS,
    });
    const modeReadback = await session.readEeprom(MODE_BLOCK_ADDR, MODE_BLOCK_LEN);
    if (!bytesEq(modeReadback, originalModeBlock)) {
      throw new Error("Settings block restore verify failed.");
    }
    pushLog(
      `Settings restored. POWER_ON_DISPLAY_MODE back to 0x${originalModeBlock[MODE_BYTE_INDEX]!.toString(16).padStart(2, "0")}. Reboot to confirm.`,
    );
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
        it to the bitmap region at{" "}
        <code>0x{BOOT_LOGO_BITMAP_ADDR.toString(16)}</code>{" "}
        ({BOOT_LOGO_SIZE} bytes, page-major LSB-top). Then flips{" "}
        <code>POWER_ON_DISPLAY_MODE</code> to <em>LOGO</em> (0x
        {MODE_LOGO.toString(16).padStart(2, "0")}) so the firmware actually
        renders it on boot. Backs up the previous bitmap + mode-byte first
        so Restore can revert.
      </p>

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
        <strong>Slow write — be patient.</strong> briand&apos;s{" "}
        <code>PY25Q16_WriteBuffer</code> erases + reprograms the full 4 KiB
        flash sector on every 8-byte sub-write where the cache has any
        non-<code>0xFF</code> byte. Overwriting the MINI KONG bitmap is 128
        sub-writes split across 5 protocol chunks. Observed on real K1
        hardware: each chunk can take up to ~60 s; the full write may run{" "}
        <strong>2-5 minutes</strong>. Per-chunk timeout is{" "}
        {(BITMAP_WRITE_TIMEOUT_MS / 1000).toFixed(0)} s; progress is logged
        chunk-by-chunk so you can see it isn&apos;t stuck. Do not unplug
        or power-cycle the radio while writing. Confirmed against{" "}
        <code>App/driver/py25q16.c:253-332</code> +{" "}
        <code>App/driver/eeprom_compat.c:100-119</code>. A firmware-side
        bulk-write opcode would collapse this to ~1 s; see CLAUDE.md.
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>Probe (non-destructive)</strong>
          <button onClick={() => runStep(probeRead)} disabled={busy}>
            Read 0x{BOOT_LOGO_BITMAP_ADDR.toString(16)} + preview
          </button>
        </div>
        <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: "var(--muted)" }}>
          Reads the 1024 bytes at the bitmap address (skipping the 8-byte
          header at <code>0x{BOOT_LOGO_HEADER_ADDR.toString(16)}</code>) and
          renders them in both polarities. On a fresh NR7Y radio you should
          see briand&apos;s MINI KONG / BIG MINI KONG default logo here.
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
            (phase !== "saved" &&
              phase !== "written" &&
              phase !== "reported-changed" &&
              phase !== "reported-unchanged")
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
            Original bitmap hash:{" "}
            <code>{shortHash(base64ToBytes(persisted.originalBitmapB64))}</code>
            <br />
            Original mode block:{" "}
            <code>
              {Array.from(base64ToBytes(persisted.originalModeBlockB64), (b) =>
                b.toString(16).padStart(2, "0"),
              ).join("")}
            </code>{" "}
            (POWER_ON_DISPLAY_MODE = 0x
            {base64ToBytes(persisted.originalModeBlockB64)[MODE_BYTE_INDEX]!
              .toString(16)
              .padStart(2, "0")}
            )
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
    typeof o.originalBitmapB64 === "string" &&
    typeof o.originalModeBlockB64 === "string" &&
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
