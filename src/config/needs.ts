/**
 * requiredRegions: given a BkgConfig and the resolved profile it will be
 * applied against, compute the minimal set of EEPROM ranges that must be
 * read from the radio before applyConfig() can run.
 *
 * The pipeline reads these ranges, constructs an EepromSnapshot, then
 * calls applyConfig. The point of this helper is to avoid reading the
 * whole EEPROM just to write a few channels.
 *
 * Output guarantees:
 *   - Every range start is 8-byte aligned (planner constraint).
 *   - Every range length is a multiple of 8 (likewise).
 *   - Overlapping or adjacent ranges are merged.
 *   - Ranges are sorted by start.
 *
 * If the config references modules that don't exist on the resolved
 * profile, those references are silently skipped here — applyConfig
 * will surface them as structured errors later. This helper's only
 * job is "if you want to apply this, you must read at least these
 * bytes first."
 */

import type {
  ResolvedProfile,
  ResolvedArrayModule,
  ResolvedBlockModule,
} from '../schema/types';
import type { BkgConfig } from './types';

export interface RegionRange {
  start: number;
  length: number;
  /** Human label for the UI ("channels[3] record", "f4hwn_settings block"). */
  label: string;
}

export function requiredRegions(
  config: BkgConfig,
  resolved: ResolvedProfile,
): RegionRange[] {
  const raw: RegionRange[] = [];
  const channels = findArray(resolved, 'channels');
  const channelNames = findArray(resolved, 'channel_names');
  const channelAttrs = findArray(resolved, 'channel_attrs');

  if (config.channels) {
    for (const ov of config.channels) {
      if (!Number.isInteger(ov.index) || ov.index < 1) continue;
      const idx = ov.index - 1;
      if (channels && ov.fields && Object.keys(ov.fields).length > 0) {
        if (idx >= 0 && idx < channels.count) {
          raw.push({
            start: channels.baseOffset + idx * channels.stride,
            length: channels.template.size,
            label: `channels[${ov.index}] record`,
          });
        }
      }
      if (channelNames && ov.name !== undefined) {
        if (idx >= 0 && idx < channelNames.count) {
          raw.push({
            start: channelNames.baseOffset + idx * channelNames.stride,
            length: channelNames.template.size,
            label: `channel_names[${ov.index}]`,
          });
        }
      }
    }
  }

  if (config.channelAttrs) {
    for (const ov of config.channelAttrs) {
      if (!Number.isInteger(ov.index) || ov.index < 1) continue;
      const idx = ov.index - 1;
      if (channelAttrs && idx >= 0 && idx < channelAttrs.count) {
        raw.push({
          start: channelAttrs.baseOffset + idx * channelAttrs.stride,
          length: channelAttrs.template.size,
          label: `channel_attrs[${ov.index}]`,
        });
      }
    }
  }

  if (config.settings) {
    for (const moduleId of Object.keys(config.settings)) {
      const mod = resolved.modules.find((m) => m.id === moduleId);
      if (mod && mod.kind === 'block') {
        const block = mod as ResolvedBlockModule;
        raw.push({
          start: block.baseOffset,
          length: block.size,
          label: `${moduleId} block`,
        });
      }
    }
  }

  // 8-align each range, then merge.
  return mergeRanges(raw.map(align8));
}

function findArray(
  resolved: ResolvedProfile,
  id: string,
): ResolvedArrayModule | undefined {
  const m = resolved.modules.find((x) => x.id === id);
  return m?.kind === 'array' ? m : undefined;
}

function align8(r: RegionRange): RegionRange {
  const start = r.start & ~0x7;
  const end = (r.start + r.length + 7) & ~0x7;
  return { start, length: end - start, label: r.label };
}

/**
 * Merge overlapping or adjacent ranges. Adjacent = end-of-one equals
 * start-of-next. Labels concatenate to retain provenance for the UI.
 */
function mergeRanges(input: RegionRange[]): RegionRange[] {
  if (input.length === 0) return [];
  const sorted = [...input].sort((a, b) => a.start - b.start);
  const out: RegionRange[] = [];
  let cur = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    const curEnd = cur.start + cur.length;
    if (next.start <= curEnd) {
      const nextEnd = next.start + next.length;
      const newEnd = Math.max(curEnd, nextEnd);
      cur = {
        start: cur.start,
        length: newEnd - cur.start,
        label: cur.label === next.label ? cur.label : `${cur.label} + ${next.label}`,
      };
    } else {
      out.push(cur);
      cur = next;
    }
  }
  out.push(cur);
  return out;
}
