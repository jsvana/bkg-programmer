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
        Stock firmware detected — flash custom to unlock programming
      </h2>
      <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
        <code>{firmware.entry.displayName}</code> read-maps EEPROM but
        silently rejects writes to channel, settings, and splash regions
        via the standard programming protocol. To use the rest of this
        tool, flash a supported custom firmware first.
      </p>

      <ol style={{ marginTop: 16, paddingLeft: 20, fontSize: 14, lineHeight: 1.55 }}>
        <li style={{ marginBottom: 14 }}>
          <strong>Back up factory data first.</strong> Scroll to the{" "}
          <em>Backup snapshot</em> section below, click <em>Read snapshot</em>,
          then download both <code>.json</code> and <code>.bin</code>. Stock
          calibration is unique per radio and irreplaceable — save it before
          touching anything else.
        </li>

        <li style={{ marginBottom: 14 }}>
          <strong>Put the radio in DFU (flash) mode.</strong>
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
              Release PTT. The radio is now in DFU mode, waiting for a
              firmware image. The display will be blank or show nothing —
              that's normal.
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
          <strong>Reconnect.</strong> After the flash, power-cycle the radio
          back into normal mode (no buttons held), then come back here and
          click <em>Connect</em> at the top. Detection should now show the
          new firmware family and the read-only restrictions will lift.
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
        <strong>Why not just flash without backing up?</strong> Calibration
        data lives in flash regions that the new firmware will reuse, but a
        bad flash or a future firmware swap can corrupt them. A pre-flash
        backup is the only way to restore your radio's factory tuning if
        something goes wrong. UVTools2 also has a separate <em>Dump Calib</em>{" "}
        tab specifically for the calibration blob — running both is belt-and-suspenders.
      </p>
    </section>
  );
}
