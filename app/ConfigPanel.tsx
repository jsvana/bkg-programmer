"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "./SessionContext";
import { findProfile, resolveProfileById } from "./profileLookup";
import { EepromSnapshot } from "../src/backup/snapshot";
import {
  parseConfig,
  applyConfig,
  requiredRegions,
  type BkgConfig,
  type ApplyResult,
  type RegionRange,
} from "../src/config";
import { planWrites } from "../src/writer/planner";
import { executeWritePlan } from "../src/writer/executor";
import type { ExecResult, WritePlan, WriteBatch } from "../src/writer/plan";
import type { Session } from "../src/protocol/session";
import type { ResolvedProfile } from "../src/schema/types";

type Stage =
  | { kind: "idle" }
  | { kind: "parse-error"; message: string }
  | { kind: "parsed"; config: BkgConfig; regions: RegionRange[] }
  | { kind: "reading"; done: number; total: number; current: string }
  | { kind: "read-error"; message: string }
  | { kind: "previewed"; config: BkgConfig; applied: ApplyResult; plan: WritePlan }
  | { kind: "writing"; done: number; total: number; batchId: string }
  | { kind: "done"; result: ExecResult; plan: WritePlan }
  | { kind: "write-error"; message: string };

export function ConfigPanel() {
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

  return (
    <ConfigPanelInner
      profileId={profileId}
      resolved={resolved}
      session={state.session}
    />
  );
}

function ConfigPanelInner({
  profileId,
  resolved,
  session,
}: {
  profileId: string;
  resolved: ResolvedProfile;
  session: Session;
}) {
  const [text, setText] = useState<string>("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  // Parse on text change. Cheap; debouncing isn't necessary.
  useEffect(() => {
    if (text.trim().length === 0) {
      setStage({ kind: "idle" });
      return;
    }
    try {
      const cfg = parseConfig(text);
      const regions = requiredRegions(cfg, resolved);
      setStage({ kind: "parsed", config: cfg, regions });
    } catch (err) {
      setStage({
        kind: "parse-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [text, resolved]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setText(t);
  }

  async function loadAndPreview() {
    if (stage.kind !== "parsed") return;
    const { config, regions } = stage;
    const totalBytes = regions.reduce((s, r) => s + r.length, 0);
    setStage({ kind: "reading", done: 0, total: totalBytes, current: "" });
    try {
      const current = new EepromSnapshot();
      let done = 0;
      for (const r of regions) {
        setStage({ kind: "reading", done, total: totalBytes, current: r.label });
        const data = await session.readEeprom(r.start, r.length);
        current.addRegion(r.start, data);
        done += r.length;
        setStage({ kind: "reading", done, total: totalBytes, current: r.label });
      }
      const applied = applyConfig(config, resolved, current);
      const plan = planWrites(resolved, current, applied.target, applied.fieldChanges);
      setStage({ kind: "previewed", config, applied, plan });
    } catch (err) {
      setStage({
        kind: "read-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function execute() {
    if (stage.kind !== "previewed") return;
    const { plan } = stage;
    setStage({ kind: "writing", done: 0, total: plan.batches.length, batchId: "" });
    try {
      const result = await executeWritePlan(plan, session, {
        onPreflight: () => {},
        onProgress: (done, total, batch) => {
          setStage({ kind: "writing", done, total, batchId: batch.id });
        },
      });
      setStage({ kind: "done", result, plan });
    } catch (err) {
      setStage({
        kind: "write-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset() {
    setText("");
    setStage({ kind: "idle" });
  }

  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18 }}>Load configuration</h2>
      <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
        Drop a BKG config JSON file here, preview the diff against the live
        radio, then write. Configs are sparse overlays — channels and fields
        not mentioned are preserved. Active profile:{" "}
        <code>{profileId}</code>.
      </p>

      <FileChooser onFile={onFile} disabled={stage.kind === "reading" || stage.kind === "writing"} />

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>
          Or paste JSON
        </summary>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder='{ "schemaVersion": 1, "channels": [...] }'
          style={{
            marginTop: 8,
            width: "100%",
            font: "13px ui-monospace, monospace",
            color: "inherit",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 8,
            resize: "vertical",
          }}
        />
      </details>

      <StageView
        stage={stage}
        onLoadAndPreview={loadAndPreview}
        onExecute={execute}
        onReset={reset}
      />
    </Section>
  );
}

function FileChooser({
  onFile,
  disabled,
}: {
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <input
        type="file"
        accept="application/json,.json"
        onChange={onFile}
        disabled={disabled}
        style={{ fontSize: 13 }}
      />
    </div>
  );
}

function StageView({
  stage,
  onLoadAndPreview,
  onExecute,
  onReset,
}: {
  stage: Stage;
  onLoadAndPreview: () => void;
  onExecute: () => void;
  onReset: () => void;
}) {
  if (stage.kind === "idle") {
    return null;
  }

  if (stage.kind === "parse-error") {
    return (
      <Banner kind="error">
        <strong>Parse error.</strong> {stage.message}
      </Banner>
    );
  }

  if (stage.kind === "parsed") {
    const total = stage.regions.reduce((s, r) => s + r.length, 0);
    return (
      <>
        <Banner kind="info">
          <strong>Ready.</strong>{" "}
          {stage.config.name ? `"${stage.config.name}" · ` : ""}
          {stage.regions.length} region(s), {total.toLocaleString()} bytes to
          read from radio before applying.
        </Banner>
        <RegionTable regions={stage.regions} />
        <ActionRow>
          <button onClick={onLoadAndPreview}>Read radio and preview</button>
          <button className="secondary" onClick={onReset}>
            Clear
          </button>
        </ActionRow>
      </>
    );
  }

  if (stage.kind === "reading") {
    const pct = stage.total === 0 ? 0 : Math.round((stage.done / stage.total) * 100);
    return (
      <ProgressBlock
        label={`Reading ${stage.current || "…"} — ${stage.done}/${stage.total} bytes`}
        pct={pct}
      />
    );
  }

  if (stage.kind === "read-error") {
    return (
      <>
        <Banner kind="error">
          <strong>Read failed.</strong> {stage.message}
        </Banner>
        <ActionRow>
          <button className="secondary" onClick={onReset}>
            Clear
          </button>
        </ActionRow>
      </>
    );
  }

  if (stage.kind === "previewed") {
    return (
      <PreviewView
        applied={stage.applied}
        plan={stage.plan}
        onExecute={onExecute}
        onReset={onReset}
      />
    );
  }

  if (stage.kind === "writing") {
    const pct = stage.total === 0 ? 0 : Math.round((stage.done / stage.total) * 100);
    return (
      <ProgressBlock
        label={`Writing ${stage.batchId} — batch ${stage.done}/${stage.total}`}
        pct={pct}
      />
    );
  }

  if (stage.kind === "done") {
    return (
      <>
        <ResultBanner result={stage.result} />
        <ActionRow>
          <button onClick={onReset}>Load another config</button>
        </ActionRow>
      </>
    );
  }

  if (stage.kind === "write-error") {
    return (
      <>
        <Banner kind="error">
          <strong>Write failed.</strong> {stage.message}
        </Banner>
        <ActionRow>
          <button className="secondary" onClick={onReset}>
            Clear
          </button>
        </ActionRow>
      </>
    );
  }

  return null;
}

function PreviewView({
  applied,
  plan,
  onExecute,
  onReset,
}: {
  applied: ApplyResult;
  plan: WritePlan;
  onExecute: () => void;
  onReset: () => void;
}) {
  const hasErrors = applied.errors.length > 0;
  const nothingToDo = !hasErrors && applied.fieldChanges.length === 0;

  return (
    <>
      {hasErrors ? (
        <Banner kind="error">
          <strong>
            {applied.errors.length} error{applied.errors.length === 1 ? "" : "s"}.
          </strong>{" "}
          Write disabled until resolved.
        </Banner>
      ) : nothingToDo ? (
        <Banner kind="info">
          <strong>No changes.</strong> The config matches the radio's
          current state. Nothing to write.
        </Banner>
      ) : (
        <Banner kind="info">
          <strong>{applied.fieldChanges.length} field change(s).</strong>{" "}
          {plan.batches.length} batch(es), {plan.totals.bytesWritten.toLocaleString()}{" "}
          bytes to write. Estimated ~{Math.round(plan.totals.estimatedDurationMs / 100) / 10}s.
        </Banner>
      )}

      {applied.errors.length > 0 ? (
        <ErrorList items={applied.errors} title="Errors" />
      ) : null}

      {applied.warnings.length > 0 ? (
        <ErrorList items={applied.warnings} title="Warnings" tone="warn" />
      ) : null}

      {applied.fieldChanges.length > 0 ? (
        <DiffTable changes={applied.fieldChanges} />
      ) : null}

      <ActionRow>
        <button
          onClick={onExecute}
          disabled={hasErrors || nothingToDo}
          style={
            hasErrors || nothingToDo
              ? {}
              : { background: "#2e7d32", color: "white", borderColor: "#2e7d32" }
          }
        >
          Write to radio
        </button>
        <button className="secondary" onClick={onReset}>
          Cancel
        </button>
      </ActionRow>
    </>
  );
}

function DiffTable({
  changes,
}: {
  changes: ApplyResult["fieldChanges"];
}) {
  // Group by the part of fieldPath up to the first ']' or '.', so all
  // changes for one channel/module land together.
  const groups = useMemo(() => {
    const m = new Map<string, ApplyResult["fieldChanges"]>();
    for (const c of changes) {
      const key = groupKey(c.fieldPath);
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return [...m.entries()];
  }, [changes]);

  return (
    <details open style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>
        {changes.length} field change(s)
      </summary>
      <div style={{ marginTop: 8 }}>
        {groups.map(([key, items]) => (
          <div key={key} style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{key}</div>
            <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                  <th style={{ padding: "2px 12px 2px 0" }}>Field</th>
                  <th style={{ padding: "2px 12px 2px 0" }}>Before</th>
                  <th style={{ padding: "2px 12px 2px 0" }}>After</th>
                  <th style={{ padding: "2px 12px 2px 0" }}>Address</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c, i) => (
                  <tr key={i}>
                    <td style={{ padding: "2px 12px 2px 0" }}>{c.fieldLabel}</td>
                    <td style={{ padding: "2px 12px 2px 0", color: "var(--muted)" }}>
                      <code>{c.before.display}</code>
                    </td>
                    <td style={{ padding: "2px 12px 2px 0" }}>
                      <code>{c.after.display}</code>
                    </td>
                    <td style={{ padding: "2px 12px 2px 0", color: "var(--muted)" }}>
                      <code>
                        0x{c.byteRange.start.toString(16).padStart(4, "0").toUpperCase()}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
}

function groupKey(path: string): string {
  // "channels[0].rx_freq" → "channels[0]"
  // "channels[2].name.name" → "channels[2].name"
  // "settings.f4hwn_settings.set_pwr" → "settings.f4hwn_settings"
  const bracketIdx = path.indexOf("]");
  if (bracketIdx !== -1) {
    const afterBracket = path.indexOf(".", bracketIdx);
    return afterBracket === -1 ? path : path.slice(0, afterBracket);
  }
  const parts = path.split(".");
  return parts.slice(0, parts.length - 1).join(".") || path;
}

function ErrorList({
  items,
  title,
  tone = "error",
}: {
  items: ReadonlyArray<{ path: string; message: string; kind?: string }>;
  title: string;
  tone?: "error" | "warn";
}) {
  return (
    <details open={tone === "error"} style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, color: tone === "error" ? "#c0392b" : "#b88a00" }}>
        {title} ({items.length})
      </summary>
      <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12 }}>
        {items.map((e, i) => (
          <li key={i} style={{ marginTop: 4 }}>
            <code style={{ color: tone === "error" ? "#c0392b" : "#b88a00" }}>
              {e.path}
            </code>
            {e.kind ? <code style={{ color: "var(--muted)", marginLeft: 8 }}>[{e.kind}]</code> : null}
            <div style={{ color: "var(--muted)" }}>{e.message}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function RegionTable({ regions }: { regions: RegionRange[] }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>
        Read plan ({regions.length} region{regions.length === 1 ? "" : "s"})
      </summary>
      <table style={{ marginTop: 8, fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--muted)", textAlign: "left" }}>
            <th style={{ padding: "2px 12px 2px 0" }}>Label</th>
            <th style={{ padding: "2px 12px 2px 0" }}>Start</th>
            <th style={{ padding: "2px 12px 2px 0" }}>Length</th>
          </tr>
        </thead>
        <tbody>
          {regions.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: "2px 12px 2px 0" }}>{r.label}</td>
              <td style={{ padding: "2px 12px 2px 0" }}>
                <code>0x{r.start.toString(16).padStart(4, "0").toUpperCase()}</code>
              </td>
              <td style={{ padding: "2px 12px 2px 0" }}>
                <code>{r.length}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function ResultBanner({ result }: { result: ExecResult }) {
  if (result.status === "success") {
    return (
      <Banner kind="success">
        <strong>Written and verified.</strong> {result.batchesWritten} batch(es)
        in {Math.round(result.durationMs)} ms.
      </Banner>
    );
  }
  if (result.status === "success-with-warnings") {
    return (
      <Banner kind="warn">
        <strong>Written with warnings.</strong>{" "}
        {result.warnings.map((w) => w.message).join("; ")}
      </Banner>
    );
  }
  if (result.status === "aborted-preflight") {
    return (
      <Banner kind="error">
        <strong>Aborted at preflight.</strong>{" "}
        {result.failedChecks.map((c) => `${c.id}: ${c.message}`).join("; ")}
      </Banner>
    );
  }
  // aborted-mid-execute
  const r = result.reason;
  const reasonText =
    r.kind === "verify-mismatch"
      ? `verify mismatch at batch ${result.failedBatch.id}`
      : r.kind === "snapshot-drift"
        ? `snapshot drift at 0x${r.address.toString(16)}`
        : r.kind === "protocol-error"
          ? `protocol error: ${r.underlying.message}`
          : r.kind === "timeout"
            ? `timeout after ${r.afterMs} ms`
            : r.kind;
  return (
    <Banner kind="error">
      <strong>Aborted mid-execute.</strong> {reasonText}. Last successful batch:{" "}
      {result.lastBatchOk}.
    </Banner>
  );
}

function ProgressBlock({ label, pct }: { label: string; pct: number }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div
        style={{
          marginTop: 6,
          height: 6,
          background: "var(--border)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: "#2e7d32" }} />
      </div>
    </div>
  );
}

function Banner({
  children,
  kind,
}: {
  children: React.ReactNode;
  kind: "info" | "error" | "warn" | "success";
}) {
  const colors = {
    info: { border: "var(--border)", bg: "rgba(0,0,0,0.02)", fg: "inherit" },
    error: { border: "#c0392b", bg: "rgba(192,57,43,0.08)", fg: "#c0392b" },
    warn: { border: "#b88a00", bg: "rgba(184,138,0,0.08)", fg: "#b88a00" },
    success: { border: "#2e7d32", bg: "rgba(46,125,50,0.08)", fg: "#2e7d32" },
  }[kind];
  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.fg,
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      {children}
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

function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 16,
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}
