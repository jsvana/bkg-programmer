"use client";

import { useSession } from "./SessionContext";
import type { ConnState } from "./SessionContext";
import type { DetectionResult } from "../src/detection/detect";

export function ConnectPanel() {
  const { state, connect, disconnect } = useSession();

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 20,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18 }}>Connect</h2>

      {state.kind === "unsupported" ? (
        <UnsupportedNotice />
      ) : state.kind === "connected" ? (
        <ConnectedView result={state.result} onDisconnect={disconnect} />
      ) : (
        <DisconnectedView state={state} onConnect={connect} />
      )}
    </section>
  );
}

function UnsupportedNotice() {
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ color: "var(--muted)" }}>
        This browser does not support the Web Serial API. Try Chrome, Edge,
        or another Chromium-based browser on desktop.
      </p>
    </div>
  );
}

function DisconnectedView({
  state,
  onConnect,
}: {
  state: Exclude<ConnState, { kind: "connected" } | { kind: "unsupported" }>;
  onConnect: () => void;
}) {
  const busy = state.kind === "connecting";
  return (
    <>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>
        Plug your radio in via the K5 programming cable, then click Connect.
      </p>
      <button onClick={onConnect} disabled={busy}>
        {busy ? "Connecting…" : "Connect to radio"}
      </button>
      {state.kind === "error" ? (
        <p
          style={{
            marginTop: 16,
            color: "#c0392b",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {state.message}
        </p>
      ) : null}
    </>
  );
}

function ConnectedView({
  result,
  onDisconnect,
}: {
  result: DetectionResult;
  onDisconnect: () => void;
}) {
  const { hello, firmware, confidence, candidateModels, modelBytesString, notes } =
    result;
  return (
    <div style={{ marginTop: 12 }}>
      <Row label="Firmware version">
        <code>{hello.versionString || "(empty)"}</code>
      </Row>
      <Row label="Confidence">
        <ConfidenceBadge confidence={confidence} />
      </Row>
      {firmware ? (
        <Row label="Profile">
          <code>{firmware.profileId}</code>
        </Row>
      ) : null}
      <Row label="Candidate models">
        {candidateModels.length ? (
          candidateModels.map((m) => (
            <code key={m} style={{ marginRight: 8 }}>{m}</code>
          ))
        ) : (
          <span style={{ color: "var(--muted)" }}>(none)</span>
        )}
      </Row>
      {modelBytesString !== undefined ? (
        <Row label="Model bytes">
          <code>{modelBytesString}</code>
        </Row>
      ) : null}
      <Row label="Lock screen">
        <code>{hello.isInLockScreen ? "yes" : "no"}</code>
      </Row>
      <Row label="Custom AES key">
        <code>{hello.hasCustomAesKey ? "yes" : "no"}</code>
      </Row>
      {notes.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Notes</div>
          <ul style={{ marginTop: 4, paddingLeft: 18 }}>
            {notes.map((n, i) => (
              <li key={i} style={{ fontSize: 13 }}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div style={{ marginTop: 20 }}>
        <button className="secondary" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px 1fr",
        gap: 12,
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
        fontSize: 14,
      }}
    >
      <div style={{ color: "var(--muted)" }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: DetectionResult["confidence"];
}) {
  const color =
    confidence === "high"
      ? "#2e7d32"
      : confidence === "medium"
        ? "#b88a00"
        : confidence === "low"
          ? "#888"
          : confidence === "conflict"
            ? "#c0392b"
            : "#777";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: color,
        color: "white",
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {confidence}
    </span>
  );
}
