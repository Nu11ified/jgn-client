import { eq, and, asc, isNotNull } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import type { RankUpdateResult, DiscordRole } from "./types";
import { fetchUserDiscordRoles } from "./discordRoleManager";
import { DISCORD_SYNC_FEATURE_FLAGS } from "./constants";

/**
 * Updates user rank based on their current Discord roles
 */
export const updateUserRankFromDiscordRoles = async (
  discordId: string,
  departmentId?: number,
  userRolesOverride?: DiscordRole[]
): Promise<RankUpdateResult> => {
  try {
    console.log(`📊 updateUserRankFromDiscordRoles called for Discord ID: ${discordId}, Department: ${departmentId ?? 'all'}`);

    // Get user's current Discord roles (allow override to avoid duplicate fetches)
    const userRoles = userRolesOverride ?? (await fetchUserDiscordRoles(discordId));

    // Get departments to check (either specific one or all where user is a member)
    const departmentConditions = [eq(deptSchema.departmentMembers.discordId, discordId)];
    if (departmentId) {
      departmentConditions.push(eq(deptSchema.departmentMembers.departmentId, departmentId));
    }

    const memberships = await postgrestDb
      .select({
        departmentId: deptSchema.departmentMembers.departmentId,
        memberId: deptSchema.departmentMembers.id,
        currentRankId: deptSchema.departmentMembers.rankId,
        discordGuildId: deptSchema.departments.discordGuildId,
        memberStatus: deptSchema.departmentMembers.status,
        isActive: deptSchema.departmentMembers.isActive,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(deptSchema.departments, eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id))
      .where(and(...departmentConditions, eq(deptSchema.departmentMembers.isActive, true)));

    console.log(`🏢 Found ${memberships.length} active department membership(s) for user`);

    if (memberships.length === 0) {
      return {
        success: true,
        updatedDepartments: [],
        message: "User has no active department memberships",
      };
    }

    const updatedDepartments: Array<{ departmentId: number; newRankId: number | null; oldRankId: number | null; }> = [];

    for (const membership of memberships) {
      console.log(`🏛️ Processing department ${membership.departmentId} (Guild: ${membership.discordGuildId})`);

      // Get all ranks for this department with their Discord role IDs
      const departmentRanks = await postgrestDb
        .select({
          id: deptSchema.departmentRanks.id,
          discordRoleId: deptSchema.departmentRanks.discordRoleId,
          level: deptSchema.departmentRanks.level,
          name: deptSchema.departmentRanks.name,
        })
        .from(deptSchema.departmentRanks)
        .where(
          and(
            eq(deptSchema.departmentRanks.departmentId, membership.departmentId),
            eq(deptSchema.departmentRanks.isActive, true),
            isNotNull(deptSchema.departmentRanks.discordRoleId)
          )
        )
        .orderBy(asc(deptSchema.departmentRanks.level)); // Lowest level first

      console.log(`📊 Found ${departmentRanks.length} active ranks with Discord roles for department ${membership.departmentId}`);

      // Find the lowest rank the user has based on their Discord roles
      let newRankId: number | null = null;
      let lowestRankFound: { id: number; name: string; level: number; } | null = null;
      
      for (const rank of departmentRanks) {
        if (!rank.discordRoleId) continue;
        
        const hasRole = userRoles.some(
          userRole => userRole.roleId === rank.discordRoleId && userRole.serverId === membership.discordGuildId
        );
        
        console.log(`🎭 Checking rank "${rank.name}" (Level ${rank.level}, Role: ${rank.discordRoleId}): ${hasRole ? 'HAS ROLE' : 'NO ROLE'}`);
        
        if (hasRole) {
          newRankId = rank.id;
          lowestRankFound = { id: rank.id, name: rank.name, level: rank.level };
          break; // Take the lowest level rank they have
        }

        if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_DETAILED_LOGGING && !hasRole) {
          const userRolesInGuild = userRoles.filter(r => r.serverId === membership.discordGuildId);
          console.log(`   👀 User has ${userRolesInGuild.length} roles in guild ${membership.discordGuildId}:`, 
            userRolesInGuild.map(r => r.roleId).slice(0, 3));
          console.log(`   🎯 Looking for role: ${rank.discordRoleId}`);
        }
      }

      if (lowestRankFound) {
        console.log(`🎯 Lowest rank found: "${lowestRankFound.name}" (Level ${lowestRankFound.level})`);
      } else {
        console.log("❌ No matching rank roles found for user in this department");
      }

      // Update rank if it has changed
      if (newRankId !== membership.currentRankId) {
        console.log(`🔄 Rank change detected: ${membership.currentRankId} → ${newRankId}`);

        try {
          // Update the database immediately
          await postgrestDb
            .update(deptSchema.departmentMembers)
            .set({ 
              rankId: newRankId,
              lastActiveDate: new Date(),
            })
            .where(eq(deptSchema.departmentMembers.id, membership.memberId));

          updatedDepartments.push({
            departmentId: membership.departmentId,
            newRankId,
            oldRankId: membership.currentRankId,
          });

          console.log(`✅ Successfully updated rank in database for department ${membership.departmentId}`);

        } catch (updateError) {
          console.error(`❌ Failed to update rank in database for department ${membership.departmentId}:`, updateError);
          throw updateError;
        }
      } else {
        console.log(`✅ No rank change needed for department ${membership.departmentId}`);
      }
    }

    const message = updatedDepartments.length > 0 
      ? `Updated ranks in ${updatedDepartments.length} department(s): ${updatedDepartments.map(d => `Dept ${d.departmentId} (${d.oldRankId} → ${d.newRankId})`).join(', ')}`
      : "No rank changes needed - all ranks are in sync";

    console.log(`🎉 updateUserRankFromDiscordRoles completed: ${message}`);

    return {
      success: true,
      updatedDepartments,
      message,
    };
  } catch (error) {
    console.error("💥 Failed to update user rank from Discord roles:", error);
    return {
      success: false,
      updatedDepartments: [],
      message: `Failed to update ranks from Discord roles: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}; 