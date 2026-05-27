"use client";

import { useSession } from "./SessionContext";
import type { ConnState } from "./SessionContext";

/**
 * Persistent connection status rail. Sits below the top bar, above the
 * workspace. Always rendered; it just changes content based on session
 * state. Heavy detail (notes, AES key, programmability rationale) lives
 * in the Connection details utility, not here.
 */
export function StatusRail() {
  const { state, connect, disconnect } = useSession();

  if (state.kind === "unsupported") {
    const insecure = state.reason === "insecure-context";
    return (
      <div className="rail">
        <span className="rail-light err" aria-hidden />
        <span className="rail-field">
          <span className="rail-field-label">
            {insecure ? "connection" : "browser"}
          </span>
          <span>{insecure ? "https required" : "web serial unsupported"}</span>
        </span>
        <span className="rail-field" style={{ color: "var(--fg-muted)" }}>
          {insecure
            ? "Web Serial only works on https:// (or localhost). Reload over HTTPS."
            : "use Chrome, Edge, or another Chromium-based desktop browser"}
        </span>
      </div>
    );
  }

  if (state.kind === "connected") {
    const { hello, radio, firmware } = state.result;
    const radioLabel =
      radio.kind === "confirmed"
        ? radio.models.join(", ")
        : radio.kind === "inferred"
          ? `${radio.models.join(", ")} (inferred)`
          : radio.kind === "ambiguous"
            ? `${radio.models.join(" / ")} (ambiguous)`
            : radio.kind === "conflict"
              ? "identity conflict"
              : "unknown";

    const fwLabel =
      firmware.kind === "matched"
        ? firmware.entry.displayName
        : `unknown · "${firmware.versionString || "(empty)"}"`;

    return (
      <div className="rail">
        <span className="rail-light on" aria-hidden />
        <div className="rail-fields">
          <span className="rail-field">
            <span className="rail-field-label">radio</span>
            <span>{radioLabel}</span>
          </span>
          <span className="rail-field">
            <span className="rail-field-label">firmware</span>
            <span>{fwLabel}</span>
          </span>
          <span className="rail-field">
            <span className="rail-field-label">ver</span>
            <span>{hello.versionString || "(empty)"}</span>
          </span>
          {hello.isInLockScreen ? (
            <span className="rail-field" style={{ color: "var(--warn)" }}>
              <span className="rail-field-label">lock</span>
              <span>screen active</span>
            </span>
          ) : null}
        </div>
        <div className="rail-actions">
          <button className="ghost" onClick={disconnect}>
            disconnect
          </button>
        </div>
      </div>
    );
  }

  // idle, connecting, error
  const busy = state.kind === "connecting";
  return (
    <div className="rail">
      <RailLightFor state={state} />
      <div className="rail-fields">
        <span className="rail-field">
          <span className="rail-field-label">port</span>
          <span style={{ color: "var(--fg-muted)" }}>
            {state.kind === "connecting" ? "opening…" : "not connected"}
          </span>
        </span>
        {state.kind === "error" ? (
          <span
            className="rail-field"
            style={{ color: "var(--err)", maxWidth: "60ch" }}
          >
            <span className="rail-field-label">error</span>
            <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {state.message}
            </span>
          </span>
        ) : null}
      </div>
      <div className="rail-actions">
        <button onClick={connect} disabled={busy}>
          {busy ? "connecting…" : "connect radio"}
        </button>
      </div>
    </div>
  );
}

function RailLightFor({ state }: { state: ConnState }) {
  if (state.kind === "error") return <span className="rail-light err" aria-hidden />;
  if (state.kind === "connecting") return <span className="rail-light warn" aria-hidden />;
  return <span className="rail-light" aria-hidden />;
}
