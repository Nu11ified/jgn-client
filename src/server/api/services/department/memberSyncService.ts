import { eq } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import type { SyncMemberRequest, RoleChangeAction, DiscordRoleManagementResult } from "./types";
import { manageDiscordRole, getServerIdFromRoleId } from "./discordRoleManager";
import { updateUserRankFromDiscordRoles } from "./rankSyncService";
import { updateUserTeamFromDiscordRoles } from "./teamSyncService";
import { regenerateAndUpdateMemberCallsign } from "./callsignService";
import { DISCORD_SYNC_FEATURE_FLAGS, DEFAULT_SYNC_CONFIG } from "./constants";

/**
 * Main function to sync a member's roles and callsign
 * This is the central orchestrator that handles the complete sync flow:
 * 1. Apply Discord role changes (if any)
 * 2. Wait for microservice to detect changes
 * 3. Sync rank and team from Discord roles
 * 4. Update callsign
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
          const success = await manageDiscordRole(
            roleChange.type,
            discordId,
            roleChange.roleId,
            roleChange.serverId
          );

          roleManagementResults.push({
            success,
            message: `${roleChange.type} ${roleChange.roleType} role ${roleChange.roleId}: ${success ? 'success' : 'failed'}`,
            ...(roleChange.type === 'add' ? { addedRoles: [{ type: roleChange.roleType, roleId: roleChange.roleId }] } : {}),
            ...(roleChange.type === 'remove' ? { removedRoles: [{ type: roleChange.roleType, roleId: roleChange.roleId }] } : {}),
          });

          if (!success) {
            console.warn(`⚠️ Failed to ${roleChange.type} ${roleChange.roleType} role ${roleChange.roleId}`);
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

      // Wait for Discord propagation if we made role changes
      if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_AUTO_SYNC_AFTER_ROLE_CHANGE) {
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
 */
export const createRankRoleChanges = async (
  oldRankId: number | null,
  newRankId: number | null,
  departmentId: number
): Promise<RoleChangeAction[]> => {
  const roleChanges: RoleChangeAction[] = [];

  // Remove old rank role if exists
  if (oldRankId) {
    const oldRank = await postgrestDb
      .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, oldRankId))
      .limit(1);

    if (oldRank.length > 0 && oldRank[0]!.discordRoleId) {
      const serverId = await getServerIdFromRoleId(oldRank[0]!.discordRoleId);
      if (serverId) {
        roleChanges.push({
          type: 'remove',
          roleId: oldRank[0]!.discordRoleId,
          serverId,
          roleType: 'rank',
        });
      }
    }
  }

  // Add new rank role if exists
  if (newRankId) {
    const newRank = await postgrestDb
      .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, newRankId))
      .limit(1);

    if (newRank.length > 0 && newRank[0]!.discordRoleId) {
      const serverId = await getServerIdFromRoleId(newRank[0]!.discordRoleId);
      if (serverId) {
        roleChanges.push({
          type: 'add',
          roleId: newRank[0]!.discordRoleId,
          serverId,
          roleType: 'rank',
        });
      }
    }
  }

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