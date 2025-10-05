// Feature flags for Discord sync behavior
export const DISCORD_SYNC_FEATURE_FLAGS = {
  ENABLE_AUTO_SYNC_AFTER_ROLE_CHANGE: true,
  // Reduce propagation wait to improve UX; verification handles correctness
  SYNC_DELAY_MS: 3000,
  ENABLE_RANK_LIMIT_VALIDATION: true,
  ENABLE_CALLSIGN_AUTO_GENERATION: true,
  // Lower verbosity in production by default
  ENABLE_DETAILED_LOGGING: process.env.NODE_ENV !== 'production',
  ENABLE_ROLE_VERIFICATION: true, // Keep verification enabled in all envs
  MAX_SYNC_RETRIES: 2,
  // CRITICAL FIX: Disabled async sync to ensure roles are assigned before member creation completes
  // This prevents the issue where members get 3-digit IDs but no Discord/TeamSpeak roles
  ENABLE_ASYNC_MEMBER_CREATION_SYNC: false, // Changed from true - sync must complete before returning
  ENABLE_BATCH_ROLE_MANAGEMENT: true, // Prefer batch API when available
} as const;

// Default sync configuration - optimized for better performance
export const DEFAULT_SYNC_CONFIG = {
  // Faster polling, fewer attempts for quicker resolution
  MAX_ATTEMPTS: 2,
  INTERVAL_MS: 1000,
} as const; 

// Cache TTLs (ms)
export const ROLE_CACHE_TTLS = {
  DEPARTMENT_ROLE_MAP_MS: 3 * 60 * 1000, // 3 minutes
} as const;