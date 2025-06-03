// Feature flags for Discord sync behavior
export const DISCORD_SYNC_FEATURE_FLAGS = {
  ENABLE_AUTO_SYNC_AFTER_ROLE_CHANGE: true,
  SYNC_DELAY_MS: 15000, // Reduced from 10s to 15s - most Discord changes propagate quickly
  ENABLE_RANK_LIMIT_VALIDATION: true,
  ENABLE_CALLSIGN_AUTO_GENERATION: true,
  ENABLE_DETAILED_LOGGING: true, // Temporarily enabled for debugging
  MAX_SYNC_RETRIES: 2,
  ENABLE_ASYNC_MEMBER_CREATION_SYNC: true, // New flag: run Discord sync in background during member creation
} as const;

// Default sync configuration - optimized for better performance
export const DEFAULT_SYNC_CONFIG = {
  MAX_ATTEMPTS: 3, // Reduced from 3 to 2 - most changes happen immediately
  INTERVAL_MS: 1500, // Reduced from 1.5s to 1s - faster polling
} as const; 