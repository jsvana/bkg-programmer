"use client";

import type { ReactNode } from "react";
import type { ToolId } from "./types";
import { ConnectPanel } from "./ConnectPanel";
import { RadioIdentityHelp } from "./RadioIdentityHelp";
import { StockFirmwareGuide } from "./StockFirmwareGuide";
import { SelfTestPanel } from "./SelfTestPanel";
import { WritePanel } from "./WritePanel";
import { ConfigPanel } from "./ConfigPanel";
import { CwQuickSetupPanel } from "./CwQuickSetupPanel";
import { ChannelProgramPanel } from "./ChannelProgramPanel";
import { BackupPanel } from "./BackupPanel";
import { SplashTestPanel } from "./SplashTestPanel";
import { WelcomeStringsPanel } from "./WelcomeStringsPanel";
import { SplashFlasherPanel } from "./SplashFlasherPanel";
import { useSession } from "./SessionContext";
import type { ConnState } from "./SessionContext";
import { StepGroup } from "./ui";

import type { UtilityId } from "./types";

interface ToolMeta {
  num: string;
  name: string;
  blurb: ReactNode;
}

const TOOL_META: Record<ToolId, ToolMeta> = {
  flash: {
    num: "01",
    name: "Install firmware",
    blurb: (
      <>
        This app can&rsquo;t install firmware itself — that&rsquo;s on purpose.
        Use a separate tool called <strong>UVTools2</strong> with the steps
        below, then come back here to set up your radio.
      </>
    ),
  },
  program: {
    num: "02",
    name: "Program radio",
    blurb: (
      <>
        Back up your radio first, then set up channels and text. Every change
        is read back to confirm it saved — if anything doesn&rsquo;t match,
        the tool stops and tells you rather than leaving things half-done.
      </>
    ),
  },
  splash: {
    num: "03",
    name: "Boot screen",
    blurb: (
      <>
        Change what your radio shows when it powers on — the display style,
        two lines of welcome text, or a custom logo image (on firmware that
        supports it). Each option backs up the original first so you can put
        it back.
      </>
    ),
  },
};

const UTILITY_META: Record<UtilityId, ToolMeta> = {
  "self-test": {
    num: "U-1",
    name: "Check this radio",
    blurb: (
      <>
        Confirms that changes you make will actually stick on this radio.
        It temporarily writes to one unused channel, reads it back, restarts
        the radio, and checks again — then puts everything back. The result
        is remembered for this firmware so you only run it once.
      </>
    ),
  },
  identity: {
    num: "U-2",
    name: "Which radio is this?",
    blurb: (
      <>
        We couldn&rsquo;t be completely sure which radio is connected.
        Compare the photos and notes below against the radio in your hand.
      </>
    ),
  },
  "connection-details": {
    num: "U-3",
    name: "Connection details",
    blurb: (
      <>
        Everything we detected when you connected: the radio model, its
        firmware, whether changes are safe to make, and a few status flags.
      </>
    ),
  },
};

export function ToolWorkspace({
  tool,
  onBack,
}: {
  tool: ToolId | UtilityId;
  onBack: () => void;
}) {
  const isUtility = tool === "self-test" || tool === "identity" || tool === "connection-details";
  const meta = isUtility
    ? UTILITY_META[tool as UtilityId]
    : TOOL_META[tool as ToolId];

  return (
    <>
      <div className="tool-view-head">
        <div className="tool-view-title">
          <span className="tool-view-num">{meta.num}</span>
          <h1 className="tool-view-name">{meta.name}</h1>
        </div>
        <button className="tool-view-back" onClick={onBack}>
          ← back to hub
        </button>
      </div>
      <p className="tool-view-blurb">{meta.blurb}</p>

      <div className="tool-stack">
        <ToolContent tool={tool} />
      </div>
    </>
  );
}

function ToolContent({ tool }: { tool: ToolId | UtilityId }) {
  const { state } = useSession();
  const connected = state.kind === "connected";

  switch (tool) {
    case "flash":
      return <FlashTool />;

    case "program": {
      if (!connected)
        return (
          <ConnectPrompt lead="Connect your radio when you're ready to make changes — you can set everything up after." />
        );
      const guard = firmwareGuard(state, "program");
      if (guard) return guard;
      return (
        <>
          <StepGroup
            n={1}
            title="Back up your radio"
            importance="important"
            hint="Save a copy of everything on your radio before changing anything. If a change ever goes wrong, this is what puts it back."
          >
            <BackupPanel />
          </StepGroup>
          <StepGroup
            n={2}
            title="Make your changes"
            importance="optional"
            hint="Use whichever of these you need — they're independent. Nothing is sent to the radio until you review the changes and choose to save."
          >
            <ChannelProgramPanel />
            <CwQuickSetupPanel />
            <WritePanel />
            <ConfigPanel />
          </StepGroup>
        </>
      );
    }

    case "splash": {
      if (!connected)
        return (
          <ConnectPrompt lead="Connect your radio when you're ready to change the boot screen." />
        );
      const guard = firmwareGuard(state, "splash");
      if (guard) return guard;
      return (
        <>
          <p className="tool-view-blurb" style={{ marginBottom: 0 }}>
            Pick whichever option fits what you want to change. Each one backs
            up the original first.
          </p>
          <WelcomeStringsPanel />
          <SplashFlasherPanel />
          <SplashTestPanel />
        </>
      );
    }

    case "self-test":
      if (!connected)
        return <ConnectPrompt lead="Connect your radio to run the check." />;
      return <SelfTestPanel />;

    case "identity":
      if (!connected)
        return (
          <ConnectPrompt lead="Connect your radio so we can compare what it reports against the radio in your hand." />
        );
      return <RadioIdentityHelp />;

    case "connection-details":
      return <ConnectPanel />;
  }
}

/**
 * Firmware-compatibility gate, enforced here rather than at the hub so the
 * tools stay openable without a connection. Returns a callout to render in
 * place of the tool when the connected radio's firmware can't safely accept
 * changes; null when it can (or when not connected — that case is handled
 * by the caller before reaching here).
 */
function firmwareGuard(
  state: ConnState,
  tool: "program" | "splash",
): ReactNode {
  if (state.kind !== "connected") return null;
  const fw = state.result.firmware;

  if (fw.kind === "matched" && fw.entry.family === "stock") {
    return (
      <div className="callout">
        {tool === "program"
          ? "Your radio's factory firmware won't accept changes. Install custom firmware first (the Install firmware tool walks you through it)."
          : "Factory firmware won't let the boot screen be changed. Install custom firmware first (the Install firmware tool walks you through it)."}
      </div>
    );
  }

  if (fw.kind !== "matched") {
    return (
      <div className="callout">
        We don&rsquo;t recognize this firmware, so we won&rsquo;t risk changing
        anything. Check the connection details to see what the radio reported.
      </div>
    );
  }

  return null;
}

/**
 * Actionable not-connected state. Instead of pointing at the rail, this lets
 * the user connect right where they are, just before they make changes —
 * connection is no longer a gate to opening the tool.
 */
function ConnectPrompt({ lead }: { lead: string }) {
  const { state, connect } = useSession();

  if (state.kind === "unsupported") {
    return (
      <div className="callout">
        Connecting to a radio needs Chrome or Edge on a desktop computer, over
        a secure (https) page. Open this page there to continue.
      </div>
    );
  }

  const busy = state.kind === "connecting";
  return (
    <div className="callout">
      <p style={{ marginTop: 0 }}>{lead}</p>
      <p>
        Put the radio in programming mode — hold the lower side button
        (Side&nbsp;2) while turning it on — plug in the programming cable, then
        connect.
      </p>
      <button onClick={connect} disabled={busy}>
        {busy ? "connecting…" : "connect radio"}
      </button>
      {state.kind === "error" ? (
        <p
          style={{
            marginTop: "var(--space-3)",
            color: "var(--err)",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function FlashTool() {
  const { state } = useSession();
  const connectedToStock =
    state.kind === "connected" &&
    state.result.firmware.kind === "matched" &&
    state.result.firmware.entry.family === "stock";

  return (
    <>
      {connectedToStock ? <StockFirmwareGuide /> : null}

      <div className="flash-card">
        <h2>Install custom firmware with UVTools2</h2>
        <p style={{ marginTop: "var(--space-2)", color: "var(--fg-muted)" }}>
          This app sets up your radio, but it doesn&rsquo;t install firmware.
          For that, use a separate, free tool called{" "}
          <a
            href="https://armel.github.io/uvtools2/"
            target="_blank"
            rel="noopener noreferrer"
          >
            UVTools2
          </a>
          . Follow the steps below, then come back here.
        </p>

        <ol className="flash-steps">
          <li>
            <div>
              <h4>Choose firmware</h4>
              <p>
                The F4HWN family (Fusion, Edition, NR7Y) works on UV-K5 and
                UV-K1 radios. If you want a custom logo on the boot screen,
                use a build that supports it — the download below does.
              </p>
              <div className="firmware-download">
                <div className="firmware-download-head">
                  <strong>NR7Y CW (BKG build) — UV-K1</strong>
                  <span className="firmware-download-meta">
                    v1.1.0 · 87 KB
                  </span>
                </div>
                <p className="firmware-download-blurb">
                  F4HWN NR7Y CW preset built from{" "}
                  <a
                    href="https://github.com/briand/uv-k1-k5v3-firmware-custom"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    briand/uv-k1-k5v3-firmware-custom
                  </a>{" "}
                  with <code>ENABLE_FEAT_F4HWN_LOGO</code> and{" "}
                  <code>ENABLE_FEAT_NR7Y_CW</code> on. Enables the bitmap
                  splash (Splash tool) and the full CW keyer block this
                  programmer's Quick CW Setup writes to (menus 71/72/73).
                  Targets UV-K1 Mini Kong; the same image runs on
                  UV-K5-V3 (firmware identifies as ambiguous —
                  Quick CW Setup is gated to UV-K1 only for now).
                </p>
                <p className="firmware-download-blurb">
                  <strong>v1.1.0 changes:</strong> CAT control over
                  UART/VCP with USB status indicator; UART-safe escape
                  hatches for the CW keyer PA10 conflict.{" "}
                  <strong>Breaking:</strong> default CW paddle mapping
                  is now TIP=dit, RING=dah (industry standard). If you
                  had previously selected a &ldquo;Reversed&rdquo;
                  key-input mode to compensate, switch to the
                  non-reversed equivalent after flashing (and vice
                  versa).
                </p>
                <a
                  href="/firmware/nr7y.cw-bkg-logo.v1.1.0.bin"
                  download
                  className="firmware-download-btn"
                >
                  Download nr7y.cw-bkg-logo.v1.1.0.bin
                </a>
                <p className="firmware-download-hash">
                  SHA256:{" "}
                  <code>
                    011fd156de29df6066e7388ee49b2b82a916fc071b86cb1f05f8048a712fe51b
                  </code>
                </p>
              </div>
            </div>
          </li>
          <li>
            <div>
              <h4>Put the radio in install mode</h4>
              <p>
                <strong>UV-K1 Mini Kong:</strong> hold the <strong>PTT</strong>{" "}
                key by itself while powering on.{" "}
                <strong>UV-K5:</strong> hold <strong>PTT and the top side
                button</strong> while powering on. (On the K1, adding the side
                button opens a different hidden menu instead — PTT alone.)
              </p>
            </div>
          </li>
          <li>
            <div>
              <h4>Install it with UVTools2</h4>
              <p>
                In UVTools2, open the firmware file you downloaded, pick the
                radio&rsquo;s port, and start the install. Wait for the radio
                to restart on its own.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h4>Come back and reconnect</h4>
              <p>
                Turn the radio off and back on normally, reconnect the cable,
                and use the <em>connect radio</em> button in the bar above.
                The Program and Boot screen tools unlock once the new firmware
                is detected.
              </p>
            </div>
          </li>
        </ol>

        <div className="callout">
          <strong>Why is this needed?</strong> The factory firmware quietly
          ignores changes to channels, settings, and the boot screen — it
          accepts the request but nothing actually changes. Custom firmware
          allows those changes.
        </div>
      </div>
    </>
  );
}
