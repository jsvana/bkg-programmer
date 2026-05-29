"use client";

import type { ReactNode } from "react";
import { useSession } from "./SessionContext";
import type { ToolId } from "./types";

interface Status {
  chip?: { label: string; tone?: "ok" | "warn" | "required" };
  primary?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * The hub. Three deliberate doors — Flash firmware, Program radio, Set
 * splash screen — plus a utilities footer. Each tile shows the tool's
 * single-sentence purpose and a status chip computed from connection +
 * firmware state. Whichever tile is the most likely next action gets
 * promoted to .primary styling — never more than one at a time.
 */
export function Hub({
  onSelect,
  onOpenUtility,
}: {
  onSelect: (tool: ToolId) => void;
  onOpenUtility: (id: "self-test" | "identity" | "connection-details") => void;
}) {
  const { state } = useSession();

  const connected = state.kind === "connected";
  const fwKind = connected ? state.result.firmware.kind : "unknown";
  const fwFamily =
    connected && state.result.firmware.kind === "matched"
      ? state.result.firmware.entry.family
      : null;
  const isStock = fwFamily === "stock";

  // Status per tool.
  // - Flash: highlighted whenever the user is on stock firmware (the
  //   "you need to do this first" case). Otherwise informational.
  // - Program & Splash: gated on a known custom-firmware profile.
  const flashStatus: Status = isStock
    ? { chip: { label: "do this first", tone: "required" }, primary: true }
    : connected && fwKind === "matched"
      ? { chip: { label: "already on custom fw", tone: "ok" } }
      : { chip: { label: "external — uvtools2", tone: "warn" } };

  const programStatus: Status =
    !connected
      ? { chip: { label: "connect first", tone: "warn" }, disabled: true, disabledReason: "Connect a radio to begin." }
      : isStock
        ? { chip: { label: "needs custom fw", tone: "warn" }, disabled: true, disabledReason: "Stock firmware silently rejects writes — flash custom firmware first." }
        : fwKind !== "matched"
          ? { chip: { label: "firmware unrecognised", tone: "warn" }, disabled: true, disabledReason: "Detection didn't match a known profile; refusing to write." }
          : { chip: { label: "ready", tone: "ok" }, primary: !isStock };

  const splashStatus: Status =
    !connected
      ? { chip: { label: "connect first", tone: "warn" }, disabled: true, disabledReason: "Connect a radio to begin." }
      : isStock
        ? { chip: { label: "stock blocks splash writes", tone: "warn" }, disabled: true, disabledReason: "Stock K1 read-maps the boot logo but silently rejects writes." }
        : fwKind !== "matched"
          ? { chip: { label: "firmware unrecognised", tone: "warn" }, disabled: true, disabledReason: "Detection didn't match a known profile; refusing to write." }
          : { chip: { label: "ready", tone: "ok" } };

  // Only one .primary at a time. Flash wins if stock; else Program.
  if (flashStatus.primary && programStatus.primary) programStatus.primary = false;

  return (
    <>
      <header className="workspace-intro">
        <h1>What do you want to do?</h1>
        <p>
          Pick a tool. Connection status stays in the rail above; the
          workspace will focus on just the chosen tool.
        </p>
      </header>

      <PowerOnModes />

      <div className="hub" role="list">
        <Tile
          num="01"
          name="Flash firmware"
          desc="Install F4HWN-family custom firmware (e.g. NR7Y) using UVTools2. This unlocks the EEPROM writes the other two tools depend on — stock firmware silently rejects them."
          status={flashStatus}
          onSelect={() => onSelect("flash")}
        />
        <Tile
          num="02"
          name="Program radio"
          desc="Back up the EEPROM, then apply a config file or edit channel names, callsign, and boot text strings. Every write is read-verified."
          status={programStatus}
          onSelect={() => onSelect("program")}
        />
        <Tile
          num="03"
          name="Set splash screen"
          desc="Customise the boot display — six display modes, two welcome strings, and (on firmwares with the LOGO feature) a 128×64 monochrome bitmap."
          status={splashStatus}
          onSelect={() => onSelect("splash")}
        />
      </div>

      <UtilityRow
        onOpen={onOpenUtility}
        ambiguousIdentity={
          connected &&
          (state.result.radio.kind === "ambiguous" ||
            state.result.radio.kind === "inferred" ||
            state.result.radio.kind === "conflict")
        }
        connected={connected}
      />
    </>
  );
}

/**
 * The radio has three distinct power-on modes selected by which button (if
 * any) is held while turning it on. This is foundational: the Program and
 * Splash tools only work when the radio booted into programmer mode, and
 * that mode only exists on the forked BKG firmware. Spelling it out here
 * saves the "why does nothing happen when I connect?" support loop.
 */
function PowerOnModes() {
  return (
    <section className="modes" aria-labelledby="modes-heading">
      <span className="label-caps" id="modes-heading">
        Power-on modes
      </span>
      <p className="modes-lead">
        The radio boots into a different mode depending on which button you
        hold while turning it on. <strong>This tool can only program the
        radio when it&rsquo;s in programmer mode.</strong>
      </p>
      <ul className="mode-list">
        <li className="mode">
          <span className="mode-hold">No button</span>
          <span className="mode-body">
            <span className="mode-name">Standard radio</span>
            <span className="mode-desc">
              Power on normally. The radio operates as usual — transmit,
              receive, menus. Not programmable over serial in this mode.
            </span>
          </span>
        </li>
        <li className="mode">
          <span className="mode-hold">Hold PTT</span>
          <span className="mode-body">
            <span className="mode-name">DFU mode</span>
            <span className="mode-desc">
              Hold the PTT key while powering on. Used to flash firmware
              (e.g. with UVTools2). Not used by this tool directly.
            </span>
          </span>
        </li>
        <li className="mode">
          <span className="mode-hold">Hold bottom-left</span>
          <span className="mode-body">
            <span className="mode-name">
              Programmer mode <span className="chip required">required to program</span>
            </span>
            <span className="mode-desc">
              Hold the bottom-left side button while powering on. The radio
              waits for serial commands so this tool can read and write the
              EEPROM. <strong>Only available on the forked BKG firmware</strong> —
              flash it first if you don&rsquo;t have it.
            </span>
          </span>
        </li>
      </ul>
    </section>
  );
}

function Tile({
  num,
  name,
  desc,
  status,
  onSelect,
}: {
  num: string;
  name: string;
  desc: ReactNode;
  status: Status;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="listitem"
      className={`tool-tile${status.primary ? " primary" : ""}`}
      onClick={onSelect}
      disabled={status.disabled}
      title={status.disabledReason ?? undefined}
    >
      <span className="tool-tile-num">{num}</span>
      <span className="tool-tile-name">{name}</span>
      <span className="tool-tile-desc">{desc}</span>
      <span className="tool-tile-foot">
        {status.chip ? (
          <span className={`chip${status.chip.tone ? " " + status.chip.tone : ""}`}>
            {status.chip.label}
          </span>
        ) : (
          <span />
        )}
        <span className="arrow">{status.disabled ? "—" : "open →"}</span>
      </span>
    </button>
  );
}

function UtilityRow({
  onOpen,
  ambiguousIdentity,
  connected,
}: {
  onOpen: (id: "self-test" | "identity" | "connection-details") => void;
  ambiguousIdentity: boolean;
  connected: boolean;
}) {
  if (!connected) return null;
  return (
    <div className="utility-row">
      <div>
        <span className="label-caps">Utilities</span>
        <button className="utility-link" onClick={() => onOpen("self-test")}>
          Self-test
          <span className="utility-link-desc">
            — verify writes persist on this firmware version
          </span>
        </button>
      </div>
      {ambiguousIdentity ? (
        <div>
          <span className="label-caps">Identity</span>
          <button className="utility-link" onClick={() => onOpen("identity")}>
            Resolve radio identity
            <span className="utility-link-desc">— inferred / ambiguous</span>
          </button>
        </div>
      ) : null}
      <div>
        <span className="label-caps">Connection</span>
        <button
          className="utility-link"
          onClick={() => onOpen("connection-details")}
        >
          Connection details
          <span className="utility-link-desc">
            — programmability, notes, AES key
          </span>
        </button>
      </div>
    </div>
  );
}
