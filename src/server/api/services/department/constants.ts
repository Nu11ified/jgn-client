// Feature flags for Discord sync behavior
export const DISCORD_SYNC_FEATURE_FLAGS = {
  ENABLE_AUTO_SYNC_AFTER_ROLE_CHANGE: true,
  SYNC_DELAY_MS: 10000, // Reduced from 15s to 10s - Discord propagation is usually faster
  ENABLE_RANK_LIMIT_VALIDATION: true,
  ENABLE_CALLSIGN_AUTO_GENERATION: true,
  ENABLE_DETAILED_LOGGING: true, // Temporarily enabled for debugging
  MAX_SYNC_RETRIES: 2,
} as const;

// Default sync configuration - optimized for better performance
export const DEFAULT_SYNC_CONFIG = {
  MAX_ATTEMPTS: 3, // Reduced from 5 to 3 - most changes happen immediately or not at all
  INTERVAL_MS: 1500, // Reduced from 2s to 1.5s - faster feedback while still allowing propagation
} as const; 