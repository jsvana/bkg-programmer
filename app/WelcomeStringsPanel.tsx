"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "./SessionContext";
import { TechDetails } from "./ui";

// On K1+briand (and NR7Y, which is built on top), the firmware does NOT use
// the V1-style logical addresses for the welcome region. Verified against
// briand/uv-k1-k5v3-firmware-custom:
//
//   App/ui/welcome.c:278-281
//     PY25Q16_ReadBuffer(0x00A0C8, WelcomeString0, 16);   // bypasses AddrTranslate
//     PY25Q16_ReadBuffer(0x00A0D8, WelcomeString1, 16);
//
//   App/settings.c:255,265
//     PY25Q16_ReadBuffer(0x00A0A8, Data, 8);
//     gEeprom.POWER_ON_DISPLAY_MODE = (Data[7] < 6) ? Data[7] : VOLTAGE;
//
// Both reads are direct PY25Q16 (physical) reads. To target those same flash
// bytes through the WRITE_EEPROM (0x051D) protocol we use the virtual address
// that AddrTranslate maps identity-onto in the settings region:
//
//   App/driver/eeprom_compat.c:56  _MK_MAPPING(0x00A000, 0x00A000, 0x00A170)
//   → virtual 0x00A000-0x00A170 → physical 0x00A000-0x00A170 (1:1)
//
// Hardware-confirmed 2026-05-25 that the V1-style addresses 0x0EB0/0x0EC0/0x0E90
// route to the channels region on K1+briand (writes persist there but
// welcome.c never reads them) — they were the original guess and they
// silently miss the firmware's actual read path.
const WELCOME0_ADDR = 0x00a0c8;
const WELCOME1_ADDR = 0x00a0d8;
const WELCOME_LEN = 16;
const DISPLAY_MODE_BLOCK_ADDR = 0x00a0a8;
const DISPLAY_MODE_BLOCK_LEN = 8;
const DISPLAY_MODE_BYTE_INDEX = 7;

// settings.h:30-37 — NB the order differs by enum branch (one has 6 values,
// the other has 4). We surface all six; the firmware clamps anything >=6 to
// VOLTAGE on load (settings.c:145).
// Plain-language labels use the F4HWN interpretation of POWER_ON_DISPLAY_MODE
// — this panel only shows for F4HWN-based profiles, so that's the meaning that
// applies. Technical (dual-build) detail lives in the "Technical detail"
// expander in the panel body.
const DISPLAY_MODES: ReadonlyArray<{ value: number; label: string; hint: string }> = [
  { value: 0, label: "Your text, plus voltage and version", hint: "Shows both lines of your text along with the firmware version and battery voltage." },
  { value: 1, label: "Blank screen with a beep", hint: "No text — just a startup beep." },
  { value: 2, label: "Your text only", hint: "Shows your two lines and nothing else." },
  { value: 3, label: "Battery voltage (hides your text)", hint: "Replaces your text with the battery voltage on boot." },
  { value: 4, label: "Logo image", hint: "Shows a custom logo image instead of text (only on firmware that supports it)." },
  { value: 5, label: "Blank screen", hint: "Nothing shown on boot." },
];

const STORAGE_KEY = "bkg-welcome-strings-state";

interface SnapshotState {
  capturedAt: string;
  firmwareVersion: string;
  welcome0Hex: string;        // hex of original 16 bytes
  welcome1Hex: string;
  displayModeBlockHex: string; // hex of original 8 bytes at 0x0E90
}

export function WelcomeStringsPanel() {
  const { state } = useSession();

  const [snapshot, setSnapshot] = useState<SnapshotState | null>(null);
  const [welcome0, setWelcome0] = useState("");
  const [welcome1, setWelcome1] = useState("");
  const [displayMode, setDisplayMode] = useState<number>(0);
  const [displayModeBlock, setDisplayModeBlock] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (isValidSnapshot(parsed)) setSnapshot(parsed);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev, line]);
  }, []);

  const connected = state.kind === "connected";
  const session = connected ? state.session : null;
  const firmwareVersion = connected ? state.result.hello.versionString : "";
  const profileId =
    connected && state.result.firmware.kind === "matched"
      ? state.result.firmware.entry.profileId
      : undefined;

  // Show on any F4HWN-based profile; the welcome addresses are the same.
  const visibleProfiles = new Set(["uv-k1-f4hwn-nr7y", "uv-k5-v1-f4hwn"]);
  if (!connected || !profileId || !visibleProfiles.has(profileId)) return null;

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

  async function readCurrent() {
    if (!session) throw new Error("not connected");
    pushLog(`Reading 0x${WELCOME0_ADDR.toString(16)} (${WELCOME_LEN} bytes)…`);
    const w0 = await session.readEeprom(WELCOME0_ADDR, WELCOME_LEN);
    pushLog(`Reading 0x${WELCOME1_ADDR.toString(16)} (${WELCOME_LEN} bytes)…`);
    const w1 = await session.readEeprom(WELCOME1_ADDR, WELCOME_LEN);
    pushLog(
      `Reading 0x${DISPLAY_MODE_BLOCK_ADDR.toString(16)} (${DISPLAY_MODE_BLOCK_LEN} bytes, for POWER_ON_DISPLAY_MODE)…`,
    );
    const dmBlock = await session.readEeprom(DISPLAY_MODE_BLOCK_ADDR, DISPLAY_MODE_BLOCK_LEN);

    const w0Ascii = decodeWelcomeAscii(w0);
    const w1Ascii = decodeWelcomeAscii(w1);
    const dmByte = dmBlock[DISPLAY_MODE_BYTE_INDEX]!;
    pushLog(
      `Welcome 1 (0x${WELCOME0_ADDR.toString(16)}): "${w0Ascii.text}" (${w0Ascii.diagnostic})`,
    );
    pushLog(
      `Welcome 2 (0x${WELCOME1_ADDR.toString(16)}): "${w1Ascii.text}" (${w1Ascii.diagnostic})`,
    );
    pushLog(
      `POWER_ON_DISPLAY_MODE byte (0x${(DISPLAY_MODE_BLOCK_ADDR + DISPLAY_MODE_BYTE_INDEX).toString(16)}): 0x${dmByte.toString(16).padStart(2, "0")} (${dmByte})`,
    );

    setWelcome0(w0Ascii.text);
    setWelcome1(w1Ascii.text);
    setDisplayMode(dmByte < 6 ? dmByte : 0);
    setDisplayModeBlock(dmBlock);
    const snap: SnapshotState = {
      capturedAt: new Date().toISOString(),
      firmwareVersion,
      welcome0Hex: bytesToHex(w0),
      welcome1Hex: bytesToHex(w1),
      displayModeBlockHex: bytesToHex(dmBlock),
    };
    setSnapshot(snap);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  }

  async function writeAll() {
    if (!session) throw new Error("not connected");
    if (!snapshot) throw new Error("read current values first (Restore needs a snapshot)");
    if (!displayModeBlock) throw new Error("no display-mode block captured");

    const w0Bytes = encodeWelcomeAscii(welcome0);
    const w1Bytes = encodeWelcomeAscii(welcome1);
    const dmBlock = new Uint8Array(displayModeBlock);
    dmBlock[DISPLAY_MODE_BYTE_INDEX] = displayMode & 0xff;

    pushLog(
      `Writing welcome 1 to 0x${WELCOME0_ADDR.toString(16)}: ${JSON.stringify(welcome0.slice(0, WELCOME_LEN))}…`,
    );
    await session.writeEeprom(WELCOME0_ADDR, w0Bytes);
    pushLog(
      `Writing welcome 2 to 0x${WELCOME1_ADDR.toString(16)}: ${JSON.stringify(welcome1.slice(0, WELCOME_LEN))}…`,
    );
    await session.writeEeprom(WELCOME1_ADDR, w1Bytes);
    pushLog(
      `Writing display-mode block to 0x${DISPLAY_MODE_BLOCK_ADDR.toString(16)} (preserving other bytes)…`,
    );
    await session.writeEeprom(DISPLAY_MODE_BLOCK_ADDR, dmBlock);

    pushLog("Reading back to verify…");
    const v0 = await session.readEeprom(WELCOME0_ADDR, WELCOME_LEN);
    const v1 = await session.readEeprom(WELCOME1_ADDR, WELCOME_LEN);
    const vDm = await session.readEeprom(DISPLAY_MODE_BLOCK_ADDR, DISPLAY_MODE_BLOCK_LEN);
    if (!bytesEq(v0, w0Bytes)) {
      throw new Error(
        `Welcome 1 verify mismatch. Read-back hex: ${bytesToHex(v0)}. ` +
          `Likely cause on K1+NR7Y: briand virtual mapping diverts 0x0EB0 to channel data — ` +
          `welcome.c's read at this address may not be what the firmware actually displays. ` +
          `Original snapshot preserved in localStorage; click Restore.`,
      );
    }
    if (!bytesEq(v1, w1Bytes)) {
      throw new Error(`Welcome 2 verify mismatch. Read-back hex: ${bytesToHex(v1)}.`);
    }
    if (vDm[DISPLAY_MODE_BYTE_INDEX] !== (displayMode & 0xff)) {
      throw new Error(
        `Display-mode verify mismatch. Wrote 0x${(displayMode & 0xff).toString(16)}, ` +
          `read back 0x${vDm[DISPLAY_MODE_BYTE_INDEX]!.toString(16)}.`,
      );
    }
    pushLog("All three writes verified. Reboot to see the new splash.");
  }

  async function restoreSnapshot() {
    if (!session) throw new Error("not connected");
    if (!snapshot) throw new Error("no snapshot to restore");
    const w0 = hexToBytes(snapshot.welcome0Hex);
    const w1 = hexToBytes(snapshot.welcome1Hex);
    const dm = hexToBytes(snapshot.displayModeBlockHex);
    pushLog(`Restoring 0x${WELCOME0_ADDR.toString(16)}…`);
    await session.writeEeprom(WELCOME0_ADDR, w0);
    pushLog(`Restoring 0x${WELCOME1_ADDR.toString(16)}…`);
    await session.writeEeprom(WELCOME1_ADDR, w1);
    pushLog(`Restoring 0x${DISPLAY_MODE_BLOCK_ADDR.toString(16)} block…`);
    await session.writeEeprom(DISPLAY_MODE_BLOCK_ADDR, dm);
    pushLog("Restore writes sent. Reboot to confirm.");
  }

  async function reboot() {
    if (!session) throw new Error("not connected");
    pushLog("Sending reboot (0x05DD). Session closes — reconnect after boot.");
    await session.reboot();
  }

  function clear() {
    setSnapshot(null);
    localStorage.removeItem(STORAGE_KEY);
    setLog([]);
  }

  const canWrite =
    !busy &&
    snapshot !== null &&
    displayModeBlock !== null &&
    welcome0.length <= WELCOME_LEN &&
    welcome1.length <= WELCOME_LEN;

  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18 }}>Boot screen text</h2>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>
        Set the two lines of text your radio shows when it powers on — your
        callsign, a club name, whatever you like. Show your current text
        first, edit it, then save. Pick <em>Your text only</em> or{" "}
        <em>Your text, plus voltage and version</em> as the style so your text
        actually appears.
      </p>

      <TechDetails>
        Text is written to physical settings addresses{" "}
        <code>0x{WELCOME0_ADDR.toString(16)}</code> /{" "}
        <code>0x{WELCOME1_ADDR.toString(16)}</code>, and the boot-screen style
        byte to <code>0x{DISPLAY_MODE_BLOCK_ADDR.toString(16)}</code> (byte 7),
        identity-mapped by <code>eeprom_compat.c</code>. briand&apos;s{" "}
        <code>welcome.c:278-281</code> + <code>settings.c:255,265</code> read
        these physical addresses directly, bypassing <code>AddrTranslate</code>.
        The style names map to <code>POWER_ON_DISPLAY_MODE</code>; on non-F4HWN
        builds the same byte values mean different things.
      </TechDetails>

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => runStep(readCurrent)} disabled={busy}>
          Show current text
        </button>
        <button onClick={() => runStep(writeAll)} disabled={!canWrite}>
          Save
        </button>
        <button
          className="secondary"
          onClick={() => runStep(reboot)}
          disabled={busy}
        >
          Restart radio
        </button>
        <button
          onClick={() => runStep(restoreSnapshot)}
          disabled={busy || !snapshot}
        >
          Undo (put the old text back)
        </button>
        <button className="secondary" onClick={clear} disabled={busy}>
          Clear backup
        </button>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          Line 1 (up to {WELCOME_LEN} characters):
          <input
            type="text"
            value={welcome0}
            onChange={(e) => setWelcome0(e.target.value)}
            disabled={busy}
            maxLength={WELCOME_LEN}
            placeholder="W6JY"
            style={{ marginLeft: 8, width: "100%", marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          Line 2 (up to {WELCOME_LEN} characters):
          <input
            type="text"
            value={welcome1}
            onChange={(e) => setWelcome1(e.target.value)}
            disabled={busy}
            maxLength={WELCOME_LEN}
            placeholder="BKG #042"
            style={{ marginLeft: 8, width: "100%", marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          Boot screen style:
          <select
            value={displayMode}
            onChange={(e) => setDisplayMode(Number.parseInt(e.target.value, 10))}
            disabled={busy}
            style={{ marginLeft: 8, marginTop: 4 }}
          >
            {DISPLAY_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            {DISPLAY_MODES[displayMode]?.hint ?? ""}
          </div>
        </label>
      </div>

      {snapshot ? (
        <p style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          Backup of the old text saved{" "}
          {new Date(snapshot.capturedAt).toLocaleString()}. You can undo even
          after closing and reopening this page.
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
        <TechDetails summary="Step-by-step log">
          <pre
            style={{
              marginTop: 4,
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
        </TechDetails>
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

interface AsciiDecodeResult {
  text: string;
  diagnostic: string;
}

function decodeWelcomeAscii(bytes: Uint8Array): AsciiDecodeResult {
  // The firmware treats the 16 bytes as a null-padded ASCII string. We
  // decode up to the first null (or 16 chars). Anything outside printable
  // ASCII gets flagged so the user can tell "this is binary garbage" from
  // "this is real text".
  let len = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      len = i;
      break;
    }
  }
  let printable = 0;
  let chars = "";
  for (let i = 0; i < len; i++) {
    const b = bytes[i]!;
    if (b >= 0x20 && b <= 0x7e) {
      printable++;
      chars += String.fromCharCode(b);
    } else {
      chars += ".";
    }
  }
  const hex = bytesToHex(bytes);
  const diagnostic =
    len === 0
      ? "empty (or starts with NUL)"
      : printable === len
        ? `${len} printable chars`
        : `${printable}/${len} printable, hex=${hex}`;
  return { text: chars, diagnostic };
}

function encodeWelcomeAscii(s: string): Uint8Array {
  const out = new Uint8Array(WELCOME_LEN);
  for (let i = 0; i < WELCOME_LEN; i++) {
    const c = i < s.length ? s.charCodeAt(i) : 0;
    out[i] = c >= 0x20 && c <= 0x7e ? c : 0;
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isValidSnapshot(x: unknown): x is SnapshotState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.capturedAt === "string" &&
    typeof o.firmwareVersion === "string" &&
    typeof o.welcome0Hex === "string" &&
    typeof o.welcome1Hex === "string" &&
    typeof o.displayModeBlockHex === "string"
  );
}
