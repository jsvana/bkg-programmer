"use client";

import type { ReactNode } from "react";
import type { ToolId } from "./types";
import { ConnectPanel } from "./ConnectPanel";
import { RadioIdentityHelp } from "./RadioIdentityHelp";
import { StockFirmwareGuide } from "./StockFirmwareGuide";
import { SelfTestPanel } from "./SelfTestPanel";
import { WritePanel } from "./WritePanel";
import { ConfigPanel } from "./ConfigPanel";
import { BackupPanel } from "./BackupPanel";
import { SplashTestPanel } from "./SplashTestPanel";
import { WelcomeStringsPanel } from "./WelcomeStringsPanel";
import { SplashFlasherPanel } from "./SplashFlasherPanel";
import { useSession } from "./SessionContext";

import type { UtilityId } from "./types";

interface ToolMeta {
  num: string;
  name: string;
  blurb: ReactNode;
}

const TOOL_META: Record<ToolId, ToolMeta> = {
  flash: {
    num: "01",
    name: "Flash firmware",
    blurb: (
      <>
        bkg-programmer does not flash firmware itself — it can't, by design.
        Use <strong>UVTools2</strong> with the steps below, then come back
        here to program the radio.
      </>
    ),
  },
  program: {
    num: "02",
    name: "Program radio",
    blurb: (
      <>
        Back up first, then load a config file or edit fields directly. Every
        write is read-verified; mismatches halt the batch and report which
        address differed.
      </>
    ),
  },
  splash: {
    num: "03",
    name: "Splash screen",
    blurb: (
      <>
        Set the boot display mode, welcome strings, or — on firmwares built
        with <code>ENABLE_FEAT_F4HWN_LOGO</code> — a 128×64 monochrome
        bitmap. The diagnostic test panel verifies that splash-region
        writes actually persist on your firmware before you touch the
        real logo.
      </>
    ),
  },
};

const UTILITY_META: Record<UtilityId, ToolMeta> = {
  "self-test": {
    num: "U-1",
    name: "Self-test",
    blurb: (
      <>
        Writes a known byte to a safe channel-name slot, reads it back, and
        — optionally — reboots the radio and reads again to confirm the
        firmware actually persisted the change rather than caching it in
        RAM. Per-(model, firmware-version) result is cached locally.
      </>
    ),
  },
  identity: {
    num: "U-2",
    name: "Resolve radio identity",
    blurb: (
      <>
        Detection couldn't fully confirm which radio is on the cable.
        Compare the photos and bullet differentiators below against your
        device.
      </>
    ),
  },
  "connection-details": {
    num: "U-3",
    name: "Connection details",
    blurb: (
      <>
        Full hello reply: firmware match, radio identity, programmability
        verdict, lock-screen flag, AES key flag, raw detection notes.
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

    case "program":
      if (!connected) return <NotConnectedHint />;
      return (
        <>
          <BackupPanel />
          <WritePanel />
          <ConfigPanel />
        </>
      );

    case "splash":
      if (!connected) return <NotConnectedHint />;
      return (
        <>
          <WelcomeStringsPanel />
          <SplashFlasherPanel />
          <SplashTestPanel />
        </>
      );

    case "self-test":
      if (!connected) return <NotConnectedHint />;
      return <SelfTestPanel />;

    case "identity":
      if (!connected) return <NotConnectedHint />;
      return <RadioIdentityHelp />;

    case "connection-details":
      return <ConnectPanel />;
  }
}

function NotConnectedHint() {
  return (
    <div className="callout">
      Not connected. Use the <strong>connect radio</strong> button in the
      status rail above to open a serial port.
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
        <h2>Flash a custom firmware with UVTools2</h2>
        <p style={{ marginTop: "var(--space-2)", color: "var(--fg-muted)" }}>
          bkg-programmer talks the protocol, not the bootloader. Firmware
          installation runs in a separate tool — UVTools2 — that drives the
          DFU bootloader directly.
        </p>

        <ol className="flash-steps">
          <li>
            <div>
              <h4>Pick a target firmware</h4>
              <p>
                F4HWN family (Fusion, Edition, NR7Y) for UV-K5-V1 / V3 / K1;
                <code> ENABLE_FEAT_F4HWN_LOGO</code> if you also want the
                bitmap splash.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h4>Enter DFU mode on the radio</h4>
              <p>
                UV-K5: hold <code>PTT + Side1</code> while powering on.
                UV-K1 Mini Kong: <strong>hold PTT alone</strong> while
                powering on — the K5 combo enters a different engineering
                menu on K1.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h4>Flash with UVTools2</h4>
              <p>
                Open the .bin in UVTools2, select the right COM port, hit
                Flash. Wait for the radio to reboot.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h4>Reconnect here</h4>
              <p>
                Power-cycle, reconnect the cable, and use the rail's{" "}
                <em>connect radio</em> button. Detection will identify the
                new firmware and unlock Program / Splash.
              </p>
            </div>
          </li>
        </ol>

        <div className="callout">
          <strong>Why this step is gated.</strong> Stock firmware
          read-maps EEPROM regions (channels, settings, boot logo) but
          silently drops the standard <code>0x051D</code> write opcode
          against them — no reply, no error, just nothing happens. Custom
          firmware re-enables those writes.
        </div>
      </div>
    </>
  );
}
