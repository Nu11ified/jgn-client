import { eq, and, isNotNull } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import type { TeamUpdateResult } from "./types";
import { fetchUserDiscordRoles, checkUserHasRole } from "./discordRoleManager";
import { DISCORD_SYNC_FEATURE_FLAGS } from "./constants";

/**
 * Updates user team based on their current Discord roles
 */
export const updateUserTeamFromDiscordRoles = async (
  discordId: string,
  departmentId?: number,
  retryCount = 0,
  maxRetries = 2
): Promise<TeamUpdateResult> => {
  try {
    console.log(`🏢 updateUserTeamFromDiscordRoles called for Discord ID: ${discordId}, Department: ${departmentId ?? 'all'}`);

    // Get user's current Discord roles
    const userRoles = await fetchUserDiscordRoles(discordId);

    // Get departments to check (either specific one or all where user is a member)
    const departmentConditions = [eq(deptSchema.departmentMembers.discordId, discordId)];
    if (departmentId) {
      departmentConditions.push(eq(deptSchema.departmentMembers.departmentId, departmentId));
    }

    const memberships = await postgrestDb
      .select({
        departmentId: deptSchema.departmentMembers.departmentId,
        memberId: deptSchema.departmentMembers.id,
        currentTeamId: deptSchema.departmentMembers.primaryTeamId,
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

    const updatedDepartments: Array<{ departmentId: number; newTeamId: number | null; oldTeamId: number | null; }> = [];
    let foundAnyTeamChanges = false;

    for (const membership of memberships) {
      console.log(`🏛️ Processing department ${membership.departmentId} (Guild: ${membership.discordGuildId})`);

      // Get all teams for this department with their Discord role IDs
      const departmentTeams = await postgrestDb
        .select({
          id: deptSchema.departmentTeams.id,
          discordRoleId: deptSchema.departmentTeams.discordRoleId,
          name: deptSchema.departmentTeams.name,
        })
        .from(deptSchema.departmentTeams)
        .where(
          and(
            eq(deptSchema.departmentTeams.departmentId, membership.departmentId),
            eq(deptSchema.departmentTeams.isActive, true),
            isNotNull(deptSchema.departmentTeams.discordRoleId)
          )
        );

      console.log(`👥 Found ${departmentTeams.length} active teams with Discord roles for department ${membership.departmentId}`);

      // Find team the user has based on their Discord roles (take first match)
      let newTeamId: number | null = null;
      let teamFound: { id: number; name: string; } | null = null;
      
      // Filter user roles for this specific guild/server
      const guildRoles = userRoles.filter(role => role.serverId === membership.discordGuildId);
      console.log(`👀 User has ${guildRoles.length} roles in guild ${membership.discordGuildId}: [${guildRoles.slice(0, 10).map(r => `'${r.roleId}'`).join(', ')}${guildRoles.length > 10 ? '...' : ''}]`);
      
      // DEBUG: Check if B Shift role exists in ALL roles vs filtered roles
      const bShiftRoleId = '1121245875948236900';
      const bShiftInAll = userRoles.find(r => r.roleId === bShiftRoleId);
      const bShiftInGuild = guildRoles.find(r => r.roleId === bShiftRoleId);
      console.log(`🔍 DEBUG B Shift role ${bShiftRoleId}:`);
      console.log(`   📋 In ALL roles: ${bShiftInAll ? `YES (server: ${bShiftInAll.serverId})` : 'NO'}`);
      console.log(`   🏛️ In guild ${membership.discordGuildId} roles: ${bShiftInGuild ? 'YES' : 'NO'}`);
      console.log(`   🔢 Guild ID types: expected=${typeof membership.discordGuildId} (${membership.discordGuildId}), actual=${bShiftInAll ? typeof bShiftInAll.serverId : 'N/A'} (${bShiftInAll?.serverId ?? 'N/A'})`);
      
      // ADDITIONAL DEBUG: Direct API check for B Shift role
      const directCheck = await checkUserHasRole(discordId, bShiftRoleId, membership.discordGuildId);
      console.log(`   🎯 Direct API check: ${directCheck.hasRole ? 'HAS ROLE' : 'NO ROLE'}${directCheck.error ? ` (Error: ${directCheck.error})` : ''}`);
      
      for (const team of departmentTeams) {
        if (!team.discordRoleId) continue;
        
        const hasRole = guildRoles.some(userRole => userRole.roleId === team.discordRoleId);
        
        console.log(`👥 Checking team "${team.name}" (Role: ${team.discordRoleId}): ${hasRole ? 'HAS ROLE' : 'NO ROLE'}`);
        if (!hasRole) {
          console.log(`   🎯 Looking for role: ${team.discordRoleId}`);
          console.log(`   🔍 User's guild roles: [${guildRoles.map(r => r.roleId).join(', ')}]`);
          console.log(`   ❓ Role match check: ${guildRoles.map(r => `${r.roleId} === ${team.discordRoleId} ? ${r.roleId === team.discordRoleId}`).join(' | ')}`);
        }
        
        if (hasRole) {
          newTeamId = team.id;
          teamFound = { id: team.id, name: team.name };
          console.log(`🎯 Found matching team role: ${team.discordRoleId} for team "${team.name}"`);
          break; // Take the first team role they have
        }
      }

      if (teamFound) {
        console.log(`🎯 Team found: "${teamFound.name}"`);
      } else {
        console.log("❌ No matching team roles found for user in this department");
        
        // If no team found and we have retries left, and this is a specific department check
        if (retryCount < maxRetries && departmentId && departmentTeams.length > 0) {
          console.log(`🔄 No team roles found, will retry (attempt ${retryCount + 1}/${maxRetries + 1})`);
          // Don't immediately retry here, let the calling function handle it
        }
      }

      // Update team if it has changed
      if (newTeamId !== membership.currentTeamId) {
        console.log(`🔄 Team change detected: ${membership.currentTeamId} → ${newTeamId}`);
        foundAnyTeamChanges = true;

        try {
          // Update the primary team assignment immediately
          await postgrestDb
            .update(deptSchema.departmentMembers)
            .set({ 
              primaryTeamId: newTeamId,
              lastActiveDate: new Date(),
            })
            .where(eq(deptSchema.departmentMembers.id, membership.memberId));

          // Handle team membership records
          if (newTeamId) {
            // Add to new team membership if not already exists
            const existingMembership = await postgrestDb
              .select()
              .from(deptSchema.departmentTeamMemberships)
              .where(
                and(
                  eq(deptSchema.departmentTeamMemberships.memberId, membership.memberId),
                  eq(deptSchema.departmentTeamMemberships.teamId, newTeamId)
                )
              )
              .limit(1);

            if (existingMembership.length === 0) {
              await postgrestDb
                .insert(deptSchema.departmentTeamMemberships)
                .values({
                  memberId: membership.memberId,
                  teamId: newTeamId,
                  isLeader: false,
                });
              console.log(`✅ Added team membership record for team ${newTeamId}`);
            }
          }

          // Remove old team memberships if user left teams
          if (membership.currentTeamId && membership.currentTeamId !== newTeamId) {
            await postgrestDb
              .delete(deptSchema.departmentTeamMemberships)
              .where(
                and(
                  eq(deptSchema.departmentTeamMemberships.memberId, membership.memberId),
                  eq(deptSchema.departmentTeamMemberships.teamId, membership.currentTeamId)
                )
              );
            console.log(`🗑️ Removed old team membership record for team ${membership.currentTeamId}`);
          }

          updatedDepartments.push({
            departmentId: membership.departmentId,
            newTeamId,
            oldTeamId: membership.currentTeamId,
          });

          console.log(`✅ Successfully updated team in database for department ${membership.departmentId}`);

        } catch (updateError) {
          console.error(`❌ Failed to update team in database for department ${membership.departmentId}:`, updateError);
          throw updateError;
        }
      } else {
        console.log(`✅ No team change needed for department ${membership.departmentId}`);
      }
    }

    // If no changes found and we have retries left, try again after a short delay
    if (!foundAnyTeamChanges && retryCount < maxRetries && departmentId) {
      console.log(`⏳ No team changes detected, retrying in 2 seconds (attempt ${retryCount + 1}/${maxRetries + 1})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return updateUserTeamFromDiscordRoles(discordId, departmentId, retryCount + 1, maxRetries);
    }

    const message = updatedDepartments.length > 0 
      ? `Updated teams in ${updatedDepartments.length} department(s): ${updatedDepartments.map(d => `Dept ${d.departmentId} (${d.oldTeamId} → ${d.newTeamId})`).join(', ')}`
      : "No team changes needed - all teams are in sync";

    console.log(`🎉 updateUserTeamFromDiscordRoles completed: ${message}`);

    return {
      success: true,
      updatedDepartments,
      message,
    };
  } catch (error) {
    console.error("💥 Failed to update user team from Discord roles:", error);
    return {
      success: false,
      updatedDepartments: [],
      message: `Failed to update teams from Discord roles: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
};