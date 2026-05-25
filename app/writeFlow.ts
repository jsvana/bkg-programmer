/**
 * Glue between the UI and the writer module. Handles the read→encode→
 * plan→execute pipeline for the narrow set of writes the WritePanel
 * exposes today: ASCII slot writes for callsign / welcome / channel name.
 *
 * Intentionally small. We can grow it into a real field-encoder module
 * once we have more than one field type to handle.
 */

import { EepromSnapshot } from "../src/backup/snapshot";
import { planWrites } from "../src/writer/planner";
import { executeWritePlan } from "../src/writer/executor";
import type { FieldChange } from "../src/backup/diff";
import type { Session } from "../src/protocol/session";
import type { ResolvedProfile } from "../src/schema/types";
import type { WriteBatch, ExecResult, PreflightCheck } from "../src/writer/plan";

/** Encode an ASCII value into a fixed-size, null-padded slot. */
export function encodeAsciiSlot(value: string, slotSize: number): Uint8Array {
  const buf = new Uint8Array(slotSize); // zero-init = null padding
  const encoded = new TextEncoder().encode(value);
  const len = Math.min(encoded.length, slotSize);
  buf.set(encoded.subarray(0, len));
  return buf;
}

/** Decode a null-terminated ASCII slot for display. */
export function decodeAsciiSlot(bytes: Uint8Array): string {
  const nullIdx = bytes.indexOf(0);
  const slice = nullIdx === -1 ? bytes : bytes.subarray(0, nullIdx);
  return new TextDecoder("ascii").decode(slice);
}

export interface AsciiWriteResult {
  exec: ExecResult;
  /** New value as it would decode after the write, for UI confirmation. */
  decoded: string;
  /** Address that was actually written (start of the 8-aligned containing region). */
  alignedStart: number;
  /** Length of the aligned read/write window. */
  alignedLength: number;
}

/**
 * Perform a single ASCII-slot write through the planner/executor pipeline.
 *
 * The planner needs an 8-byte-aligned current snapshot for every block
 * the write touches; this helper reads exactly that window, applies the
 * encoded bytes at the field's offset within it, and constructs the
 * single FieldChange the planner expects.
 *
 * The executor's mandatory verify-after-write does the safety lift —
 * mismatches surface here as ExecResult.status !== 'success'.
 */
export async function writeAsciiField(
  session: Session,
  resolved: ResolvedProfile,
  fieldAddress: number,
  slotSize: number,
  newValue: string,
  fieldLabel: string,
  callbacks?: {
    onPreflight?: (c: PreflightCheck) => void;
    onProgress?: (done: number, total: number, batch: WriteBatch) => void;
  },
): Promise<AsciiWriteResult> {
  const newBytes = encodeAsciiSlot(newValue, slotSize);

  // 8-aligned read window covering the entire field.
  const alignedStart = fieldAddress & ~0x7;
  const alignedEnd = (fieldAddress + slotSize + 7) & ~0x7;
  const alignedLength = alignedEnd - alignedStart;

  const currentAligned = await session.readEeprom(alignedStart, alignedLength);
  const current = new EepromSnapshot();
  current.addRegion(alignedStart, currentAligned);

  // Build target = current with newBytes overlaid at the field's offset
  // within the aligned window.
  const targetAligned = new Uint8Array(currentAligned);
  const offsetInWindow = fieldAddress - alignedStart;
  targetAligned.set(newBytes, offsetInWindow);
  const target = new EepromSnapshot();
  target.addRegion(alignedStart, targetAligned);

  const beforeSlot = currentAligned.subarray(offsetInWindow, offsetInWindow + slotSize);
  const change: FieldChange = {
    fieldPath: fieldLabel,
    fieldLabel,
    before: { raw: 0, display: decodeAsciiSlot(beforeSlot) },
    after: { raw: 0, display: decodeAsciiSlot(newBytes) },
    severity: "cosmetic",
    byteRange: { start: fieldAddress, end: fieldAddress + slotSize },
  };

  const plan = planWrites(resolved, current, target, [change]);

  const exec = await executeWritePlan(plan, session, {
    onPreflight: (c) => callbacks?.onPreflight?.(c),
    onProgress: (done, total, batch) => callbacks?.onProgress?.(done, total, batch),
  });

  return {
    exec,
    decoded: decodeAsciiSlot(newBytes),
    alignedStart,
    alignedLength,
  };
}

/** Read an ASCII slot from the device for prefilling the UI. */
export async function readAsciiSlot(
  session: Session,
  fieldAddress: number,
  slotSize: number,
): Promise<string> {
  const alignedStart = fieldAddress & ~0x7;
  const alignedEnd = (fieldAddress + slotSize + 7) & ~0x7;
  const alignedLength = alignedEnd - alignedStart;
  const buf = await session.readEeprom(alignedStart, alignedLength);
  const offsetInWindow = fieldAddress - alignedStart;
  return decodeAsciiSlot(buf.subarray(offsetInWindow, offsetInWindow + slotSize));
}
