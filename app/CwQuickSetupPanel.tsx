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

// Map a 2m/HF/UHF frequency (MHz) to the briand `FREQUENCY_Band_t` index
// (the same index stored in channel_attrs.band). Mirrors
// App/frequencies.c FREQUENCY_GetBand exactly — pick the highest band whose
// lower bound ≤ frequency. The .lower values in the firmware table are in
// units of 10 Hz; we compare MHz against the equivalent here.
// Source: App/frequencies.c:30-46, :118-125.
function bandIndexForMHz(freqMhz: number): number {
  // [band index, lower MHz]
  const tbl: ReadonlyArray<[number, number]> = [
    [6, 470], // BAND7_470MHz
    [5, 400], // BAND6_400MHz
    [4, 350], // BAND5_350MHz
    [3, 174], // BAND4_174MHz
    [2, 137], // BAND3_137MHz
    [1, 108], // BAND2_108MHz
    [0, 50],  // BAND1_50MHz
  ];
  for (const [idx, lower] of tbl) {
    if (freqMhz >= lower) return idx;
  }
  return 0;
}

// Defaults answered by the user 2026-05-26:
//   menu 2  → tx_power = Low3 (~250 mW)
//   menu 12 → modulation = CW
//   menu 71 → cw_keyer_mode = Iambic B
//   menu 72 → user-entered WPM, validated client-side (10..40)
//   menu 73 → cw_key_input_menu = "Port+Btn Iambic" (index 6, bitmap 0x16)
// Channel: THE YARD at 144.025 MHz, channel slot 1.
const DEFAULT_CHANNEL_INDEX = 1;
const DEFAULT_CHANNEL_NAME = "THE YARD";
const DEFAULT_FREQ_MHZ = "144.025";
const DEFAULT_TX_POWER = "Low3";
const DEFAULT_KEYER_MODE = "Iambic B";
const DEFAULT_WPM = 18;
// Default to a port-free mode. The programming cable occupies the same
// TRRS jack the firmware monitors for paddle dit/dah lines. If we
// default to anything that polls the port (modes 1, 4-7), at next boot
// CW_CheckKeyerInputs (App/app/cwkeyer.c:460-507) sees the cable as a
// stuck paddle and main.c:208-229 throws up "CW KEY STUCK / Port Input
// disabled", blocks the boot loop for 2 seconds, then reverts to
// HANDKEY anyway. Two-second window means the next host hello times
// out → user can't reconnect, looks broken.
const DEFAULT_KEY_INPUT = "PTT HandKey";

// Modes that poll the TRRS port. Setting any of these via this panel
// while the programming cable is plugged in is the foot-gun above.
const PORT_USING_KEY_INPUTS = new Set<string>([
  "Port HandKey",
  "Port Iambic",
  "Port Iambic Reversed",
  "Port+Btn Iambic",
  "Port+Btn Iambic Reversed",
]);

const TX_POWER_OPTIONS = [
  "Low1",
  "Low2",
  "Low3",
  "Low4",
  "Low5",
  "Mid",
  "High",
] as const;
const KEYER_MODE_OPTIONS = ["Iambic A", "Iambic B"] as const;
const KEY_INPUT_OPTIONS = [
  "PTT HandKey",
  "Port HandKey",
  "Side Btn Iambic",
  "Side Btn Iambic Reversed",
  "Port Iambic",
  "Port Iambic Reversed",
  "Port+Btn Iambic",
  "Port+Btn Iambic Reversed",
] as const;

type Stage =
  | { kind: "idle" }
  | { kind: "form-error"; message: string }
  | { kind: "reading"; done: number; total: number; current: string }
  | { kind: "read-error"; message: string }
  | { kind: "previewed"; cfg: BkgConfig; applied: ApplyResult; plan: WritePlan }
  | { kind: "writing"; done: number; total: number; batchId: string }
  | { kind: "done"; result: ExecResult }
  | { kind: "write-error"; message: string };

export function CwQuickSetupPanel() {
  const { state } = useSession();
  if (state.kind !== "connected") return null;

  const profileId =
    state.result.firmware.kind === "matched"
      ? state.result.firmware.entry.profileId
      : undefined;

  // Only meaningful for NR7Y — that's where nr7y_cw_settings lives.
  if (profileId !== "uv-k1-f4hwn-nr7y") return null;

  const profile = findProfile(profileId);
  const resolved = resolveProfileById(profileId);
  if (!profile || !resolved) return null;

  return <CwQuickSetupInner session={state.session} profileId={profileId} resolved={resolved} />;
}

function CwQuickSetupInner({
  session,
  profileId,
  resolved,
}: {
  session: Session;
  profileId: string;
  resolved: ReturnType<typeof resolveProfileById> & object;
}) {
  const [channelIndex, setChannelIndex] = useState<number>(DEFAULT_CHANNEL_INDEX);
  const [channelName, setChannelName] = useState<string>(DEFAULT_CHANNEL_NAME);
  const [freqMhz, setFreqMhz] = useState<string>(DEFAULT_FREQ_MHZ);
  const [txPower, setTxPower] = useState<string>(DEFAULT_TX_POWER);
  const [keyerMode, setKeyerMode] = useState<string>(DEFAULT_KEYER_MODE);
  const [wpm, setWpm] = useState<string>(String(DEFAULT_WPM));
  const [keyInput, setKeyInput] = useState<string>(DEFAULT_KEY_INPUT);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  // Form validation, surfaced inline.
  const formError = useMemo<string | null>(() => {
    if (!Number.isInteger(channelIndex) || channelIndex < 1 || channelIndex > 200) {
      return "Channel slot must be an integer 1..200 (stock K1 menu cap).";
    }
    if (channelName.length === 0 || channelName.length > 10) {
      return "Channel name must be 1..10 ASCII characters.";
    }
    if (!/^[\x20-\x7E]*$/.test(channelName)) {
      return "Channel name must be printable ASCII.";
    }
    const freq = parseFloat(freqMhz);
    if (!Number.isFinite(freq) || freq < 18 || freq > 1300) {
      return "Frequency must be 18..1300 MHz.";
    }
    const wpmInt = parseInt(wpm, 10);
    if (!Number.isInteger(wpmInt) || wpmInt < 10 || wpmInt > 40) {
      return "WPM must be an integer between 10 and 40.";
    }
    return null;
  }, [channelIndex, channelName, freqMhz, wpm]);

  // Synthesised config (also displayed for transparency / hand-editing).
  const cfg = useMemo<BkgConfig | null>(() => {
    if (formError) return null;
    return {
      schemaVersion: 1,
      name: `CW QRP setup — ${channelName}`,
      notes:
        "Generated by CwQuickSetupPanel. Touches channel " +
        `${channelIndex} (rx/tx freq, modulation, tx_power, name) and the ` +
        "global nr7y_cw_settings block (keyer mode, WPM, key input, " +
        "break-in, byte-2 validity marker).",
      appliesTo: { profileIds: ["uv-k1-f4hwn-nr7y"] },
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
            modulation: "CW",
            bandwidth: "Narrow (12.5 kHz)",
            tx_power: txPower,
          },
        },
      ],
      // Critical: without a valid channel_attrs entry, the firmware
      // treats the slot as unused (radio.c:318-328 checks
      // att->__val == 0xFFFF and bails to RADIO_InitInfo defaults
      // (FM, LOW1) without reading the channel record). Channel name
      // still shows in the list because that path doesn't use
      // ConfigureChannel, which is why the bug looked partial.
      channelAttrs: [
        {
          index: channelIndex,
          fields: {
            band: bandIndexForMHz(parseFloat(freqMhz)),
            compander: "Off",
            exclude: false,
            scanlist: "Off",
          },
        },
      ],
      settings: {
        nr7y_cw_settings: {
          cw_keyer_mode: keyerMode,
          cw_key_wpm: parseInt(wpm, 10),
          cw_key_input_menu: keyInput,
          cw_breakin_enable: true,
          // Critical: clear the byte-2 validity marker so firmware
          // honours key-input + break-in on next reload. See
          // App/settings.c:365  (Data[2] < 0x80) check.
          cw_byte2_invalid: false,
        },
      },
    };
  }, [formError, channelIndex, channelName, freqMhz, txPower, keyerMode, wpm, keyInput]);

  const cfgJson = useMemo(() => (cfg ? JSON.stringify(cfg, null, 2) : ""), [cfg]);

  // Validate via the same parser the JSON path uses, in case the
  // synthesised shape ever drifts from the parser's expectations.
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
    // We intentionally don't watch `stage` here.
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
      <h2 style={{ margin: 0, fontSize: 18 }}>CW QRP quick setup</h2>
      <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
        Defaults map the F4HWN NR7Y CW operator menu items 2, 12, 71, 72, 73
        plus a channel slot. Adjust below, then preview & write. Profile:{" "}
        <code>{profileId}</code>.
      </p>

      <FieldGrid>
        <NumberField
          label="Channel slot"
          value={channelIndex}
          min={1}
          max={200}
          onChange={setChannelIndex}
          disabled={busy}
          hint="1-based, matching the radio menu (max 200 on stock K1)."
        />
        <TextField
          label="Channel name"
          value={channelName}
          maxLength={10}
          onChange={setChannelName}
          disabled={busy}
          hint="Up to 10 ASCII characters."
        />
        <TextField
          label="Frequency (MHz)"
          value={freqMhz}
          onChange={setFreqMhz}
          disabled={busy}
          hint="Simplex; RX = TX. 2 m default 144.025."
        />
        <SelectField
          label="Menu 2 — TX power"
          value={txPower}
          options={[...TX_POWER_OPTIONS]}
          onChange={setTxPower}
          disabled={busy}
          hint="OUTPUT_POWER. Low3 ≈ 250 mW; Mid ≈ 2 W."
        />
        <SelectField
          label="Menu 71 — Keyer mode"
          value={keyerMode}
          options={[...KEYER_MODE_OPTIONS]}
          onChange={setKeyerMode}
          disabled={busy}
          hint="Iambic B is the common default."
        />
        <NumberField
          label="Menu 72 — Keyer speed (WPM)"
          value={parseInt(wpm, 10)}
          min={10}
          max={40}
          onChange={(n) => setWpm(String(n))}
          disabled={busy}
          hint="10..40 inclusive."
        />
        <SelectField
          label="Menu 73 — Key input"
          value={keyInput}
          options={[...KEY_INPUT_OPTIONS]}
          onChange={setKeyInput}
          disabled={busy}
          hint="Default is PTT HandKey (safe with the programming cable). Port-using modes are listed below."
        />
      </FieldGrid>

      {formError ? <Banner kind="error">{formError}</Banner> : null}

      {PORT_USING_KEY_INPUTS.has(keyInput) ? (
        <Banner kind="warn">
          <strong>Cable warning.</strong> "{keyInput}" polls the TRRS port
          at boot for paddle dit/dah lines. The programming cable is in
          that same jack — on next boot, firmware{" "}
          <code>CW_CheckKeyerInputs</code> (App/app/cwkeyer.c:460) will
          see the cable as a stuck paddle, show <code>CW KEY STUCK / Port
          Input disabled</code> for 2 s, revert this setting to{" "}
          <code>PTT HandKey</code>, and during that 2 s window the radio
          won't ack hello packets, so reconnects time out. Set this on
          the radio itself once the paddle is plugged in instead.
        </Banner>
      ) : null}

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>
          Generated config (hand-editable as JSON below)
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
