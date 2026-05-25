"use client";

import { useEffect, useState } from "react";
import { useSession } from "./SessionContext";
import {
  findProfile,
  resolveProfileById,
  getChannelNameAddress,
  getChannelCount,
  findAsciiField,
  type AsciiFieldLocation,
} from "./profileLookup";
import { readAsciiSlot, writeAsciiField } from "./writeFlow";
import type { Session } from "../src/protocol/session";
import type { ResolvedProfile } from "../src/schema/types";
import type { ExecResult } from "../src/writer/plan";

/** Slot size for channel names — V1/IJV layout, 10 visible chars + 6 pad. */
const CHANNEL_NAME_SIZE = 16;
const CHANNEL_NAME_MAX = 10;

export function WritePanel() {
  const { state } = useSession();
  if (state.kind !== "connected") return null;

  const profileId =
    state.result.firmware.kind === "matched"
      ? state.result.firmware.entry.profileId
      : undefined;
  if (!profileId) return null;
  const profile = findProfile(profileId);
  const resolved = resolveProfileById(profileId);
  if (!profile || !resolved) return null;

  // Boot line fields are inside the ijv_settings block. Other profiles don't
  // have them in this exact shape, so we only surface them when the field
  // is actually present (i.e. the IJV profile).
  const bootLine1 = findAsciiField(resolved, "ijv_settings", "boot_line_1");
  const bootLine2 = findAsciiField(resolved, "ijv_settings", "boot_line_2");

  const channelCount = getChannelCount(profile);

  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18 }}>Programming</h2>
      <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
        Direct writes through the planner + executor pipeline. Each save
        reads the current 8-aligned slot, replaces the field bytes, writes,
        and reads back to verify. Verify mismatches surface as errors.
      </p>

      {bootLine1 ? (
        <AsciiWriter
          title="Boot screen line 1 (callsign)"
          session={state.session}
          resolved={resolved}
          loc={bootLine1}
        />
      ) : null}
      {bootLine2 ? (
        <AsciiWriter
          title="Boot screen line 2 (welcome)"
          session={state.session}
          resolved={resolved}
          loc={bootLine2}
        />
      ) : null}
      {channelCount > 0 ? (
        <ChannelNameWriter
          session={state.session}
          resolved={resolved}
          channelCount={channelCount}
        />
      ) : null}
    </Section>
  );
}

function AsciiWriter({
  title,
  session,
  resolved,
  loc,
}: {
  title: string;
  session: Session;
  resolved: ResolvedProfile;
  loc: AsciiFieldLocation;
}) {
  const [value, setValue] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await readAsciiSlot(session, loc.address, loc.size);
        if (!cancelled) {
          setValue(v);
          setLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            "Load failed: " +
              (err instanceof Error ? err.message : String(err)),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, loc.address, loc.size]);

  async function save() {
    setStatus(null);
    setError(null);
    setWorking(true);
    try {
      const result = await writeAsciiField(
        session,
        resolved,
        loc.address,
        loc.size,
        value,
        loc.label,
      );
      setStatus(formatExecResult(result.exec));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <SubSection title={title} address={loc.address} maxLength={loc.maxLength}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={loc.maxLength}
        disabled={!loaded || working}
        placeholder={loaded ? "" : "Loading current value…"}
        style={inputStyle}
      />
      <ActionRow>
        <button onClick={save} disabled={!loaded || working}>
          {working ? "Writing…" : "Save"}
        </button>
        {status ? <Status text={status} /> : null}
        {error ? <Status text={error} error /> : null}
      </ActionRow>
    </SubSection>
  );
}

function ChannelNameWriter({
  session,
  resolved,
  channelCount,
}: {
  session: Session;
  resolved: ResolvedProfile;
  channelCount: number;
}) {
  const [channelStr, setChannelStr] = useState<string>("1");
  const [name, setName] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profile = findProfile(resolved.id);
  const channel = Number(channelStr);
  const validChannel =
    Number.isInteger(channel) && channel >= 1 && channel <= channelCount;
  const address = profile && validChannel
    ? getChannelNameAddress(profile, channel)
    : null;

  // Load current name when the channel number changes to a valid one.
  useEffect(() => {
    if (address === null) {
      setLoaded(false);
      setName("");
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const v = await readAsciiSlot(session, address, CHANNEL_NAME_SIZE);
        if (!cancelled) {
          setName(v);
          setLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            "Load failed: " +
              (err instanceof Error ? err.message : String(err)),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, address]);

  async function save() {
    if (address === null) return;
    setStatus(null);
    setError(null);
    setWorking(true);
    try {
      const result = await writeAsciiField(
        session,
        resolved,
        address,
        CHANNEL_NAME_SIZE,
        name,
        `Channel ${channel} name`,
      );
      setStatus(formatExecResult(result.exec));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <SubSection
      title="Channel name"
      address={address ?? null}
      maxLength={CHANNEL_NAME_MAX}
    >
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8 }}>
        <input
          type="number"
          min={1}
          max={channelCount}
          value={channelStr}
          onChange={(e) => setChannelStr(e.target.value)}
          disabled={working}
          style={inputStyle}
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CHANNEL_NAME_MAX}
          disabled={!loaded || working}
          placeholder={loaded ? "" : "Loading current name…"}
          style={inputStyle}
        />
      </div>
      <ActionRow>
        <button onClick={save} disabled={!loaded || working || !validChannel}>
          {working ? "Writing…" : `Save channel ${channel}`}
        </button>
        {status ? <Status text={status} /> : null}
        {error ? <Status text={error} error /> : null}
      </ActionRow>
    </SubSection>
  );
}

function formatExecResult(exec: ExecResult): string {
  switch (exec.status) {
    case "success":
      return `Verified. ${exec.batchesWritten} batch(es) in ${Math.round(exec.durationMs)} ms.`;
    case "success-with-warnings":
      return `Verified with ${exec.warnings.length} warning(s): ${exec.warnings
        .map((w) => w.message)
        .join("; ")}`;
    case "aborted-preflight":
      return `Aborted at preflight: ${exec.failedChecks
        .map((c) => `${c.id}: ${c.message}`)
        .join("; ")}`;
    case "aborted-mid-execute": {
      const r = exec.reason;
      const reasonText =
        r.kind === "verify-mismatch"
          ? `verify mismatch (expected ${hex(r.expected)}, got ${hex(r.actual)})`
          : r.kind === "snapshot-drift"
            ? `snapshot drift at 0x${r.address.toString(16)}`
            : r.kind === "protocol-error"
              ? `protocol error: ${r.underlying.message}`
              : r.kind === "timeout"
                ? `timeout after ${r.afterMs} ms`
                : r.kind;
      return `Aborted mid-execute: ${reasonText}. Last good batch: ${exec.lastBatchOk}.`;
    }
  }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
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

function SubSection({
  title,
  address,
  maxLength,
  children,
}: {
  title: string;
  address: number | null;
  maxLength: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 16,
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {address !== null
            ? `0x${address.toString(16).toUpperCase().padStart(4, "0")} · max ${maxLength} chars`
            : "—"}
        </span>
      </div>
      {children}
    </div>
  );
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 8,
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

function Status({ text, error }: { text: string; error?: boolean }) {
  return (
    <span
      style={{
        fontSize: 13,
        color: error ? "#c0392b" : "#2e7d32",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {text}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "6px 8px",
  width: "100%",
  maxWidth: 280,
};
