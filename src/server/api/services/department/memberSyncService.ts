import { eq, and, isNotNull } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import type { SyncMemberRequest, RoleChangeAction, DiscordRoleManagementResult } from "./types";
import { manageDiscordRole, getServerIdFromRoleId, manageDiscordRoleWithVerification } from "./discordRoleManager";
import { updateUserRankFromDiscordRoles } from "./rankSyncService";
import { updateUserTeamFromDiscordRoles } from "./teamSyncService";
import { regenerateAndUpdateMemberCallsign } from "./callsignService";
import { DISCORD_SYNC_FEATURE_FLAGS, DEFAULT_SYNC_CONFIG } from "./constants";

/**
 * Main function to sync a member's roles and callsign
 * This is the central orchestrator that handles the complete sync flow:
 * 1. Apply Discord role changes (if any) with verification for rank roles
 * 2. Wait for Discord role propagation
 * 3. Sync rank and team from Discord roles (background polling)
 * 4. Update callsign
 * 
 * IMPROVED FEATURES:
 * - Removes ALL department rank roles before adding new rank role
 * - Uses verification for rank role assignments to ensure they succeed
 * - Provides detailed error reporting and retry logic
 * - Distinguishes between critical rank role failures and team role failures
 */
export const syncMemberRolesAndCallsign = async (request: SyncMemberRequest): Promise<{
  success: boolean;
  message: string;
  roleManagementResults?: DiscordRoleManagementResult[];
}> => {
  const { discordId, departmentId, memberId, roleChanges = [], skipRoleManagement = false } = request;
  
  console.log(`🔄 Starting member sync for Discord ID: ${discordId}, Department: ${departmentId}, Member: ${memberId}`);
  console.log(`📋 Role changes to apply: ${roleChanges.length}, Skip role management: ${skipRoleManagement}`);

  const roleManagementResults: DiscordRoleManagementResult[] = [];

  try {
    // Step 1: Apply Discord role changes if provided and not skipped
    if (!skipRoleManagement && roleChanges.length > 0) {
      console.log("🎭 Applying Discord role changes...");
      
      for (const roleChange of roleChanges) {
        try {
          // Use verification for rank roles to ensure they are applied successfully
          const useVerification = roleChange.roleType === 'rank';
          
          const result = useVerification 
            ? await manageDiscordRoleWithVerification(
                roleChange.type,
                discordId,
                roleChange.roleId,
                roleChange.serverId
              )
            : await manageDiscordRole(
                roleChange.type,
                discordId,
                roleChange.roleId,
                roleChange.serverId
              );
          
          const isVerificationResult = 'verified' in result;
          
          const message = result.success 
            ? `${roleChange.type} ${roleChange.roleType} role ${roleChange.roleId}: success (${result.retryCount ?? 1} attempts${useVerification && isVerificationResult && result.verified ? ', verified' : ''})`
            : `${roleChange.type} ${roleChange.roleType} role ${roleChange.roleId}: failed - ${result.error}`;

          roleManagementResults.push({
            success: result.success,
            message,
            ...(roleChange.type === 'add' && result.success ? { addedRoles: [{ type: roleChange.roleType, roleId: roleChange.roleId }] } : {}),
            ...(roleChange.type === 'remove' && result.success ? { removedRoles: [{ type: roleChange.roleType, roleId: roleChange.roleId }] } : {}),
          });

          if (!result.success) {
            console.warn(`⚠️ Failed to ${roleChange.type} ${roleChange.roleType} role ${roleChange.roleId}: ${result.error}`);
            // For rank roles, log this as an error since it's critical
            if (roleChange.roleType === 'rank') {
              console.error(`🚨 CRITICAL: Rank role ${roleChange.type} failed! This will affect user permissions.`);
            }
          } else {
            const verifiedText = useVerification && isVerificationResult && result.verified ? ' and verified' : '';
            console.log(`✅ Successfully ${roleChange.type}ed ${roleChange.roleType} role ${roleChange.roleId} after ${result.retryCount ?? 1} attempts${verifiedText}`);
          }
        } catch (error) {
          console.error(`❌ Error applying role change:`, error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          roleManagementResults.push({
            success: false,
            message: `Failed to ${roleChange.type} ${roleChange.roleType} role ${roleChange.roleId}: ${errorMessage}`,
          });
        }
      }

      // Check if any role changes failed and report
      const failedChanges = roleManagementResults.filter(r => !r.success);
      if (failedChanges.length > 0) {
        console.warn(`⚠️ ${failedChanges.length}/${roleChanges.length} role changes failed`);
        failedChanges.forEach(failure => console.warn(`   - ${failure.message}`));
      } else {
        console.log(`✅ All ${roleChanges.length} role changes completed successfully`);
      }

      // Wait for Discord propagation if we made role changes and at least some succeeded
      const successfulChanges = roleManagementResults.filter(r => r.success);
      if (successfulChanges.length > 0 && DISCORD_SYNC_FEATURE_FLAGS.ENABLE_AUTO_SYNC_AFTER_ROLE_CHANGE) {
        console.log(`⏳ Waiting ${DISCORD_SYNC_FEATURE_FLAGS.SYNC_DELAY_MS}ms for Discord role propagation...`);
        await new Promise(resolve => setTimeout(resolve, DISCORD_SYNC_FEATURE_FLAGS.SYNC_DELAY_MS));
      }
    }

    // Step 2: Sync with background polling for changes
    await syncMemberRolesAndCallsignInBackground(discordId, departmentId, memberId);

    return {
      success: true,
      message: "Member sync completed successfully",
      roleManagementResults: roleManagementResults.length > 0 ? roleManagementResults : undefined,
    };

  } catch (error) {
    console.error("💥 Member sync failed:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Member sync failed: ${errorMessage}`,
      roleManagementResults: roleManagementResults.length > 0 ? roleManagementResults : undefined,
    };
  }
};

/**
 * Background sync function that polls for Discord role changes and updates callsign
 * This function waits for the microservice to detect role changes and update the database
 */
export const syncMemberRolesAndCallsignInBackground = async (
  discordId: string,
  departmentId: number,
  memberId: number,
  maxAttempts = DEFAULT_SYNC_CONFIG.MAX_ATTEMPTS,
  intervalMs = DEFAULT_SYNC_CONFIG.INTERVAL_MS
): Promise<void> => {
  let lastRankId: number | null = null;
  let lastTeamId: number | null = null;
  let detectedChange = false;

  console.log(`🔍 Starting background sync polling for member ${memberId} (max ${maxAttempts} attempts, ${intervalMs}ms intervals)`);

  // Get initial state before any sync attempts
  const initialMember = await postgrestDb
    .select({
      rankId: deptSchema.departmentMembers.rankId,
      primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
    })
    .from(deptSchema.departmentMembers)
    .where(eq(deptSchema.departmentMembers.id, memberId))
    .limit(1);

  if (initialMember.length === 0) {
    console.warn(`⚠️ Member ${memberId} not found, stopping background sync`);
    return;
  }

  const initial = initialMember[0]!;
  lastRankId = initial.rankId ?? null;
  lastTeamId = initial.primaryTeamId ?? null;
  console.log(`📊 Initial state - Rank: ${lastRankId}, Team: ${lastTeamId}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`🔄 Background sync attempt ${attempt}/${maxAttempts}`);

    // Sync rank and team from Discord roles
    const rankResult = await updateUserRankFromDiscordRoles(discordId, departmentId);
    const teamResult = await updateUserTeamFromDiscordRoles(discordId, departmentId);

    // Check if any updates were actually made by the sync functions
    const rankUpdated = rankResult.updatedDepartments.length > 0;
    const teamUpdated = teamResult.updatedDepartments.length > 0;

    if (rankUpdated || teamUpdated) {
      detectedChange = true;
      console.log(`🎯 Change detected! Rank updated: ${rankUpdated}, Team updated: ${teamUpdated}`);
      
      if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_CALLSIGN_AUTO_GENERATION) {
        await regenerateAndUpdateMemberCallsign(memberId);
        console.log(`✅ Callsign updated for member ${memberId} after role change.`);
      }
      break;
    }

    // If no changes detected and this is not the last attempt, wait before trying again
    if (attempt < maxAttempts) {
      console.log(`⏳ No changes detected, waiting ${intervalMs}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  if (!detectedChange) {
    console.log(`⚠️ No changes detected after ${maxAttempts} attempts`);
    
    // As a fallback, update callsign anyway if enabled
    if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_CALLSIGN_AUTO_GENERATION) {
      await regenerateAndUpdateMemberCallsign(memberId);
      console.log(`✅ Callsign updated for member ${memberId} after max attempts (fallback).`);
    }
  }
};

/**
 * Helper function to create role change actions for rank updates
 * This function ensures ALL department rank roles are removed before adding the new one
 */
export const createRankRoleChanges = async (
  oldRankId: number | null,
  newRankId: number | null,
  departmentId: number
): Promise<RoleChangeAction[]> => {
  const roleChanges: RoleChangeAction[] = [];

  // Get ALL ranks for this department with Discord role IDs
  const allDepartmentRanks = await postgrestDb
    .select({ 
      id: deptSchema.departmentRanks.id,
      discordRoleId: deptSchema.departmentRanks.discordRoleId 
    })
    .from(deptSchema.departmentRanks)
    .where(
      and(
        eq(deptSchema.departmentRanks.departmentId, departmentId),
        eq(deptSchema.departmentRanks.isActive, true),
        isNotNull(deptSchema.departmentRanks.discordRoleId)
      )
    );

  console.log(`🧹 Found ${allDepartmentRanks.length} active ranks with Discord roles in department ${departmentId}`);

  // Remove ALL rank roles for this department (except the new one if it exists)
  for (const rank of allDepartmentRanks) {
    if (!rank.discordRoleId || rank.id === newRankId) continue;
    
    const serverId = await getServerIdFromRoleId(rank.discordRoleId);
    if (serverId) {
      roleChanges.push({
        type: 'remove',
        roleId: rank.discordRoleId,
        serverId,
        roleType: 'rank',
      });
      console.log(`➖ Queued removal of rank role ${rank.discordRoleId} (Rank ID: ${rank.id})`);
    }
  }

  // Add new rank role if exists
  if (newRankId) {
    console.log(`🔍 Looking up new rank ${newRankId} to add Discord role...`);
    const newRank = await postgrestDb
      .select({ 
        id: deptSchema.departmentRanks.id,
        name: deptSchema.departmentRanks.name,
        discordRoleId: deptSchema.departmentRanks.discordRoleId 
      })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, newRankId))
      .limit(1);

    if (newRank.length === 0) {
      console.error(`❌ New rank ${newRankId} not found in database!`);
    } else {
      const rank = newRank[0]!;
      console.log(`📋 Found rank: "${rank.name}" (ID: ${rank.id}, Discord Role: ${rank.discordRoleId || 'NONE'})`);
      
      if (!rank.discordRoleId) {
        console.warn(`⚠️ Rank "${rank.name}" has no Discord role ID configured!`);
      } else {
        console.log(`🔍 Getting server ID for Discord role ${rank.discordRoleId}...`);
        const serverId = await getServerIdFromRoleId(rank.discordRoleId);
        
        if (!serverId) {
          console.error(`❌ Could not find server ID for Discord role ${rank.discordRoleId} (rank: ${rank.name})`);
        } else {
          console.log(`✅ Found server ID ${serverId} for role ${rank.discordRoleId}`);
          roleChanges.push({
            type: 'add',
            roleId: rank.discordRoleId,
            serverId,
            roleType: 'rank',
          });
          console.log(`➕ Queued addition of rank role ${rank.discordRoleId} (Rank: "${rank.name}", ID: ${newRankId})`);
        }
      }
    }
  } else {
    console.log(`ℹ️ No new rank to add (newRankId is ${newRankId})`);
  }

  console.log(`🎭 Created ${roleChanges.length} role change actions for rank update`);
  return roleChanges;
};

/**
 * Helper function to create role change actions for team updates
 */
export const createTeamRoleChanges = async (
  oldTeamId: number | null,
  newTeamId: number | null,
  departmentId: number
): Promise<RoleChangeAction[]> => {
  const roleChanges: RoleChangeAction[] = [];

  // Remove old team role if exists
  if (oldTeamId) {
    const oldTeam = await postgrestDb
      .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
      .from(deptSchema.departmentTeams)
      .where(eq(deptSchema.departmentTeams.id, oldTeamId))
      .limit(1);

    if (oldTeam.length > 0 && oldTeam[0]!.discordRoleId) {
      const serverId = await getServerIdFromRoleId(oldTeam[0]!.discordRoleId);
      if (serverId) {
        roleChanges.push({
          type: 'remove',
          roleId: oldTeam[0]!.discordRoleId,
          serverId,
          roleType: 'team',
        });
      }
    }
  }

  // Add new team role if exists
  if (newTeamId) {
    const newTeam = await postgrestDb
      .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
      .from(deptSchema.departmentTeams)
      .where(eq(deptSchema.departmentTeams.id, newTeamId))
      .limit(1);

    if (newTeam.length > 0 && newTeam[0]!.discordRoleId) {
      const serverId = await getServerIdFromRoleId(newTeam[0]!.discordRoleId);
      if (serverId) {
        roleChanges.push({
          type: 'add',
          roleId: newTeam[0]!.discordRoleId,
          serverId,
          roleType: 'team',
        });
      }
    }
  }

  return roleChanges;
}; 