/**
 * Transport interface for sending/receiving framed messages.
 *
 * The default implementation uses WebSerial. A node implementation
 * (for CLI / tests against real hardware) would implement the same
 * interface against `serialport` or similar.
 */

import { tryExtractFrame, type Frame } from './commands';

export interface Transport {
  /** Open the underlying port. Idempotent: safe to call when already open. */
  open(): Promise<void>;
  /** Close the port and release resources. */
  close(): Promise<void>;
  /** Send a complete framed message (output of buildFrame / build*). */
  send(frame: Uint8Array): Promise<void>;
  /**
   * Wait for the next inbound frame.
   * @param timeoutMs default 2000
   */
  recv(timeoutMs?: number): Promise<Frame>;
  /** Round-trip a request, return the next response frame. */
  request(frame: Uint8Array, timeoutMs?: number): Promise<Frame>;
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

interface Waiter {
  resolve: (frame: Frame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * WebSerial transport. Browser-only.
 *
 * Usage:
 *   const port = await navigator.serial.requestPort();
 *   const t = new WebSerialTransport(port, { baudRate: 38400 });
 *   await t.open();
 *   ...
 *
 * Implementation notes:
 *  - The reader loop pumps `feed()` with each chunk. `feed()` slices
 *    out complete frames using tryExtractFrame() and delivers them to
 *    pending waiters or buffers them.
 *  - Frames that arrive with no waiter are buffered, so a `request()`
 *    that races a write/read sequence still gets its reply.
 *  - On close, pending waiters are rejected and the reader is released.
 */
export class WebSerialTransport implements Transport {
  private buffer = new Uint8Array(0);
  private waiters: Waiter[] = [];
  private frames: Frame[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopDone: Promise<void> | null = null;
  private closing = false;
  private opened = false;

  constructor(
    private readonly port: SerialPort,
    private readonly options: SerialOptions = { baudRate: 38400 },
  ) {}

  async open(): Promise<void> {
    if (this.opened) return;
    await this.port.open(this.options);
    this.opened = true;
    this.closing = false;
    this.readLoopDone = this.runReadLoop();
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    this.closing = true;

    try {
      if (this.reader) await this.reader.cancel();
    } catch {
      // ignore — we're tearing down
    }

    if (this.readLoopDone) {
      try {
        await this.readLoopDone;
      } catch {
        // already handled inside the loop
      }
    }

    try {
      await this.port.close();
    } catch {
      // ignore
    }

    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('transport closed'));
    }
    this.waiters = [];
    this.frames = [];
    this.buffer = new Uint8Array(0);
    this.opened = false;
    this.reader = null;
    this.readLoopDone = null;
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.opened) throw new Error('transport not open');
    if (!this.port.writable) throw new Error('port not writable');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(frame);
    } finally {
      writer.releaseLock();
    }
  }

  recv(timeoutMs = 2000): Promise<Frame> {
    if (!this.opened) return Promise.reject(new Error('transport not open'));
    const buffered = this.frames.shift();
    if (buffered) return Promise.resolve(buffered);

    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new TimeoutError(`recv timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  async request(frame: Uint8Array, timeoutMs = 2000): Promise<Frame> {
    // Register the waiter BEFORE writing so a fast reply can't race past us.
    const reply = this.recv(timeoutMs);
    try {
      await this.send(frame);
    } catch (err) {
      // Best-effort: drop the waiter we just registered.
      // recv() will time out otherwise.
      throw err;
    }
    return reply;
  }

  private async runReadLoop(): Promise<void> {
    if (!this.port.readable) {
      throw new Error('port not readable');
    }
    const reader = this.port.readable.getReader();
    this.reader = reader;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) this.feed(value);
      }
    } catch (err) {
      if (!this.closing) {
        const e = err instanceof Error ? err : new Error(String(err));
        for (const w of this.waiters) {
          clearTimeout(w.timer);
          w.reject(e);
        }
        this.waiters = [];
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  /** Stream-feeder: call from reader loop with newly-received bytes. */
  protected feed(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    while (true) {
      const result = tryExtractFrame(this.buffer);
      if (!result) break;
      this.buffer = this.buffer.slice(result.consumed);
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(result.frame);
      } else {
        this.frames.push(result.frame);
      }
    }
  }
}

/**
 * In-memory transport for tests. Useful for unit-testing higher layers
 * without a real radio.
 */
export class MockTransport implements Transport {
  private inbox: Frame[] = [];
  public sent: Uint8Array[] = [];

  constructor(public responses: Frame[] = []) {}

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async send(frame: Uint8Array): Promise<void> {
    this.sent.push(frame);
    const next = this.responses.shift();
    if (next) this.inbox.push(next);
  }

  async recv(_timeoutMs = 2000): Promise<Frame> {
    const next = this.inbox.shift();
    if (!next) throw new TimeoutError('MockTransport: no queued response');
    return next;
  }

  async request(frame: Uint8Array, _timeoutMs = 2000): Promise<Frame> {
    await this.send(frame);
    return this.recv(_timeoutMs);
  }
}
