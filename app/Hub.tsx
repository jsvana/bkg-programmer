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
      ? { chip: { label: "already installed", tone: "ok" } }
      : { chip: { label: "uses UVTools2", tone: "warn" } };

  // Connection is NOT a gate. The user can open these tools while
  // disconnected and connect from inside, just before they make changes.
  // The only hard gate is firmware compatibility, and that can only be
  // judged once a radio is actually connected.
  const programStatus: Status =
    !connected
      ? { chip: { label: "connect when ready" } }
      : isStock
        ? { chip: { label: "needs custom firmware", tone: "warn" }, disabled: true, disabledReason: "Your radio's factory firmware won't accept changes. Install custom firmware first." }
        : fwKind !== "matched"
          ? { chip: { label: "firmware not recognized", tone: "warn" }, disabled: true, disabledReason: "We don't recognize this firmware, so we won't risk changing anything." }
          : { chip: { label: "ready", tone: "ok" }, primary: !isStock };

  const splashStatus: Status =
    !connected
      ? { chip: { label: "connect when ready" } }
      : isStock
        ? { chip: { label: "needs custom firmware", tone: "warn" }, disabled: true, disabledReason: "Factory firmware won't let the boot screen be changed. Install custom firmware first." }
        : fwKind !== "matched"
          ? { chip: { label: "firmware not recognized", tone: "warn" }, disabled: true, disabledReason: "We don't recognize this firmware, so we won't risk changing anything." }
          : { chip: { label: "ready", tone: "ok" } };

  // Only one .primary at a time. Flash wins if stock; else Program.
  if (flashStatus.primary && programStatus.primary) programStatus.primary = false;

  return (
    <>
      <PowerOnModes />

      <header className="workspace-intro">
        <h1>What do you want to do?</h1>
        <p>
          Pick a tool below. You don&rsquo;t have to connect a radio first —
          each tool lets you connect right before it makes changes. Your
          connection stays shown in the bar above.
        </p>
      </header>

      <div className="hub" role="list">
        <Tile
          num="01"
          name="Install firmware"
          desc="Install custom firmware (like NR7Y) using a separate tool called UVTools2. The other two tools only work once custom firmware is installed — the factory firmware won't let them make changes."
          status={flashStatus}
          onSelect={() => onSelect("flash")}
        />
        <Tile
          num="02"
          name="Program radio"
          desc="Back up your radio first, then set up channels, your callsign, and boot-screen text. Every change is saved and read back to confirm it stuck."
          status={programStatus}
          onSelect={() => onSelect("program")}
        />
        <Tile
          num="03"
          name="Boot screen"
          desc="Change what shows when the radio powers on — the display style, two lines of welcome text, and (on firmware that supports it) a custom logo image."
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
        Your radio starts up differently depending on which button you hold
        while turning it on. <strong>This tool can only make changes when the
        radio is in programming mode.</strong>
      </p>
      <ul className="mode-list">
        <li className="mode">
          <span className="mode-hold">No button</span>
          <span className="mode-body">
            <span className="mode-name">Normal use</span>
            <span className="mode-desc">
              Turn it on as usual — transmit, receive, menus. This tool
              can&rsquo;t talk to the radio in this mode.
            </span>
          </span>
        </li>
        <li className="mode">
          <span className="mode-hold">Hold PTT</span>
          <span className="mode-body">
            <span className="mode-name">Install mode</span>
            <span className="mode-desc">
              Hold the PTT (push-to-talk) key while powering on. This is for
              installing firmware with UVTools2. You won&rsquo;t use this mode
              here directly.
            </span>
          </span>
        </li>
        <li className="mode">
          <span className="mode-hold">Hold Side&nbsp;2</span>
          <span className="mode-body">
            <span className="mode-name">
              Programming mode <span className="chip required">needed for this tool</span>
            </span>
            <span className="mode-desc">
              Hold the lower side button (Side&nbsp;2) while powering on. The
              radio then waits for this tool to read and change its settings.{" "}
              <strong>Only available once custom firmware is installed</strong> —
              install it first if your radio still has the factory firmware.
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
          Check this radio
          <span className="utility-link-desc">
            — confirm your changes will actually stick
          </span>
        </button>
      </div>
      {ambiguousIdentity ? (
        <div>
          <span className="label-caps">Identity</span>
          <button className="utility-link" onClick={() => onOpen("identity")}>
            Which radio is this?
            <span className="utility-link-desc">— we couldn&rsquo;t tell for sure</span>
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
            — everything we detected about this radio
          </span>
        </button>
      </div>
    </div>
  );
}
