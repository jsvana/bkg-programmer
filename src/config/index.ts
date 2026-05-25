export type {
  BkgConfig,
  ChannelOverlay,
  ChannelAttrOverlay,
  SplashOverlay,
  ConfigValue,
  ConfigWarning,
  ConfigError,
} from './types';
export { CONFIG_SCHEMA_VERSION } from './types';
export { applyConfig, parseConfig } from './apply';
export type { ApplyResult } from './apply';
export { decodeField, encodeValue, writeField, ConfigEncodeError } from './codec';
export { requiredRegions } from './needs';
export type { RegionRange } from './needs';
