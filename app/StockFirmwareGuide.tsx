"use client";

import { useSession } from "./SessionContext";

/**
 * Guidance panel shown when the connected radio is running stock firmware.
 *
 * The full programming feature set (channels, settings, splash) requires
 * write access to EEPROM regions that stock firmware silently rejects via
 * the standard 0x051D opcode. See CLAUDE.md "Stock K1 has read-mapped,
 * write-protected regions" for the empirical evidence. Path forward is to
 * flash a supported custom firmware; this panel walks the user through it.
 */
export function StockFirmwareGuide() {
  const { state } = useSession();
  if (state.kind !== "connected") return null;
  const firmware = state.result.firmware;
  if (firmware.kind !== "matched" || firmware.entry.family !== "stock") {
    return null;
  }

  return (
    <section
      style={{
        border: "1px solid var(--accent)",
        borderRadius: 8,
        padding: 20,
        marginTop: 20,
        background: "rgba(64, 130, 247, 0.05)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18 }}>
        This radio still has its factory firmware
      </h2>
      <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
        The factory firmware (<code>{firmware.entry.displayName}</code>) quietly
        ignores changes to channels, settings, and the boot screen. To use the
        rest of this tool, install custom firmware first — here&rsquo;s how.
      </p>

      <ol style={{ marginTop: 16, paddingLeft: 20, fontSize: 14, lineHeight: 1.55 }}>
        <li style={{ marginBottom: 14 }}>
          <strong>Back up the factory data first.</strong> In UVTools2, use the{" "}
          <em>Dump Calib</em> tab to save your radio&rsquo;s factory
          calibration. It&rsquo;s unique to your radio and can&rsquo;t be
          recreated — save it before changing anything else.
        </li>

        <li style={{ marginBottom: 14 }}>
          <strong>Put the radio in install mode.</strong>
          <ol type="a" style={{ marginTop: 6, paddingLeft: 20 }}>
            <li>Power the radio off (volume knob counter-clockwise until it clicks).</li>
            <li>
              Hold <strong>PTT</strong> only (do <em>not</em> add Side 1 —
              that toggles the 350MHz TX hidden menu instead).
            </li>
            <li>
              While holding PTT, power on by turning the volume knob clockwise.
            </li>
            <li>
              Release PTT. The radio is now in install mode, waiting for new
              firmware. The screen will be blank — that&rsquo;s normal.
            </li>
          </ol>
        </li>

        <li style={{ marginBottom: 14 }}>
          <strong>Flash custom firmware with UVTools2.</strong>
          <ol type="a" style={{ marginTop: 6, paddingLeft: 20 }}>
            <li>
              Download a firmware <code>.bin</code> from{" "}
              <a
                href="https://github.com/briand/uv-k1-k5v3-firmware-custom/releases"
                target="_blank"
                rel="noopener noreferrer"
              >
                briand's release page
              </a>{" "}
              (a K1-tuned fork of F4HWN Fusion).
            </li>
            <li>
              Open{" "}
              <a
                href="https://armel.github.io/uvtools2/?mode=flash"
                target="_blank"
                rel="noopener noreferrer"
              >
                UVTools2 (Flash Firmware tab)
              </a>{" "}
              in a new tab. You'll need to disconnect this page first —
              only one browser tab can hold the serial port at a time.
            </li>
            <li>
              In UVTools2: select the <code>.bin</code> file, click{" "}
              <em>Flash firmware</em>, pick the same serial port. The
              progress bar runs to 100%; the radio reboots automatically.
            </li>
          </ol>
        </li>

        <li>
          <strong>Reconnect.</strong> After installing, turn the radio off and
          back on normally (no buttons held), then come back here and click{" "}
          <em>Connect</em> at the top. The tool should now recognize the new
          firmware, and the rest of the features will unlock.
        </li>
      </ol>

      <p
        style={{
          marginTop: 16,
          padding: 10,
          background: "rgba(184, 138, 0, 0.08)",
          border: "1px solid #b88a00",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        <strong>Why back up first?</strong> Your radio&rsquo;s factory tuning
        is stored in the same memory the new firmware reuses. If an install
        goes wrong, that backup is the only way to get your radio&rsquo;s
        original tuning back — so it&rsquo;s worth the extra minute.
      </p>
    </section>
  );
}
