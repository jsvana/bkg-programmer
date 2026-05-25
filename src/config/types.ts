/**
 * BKG configuration file: a human-authored JSON overlay that names
 * specific fields to change on a radio.
 *
 * This is NOT a full backup. It's sparse — channels and fields not
 * mentioned are left untouched. Designed for "I want CH1 to be the
 * Marin repeater and TX power on Mid, leave everything else alone."
 *
 * See docs/07-backup-format.md for the full-dump format. This format
 * is intentionally lighter, schema-native, and hand-editable.
 *
 * Pipeline:
 *   parseConfig(json)           → BkgConfig  (shape-validated)
 *   applyConfig(cfg, resolved,  → { fieldChanges, target, ... }
 *               currentSnap)
 *   planner.planWrites(...)     → WritePlan
 *   executor.execute(...)       → bytes on the radio
 */

import type { ProfileId } from '../schema/types';

export const CONFIG_SCHEMA_VERSION = 1 as const;

/**
 * Accepted value forms in the config file. The codec coerces to the
 * field's raw integer at apply time.
 *
 * - `boolean` for bool fields.
 * - `number` for int/frequency/enum fields, OR a numeric raw enum value.
 * - `string` for ascii fields, OR an enum label (matched against the
 *   field's enum values[].label, case-sensitive). Strings starting
 *   with '0x' are also accepted as hex integers for int fields, to
 *   make CTCSS/DCS tables readable.
 */
export type ConfigValue = boolean | number | string;

export interface ChannelOverlay {
  /** 1-based channel number, matching the radio menu (CH001 = 1). */
  index: number;
  /** Shortcut for setting the channel_names entry for this channel.
   *  Equivalent to writing `channel_names[index-1].name`, but
   *  natural enough that it gets its own slot. */
  name?: string;
  /** Field-id -> value, against the `channels` array template
   *  (e.g., rx_freq, tx_offset_freq, modulation, tx_power). */
  fields?: { readonly [fieldId: string]: ConfigValue };
}

export interface ChannelAttrOverlay {
  index: number;
  /** Field-id -> value, against the `channel_attrs` array template
   *  (band, compander, scanlist1, scanlist2, ...). */
  fields: { readonly [fieldId: string]: ConfigValue };
}

/**
 * Reserved for future use. Today the loader rejects any config that
 * sets `splash`, regardless of profile, with a clear error. On stock
 * K1 the splash region is silently write-protected via the standard
 * 0x051D opcode (see CLAUDE.md). On F4HWN/NR7Y the region is mapped
 * for writes but no field-level schema models it yet.
 */
export interface SplashOverlay {
  readonly [key: string]: unknown;
}

export interface BkgConfig {
  /** Pointer to the JSON Schema for this config format. Optional but
   *  recommended so editors can autocomplete. */
  $schema?: string;
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;

  /** Human label, e.g. "W6JSV 2m repeaters". */
  name?: string;
  notes?: string;

  /** Optional restriction on which profiles this config is valid for.
   *  If set and the active profile isn't in the list, applyConfig
   *  refuses to apply. If absent, applied to whatever the active
   *  profile is (with per-field validation). */
  appliesTo?: {
    profileIds?: ReadonlyArray<ProfileId>;
  };

  /** Sparse channel overlay. Channels not listed are preserved. */
  channels?: ReadonlyArray<ChannelOverlay>;

  /** Sparse channel-attributes overlay. */
  channelAttrs?: ReadonlyArray<ChannelAttrOverlay>;

  /**
   * Settings overlay. Outer key is moduleId, inner key is fieldId.
   * Example:
   *   "settings": {
   *     "f4hwn_settings": {
   *       "set_pwr": "Mid (~2 W)",
   *       "set_ptt": 0
   *     }
   *   }
   */
  settings?: {
    readonly [moduleId: string]: { readonly [fieldId: string]: ConfigValue };
  };

  /** Convenience top-level keys. Currently all are rejected by
   *  applyConfig with a 'not yet supported' error — they're declared
   *  here so the file format is forward-compatible. */
  callsign?: string;
  keyerSpeed?: number;
  splash?: SplashOverlay;
}

// =============================================================
// Apply-time outputs (consumed by the existing planner / executor)
// =============================================================

export interface ConfigWarning {
  /** Dot-path inside the config file ("channels[2].rx_freq",
   *  "settings.f4hwn_settings.set_pwr"). */
  path: string;
  message: string;
}

export interface ConfigError extends ConfigWarning {
  kind:
    | 'parse'                     // malformed JSON / shape mismatch
    | 'unsupported-convenience'   // callsign/keyer/splash, by design (today)
    | 'unknown-module'            // module not in resolved profile
    | 'unknown-field'             // field not in module template
    | 'value-out-of-range'        // int below min / above max
    | 'value-bad-enum'            // string didn't match any enum label
    | 'value-wrong-type'          // expected bool, got string, etc.
    | 'channel-index-out-of-range'
    | 'profile-mismatch'          // appliesTo.profileIds excluded this profile
    | 'readonly-module'           // module is readOnly in the profile
    | 'snapshot-coverage';        // current snapshot didn't cover a needed range
}
