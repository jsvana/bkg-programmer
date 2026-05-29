"use client";

import { useSession } from "./SessionContext";
import type { ConnState } from "./SessionContext";
import type {
  DetectionResult,
  RadioIdentity,
  FirmwareIdentity,
  Programmability,
} from "../src/detection/detect";

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
        <UnsupportedNotice reason={state.reason} />
      ) : state.kind === "connected" ? (
        <ConnectedView result={state.result} onDisconnect={disconnect} />
      ) : (
        <DisconnectedView state={state} onConnect={connect} />
      )}
    </section>
  );
}

function UnsupportedNotice({ reason }: { reason: "no-api" | "insecure-context" }) {
  if (reason === "insecure-context") {
    return (
      <div style={{ marginTop: 12 }}>
        <p style={{ color: "var(--muted)" }}>
          The Web Serial API only exposes <code>navigator.serial</code> in a
          secure context. This page is loaded over plain HTTP — Chrome hides
          the API and the rail reports it as unsupported even though your
          browser is fine.
        </p>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Reload over <code>https://</code> (same host) or run a local copy
          at <code>http://localhost</code> — both count as secure contexts.
        </p>
      </div>
    );
  }
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
        Plug your radio in with the programming cable, put it in programming
        mode (hold the lower side button while turning it on), then click
        Connect.
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
  const { hello, radio, firmware, programmability, modelBytesString, notes } = result;
  return (
    <div style={{ marginTop: 12 }}>
      <Row label="Firmware version">
        <code>{hello.versionString || "(empty)"}</code>
      </Row>
      <Row label="Radio">
        <RadioBadge radio={radio} />
      </Row>
      <Row label="Firmware">
        <FirmwareBadge firmware={firmware} />
      </Row>
      <Row label="Safe to change?">
        <ProgrammabilityBadge programmability={programmability} />
      </Row>
      {modelBytesString !== undefined ? (
        <Row label="Model bytes">
          <code>{modelBytesString}</code>
        </Row>
      ) : null}
      <Row label="Radio locked">
        <code>{hello.isInLockScreen ? "yes" : "no"}</code>
      </Row>
      <Row label="Custom encryption key">
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

// ============ Badges ============

const GREEN = "#2e7d32";
const AMBER = "#b88a00";
const GREY = "#888";
const RED = "#c0392b";

function Badge({
  color,
  label,
  detail,
}: {
  color: string;
  label: string;
  detail?: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
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
        {label}
      </span>
      {detail ? (
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{detail}</span>
      ) : null}
    </span>
  );
}

function RadioBadge({ radio }: { radio: RadioIdentity }) {
  switch (radio.kind) {
    case "confirmed":
      return <Badge color={GREEN} label="confirmed" detail={radio.models.join(", ")} />;
    case "inferred":
      return <Badge color={AMBER} label="inferred" detail={radio.models.join(", ")} />;
    case "ambiguous":
      return (
        <Badge color={AMBER} label="ambiguous" detail={radio.models.join(" / ")} />
      );
    case "conflict":
      return (
        <Badge
          color={RED}
          label="conflict"
          detail={`firmware says ${radio.firmwareCandidates.join("/")}; EEPROM says "${radio.modelBytesSays}"`}
        />
      );
    case "unknown":
      return <Badge color={GREY} label="unknown" />;
  }
}

function FirmwareBadge({ firmware }: { firmware: FirmwareIdentity }) {
  switch (firmware.kind) {
    case "matched":
      return (
        <Badge
          color={GREEN}
          label="matched"
          detail={`${firmware.entry.displayName} → ${firmware.entry.profileId}`}
        />
      );
    case "unknown":
      return (
        <Badge color={GREY} label="unknown" detail={firmware.versionString || "(empty)"} />
      );
  }
}

function ProgrammabilityBadge({
  programmability,
}: {
  programmability: Programmability;
}) {
  switch (programmability.kind) {
    case "verified":
      return <Badge color={GREEN} label="yes" detail="checked and confirmed" />;
    case "verified-with-reboot":
      return (
        <Badge color={GREEN} label="yes" detail="confirmed after a restart" />
      );
    case "provisional":
      return (
        <Badge
          color={AMBER}
          label="probably"
          detail={
            programmability.reason === "self-test-not-run"
              ? "not checked yet — run “Check this radio” to be sure"
              : "the check found a problem"
          }
        />
      );
    case "unsupported":
      return (
        <Badge
          color={GREY}
          label="no"
          detail={
            programmability.reason === "firmware-unknown"
              ? "firmware not recognized"
              : "firmware not supported"
          }
        />
      );
    case "blocked":
      return (
        <Badge
          color={RED}
          label="blocked"
          detail={
            programmability.reason === "radio-identity-conflict"
              ? "we can't tell which radio this is"
              : "radio is in install mode"
          }
        />
      );
  }
}
