"use client";

import { useState } from "react";
import { useSession } from "./SessionContext";
import { runSelfTest } from "../src/self-test/self-test";
import type { SelfTestReport } from "../src/self-test/report";
import type { Session } from "../src/protocol/session";
import type { WebSerialTransport } from "../src/protocol/transport";
import type { RadioModelId } from "../src/schema/types";
import {
  findProfile,
  getChannelNameAddress,
  getChannelCount,
  isChannelNamesReadOnly,
} from "./profileLookup";

interface Step {
  step: string;
  detail?: string;
  ts: number;
}

export function SelfTestPanel() {
  const { state } = useSession();

  if (state.kind !== "connected") return null;
  const profileId = state.result.suggestedProfileId ?? state.result.firmware?.profileId;
  if (!profileId) {
    return (
      <Section>
        <p style={{ color: "var(--muted)" }}>
          Self-test requires a recognized profile. Detection returned no
          suggested profile; refusing to run.
        </p>
      </Section>
    );
  }
  const profile = findProfile(profileId);
  if (!profile) {
    return (
      <Section>
        <p style={{ color: "#c0392b" }}>
          Profile "{profileId}" not found in registry.
        </p>
      </Section>
    );
  }

  if (isChannelNamesReadOnly(profile)) {
    return (
      <Section>
        <h2 style={{ margin: 0, fontSize: 18 }}>Self-test</h2>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Profile <code>{profileId}</code> is marked read-only — its channel
          name layout is inferred, not verified against firmware source.
          Refusing to write to an unverified address. Backup is still safe.
        </p>
      </Section>
    );
  }
  const radioModel = state.result.candidateModels[0] ?? ("uv-k5-v1" as RadioModelId);
  return (
    <SelfTestForm
      profileId={profileId}
      maxChannel={getChannelCount(profile)}
      session={state.session}
      transport={state.transport}
      radioModel={radioModel}
    />
  );
}

function SelfTestForm({
  profileId,
  maxChannel,
  session,
  transport,
  radioModel,
}: {
  profileId: string;
  maxChannel: number;
  session: Session;
  transport: WebSerialTransport;
  radioModel: RadioModelId;
}) {
  const [scratchChannel, setScratchChannel] = useState<string>("198");
  const [unmappedAddress, setUnmappedAddress] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profile = findProfile(profileId);

  function parseHex(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = trimmed.startsWith("0x")
      ? parseInt(trimmed.slice(2), 16)
      : parseInt(trimmed, 16);
    return Number.isFinite(n) ? n : null;
  }

  async function run() {
    setError(null);
    setReport(null);
    setSteps([]);

    const chN = Number(scratchChannel);
    if (!Number.isInteger(chN) || chN < 1 || chN > maxChannel) {
      setError(`Channel must be 1..${maxChannel}`);
      return;
    }
    if (!profile) {
      setError("Profile lookup failed");
      return;
    }
    const addr = getChannelNameAddress(profile, chN);
    if (addr === null) {
      setError("Could not derive channel name address");
      return;
    }
    let unmapped: number | null = null;
    if (unmappedAddress.trim()) {
      unmapped = parseHex(unmappedAddress);
      if (unmapped === null) {
        setError(`Invalid unmapped address: ${unmappedAddress}`);
        return;
      }
    }

    setRunning(true);
    try {
      const result = await runSelfTest(
        session,
        transport,
        {
          scratchChannel: chN,
          radioModel,
          scratchChannelNameAddress: addr,
          unmappedTestAddress: unmapped,
        },
        {
          onStep(step, detail) {
            setSteps((prev) => {
              const entry: Step =
                detail === undefined
                  ? { step, ts: performance.now() }
                  : { step, detail, ts: performance.now() };
              return [...prev, entry];
            });
          },
        },
      );
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18 }}>Self-test</h2>
      <p style={{ color: "var(--muted)", marginTop: 4 }}>
        Proves write-then-read actually verifies persistence (and not just RAM
        cache) for this firmware. Backs up + restores a single scratch channel
        name. Reboots the radio up to 3 times.
      </p>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <Field label={`Scratch channel (1..${maxChannel})`}>
          <input
            type="number"
            min={1}
            max={maxChannel}
            value={scratchChannel}
            onChange={(e) => setScratchChannel(e.target.value)}
            disabled={running}
            style={inputStyle}
          />
        </Field>
        <Field label="Unmapped test address (optional, hex)">
          <input
            type="text"
            placeholder="e.g. 0x5000"
            value={unmappedAddress}
            onChange={(e) => setUnmappedAddress(e.target.value)}
            disabled={running}
            style={inputStyle}
          />
        </Field>
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={running}
          />
          <span>
            I confirm channel {scratchChannel} is unused. Its name will be
            overwritten and restored.
          </span>
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={run} disabled={!confirmed || running}>
          {running ? "Running…" : "Run self-test"}
        </button>
      </div>

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

      {steps.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Progress</div>
          <ol style={{ marginTop: 4, paddingLeft: 20, fontSize: 13 }}>
            {steps.map((s, i) => (
              <li key={i}>
                <code style={{ marginRight: 6 }}>{s.step}</code>
                {s.detail ? <span>{s.detail}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {report ? <ReportView report={report} /> : null}
    </Section>
  );
}

function ReportView({ report }: { report: SelfTestReport }) {
  const color = report.passed ? "#2e7d32" : "#c0392b";
  return (
    <div
      style={{
        marginTop: 20,
        border: `1px solid ${color}`,
        borderRadius: 6,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <strong style={{ color }}>{report.passed ? "PASS" : "FAIL"}</strong>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {report.firmwareVersion} · {report.radioModel}
        </span>
      </div>
      <ResultRow name="Protocol roundtrip" result={report.tests.protocolRoundtrip} />
      <ResultRow
        name="Persistence across reboot"
        result={report.tests.persistenceAcrossReboot}
      />
      <ResultRow name="Silent-drop detection" result={report.tests.silentDropDetection} />
      <div style={{ marginTop: 8, fontSize: 13 }}>
        <strong>Recommendations:</strong>{" "}
        rebootWaitMs={report.recommendations.rebootWaitMs}; trustReadback=
        <code>{report.recommendations.trustReadback}</code>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>Raw JSON</summary>
        <pre
          style={{
            background: "var(--border)",
            padding: 8,
            fontSize: 12,
            overflow: "auto",
            borderRadius: 4,
          }}
        >
          {JSON.stringify(report, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function ResultRow({
  name,
  result,
}: {
  name: string;
  result: { status: string; detail?: string; durationMs?: number };
}) {
  const color =
    result.status === "pass"
      ? "#2e7d32"
      : result.status === "fail"
        ? "#c0392b"
        : "var(--muted)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 80px 1fr",
        gap: 12,
        padding: "4px 0",
        fontSize: 14,
      }}
    >
      <div>{name}</div>
      <div style={{ color, textTransform: "uppercase", fontSize: 12 }}>
        {result.status}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        {result.detail ?? ""}
      </div>
    </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{label}</span>
      {children}
    </label>
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
