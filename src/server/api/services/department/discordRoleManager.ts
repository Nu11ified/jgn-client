import axios from "axios";
import { env } from "@/env";
import { TRPCError } from "@trpc/server";
import { eq, and, isNotNull } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import type { DiscordRole, DiscordRoleManagementResult } from "./types";
import { DISCORD_SYNC_FEATURE_FLAGS } from "./constants";

const API_BASE_URL = (env.INTERNAL_API_URL as string | undefined) ?? "http://localhost:8000";
const M2M_API_KEY = env.M2M_API_KEY as string | undefined;

// Cache for server IDs to avoid redundant API calls
const serverIdCache = new Map<string, string | null>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

/**
 * Clear the server ID cache - useful for testing or when roles are updated
 */
export const clearServerIdCache = (): void => {
  serverIdCache.clear();
  cacheTimestamps.clear();
  console.log("🧹 Server ID cache cleared");
};

/**
 * Clean up expired cache entries
 */
const cleanupExpiredCache = (): void => {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, timestamp] of cacheTimestamps.entries()) {
    if (now - timestamp > CACHE_TTL) {
      expiredKeys.push(key);
    }
  }
  
  for (const key of expiredKeys) {
    serverIdCache.delete(key);
    cacheTimestamps.delete(key);
  }
  
  if (expiredKeys.length > 0) {
    console.log(`🧹 Cleaned up ${expiredKeys.length} expired cache entries`);
  }
};

/**
 * Manages Discord role operations (add/remove) for a user with retry logic
 */
export const manageDiscordRole = async (
  action: 'add' | 'remove',
  userDiscordId: string,
  roleId: string,
  serverId: string,
  maxRetries = 3,
  retryDelayMs = 1000
): Promise<{ success: boolean; error?: string; retryCount?: number }> => {
  let lastError: unknown = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🎭 manageDiscordRole attempt ${attempt}/${maxRetries}:`, { action, userDiscordId, roleId, serverId });
      
      if (!M2M_API_KEY) {
        const error = "M2M API key not configured";
        console.log("❌ No M2M_API_KEY found");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error,
        });
      }

      const url = `${API_BASE_URL}/admin/discord_roles/manage`;
      const payload = {
        action,
        discord_user_id: userDiscordId,
        discord_role_id: roleId,
        discord_server_id: serverId,
      };
      
      console.log("🌐 Making role management API call to:", url);
      console.log("📤 Payload:", payload);

      const response = await axios.post(url, payload, {
        headers: { "X-API-Key": M2M_API_KEY },
        timeout: 10000, // 10 second timeout
      });

      console.log(`✅ Discord role management successful on attempt ${attempt}:`, response.data);
      return { success: true, retryCount: attempt };
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Discord role management failed on attempt ${attempt}/${maxRetries}:`, error);
      
      if (axios.isAxiosError(error)) {
        console.error("Response data:", error.response?.data);
        console.error("Response status:", error.response?.status);
        console.error("Response headers:", error.response?.headers);
        
        // Don't retry on certain error codes that won't succeed on retry
        if (error.response?.status === 400 || error.response?.status === 401 || error.response?.status === 403) {
          console.error(`💀 Non-retryable error (${error.response.status}), not retrying`);
          const errorData = error.response?.data as { message?: string } | undefined;
          return { 
            success: false, 
            error: `HTTP ${error.response.status}: ${errorData?.message ?? error.message}`,
            retryCount: attempt 
          };
        }
      }
      
      // If this wasn't the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const delayMs = retryDelayMs * attempt; // Exponential backoff
        console.log(`⏳ Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  // All retries failed
  const errorMessage = lastError instanceof Error ? lastError.message : 'Unknown error';
  console.error(`💀 All ${maxRetries} attempts failed for Discord role management`);
  return { 
    success: false, 
    error: `Failed after ${maxRetries} attempts: ${errorMessage}`,
    retryCount: maxRetries 
  };
};

/**
 * Fetches all Discord roles for a user
 */
export const fetchUserDiscordRoles = async (discordId: string): Promise<DiscordRole[]> => {
  try {
    if (!M2M_API_KEY) {
      console.warn("⚠️ M2M_API_KEY not available, skipping Discord role fetch");
      return [];
    }

    console.log("🔍 Fetching user Discord roles from API...");
    const rolesResponse = await axios.get(
      `${API_BASE_URL}/admin/user_server_roles/users/${discordId}/roles`,
      {
        headers: { "X-API-Key": M2M_API_KEY },
      }
    );

    // Map the API response fields to our expected format
    const rawRoles = rolesResponse.data as Array<{ role_id: string; server_id: string; role_name: string; }> ?? [];
    const userRoles = rawRoles.map(role => ({ 
      roleId: role.role_id, 
      serverId: role.server_id 
    }));

    console.log(`📋 Found ${userRoles.length} Discord roles for user`);
    if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_DETAILED_LOGGING) {
      // Show ALL roles, not just first 5
      console.log("🔍 User's Discord roles (ALL):", userRoles.map(r => `${r.roleId} (${r.serverId})`));
    } else {
      // Show first 10 roles with indication if there are more
      const displayRoles = userRoles.slice(0, 10).map(r => `${r.roleId} (${r.serverId})`);
      if (userRoles.length > 10) {
        displayRoles.push(`... and ${userRoles.length - 10} more`);
      }
      console.log("🔍 User's Discord roles:", displayRoles);
    }

    return userRoles;
  } catch (error) {
    console.error("❌ Failed to fetch user Discord roles:", error);
    throw new Error("Failed to fetch Discord roles from API");
  }
};

/**
 * Gets the server ID for a given role ID
 */
export const getServerIdFromRoleId = async (roleId: string): Promise<string | null> => {
  try {
    if (!M2M_API_KEY) {
      console.warn("⚠️ M2M_API_KEY not available, cannot fetch server ID");
      return null;
    }

    // Clean up expired cache entries periodically
    cleanupExpiredCache();

    // Check cache first
    const now = Date.now();
    const cachedValue = serverIdCache.get(roleId);
    const cacheTime = cacheTimestamps.get(roleId);
    
    if (cachedValue !== undefined && cacheTime && (now - cacheTime) < CACHE_TTL) {
      console.log(`📋 Using cached server ID: ${cachedValue} for role: ${roleId}`);
      return cachedValue;
    }

    console.log(`🔍 Fetching server ID for role: ${roleId}`);
    // Use the more reliable /admin/roles/{role_id} endpoint
    const response = await axios.get(
      `${API_BASE_URL}/admin/roles/${roleId}`,
      {
        headers: { "X-API-Key": M2M_API_KEY },
        timeout: 5000, // Add timeout to prevent hanging requests
      }
    );

    const responseData = response.data as { server_id?: string; role_id?: string; role_name?: string } | undefined;
    const serverId = responseData?.server_id ?? null;
    
    // Cache the result
    serverIdCache.set(roleId, serverId);
    cacheTimestamps.set(roleId, now);
    
    console.log(`📋 Found server ID: ${serverId} for role: ${roleId}`);
    return serverId;
  } catch (error) {
    // Handle 404 errors gracefully - this is expected for roles that don't exist
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.log(`ℹ️ Role ${roleId} not found in Discord API (404) - this is normal for deleted/invalid roles`);
      
      // Cache the null result to avoid repeated 404 calls
      const now = Date.now();
      serverIdCache.set(roleId, null);
      cacheTimestamps.set(roleId, now);
      
      return null;
    }
    
    // Handle timeout errors
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      console.warn(`⏰ Timeout fetching server ID for role ${roleId} - API may be slow`);
      return null;
    }
    
    // Log other errors as actual errors
    console.error(`❌ Failed to fetch server ID for role ${roleId}:`, error);
    return null;
  }
};

/**
 * Removes Discord roles for members with non-active status
 */
export const removeDiscordRolesForInactiveMember = async (
  discordId: string,
  departmentId: number
): Promise<DiscordRoleManagementResult> => {
  try {
    console.log("🗑️ removeDiscordRolesForInactiveMember called with:", { discordId, departmentId });
    
    const removedRoles: Array<{ type: 'rank' | 'team'; roleId: string; }> = [];

    // Get member's current rank and team information
    const memberInfo = await postgrestDb
      .select({
        rankId: deptSchema.departmentMembers.rankId,
        primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
        discordGuildId: deptSchema.departments.discordGuildId,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(deptSchema.departments, eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id))
      .where(
        and(
          eq(deptSchema.departmentMembers.discordId, discordId),
          eq(deptSchema.departmentMembers.departmentId, departmentId)
        )
      )
      .limit(1);

    if (memberInfo.length === 0) {
      return {
        success: false,
        message: "Member not found",
        removedRoles: [],
      };
    }

    const member = memberInfo[0]!;

    // Remove rank Discord role if member has one
    if (member.rankId) {
      const rankInfo = await postgrestDb
        .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
        .from(deptSchema.departmentRanks)
        .where(eq(deptSchema.departmentRanks.id, member.rankId))
        .limit(1);

      if (rankInfo.length > 0 && rankInfo[0]!.discordRoleId) {
        const serverId = await getServerIdFromRoleId(rankInfo[0]!.discordRoleId);
        if (serverId) {
          const roleRemoved = await manageDiscordRole(
            'remove',
            discordId,
            rankInfo[0]!.discordRoleId,
            serverId
          );
          
          if (roleRemoved.success) {
            removedRoles.push({ type: 'rank', roleId: rankInfo[0]!.discordRoleId });
            console.log("✅ Removed rank Discord role:", rankInfo[0]!.discordRoleId);
          } else {
            console.log("❌ Failed to remove rank Discord role:", rankInfo[0]!.discordRoleId);
          }
        }
      }
    }

    // Remove primary team Discord role if member has one
    if (member.primaryTeamId) {
      const teamInfo = await postgrestDb
        .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
        .from(deptSchema.departmentTeams)
        .where(eq(deptSchema.departmentTeams.id, member.primaryTeamId))
        .limit(1);

      if (teamInfo.length > 0 && teamInfo[0]!.discordRoleId) {
        const serverId = await getServerIdFromRoleId(teamInfo[0]!.discordRoleId);
        if (serverId) {
          const roleRemoved = await manageDiscordRole(
            'remove',
            discordId,
            teamInfo[0]!.discordRoleId,
            serverId
          );
          
          if (roleRemoved.success) {
            removedRoles.push({ type: 'team', roleId: teamInfo[0]!.discordRoleId });
            console.log("✅ Removed team Discord role:", teamInfo[0]!.discordRoleId);
          } else {
            console.log("❌ Failed to remove team Discord role:", teamInfo[0]!.discordRoleId);
          }
        }
      }
    }

    // Remove additional team memberships (not just primary team)
    const additionalTeams = await postgrestDb
      .select({
        teamId: deptSchema.departmentTeamMemberships.teamId,
        discordRoleId: deptSchema.departmentTeams.discordRoleId,
      })
      .from(deptSchema.departmentTeamMemberships)
      .innerJoin(deptSchema.departmentTeams, eq(deptSchema.departmentTeamMemberships.teamId, deptSchema.departmentTeams.id))
      .innerJoin(deptSchema.departmentMembers, eq(deptSchema.departmentTeamMemberships.memberId, deptSchema.departmentMembers.id))
      .where(
        and(
          eq(deptSchema.departmentMembers.discordId, discordId),
          eq(deptSchema.departmentTeams.departmentId, departmentId),
          isNotNull(deptSchema.departmentTeams.discordRoleId)
        )
      );

    for (const team of additionalTeams) {
      if (team.discordRoleId && team.teamId !== member.primaryTeamId) {
        const serverId = await getServerIdFromRoleId(team.discordRoleId);
        if (serverId) {
          const roleRemoved = await manageDiscordRole(
            'remove',
            discordId,
            team.discordRoleId,
            serverId
          );
          
          if (roleRemoved.success) {
            removedRoles.push({ type: 'team', roleId: team.discordRoleId });
            console.log("✅ Removed additional team Discord role:", team.discordRoleId);
          } else {
            console.log("❌ Failed to remove additional team Discord role:", team.discordRoleId);
          }
        }
      }
    }

    const message = removedRoles.length > 0 
      ? `Removed ${removedRoles.length} Discord role(s) for inactive member`
      : "No Discord roles to remove";

    return {
      success: true,
      message,
      removedRoles,
    };
  } catch (error) {
    console.error("❌ Failed to remove Discord roles for inactive member:", error);
    return {
      success: false,
      message: "Failed to remove Discord roles",
      removedRoles: [],
    };
  }
};

/**
 * Restores Discord roles for members returning to active status
 */
export const restoreDiscordRolesForActiveMember = async (
  discordId: string,
  departmentId: number
): Promise<DiscordRoleManagementResult> => {
  try {
    console.log("➕ restoreDiscordRolesForActiveMember called with:", { discordId, departmentId });
    
    const addedRoles: Array<{ type: 'rank' | 'team'; roleId: string; }> = [];

    // Get member's current rank and team information
    const memberInfo = await postgrestDb
      .select({
        rankId: deptSchema.departmentMembers.rankId,
        primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
        discordGuildId: deptSchema.departments.discordGuildId,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(deptSchema.departments, eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id))
      .where(
        and(
          eq(deptSchema.departmentMembers.discordId, discordId),
          eq(deptSchema.departmentMembers.departmentId, departmentId)
        )
      )
      .limit(1);

    if (memberInfo.length === 0) {
      return {
        success: false,
        message: "Member not found",
        addedRoles: [],
      };
    }

    const member = memberInfo[0]!;

    // Add rank Discord role if member has one
    if (member.rankId) {
      const rankInfo = await postgrestDb
        .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
        .from(deptSchema.departmentRanks)
        .where(eq(deptSchema.departmentRanks.id, member.rankId))
        .limit(1);

      if (rankInfo.length > 0 && rankInfo[0]!.discordRoleId) {
        const serverId = await getServerIdFromRoleId(rankInfo[0]!.discordRoleId);
        if (serverId) {
          const roleAdded = await manageDiscordRole(
            'add',
            discordId,
            rankInfo[0]!.discordRoleId,
            serverId
          );
          
          if (roleAdded.success) {
            addedRoles.push({ type: 'rank', roleId: rankInfo[0]!.discordRoleId });
            console.log("✅ Added rank Discord role:", rankInfo[0]!.discordRoleId);
          } else {
            console.log("❌ Failed to add rank Discord role:", rankInfo[0]!.discordRoleId);
          }
        }
      }
    }

    // Add primary team Discord role if member has one
    if (member.primaryTeamId) {
      const teamInfo = await postgrestDb
        .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
        .from(deptSchema.departmentTeams)
        .where(eq(deptSchema.departmentTeams.id, member.primaryTeamId))
        .limit(1);

      if (teamInfo.length > 0 && teamInfo[0]!.discordRoleId) {
        const serverId = await getServerIdFromRoleId(teamInfo[0]!.discordRoleId);
        if (serverId) {
          const roleAdded = await manageDiscordRole(
            'add',
            discordId,
            teamInfo[0]!.discordRoleId,
            serverId
          );
          
          if (roleAdded.success) {
            addedRoles.push({ type: 'team', roleId: teamInfo[0]!.discordRoleId });
            console.log("✅ Added team Discord role:", teamInfo[0]!.discordRoleId);
          } else {
            console.log("❌ Failed to add team Discord role:", teamInfo[0]!.discordRoleId);
          }
        }
      }
    }

    // Add additional team memberships (not just primary team)
    const additionalTeams = await postgrestDb
      .select({
        teamId: deptSchema.departmentTeamMemberships.teamId,
        discordRoleId: deptSchema.departmentTeams.discordRoleId,
      })
      .from(deptSchema.departmentTeamMemberships)
      .innerJoin(deptSchema.departmentTeams, eq(deptSchema.departmentTeamMemberships.teamId, deptSchema.departmentTeams.id))
      .innerJoin(deptSchema.departmentMembers, eq(deptSchema.departmentTeamMemberships.memberId, deptSchema.departmentMembers.id))
      .where(
        and(
          eq(deptSchema.departmentMembers.discordId, discordId),
          eq(deptSchema.departmentTeams.departmentId, departmentId),
          isNotNull(deptSchema.departmentTeams.discordRoleId)
        )
      );

    for (const team of additionalTeams) {
      if (team.discordRoleId && team.teamId !== member.primaryTeamId) {
        const serverId = await getServerIdFromRoleId(team.discordRoleId);
        if (serverId) {
          const roleAdded = await manageDiscordRole(
            'add',
            discordId,
            team.discordRoleId,
            serverId
          );
          
          if (roleAdded.success) {
            addedRoles.push({ type: 'team', roleId: team.discordRoleId });
            console.log("✅ Added additional team Discord role:", team.discordRoleId);
          } else {
            console.log("❌ Failed to add additional team Discord role:", team.discordRoleId);
          }
        }
      }
    }

    const message = addedRoles.length > 0 
      ? `Added ${addedRoles.length} Discord role(s) for active member`
      : "No Discord roles to add";

    return {
      success: true,
      message,
      addedRoles,
    };
  } catch (error) {
    console.error("❌ Failed to restore Discord roles for active member:", error);
    return {
      success: false,
      message: "Failed to restore Discord roles",
      addedRoles: [],
    };
  }
};

/**
 * Directly check if a user has a specific role in a specific server
 * This is a more targeted check than fetching all roles
 */
export const checkUserHasRole = async (
  discordUserId: string, 
  roleId: string, 
  serverId: string
): Promise<{ hasRole: boolean; error?: string }> => {
  try {
    if (!M2M_API_KEY) {
      return { hasRole: false, error: "M2M_API_KEY not available" };
    }

    console.log(`🔍 Direct role check: User ${discordUserId} has role ${roleId} in server ${serverId}?`);
    
    // Try to get specific role information for the user
    const response = await axios.get(
      `${API_BASE_URL}/admin/user_server_roles/users/${discordUserId}/roles`,
      {
        headers: { "X-API-Key": M2M_API_KEY },
        params: {
          server_id: serverId,
          role_id: roleId
        }
      }
    );

    const roles = response.data as Array<{ role_id: string; server_id: string; role_name: string; }>;
    const hasRole = roles.some(role => role.role_id === roleId && role.server_id === serverId);
    
    console.log(`🎯 Direct role check result: ${hasRole ? 'HAS ROLE' : 'NO ROLE'}`);
    console.log(`📋 Filtered roles for server ${serverId}: [${roles.map(r => r.role_id).join(', ')}]`);
    
    return { hasRole };
  } catch (error) {
    console.error(`❌ Failed to check user role directly:`, error);
    return { 
      hasRole: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

/**
 * Verifies that a user actually has a specific Discord role
 */
export const verifyUserHasDiscordRole = async (
  discordId: string,
  roleId: string,
  serverId: string
): Promise<{ hasRole: boolean; error?: string }> => {
  try {
    console.log(`🔍 Verifying user ${discordId} has role ${roleId} in server ${serverId}`);
    
    const userRoles = await fetchUserDiscordRoles(discordId);
    const hasRole = userRoles.some(role => role.roleId === roleId && role.serverId === serverId);
    
    console.log(`${hasRole ? '✅' : '❌'} Role verification: ${hasRole ? 'FOUND' : 'NOT FOUND'}`);
    return { hasRole };
  } catch (error) {
    console.error("❌ Failed to verify user role:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { hasRole: false, error: errorMessage };
  }
};

/**
 * Manages Discord role with verification to ensure it succeeded
 */
export const manageDiscordRoleWithVerification = async (
  action: 'add' | 'remove',
  userDiscordId: string,
  roleId: string,
  serverId: string,
  maxRetries = 3,
  verifyAfterChange = true
): Promise<{ success: boolean; error?: string; retryCount?: number; verified?: boolean }> => {
  // First, perform the role management
  const result = await manageDiscordRole(action, userDiscordId, roleId, serverId, maxRetries);
  
  if (!result.success) {
    return result;
  }
  
  // If verification is requested and the action succeeded, verify the result
  if (verifyAfterChange) {
    console.log(`🔍 Verifying ${action} action succeeded...`);
    
    // Wait a moment for Discord to propagate the change
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const verification = await verifyUserHasDiscordRole(userDiscordId, roleId, serverId);
    
    if (verification.error) {
      console.warn(`⚠️ Could not verify role change due to error: ${verification.error}`);
      return { ...result, verified: false, error: `Role change completed but verification failed: ${verification.error}` };
    }
    
    const expectedHasRole = action === 'add';
    const verificationPassed = verification.hasRole === expectedHasRole;
    
    if (!verificationPassed) {
      console.error(`❌ Role verification failed! Expected hasRole=${expectedHasRole}, got hasRole=${verification.hasRole}`);
      return { 
        ...result, 
        success: false,
        verified: false,
        error: `Role ${action} completed but verification failed - user ${verification.hasRole ? 'still has' : 'does not have'} the role`
      };
    }
    
    console.log(`✅ Role ${action} verified successfully`);
    return { ...result, verified: true };
  }
  
  return result;
}; 