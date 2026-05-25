/**
 * In-memory representation of a (subset of) EEPROM bytes, keyed by address
 * range. Used as input to the planner and as the rollback source.
 */

export interface SnapshotRegion {
  start: number;
  length: number;
  data: Uint8Array;
}

export class EepromSnapshot {
  private regions: SnapshotRegion[] = [];

  constructor(regions: ReadonlyArray<SnapshotRegion> = []) {
    this.regions = [...regions].sort((a, b) => a.start - b.start);
  }

  /** Add a region. Caller's responsibility to avoid overlaps. */
  addRegion(start: number, data: Uint8Array): void {
    this.regions.push({ start, length: data.length, data: data.slice() });
    this.regions.sort((a, b) => a.start - b.start);
  }

  /**
   * Read `length` bytes starting at `address`. Throws if the requested
   * range isn't fully covered by an existing region.
   */
  read(address: number, length: number): Uint8Array {
    for (const r of this.regions) {
      if (address >= r.start && address + length <= r.start + r.length) {
        return r.data.subarray(address - r.start, address - r.start + length);
      }
    }
    throw new Error(
      `EepromSnapshot.read: range [0x${address.toString(16)}, ` +
        `0x${(address + length).toString(16)}) not covered`,
    );
  }

  /** Check whether a range is covered. */
  covers(address: number, length: number): boolean {
    for (const r of this.regions) {
      if (address >= r.start && address + length <= r.start + r.length) return true;
    }
    return false;
  }

  /** All regions, in ascending address order. */
  getRegions(): ReadonlyArray<SnapshotRegion> {
    return this.regions;
  }
}
