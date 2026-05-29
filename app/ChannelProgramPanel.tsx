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
} from "../src/config";
import { planWrites } from "../src/writer/planner";
import { executeWritePlan } from "../src/writer/executor";
import type { ExecResult, WritePlan } from "../src/writer/plan";
import type { Session } from "../src/protocol/session";
import type {
  ResolvedArrayModule,
  ResolvedProfile,
} from "../src/schema/types";
import {
  bandIndexForMHz,
  guessModulation,
  type ChannelMode,
  type ChannelModeSelection,
} from "./bandPlan";

const MODE_OPTIONS: ReadonlyArray<ChannelMode> = ["FM", "AM", "USB", "CW"];

const TX_POWER_OPTIONS = [
  "Low1",
  "Low2",
  "Low3",
  "Low4",
  "Low5",
  "Mid",
  "High",
] as const;

const BANDWIDTH_OPTIONS = ["Wide (25 kHz)", "Narrow (12.5 kHz)"] as const;
type Bandwidth = (typeof BANDWIDTH_OPTIONS)[number];

const DEFAULT_FREQ_MHZ = "146.520"; // 2 m simplex calling
const DEFAULT_CHANNEL_INDEX = 1;
const DEFAULT_CHANNEL_NAME = "CH 1";
const DEFAULT_TX_POWER = "Low3";

/**
 * Default bandwidth per modulation. CW and USB benefit from the narrower
 * IF filter; FM voice on VHF/UHF in the US is still mostly 25 kHz wide;
 * AM aviation channels are 25 kHz.
 */
function defaultBandwidthForMode(mode: ChannelMode): Bandwidth {
  if (mode === "CW" || mode === "USB") return "Narrow (12.5 kHz)";
  return "Wide (25 kHz)";
}

type Stage =
  | { kind: "idle" }
  | { kind: "form-error"; message: string }
  | { kind: "reading"; done: number; total: number; current: string }
  | { kind: "read-error"; message: string }
  | { kind: "previewed"; cfg: BkgConfig; applied: ApplyResult; plan: WritePlan }
  | { kind: "writing"; done: number; total: number; batchId: string }
  | { kind: "done"; result: ExecResult }
  | { kind: "write-error"; message: string };

export function ChannelProgramPanel() {
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

  // Need writable `channels` and `channel_attrs` arrays. Stock profiles
  // mark all channel modules read-only; the panel is meaningless there.
  const channels = findArray(resolved, "channels");
  const attrs = findArray(resolved, "channel_attrs");
  if (!channels || !attrs) return null;
  if (channels.readOnly || attrs.readOnly) return null;

  return (
    <ChannelProgramInner
      session={state.session}
      profileId={profileId}
      resolved={resolved}
      channelCount={channels.count}
      attrTemplateFieldIds={attrs.template.fields.map((f) => f.id)}
    />
  );
}

function findArray(
  resolved: ResolvedProfile,
  id: string,
): ResolvedArrayModule | undefined {
  return resolved.modules.find(
    (m): m is ResolvedArrayModule => m.kind === "array" && m.id === id,
  );
}

function ChannelProgramInner({
  session,
  profileId,
  resolved,
  channelCount,
  attrTemplateFieldIds,
}: {
  session: Session;
  profileId: string;
  resolved: ResolvedProfile;
  channelCount: number;
  attrTemplateFieldIds: ReadonlyArray<string>;
}) {
  const [channelIndex, setChannelIndex] = useState<number>(DEFAULT_CHANNEL_INDEX);
  const [channelName, setChannelName] = useState<string>(DEFAULT_CHANNEL_NAME);
  const [freqMhz, setFreqMhz] = useState<string>(DEFAULT_FREQ_MHZ);
  const [modeSelection, setModeSelection] = useState<ChannelModeSelection>({
    kind: "auto",
  });
  // Bandwidth is tri-state: 'auto' follows the mode; otherwise an explicit
  // wide/narrow override the user dialed in.
  const [bandwidthChoice, setBandwidthChoice] = useState<"auto" | Bandwidth>(
    "auto",
  );
  const [txPower, setTxPower] = useState<string>(DEFAULT_TX_POWER);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const parsedFreq = useMemo(() => parseFloat(freqMhz), [freqMhz]);

  const guess = useMemo(() => guessModulation(parsedFreq), [parsedFreq]);

  const effectiveMode: ChannelMode =
    modeSelection.kind === "auto" ? guess.mode : modeSelection.mode;

  const effectiveBandwidth: Bandwidth =
    bandwidthChoice === "auto"
      ? defaultBandwidthForMode(effectiveMode)
      : bandwidthChoice;

  const formError = useMemo<string | null>(() => {
    if (!Number.isInteger(channelIndex) || channelIndex < 1 || channelIndex > channelCount) {
      return `Channel slot must be an integer 1..${channelCount}.`;
    }
    if (channelName.length === 0 || channelName.length > 10) {
      return "Channel name must be 1..10 ASCII characters.";
    }
    if (!/^[\x20-\x7E]*$/.test(channelName)) {
      return "Channel name must be printable ASCII.";
    }
    if (!Number.isFinite(parsedFreq) || parsedFreq < 18 || parsedFreq > 1300) {
      return "Frequency must be 18..1300 MHz (radio tuning range).";
    }
    return null;
  }, [channelIndex, channelName, parsedFreq, channelCount]);

  // Sparse channel_attrs entry. The template differs between V1 (1 byte:
  // band/compander/scanlist1/scanlist2) and V3/K1 (2 bytes: band/compander/
  // exclude/scanlist). Detect via the resolved template's field IDs and
  // emit only the fields that actually exist — otherwise applyConfig
  // rejects with `unknown-field`.
  const attrFields = useMemo<{ readonly [id: string]: number | string | boolean }>(() => {
    const band = bandIndexForMHz(parsedFreq);
    const has = (id: string) => attrTemplateFieldIds.includes(id);
    const out: Record<string, number | string | boolean> = { band };
    if (has("compander")) out.compander = "Off";
    if (has("exclude")) out.exclude = false;
    if (has("scanlist")) out.scanlist = "Off";
    if (has("scanlist1")) out.scanlist1 = false;
    if (has("scanlist2")) out.scanlist2 = false;
    return out;
  }, [parsedFreq, attrTemplateFieldIds]);

  const cfg = useMemo<BkgConfig | null>(() => {
    if (formError) return null;
    return {
      schemaVersion: 1,
      name: `Channel ${channelIndex} — ${channelName}`,
      notes:
        `Generated by ChannelProgramPanel. Touches channel ${channelIndex} ` +
        `(rx/tx freq, modulation, bandwidth, tx_power, name) and its ` +
        `channel_attrs entry (band). Mode source: ` +
        (modeSelection.kind === "auto"
          ? `auto-guess from ${freqMhz} MHz (${guess.reason}).`
          : `user override (${modeSelection.mode}).`),
      appliesTo: { profileIds: [profileId] },
      channels: [
        {
          index: channelIndex,
          name: channelName,
          fields: {
            rx_freq: `${freqMhz} MHz`,
            tx_offset_freq: 0,
            tx_offset_dir: "Off (simplex)",
            rx_code_type: "Off",
            tx_code_type: "Off",
            modulation: effectiveMode,
            bandwidth: effectiveBandwidth,
            tx_power: txPower,
          },
        },
      ],
      // Without a valid channel_attrs entry the firmware treats the slot
      // as unused (radio.c:318-328 — `att->__val == 0xFFFF` → bail to
      // RADIO_InitInfo defaults (FM, LOW1) without reading the channel
      // record). Same gotcha that bit CwQuickSetupPanel.
      channelAttrs: [
        {
          index: channelIndex,
          fields: attrFields,
        },
      ],
    };
  }, [
    formError,
    channelIndex,
    channelName,
    freqMhz,
    effectiveMode,
    effectiveBandwidth,
    txPower,
    profileId,
    attrFields,
    modeSelection,
    guess.reason,
  ]);

  const cfgJson = useMemo(() => (cfg ? JSON.stringify(cfg, null, 2) : ""), [cfg]);

  useEffect(() => {
    if (!cfg) return;
    try {
      parseConfig(JSON.stringify(cfg));
      if (stage.kind === "form-error") setStage({ kind: "idle" });
    } catch (err) {
      setStage({
        kind: "form-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  async function loadAndPreview() {
    if (!cfg) return;
    const regions = requiredRegions(cfg, resolved);
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
      const applied = applyConfig(cfg, resolved, current);
      const plan = planWrites(resolved, current, applied.target, applied.fieldChanges);
      setStage({ kind: "previewed", cfg, applied, plan });
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
      setStage({ kind: "done", result });
    } catch (err) {
      setStage({
        kind: "write-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset() {
    setStage({ kind: "idle" });
  }

  const busy = stage.kind === "reading" || stage.kind === "writing";

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 20,
        marginTop: 20,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18 }}>Program a channel</h2>
      <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
        Set one channel slot: name, frequency, modulation. Mode defaults
        to <strong>Auto</strong>, which picks from the ARRL US band plan
        plus aviation AM. Profile: <code>{profileId}</code>.
      </p>

      <FieldGrid>
        <NumberField
          label="Channel slot"
          value={channelIndex}
          min={1}
          max={channelCount}
          onChange={setChannelIndex}
          disabled={busy}
          hint={`1-based, matching the radio menu (max ${channelCount} on this profile).`}
        />
        <TextField
          label="Channel name"
          value={channelName}
          maxLength={10}
          onChange={setChannelName}
          disabled={busy}
          hint="Up to 10 printable ASCII characters."
        />
        <TextField
          label="Frequency (MHz)"
          value={freqMhz}
          onChange={setFreqMhz}
          disabled={busy}
          hint="Simplex; RX = TX. Default 146.520 (2 m calling)."
        />
        <ModeField
          selection={modeSelection}
          guess={guess}
          onChange={setModeSelection}
          disabled={busy}
        />
        <BandwidthField
          choice={bandwidthChoice}
          effective={effectiveBandwidth}
          modeForDefault={effectiveMode}
          onChange={setBandwidthChoice}
          disabled={busy}
        />
        <SelectField
          label="TX power"
          value={txPower}
          options={[...TX_POWER_OPTIONS]}
          onChange={setTxPower}
          disabled={busy}
          hint="OUTPUT_POWER. Low3 ≈ 250 mW; Mid ≈ 2 W."
        />
      </FieldGrid>

      {formError ? <Banner kind="error">{formError}</Banner> : null}

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>
          Generated config
        </summary>
        <pre
          style={{
            marginTop: 8,
            padding: 10,
            background: "rgba(0,0,0,0.04)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          {cfgJson || "(form has errors)"}
        </pre>
      </details>

      <StageView
        stage={stage}
        canPreview={!formError && !busy}
        onLoadAndPreview={loadAndPreview}
        onExecute={execute}
        onReset={reset}
      />
    </section>
  );
}

function ModeField({
  selection,
  guess,
  onChange,
  disabled,
}: {
  selection: ChannelModeSelection;
  guess: ReturnType<typeof guessModulation>;
  onChange: (s: ChannelModeSelection) => void;
  disabled: boolean;
}) {
  const value = selection.kind === "auto" ? "auto" : selection.mode;
  return (
    <label style={{ display: "block", fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>Modulation</div>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "auto") onChange({ kind: "auto" });
          else onChange({ kind: "explicit", mode: v as ChannelMode });
        }}
        style={inputStyle}
      >
        <option value="auto">Auto (band plan)</option>
        {MODE_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <Hint>
        {selection.kind === "auto" ? (
          <>
            Auto → <strong>{guess.mode}</strong>. {guess.reason}.
          </>
        ) : (
          <>
            User-set <strong>{selection.mode}</strong>. Band-plan would
            have picked <strong>{guess.mode}</strong> ({guess.reason}).
          </>
        )}
      </Hint>
    </label>
  );
}

function BandwidthField({
  choice,
  effective,
  modeForDefault,
  onChange,
  disabled,
}: {
  choice: "auto" | Bandwidth;
  effective: Bandwidth;
  modeForDefault: ChannelMode;
  onChange: (c: "auto" | Bandwidth) => void;
  disabled: boolean;
}) {
  return (
    <label style={{ display: "block", fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>Bandwidth</div>
      <select
        value={choice}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "auto") onChange("auto");
          else onChange(v as Bandwidth);
        }}
        style={inputStyle}
      >
        <option value="auto">Auto (follows mode)</option>
        {BANDWIDTH_OPTIONS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <Hint>
        {choice === "auto" ? (
          <>
            Auto → <code>{effective}</code> ({modeForDefault} default).
          </>
        ) : (
          <>User-set.</>
        )}
      </Hint>
    </label>
  );
}

function StageView({
  stage,
  canPreview,
  onLoadAndPreview,
  onExecute,
  onReset,
}: {
  stage: Stage;
  canPreview: boolean;
  onLoadAndPreview: () => void;
  onExecute: () => void;
  onReset: () => void;
}) {
  if (stage.kind === "idle" || stage.kind === "form-error") {
    return (
      <ActionRow>
        <button onClick={onLoadAndPreview} disabled={!canPreview}>
          Read radio and preview
        </button>
      </ActionRow>
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
            Back to form
          </button>
        </ActionRow>
      </>
    );
  }

  if (stage.kind === "previewed") {
    const hasErrors = stage.applied.errors.length > 0;
    const nothingToDo = !hasErrors && stage.applied.fieldChanges.length === 0;
    return (
      <>
        {hasErrors ? (
          <Banner kind="error">
            <strong>
              {stage.applied.errors.length} error
              {stage.applied.errors.length === 1 ? "" : "s"}.
            </strong>{" "}
            Write disabled.
          </Banner>
        ) : nothingToDo ? (
          <Banner kind="info">
            <strong>No changes.</strong> The radio already matches.
          </Banner>
        ) : (
          <Banner kind="info">
            <strong>{stage.applied.fieldChanges.length} field change(s).</strong>{" "}
            {stage.plan.batches.length} batch(es),{" "}
            {stage.plan.totals.bytesWritten.toLocaleString()} bytes. Estimated ~
            {Math.round(stage.plan.totals.estimatedDurationMs / 100) / 10}s.
          </Banner>
        )}

        {stage.applied.errors.length > 0 ? (
          <SimpleErrorList items={stage.applied.errors} />
        ) : null}

        <DiffTable changes={stage.applied.fieldChanges} />

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
    const r = stage.result;
    if (r.status === "success") {
      return (
        <>
          <Banner kind="success">
            <strong>Written and verified.</strong> {r.batchesWritten} batch(es)
            in {Math.round(r.durationMs)} ms.
          </Banner>
          <ActionRow>
            <button onClick={onReset}>Back to form</button>
          </ActionRow>
        </>
      );
    }
    return (
      <>
        <Banner kind="warn">
          <strong>Write completed with status: {r.status}.</strong> See the
          program tool's main config panel for the full result detail.
        </Banner>
        <ActionRow>
          <button onClick={onReset}>Back to form</button>
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
            Back to form
          </button>
        </ActionRow>
      </>
    );
  }

  return null;
}

function DiffTable({ changes }: { changes: ApplyResult["fieldChanges"] }) {
  if (changes.length === 0) return null;
  return (
    <details open style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>
        {changes.length} field change(s)
      </summary>
      <table style={{ marginTop: 8, fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ color: "var(--muted)", textAlign: "left" }}>
            <th style={{ padding: "2px 12px 2px 0" }}>Field</th>
            <th style={{ padding: "2px 12px 2px 0" }}>Before</th>
            <th style={{ padding: "2px 12px 2px 0" }}>After</th>
            <th style={{ padding: "2px 12px 2px 0" }}>Address</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c, i) => (
            <tr key={i}>
              <td style={{ padding: "2px 12px 2px 0" }}>{c.fieldLabel}</td>
              <td style={{ padding: "2px 12px 2px 0", color: "var(--muted)" }}>
                <code>{c.before.display}</code>
              </td>
              <td style={{ padding: "2px 12px 2px 0" }}>
                <code>{c.after.display}</code>
              </td>
              <td style={{ padding: "2px 12px 2px 0", color: "var(--muted)" }}>
                <code>0x{c.byteRange.start.toString(16).padStart(4, "0").toUpperCase()}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function SimpleErrorList({
  items,
}: {
  items: ReadonlyArray<{ path: string; message: string; kind?: string }>;
}) {
  return (
    <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12 }}>
      {items.map((e, i) => (
        <li key={i} style={{ marginTop: 4 }}>
          <code style={{ color: "#c0392b" }}>{e.path}</code>
          {e.kind ? <code style={{ color: "var(--muted)", marginLeft: 8 }}>[{e.kind}]</code> : null}
          <div style={{ color: "var(--muted)" }}>{e.message}</div>
        </li>
      ))}
    </ul>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "10px 16px",
      }}
    >
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <label style={{ display: "block", fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={inputStyle}
      />
      {hint ? <Hint>{hint}</Hint> : null}
    </label>
  );
}

function TextField({
  label,
  value,
  maxLength,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  maxLength?: number;
  onChange: (s: string) => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <label style={{ display: "block", fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
      {hint ? <Hint>{hint}</Hint> : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<string>;
  onChange: (s: string) => void;
  disabled: boolean;
  hint?: string;
}) {
  return (
    <label style={{ display: "block", fontSize: 13 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {hint ? <Hint>{hint}</Hint> : null}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 2, color: "var(--muted)", fontSize: 11 }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  marginTop: 2,
  width: "100%",
  font: "13px ui-monospace, monospace",
  color: "inherit",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "4px 6px",
};

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
