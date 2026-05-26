/**
 * Session: bundles the radio handshake and the read/write helpers that
 * need the session timestamp.
 *
 * Lifecycle:
 *   const session = await Session.open(transport);
 *   const data = await session.readEeprom(0x0000, 16);
 *   await session.writeEeprom(0x0000, data);
 *   await session.reboot();    // closes the session
 */

import {
  buildHello, parseHelloReply, HelloReply,
  buildReadEeprom, parseReadEepromReply,
  buildWriteEeprom, type WriteOpts,
  buildReboot, CMD,
} from './commands';
import type { Transport } from './transport';

export class Session {
  private constructor(
    public readonly transport: Transport,
    public readonly hello: HelloReply,
    public readonly timestamp: number,
  ) {}

  static async open(transport: Transport): Promise<Session> {
    await transport.open();
    const timestamp = (Math.random() * 0xFFFFFFFF) >>> 0;
    const frame = await transport.request(buildHello(timestamp), 3000);
    if (frame.cmd !== CMD.HELLO_REPLY) {
      throw new Error(`expected HELLO_REPLY, got cmd=0x${frame.cmd.toString(16)}`);
    }
    const hello = parseHelloReply(frame.payload);
    return new Session(transport, hello, timestamp);
  }

  /**
   * Read EEPROM. Handles requests >128 bytes by splitting into multiple
   * commands. Stitches the result.
   */
  async readEeprom(address: number, size: number): Promise<Uint8Array> {
    const result = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const chunk = Math.min(0x80, size - offset);
      const frame = await this.transport.request(
        buildReadEeprom(address + offset, chunk, this.timestamp),
      );
      if (frame.cmd !== CMD.READ_EEPROM_REPLY) {
        throw new Error(
          `expected READ_EEPROM_REPLY, got cmd=0x${frame.cmd.toString(16)}`,
        );
      }
      const reply = parseReadEepromReply(frame.payload);
      result.set(reply.data, offset);
      offset += chunk;
    }
    return result;
  }

  /**
   * Write EEPROM. `data.length` must be a multiple of 8.
   * Splits writes larger than 248 bytes into multiple commands.
   *
   * `timeoutMs` controls the per-chunk reply timeout. Defaults to the
   * transport's default. Writes that land in flash-backed regions (e.g.
   * V3/K1 splash at 0x2E00) may require a sector erase and take seconds
   * to ack — bump this to 8000+ for those regions.
   */
  async writeEeprom(
    address: number,
    data: Uint8Array,
    opts: WriteOpts & { timeoutMs?: number } = {},
  ): Promise<void> {
    if (data.length % 8 !== 0) {
      throw new Error(`write size must be multiple of 8: ${data.length}`);
    }
    const { timeoutMs, ...wireOpts } = opts;
    let offset = 0;
    while (offset < data.length) {
      // Max data per WRITE_EEPROM = 232 bytes, NOT the protocol's
      // theoretical 248. The firmware's UART_DMA_Buffer is 256 bytes
      // total, which has to hold the full frame:
      //   SOF(2) + size_field(2) + body + CRC(2) + EOF(2)  ≤ 256
      // body = CMD_051D fixed (12 bytes: Header(4)+Offset(2)+Size(1)+
      //                                  bAllowPassword(1)+Timestamp(4))
      //      + Data
      // So Data ≤ 256 - 8(framing) - 12(header) = 236, rounded down to
      // a multiple of 8 = 232 (= 0xE8). Sending 248-byte chunks causes
      // the firmware's frame parser (app/uart.c line ~860) to reject
      // the frame with no reply, and the host times out. Verified
      // empirically against UV-K1+NR7Y on 2026-05-25.
      const chunkSize = Math.min(0xE8, data.length - offset);
      const chunk = data.subarray(offset, offset + chunkSize);
      const frame = await this.transport.request(
        buildWriteEeprom(address + offset, chunk, this.timestamp, wireOpts),
        timeoutMs,
      );
      if (frame.cmd !== CMD.WRITE_EEPROM_REPLY) {
        throw new Error(
          `expected WRITE_EEPROM_REPLY, got cmd=0x${frame.cmd.toString(16)}`,
        );
      }
      offset += chunkSize;
    }
  }

  /**
   * Reboot the radio. No reply. Session is invalid after this call;
   * caller should construct a new session if needed.
   */
  async reboot(): Promise<void> {
    await this.transport.send(buildReboot());
    // No response expected. Caller responsible for waiting before re-hello.
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
