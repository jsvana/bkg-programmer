"use client";

import { useState } from "react";
import { useSession } from "./SessionContext";
import { resolveProfile } from "../src/schema/resolve";
import { moduleRegistry } from "../src/schema/profiles/index";
import { EepromSnapshot } from "../src/backup/snapshot";
import type { Session } from "../src/protocol/session";
import { findProfile, isProfileTentative } from "./profileLookup";

interface RegionRange {
  id: string;
  start: number;
  length: number;
}

interface Progress {
  done: number;
  total: number;
  current: string;
}

export function BackupPanel() {
  const { state } = useSession();

  if (state.kind !== "connected") return null;
  const profileId =
    state.result.firmware.kind === "matched"
      ? state.result.firmware.entry.profileId
      : undefined;
  if (!profileId) {
    return (
      <Section>
        <p style={{ color: "var(--muted)" }}>
          We don&rsquo;t recognize this radio&rsquo;s firmware, so we
          can&rsquo;t back it up safely.
        </p>
      </Section>
    );
  }
  const profile = findProfile(profileId);
  if (!profile) {
    return (
      <Section>
        <p style={{ color: "#c0392b" }}>
          Something went wrong loading this radio&rsquo;s layout. Try
          reconnecting.
        </p>
      </Section>
    );
  }

  const ranges = computeRanges(profile);
  return (
    <BackupForm
      profileId={profileId}
      ranges={ranges}
      session={state.session}
      firmwareVersion={state.result.hello.versionString}
      tentative={isProfileTentative(profile)}
    />
  );
}

function computeRanges(profile: ReturnType<typeof findProfile>): RegionRange[] {
  if (!profile) return [];
  const resolved = resolveProfile(profile, moduleRegistry);
  const raw: RegionRange[] = resolved.modules.map((m) => {
    if (m.kind === "block") {
      return { id: m.id, start: m.baseOffset, length: m.size };
    }
    return { id: m.id, start: m.baseOffset, length: m.count * m.stride };
  });
  // Sort and round each range to read-friendly 0x80 boundaries.
  return raw.sort((a, b) => a.start - b.start);
}

function BackupForm({
  profileId,
  ranges,
  session,
  firmwareVersion,
  tentative,
}: {
  profileId: string;
  ranges: RegionRange[];
  session: Session;
  firmwareVersion: string;
  tentative: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<EepromSnapshot | null>(null);
  const totalBytes = ranges.reduce((sum, r) => sum + r.length, 0);

  async function run() {
    setError(null);
    setLastSnapshot(null);
    setProgress({ done: 0, total: totalBytes, current: "" });
    setRunning(true);
    const snapshot = new EepromSnapshot();
    try {
      let done = 0;
      for (const range of ranges) {
        setProgress({ done, total: totalBytes, current: range.id });
        const data = await session.readEeprom(range.start, range.length);
        snapshot.addRegion(range.start, data);
        done += range.length;
        setProgress({ done, total: totalBytes, current: range.id });
      }
      setLastSnapshot(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function downloadJson() {
    if (!lastSnapshot) return;
    const doc = {
      schemaVersion: 0,
      capturedAt: new Date().toISOString(),
      profileId,
      firmwareVersion,
      regions: lastSnapshot.getRegions().map((r) => ({
        start: r.start,
        length: r.length,
        bytesBase64: bytesToBase64(r.data),
      })),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    triggerDownload(
      blob,
      `bkg-backup-${profileId}-${stamp()}.json`,
    );
  }

  function downloadBin() {
    if (!lastSnapshot) return;
    // Flat dump: concatenate regions in sorted address order, with 0xFF
    // padding between them. The result is a sparse-but-flat image.
    const regions = lastSnapshot.getRegions();
    if (regions.length === 0) return;
    const lastEnd = regions[regions.length - 1]!.start + regions[regions.length - 1]!.length;
    const firstStart = regions[0]!.start;
    const buffer = new Uint8Array(lastEnd - firstStart);
    buffer.fill(0xff);
    for (const r of regions) {
      buffer.set(r.data, r.start - firstStart);
    }
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    triggerDownload(
      blob,
      `bkg-backup-${profileId}-${stamp()}-0x${firstStart
        .toString(16)
        .padStart(4, "0")}.bin`,
    );
  }

  const pct = progress
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;

  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18 }}>Back up your radio</h2>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>
        Saves a complete copy of what&rsquo;s on your radio right now —
        channels, settings, and the factory calibration that&rsquo;s unique
        to your radio. Download it and keep it somewhere safe; it&rsquo;s how
        you put things back if a change ever goes wrong.
      </p>
      {tentative ? (
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
          <strong>Double-check this backup.</strong> We&rsquo;re not fully
          certain of this firmware&rsquo;s layout. The backup is probably
          fine, but before you rely on it, confirm that at least one channel
          name in the backup matches what the radio actually shows.
        </div>
      ) : null}

      <details className="tech" style={{ marginTop: 8 }}>
        <summary>What gets saved ({ranges.length} parts, {totalBytes.toLocaleString()} bytes)</summary>
        <table style={{ marginTop: 8, fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--muted)", textAlign: "left" }}>
              <th style={{ padding: "4px 12px 4px 0" }}>Module</th>
              <th style={{ padding: "4px 12px 4px 0" }}>Start</th>
              <th style={{ padding: "4px 12px 4px 0" }}>Length</th>
            </tr>
          </thead>
          <tbody>
            {ranges.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "2px 12px 2px 0" }}><code>{r.id}</code></td>
                <td style={{ padding: "2px 12px 2px 0" }}>
                  <code>0x{r.start.toString(16).padStart(4, "0")}</code>
                </td>
                <td style={{ padding: "2px 12px 2px 0" }}>
                  <code>{r.length.toLocaleString()}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button onClick={run} disabled={running}>
          {running ? "Backing up…" : "Back up now"}
        </button>
        <button
          className="secondary"
          onClick={downloadJson}
          disabled={!lastSnapshot || running}
        >
          Download backup
        </button>
        <button
          className="secondary"
          onClick={downloadBin}
          disabled={!lastSnapshot || running}
        >
          Download raw copy (.bin)
        </button>
      </div>

      {progress ? (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <div style={{ color: "var(--muted)" }}>
            Reading… {progress.total === 0 ? 0 : pct}%
          </div>
          <div
            style={{
              marginTop: 4,
              height: 8,
              background: "var(--border)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "var(--accent)",
                transition: "width 120ms linear",
              }}
            />
          </div>
        </div>
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

      {lastSnapshot && !running ? (
        <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>
          Backup ready. Click <strong>Download backup</strong> to save it to
          your computer.
        </p>
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
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
