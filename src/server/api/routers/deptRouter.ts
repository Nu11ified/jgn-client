import { z } from "zod";
import { eq, and, desc, asc, isNull, isNotNull, sql, inArray, gt, gte, lt, lte, ne } from "drizzle-orm";
import { adminProcedure, protectedProcedure, publicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import type { RankLimitInfo, RankLimitValidationResult } from "@/server/postgres/schema/department";
import { env } from "@/env";
import axios from "axios";

const API_BASE_URL = (env.INTERNAL_API_URL as string | undefined) ?? "http://localhost:8000";
const M2M_API_KEY = env.M2M_API_KEY as string | undefined;

// Feature flags for Discord sync behavior
const DISCORD_SYNC_FEATURE_FLAGS = {
  ENABLE_AUTO_SYNC_AFTER_ROLE_CHANGE: true,
  SYNC_DELAY_MS: 25000, // Wait time for Discord propagation
  ENABLE_RANK_LIMIT_VALIDATION: true,
  ENABLE_CALLSIGN_AUTO_GENERATION: true,
  ENABLE_DETAILED_LOGGING: true,
  MAX_SYNC_RETRIES: 2,
} as const;

// Zod validation schemas for input validation
const createDepartmentSchema = z.object({
  name: z.string().min(1, "Department name is required").max(256),
  type: deptSchema.departmentTypeEnum,
  description: z.string().optional(),
  discordGuildId: z.string().min(1, "Discord Guild ID is required").max(30),
  discordCategoryId: z.string().max(30).optional(),
  callsignPrefix: z.string().min(1, "Callsign prefix is required").max(10),
});

const updateDepartmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(256).optional(),
  type: deptSchema.departmentTypeEnum.optional(),
  description: z.string().optional().nullable(),
  discordGuildId: z.string().min(1).max(30).optional(),
  discordCategoryId: z.string().max(30).optional().nullable(),
  callsignPrefix: z.string().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});

const createRankSchema = z.object({
  departmentId: z.number().int().positive(),
  name: z.string().min(1, "Rank name is required").max(256),
  callsign: z.string().min(1, "Rank callsign is required").max(10),
  abbreviation: z.string().max(10).optional(),
  discordRoleId: z.string().min(1, "Discord Role ID is required").max(30),
  level: z.number().int().min(1, "Level must be at least 1"),
  permissions: deptSchema.departmentPermissionsSchema.optional(),
  salary: z.number().int().min(0).optional(),
});

const updateRankSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(256).optional(),
  callsign: z.string().min(1).max(10).optional(),
  abbreviation: z.string().max(10).optional().nullable(),
  discordRoleId: z.string().min(1).max(30).optional(),
  level: z.number().int().min(1).optional(),
  permissions: deptSchema.departmentPermissionsSchema.optional(),
  salary: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const createTeamSchema = z.object({
  departmentId: z.number().int().positive(),
  name: z.string().min(1, "Team name is required").max(256),
  description: z.string().optional(),
  callsignPrefix: z.string().max(10).optional(),
  discordRoleId: z.string().max(30).optional(),
  leaderId: z.string().optional(),
});

const updateTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(256).optional(),
  description: z.string().optional().nullable(),
  callsignPrefix: z.string().max(10).optional().nullable(),
  discordRoleId: z.string().max(30).optional().nullable(),
  leaderId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const createMemberSchema = z.object({
  discordId: z.string().min(1, "Discord ID is required"),
  departmentId: z.number().int().positive(),
  roleplayName: z.string().min(1, "Roleplay name is required").max(100, "Roleplay name must be 100 characters or less").optional(),
  rankId: z.number().int().positive().optional(),
  badgeNumber: z.string().max(20).optional(),
  primaryTeamId: z.number().int().positive().optional(),
  status: deptSchema.departmentMemberStatusEnum.optional(),
  notes: z.string().optional(),
});

const updateMemberSchema = z.object({
  id: z.number().int().positive(),
  roleplayName: z.string().min(1, "Roleplay name is required").max(100, "Roleplay name must be 100 characters or less").optional().nullable(),
  rankId: z.number().int().positive().optional().nullable(),
  badgeNumber: z.string().max(20).optional().nullable(),
  primaryTeamId: z.number().int().positive().optional().nullable(),
  status: deptSchema.departmentMemberStatusEnum.optional(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// Utility function to generate callsign
const generateCallsign = (rankCallsign: string, departmentPrefix: string, idNumber?: number, teamPrefix?: string): string => {
  if (!idNumber) return `${rankCallsign}${departmentPrefix}`;
  if (teamPrefix) {
    return `${rankCallsign}${departmentPrefix}-${idNumber}(${teamPrefix})`;
  }
  return `${rankCallsign}${departmentPrefix}-${idNumber}`;
};

// Utility function to get next available ID number for a department
const getNextAvailableIdNumber = async (departmentId: number): Promise<number> => {
  // Get the next available ID number (100-999)
  const availableId = await postgrestDb
    .select()
    .from(deptSchema.departmentIdNumbers)
    .where(
      and(
        eq(deptSchema.departmentIdNumbers.departmentId, departmentId),
        eq(deptSchema.departmentIdNumbers.isAvailable, true)
      )
    )
    .orderBy(asc(deptSchema.departmentIdNumbers.idNumber))
    .limit(1);

  if (availableId.length > 0) {
    return availableId[0]!.idNumber;
  }

  // If no available ID found, create new ones if needed
  const maxId = await postgrestDb
    .select()
    .from(deptSchema.departmentIdNumbers)
    .where(eq(deptSchema.departmentIdNumbers.departmentId, departmentId))
    .orderBy(desc(deptSchema.departmentIdNumbers.idNumber))
    .limit(1);

  let nextId = 100; // Start from 100
  if (maxId.length > 0 && maxId[0]!.idNumber < 999) {
    nextId = maxId[0]!.idNumber + 1;
  } else if (maxId.length > 0 && maxId[0]!.idNumber >= 999) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "No available ID numbers (100-999) for this department",
    });
  }

  // Create the new ID number
  await postgrestDb.insert(deptSchema.departmentIdNumbers).values({
    departmentId,
    idNumber: nextId,
    isAvailable: true,
  });

  return nextId;
};

// Utility function to validate API key for training endpoints
const validateApiKey = (apiKey: string): boolean => {
  const validApiKey = process.env.DEPARTMENT_TRAINING_API_KEY;
  if (!validApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Training API key not configured",
    });
  }
  return apiKey === validApiKey;
};

// Training-related schemas
const trainingCompletionSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  discordId: z.string().min(1, "Discord ID is required"),
  departmentId: z.number().int().positive(),
});

const assignTeamSchema = z.object({
  memberId: z.number().int().positive(),
  teamId: z.number().int().positive(),
});

const updateMemberStatusSchema = z.object({
  memberId: z.number().int().positive(),
  status: deptSchema.departmentMemberStatusEnum,
});

// Rank limit management schemas
const setDepartmentRankLimitSchema = z.object({
  rankId: z.number().int().positive(),
  maxMembers: z.number().int().min(0).nullable(), // null = unlimited, 0+ = specific limit
});

const setTeamRankLimitSchema = z.object({
  teamId: z.number().int().positive(),
  rankId: z.number().int().positive(),
  maxMembers: z.number().int().min(1), // Team limits must be at least 1 (cannot be unlimited)
});

const removeRankLimitSchema = z.object({
  rankId: z.number().int().positive(),
});

const removeTeamRankLimitSchema = z.object({
  teamId: z.number().int().positive(),
  rankId: z.number().int().positive(),
});

const getRankLimitsSchema = z.object({
  departmentId: z.number().int().positive(),
  teamId: z.number().int().positive().optional(),
});

const discordWebhookSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  discordId: z.string().min(1, "Discord ID is required"),
});

const updateRankByDiscordIdSchema = z.object({
  discordId: z.string().min(1, "Discord ID is required"),
  departmentId: z.number().int().positive().optional(), // Optional to update all departments
});

const updateTeamByDiscordIdSchema = z.object({
  discordId: z.string().min(1, "Discord ID is required"),
  departmentId: z.number().int().positive().optional(), // Optional to update all departments
});

// Utility function to call Discord role management API
const manageDiscordRole = async (action: 'add' | 'remove', userDiscordId: string, roleId: string, serverId: string): Promise<boolean> => {
  try {
    console.log("🎭 manageDiscordRole called with:", { action, userDiscordId, roleId, serverId });
    
    if (!M2M_API_KEY) {
      console.log("❌ No M2M_API_KEY found");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "M2M API key not configured",
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
    });

    console.log("📥 Role management response status:", response.status);
    console.log("📥 Role management response data:", response.data);
    console.log(`✅ Discord role ${action} successful:`, response.data);
    return true;
  } catch (error) {
    console.error(`❌ Discord role ${action} failed:`, error);
    if (axios.isAxiosError(error)) {
      console.error("❌ Axios error details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: error.response?.data,
        message: error.message
      });
    }
    // Return false to indicate failure instead of throwing
    return false;
  }
};

// Utility function to get server ID from role ID
const getServerIdFromRoleId = async (roleId: string): Promise<string | null> => {
  try {
    console.log("🔍 getServerIdFromRoleId called with roleId:", roleId);
    
    if (!M2M_API_KEY) {
      console.log("❌ No M2M_API_KEY found");
      return null;
    }

    const url = `${API_BASE_URL}/admin/roles/${roleId}`;
    console.log("🌐 Making API call to:", url);

    const response = await axios.get(url, {
      headers: { "X-API-Key": M2M_API_KEY },
    });

    console.log("📥 API response status:", response.status);
    console.log("📥 API response data:", response.data);

    // Check if response.data exists and has server_id property
    if (response.data && typeof response.data === 'object' && 'server_id' in response.data) {
      const serverId = (response.data as { server_id: unknown }).server_id;
      const result = typeof serverId === 'string' ? serverId : null;
      console.log("✅ Extracted server ID:", result);
      return result;
    }
    
    console.log("❌ No server_id found in response");
    return null;
  } catch (error) {
    console.error("❌ Failed to get server ID from role ID:", error);
    if (axios.isAxiosError(error)) {
      console.error("❌ Axios error details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: error.response?.data,
        message: error.message
      });
    }
    return null;
  }
};

// Utility function to update user's rank based on their current Discord roles
const updateUserRankFromDiscordRoles = async (discordId: string, departmentId?: number): Promise<{ 
  success: boolean; 
  updatedDepartments: Array<{ departmentId: number; newRankId: number | null; oldRankId: number | null; }>;
  message: string;
}> => {
  try {
    console.log(`📊 updateUserRankFromDiscordRoles called for Discord ID: ${discordId}, Department: ${departmentId ?? 'all'}`);

    // Get user's current Discord roles
    let userRoles: Array<{ roleId: string; serverId: string; }> = [];
    
    try {
      if (M2M_API_KEY) {
        console.log("🔍 Fetching user Discord roles from API...");
        const rolesResponse = await axios.get(
          `${API_BASE_URL}/admin/user_server_roles/users/${discordId}/roles`,
          {
            headers: { "X-API-Key": M2M_API_KEY },
          }
        );
        // Map the API response fields to our expected format
        const rawRoles = rolesResponse.data as Array<{ role_id: string; server_id: string; role_name: string; }> ?? [];
        userRoles = rawRoles.map(role => ({ 
          roleId: role.role_id, 
          serverId: role.server_id 
        }));
        console.log(`📋 Found ${userRoles.length} Discord roles for user`);
        if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_DETAILED_LOGGING) {
          console.log("🔍 User's Discord roles:", userRoles.slice(0, 5).map(r => `${r.roleId} (${r.serverId})`));
        }
      } else {
        console.warn("⚠️ M2M_API_KEY not available, skipping Discord role fetch");
      }
    } catch (error) {
      console.error("❌ Failed to fetch user Discord roles:", error);
      throw new Error("Failed to fetch Discord roles from API");
    }

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

// Utility function to validate rank limits before promotion
const validateRankLimit = async (
  rankId: number,
  departmentId: number,
  teamId?: number
): Promise<RankLimitValidationResult> => {
  try {
    // Get the rank and its department limit
    const rank = await postgrestDb
      .select({
        id: deptSchema.departmentRanks.id,
        name: deptSchema.departmentRanks.name,
        maxMembers: deptSchema.departmentRanks.maxMembers,
      })
      .from(deptSchema.departmentRanks)
      .where(
        and(
          eq(deptSchema.departmentRanks.id, rankId),
          eq(deptSchema.departmentRanks.departmentId, departmentId)
        )
      )
      .limit(1);

    if (rank.length === 0) {
      return {
        canPromote: false,
        reason: "Rank not found in department",
      };
    }

    const rankData = rank[0]!;
    let effectiveLimit = rankData.maxMembers;
    let teamLimit: number | null = null;

    // Check for team-specific override if teamId is provided
    if (teamId) {
      const teamRankLimit = await postgrestDb
        .select()
        .from(deptSchema.departmentTeamRankLimits)
        .where(
          and(
            eq(deptSchema.departmentTeamRankLimits.teamId, teamId),
            eq(deptSchema.departmentTeamRankLimits.rankId, rankId)
          )
        )
        .limit(1);

      if (teamRankLimit.length > 0) {
        effectiveLimit = teamRankLimit[0]!.maxMembers;
        teamLimit = teamRankLimit[0]!.maxMembers;
      }
    }

    // If no limit (null), allow unlimited
    if (effectiveLimit === null) {
      return {
        canPromote: true,
        departmentLimit: rankData.maxMembers,
        teamLimit,
        currentCount: 0, // We don't need to count if unlimited
      };
    }

    // Count current members with this rank in the appropriate scope
    let currentCount: number;
    
    if (teamId && teamLimit !== null) {
      // Count members in the specific team with this rank
      const teamMemberCount = await postgrestDb
        .select({ count: sql`count(*)` })
        .from(deptSchema.departmentMembers)
        .where(
          and(
            eq(deptSchema.departmentMembers.rankId, rankId),
            eq(deptSchema.departmentMembers.primaryTeamId, teamId),
            eq(deptSchema.departmentMembers.isActive, true)
          )
        );
      currentCount = Number(teamMemberCount[0]?.count ?? 0);
    } else {
      // Count members in the entire department with this rank
      const deptMemberCount = await postgrestDb
        .select({ count: sql`count(*)` })
        .from(deptSchema.departmentMembers)
        .where(
          and(
            eq(deptSchema.departmentMembers.rankId, rankId),
            eq(deptSchema.departmentMembers.departmentId, departmentId),
            eq(deptSchema.departmentMembers.isActive, true)
          )
        );
      currentCount = Number(deptMemberCount[0]?.count ?? 0);
    }

    const canPromote = currentCount < effectiveLimit;

    return {
      canPromote,
      reason: canPromote 
        ? "Promotion allowed" 
        : `Rank limit reached (${currentCount}/${effectiveLimit})`,
      departmentLimit: rankData.maxMembers,
      teamLimit,
      currentCount,
    };
  } catch (error) {
    return {
      canPromote: false,
      reason: `Failed to validate rank limit: ${error as string}`,
    };
  }
};

// Utility function to get comprehensive rank limit information
const getRankLimitInfo = async (
  departmentId: number,
  teamId?: number
): Promise<RankLimitInfo[]> => {
  try {
    // Get all ranks for the department
    const ranks = await postgrestDb
      .select({
        id: deptSchema.departmentRanks.id,
        name: deptSchema.departmentRanks.name,
        maxMembers: deptSchema.departmentRanks.maxMembers,
      })
      .from(deptSchema.departmentRanks)
      .where(
        and(
          eq(deptSchema.departmentRanks.departmentId, departmentId),
          eq(deptSchema.departmentRanks.isActive, true)
        )
      )
      .orderBy(desc(deptSchema.departmentRanks.level));

    const rankLimitInfos: RankLimitInfo[] = [];

    for (const rank of ranks) {
      let effectiveLimit = rank.maxMembers;
      let teamLimit: number | null = null;

      // Check for team-specific override if teamId is provided
      if (teamId) {
        const teamRankLimit = await postgrestDb
          .select()
          .from(deptSchema.departmentTeamRankLimits)
          .where(
            and(
              eq(deptSchema.departmentTeamRankLimits.teamId, teamId),
              eq(deptSchema.departmentTeamRankLimits.rankId, rank.id)
            )
          )
          .limit(1);

        if (teamRankLimit.length > 0) {
          effectiveLimit = teamRankLimit[0]!.maxMembers;
          teamLimit = teamRankLimit[0]!.maxMembers;
        }
      }

      // Count current members with this rank
      let currentCount: number;
      
      if (teamId && teamLimit !== null) {
        // Count members in the specific team with this rank
        const teamMemberCount = await postgrestDb
          .select({ count: sql`count(*)` })
          .from(deptSchema.departmentMembers)
          .where(
            and(
              eq(deptSchema.departmentMembers.rankId, rank.id),
              eq(deptSchema.departmentMembers.primaryTeamId, teamId),
              eq(deptSchema.departmentMembers.isActive, true)
            )
          );
        currentCount = Number(teamMemberCount[0]?.count ?? 0);
      } else {
        // Count members in the entire department with this rank
        const deptMemberCount = await postgrestDb
          .select({ count: sql`count(*)` })
          .from(deptSchema.departmentMembers)
          .where(
            and(
              eq(deptSchema.departmentMembers.rankId, rank.id),
              eq(deptSchema.departmentMembers.departmentId, departmentId),
              eq(deptSchema.departmentMembers.isActive, true)
            )
          );
        currentCount = Number(deptMemberCount[0]?.count ?? 0);
      }

      rankLimitInfos.push({
        rankId: rank.id,
        rankName: rank.name,
        departmentLimit: rank.maxMembers,
        teamLimit,
        currentCount,
        availableSlots: effectiveLimit ? Math.max(0, effectiveLimit - currentCount) : null,
        isAtCapacity: effectiveLimit ? currentCount >= effectiveLimit : false,
      });
    }

    return rankLimitInfos;
  } catch (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to get rank limit information: ${error as string}`,
    });
  }
};

function assertCanActOnMember({ actorDiscordId, actorRankLevel, targetDiscordId, targetRankLevel, actionName }: { actorDiscordId: string; actorRankLevel: number; targetDiscordId: string; targetRankLevel: number; actionName: string; }) {
  if (actorDiscordId === targetDiscordId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You cannot ${actionName} for yourself.`,
    });
  }
  if (targetRankLevel >= actorRankLevel) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You cannot ${actionName} for someone of equal or higher rank.`,
    });
  }
}

// Utility function to update user's team based on their current Discord roles
const updateUserTeamFromDiscordRoles = async (discordId: string, departmentId?: number): Promise<{ 
  success: boolean; 
  updatedDepartments: Array<{ departmentId: number; newTeamId: number | null; oldTeamId: number | null; }>;
  message: string;
}> => {
  try {
    console.log(`🏢 updateUserTeamFromDiscordRoles called for Discord ID: ${discordId}, Department: ${departmentId ?? 'all'}`);

    // Get user's current Discord roles
    let userRoles: Array<{ roleId: string; serverId: string; }> = [];
    
    try {
      if (M2M_API_KEY) {
        console.log("🔍 Fetching user Discord roles from API...");
        const rolesResponse = await axios.get(
          `${API_BASE_URL}/admin/user_server_roles/users/${discordId}/roles`,
          {
            headers: { "X-API-Key": M2M_API_KEY },
          }
        );
        // Map the API response fields to our expected format
        const rawRoles = rolesResponse.data as Array<{ role_id: string; server_id: string; role_name: string; }> ?? [];
        userRoles = rawRoles.map(role => ({ 
          roleId: role.role_id, 
          serverId: role.server_id 
        }));
        console.log(`📋 Found ${userRoles.length} Discord roles for user`);
        if (DISCORD_SYNC_FEATURE_FLAGS.ENABLE_DETAILED_LOGGING) {
          console.log("🔍 User's Discord roles:", userRoles.slice(0, 5).map(r => `${r.roleId} (${r.serverId})`));
        }
      } else {
        console.warn("⚠️ M2M_API_KEY not available, skipping Discord role fetch");
      }
    } catch (error) {
      console.error("❌ Failed to fetch user Discord roles:", error);
      throw new Error("Failed to fetch Discord roles from API");
    }

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
      
      for (const team of departmentTeams) {
        if (!team.discordRoleId) continue;
        
        const hasRole = userRoles.some(
          userRole => userRole.roleId === team.discordRoleId && userRole.serverId === membership.discordGuildId
        );
        
        console.log(`👥 Checking team "${team.name}" (Role: ${team.discordRoleId}): ${hasRole ? 'HAS ROLE' : 'NO ROLE'}`);
        
        if (hasRole) {
          newTeamId = team.id;
          teamFound = { id: team.id, name: team.name };
          break; // Take the first team role they have
        }
      }

      if (teamFound) {
        console.log(`🎯 Team found: "${teamFound.name}"`);
      } else {
        console.log("❌ No matching team roles found for user in this department");
      }

      // Update team if it has changed
      if (newTeamId !== membership.currentTeamId) {
        console.log(`🔄 Team change detected: ${membership.currentTeamId} → ${newTeamId}`);

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

// Utility function to remove Discord roles for members with non-active status
const removeDiscordRolesForInactiveMember = async (discordId: string, departmentId: number): Promise<{ 
  success: boolean; 
  message: string;
  removedRoles: Array<{ type: 'rank' | 'team'; roleId: string; }>;
}> => {
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
          
          if (roleRemoved) {
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
          
          if (roleRemoved) {
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
          
          if (roleRemoved) {
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

// Utility function to restore Discord roles for members returning to active status
const restoreDiscordRolesForActiveMember = async (discordId: string, departmentId: number): Promise<{ 
  success: boolean; 
  message: string;
  addedRoles: Array<{ type: 'rank' | 'team'; roleId: string; }>;
}> => {
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
          
          if (roleAdded) {
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
          
          if (roleAdded) {
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
          
          if (roleAdded) {
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

export const deptRouter = createTRPCRouter({
  // Organize routes using CRUD structure following tRPC best practices
  admin: createTRPCRouter({
    // ===== DEPARTMENT MANAGEMENT =====
    departments: createTRPCRouter({
      // CREATE department
      create: adminProcedure
        .input(createDepartmentSchema)
        .mutation(async ({ input }) => {
          try {
            // Check if department name already exists
            const existingDept = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.name, input.name))
              .limit(1);

            if (existingDept.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Department with this name already exists",
              });
            }

            // Check if callsign prefix is already in use
            const existingPrefix = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.callsignPrefix, input.callsignPrefix))
              .limit(1);

            if (existingPrefix.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Callsign prefix is already in use",
              });
            }

            const result = await postgrestDb
              .insert(deptSchema.departments)
              .values(input)
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create department",
            });
          }
        }),

      // READ departments (list all)
      list: adminProcedure
        .input(
          z.object({
            includeInactive: z.boolean().default(false),
            type: deptSchema.departmentTypeEnum.optional(),
          }).optional()
        )
        .query(async ({ input }) => {
          try {
            const conditions = [];
            if (!input?.includeInactive) {
              conditions.push(eq(deptSchema.departments.isActive, true));
            }
            if (input?.type) {
              conditions.push(eq(deptSchema.departments.type, input.type));
            }

            let departments;
            if (conditions.length > 0) {
              departments = await postgrestDb
                .select()
                .from(deptSchema.departments)
                .where(and(...conditions))
                .orderBy(asc(deptSchema.departments.name));
            } else {
              departments = await postgrestDb
                .select()
                .from(deptSchema.departments)
                .orderBy(asc(deptSchema.departments.name));
            }
            
            return departments;
          } catch (error) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to fetch departments: ${error as string}`,
            });
          }
        }),

      // READ department by ID (with relations)
      getById: adminProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .query(async ({ input }) => {
          try {
            const department = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, input.id))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }

            // Get related data
            const [ranks, teams, members, teamMemberships] = await Promise.all([
              postgrestDb
                .select()
                .from(deptSchema.departmentRanks)
                .where(eq(deptSchema.departmentRanks.departmentId, input.id))
                .orderBy(desc(deptSchema.departmentRanks.level)),
              postgrestDb
                .select()
                .from(deptSchema.departmentTeams)
                .where(eq(deptSchema.departmentTeams.departmentId, input.id))
                .orderBy(asc(deptSchema.departmentTeams.name)),
              postgrestDb
                .select({
                  id: deptSchema.departmentMembers.id,
                  discordId: deptSchema.departmentMembers.discordId,
                  roleplayName: deptSchema.departmentMembers.roleplayName,
                  callsign: deptSchema.departmentMembers.callsign,
                  badgeNumber: deptSchema.departmentMembers.badgeNumber,
                  primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
                  status: deptSchema.departmentMembers.status,
                  hireDate: deptSchema.departmentMembers.hireDate,
                  isActive: deptSchema.departmentMembers.isActive,
                  rankName: deptSchema.departmentRanks.name,
                  rankLevel: deptSchema.departmentRanks.level,
                })
                .from(deptSchema.departmentMembers)
                .leftJoin(
                  deptSchema.departmentRanks,
                  eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                )
                .where(and(...[eq(deptSchema.departmentMembers.departmentId, input.id)]))
                .orderBy(asc(deptSchema.departmentMembers.callsign)),
              // Get team memberships for this department
              postgrestDb
                .select({
                  memberId: deptSchema.departmentTeamMemberships.memberId,
                  teamId: deptSchema.departmentTeamMemberships.teamId,
                  isLeader: deptSchema.departmentTeamMemberships.isLeader,
                  joinedAt: deptSchema.departmentTeamMemberships.joinedAt,
                })
                .from(deptSchema.departmentTeamMemberships)
                .innerJoin(
                  deptSchema.departmentTeams,
                  eq(deptSchema.departmentTeamMemberships.teamId, deptSchema.departmentTeams.id)
                )
                .where(eq(deptSchema.departmentTeams.departmentId, input.id)),
            ]);

            return {
              ...department[0],
              ranks,
              teams,
              members,
              teamMemberships,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch department",
            });
          }
        }),

      // UPDATE department
      update: adminProcedure
        .input(updateDepartmentSchema)
        .mutation(async ({ input }) => {
          const { id, ...updateData } = input;
          
          try {
            // Check if department exists
            const existingDept = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, id))
              .limit(1);

            if (existingDept.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }

            // Check for name conflicts (if name is being updated)
            if (updateData.name) {
              const nameConflict = await postgrestDb
                .select()
                .from(deptSchema.departments)
                .where(
                  and(
                    eq(deptSchema.departments.name, updateData.name),
                    sql`${deptSchema.departments.id} != ${id}`
                  )
                )
                .limit(1);

              if (nameConflict.length > 0) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Department with this name already exists",
                });
              }
            }

            // Check for callsign prefix conflicts (if prefix is being updated)
            if (updateData.callsignPrefix) {
              const prefixConflict = await postgrestDb
                .select()
                .from(deptSchema.departments)
                .where(
                  and(
                    eq(deptSchema.departments.callsignPrefix, updateData.callsignPrefix),
                    sql`${deptSchema.departments.id} != ${id}`
                  )
                )
                .limit(1);

              if (prefixConflict.length > 0) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Callsign prefix is already in use",
                });
              }
            }

            const result = await postgrestDb
              .update(deptSchema.departments)
              .set(updateData)
              .where(eq(deptSchema.departments.id, id))
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update department",
            });
          }
        }),

      // DELETE department (cascade delete with proper cleanup)
      delete: adminProcedure
        .input(z.object({ 
          id: z.number().int().positive(),
          force: z.boolean().default(false) // Force deletion even with active members
        }))
        .mutation(async ({ input }) => {
          try {
            // Check if department exists
            const existingDept = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, input.id))
              .limit(1);

            if (existingDept.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }

            const department = existingDept[0]!;

            // Get count of active members for logging
            const activeMembersCount = await postgrestDb
              .select({ count: sql`count(*)` })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.departmentId, input.id),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              );

            const memberCount = Number(activeMembersCount[0]?.count ?? 0);

            // If not forcing and there are active members, throw error
            if (!input.force && memberCount > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: `Cannot delete department with ${memberCount} active members. Use force=true to override and remove all members.`,
              });
            }

            console.log(`🗑️ Starting cascade deletion of department "${department.name}" (ID: ${input.id})`);
            if (memberCount > 0) {
              console.log(`⚠️ Force deleting department with ${memberCount} active members`);
            }

            // Helper function to add delay between steps
            const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            // Step 1: Soft delete all active members and clean up their Discord roles
            if (memberCount > 0) {
              console.log(`👥 Soft-deleting ${memberCount} active members...`);
              
              const activeMembers = await postgrestDb
                .select({
                  id: deptSchema.departmentMembers.id,
                  discordId: deptSchema.departmentMembers.discordId,
                  departmentIdNumber: deptSchema.departmentMembers.departmentIdNumber,
                })
                .from(deptSchema.departmentMembers)
                .where(
                  and(
                    eq(deptSchema.departmentMembers.departmentId, input.id),
                    eq(deptSchema.departmentMembers.isActive, true)
                  )
                );

              // Remove Discord roles and soft delete members
              for (const member of activeMembers) {
                try {
                  // Remove Discord roles
                  const roleRemovalResult = await removeDiscordRolesForInactiveMember(
                    member.discordId, 
                    input.id
                  );
                  
                  if (roleRemovalResult.success) {
                    console.log(`✅ Removed Discord roles for member ${member.discordId}`);
                  } else {
                    console.warn(`⚠️ Failed to remove Discord roles for member ${member.discordId}: ${roleRemovalResult.message}`);
                  }

                  // Free up ID number
                  if (member.departmentIdNumber) {
                    await postgrestDb
                      .update(deptSchema.departmentIdNumbers)
                      .set({ 
                        isAvailable: true,
                        currentMemberId: null,
                      })
                      .where(
                        and(
                          eq(deptSchema.departmentIdNumbers.departmentId, input.id),
                          eq(deptSchema.departmentIdNumbers.idNumber, member.departmentIdNumber)
                        )
                      );
                  }

                  // Soft delete member
                  await postgrestDb
                    .update(deptSchema.departmentMembers)
                    .set({ 
                      isActive: false,
                      lastActiveDate: new Date()
                    })
                    .where(eq(deptSchema.departmentMembers.id, member.id));

                } catch (memberError) {
                  console.error(`❌ Error processing member ${member.discordId}:`, memberError);
                }
              }
              
              // Wait 2 seconds after processing all members
              console.log(`⏳ Waiting 2 seconds before proceeding to team cleanup...`);
              await delay(2000);
            }

            // Step 2: Remove all team memberships (will cascade automatically, but doing explicitly for clarity)
            console.log(`🏛️ Removing team memberships...`);
            await postgrestDb
              .delete(deptSchema.departmentTeamMemberships)
              .where(
                sql`${deptSchema.departmentTeamMemberships.memberId} IN (
                  SELECT id FROM ${deptSchema.departmentMembers} 
                  WHERE department_id = ${input.id}
                )`
              );
            
            // Wait 2 seconds after team memberships cleanup
            console.log(`⏳ Waiting 2 seconds before proceeding to rank limits cleanup...`);
            await delay(2000);

            // Step 3: Delete all team rank limits
            console.log(`📊 Removing team rank limits...`);
            await postgrestDb
              .delete(deptSchema.departmentTeamRankLimits)
              .where(
                sql`${deptSchema.departmentTeamRankLimits.teamId} IN (
                  SELECT id FROM ${deptSchema.departmentTeams} 
                  WHERE department_id = ${input.id}
                )`
              );
            
            // Wait 2 seconds after rank limits cleanup
            console.log(`⏳ Waiting 2 seconds before proceeding to teams deletion...`);
            await delay(2000);

            // Step 4: Delete all teams
            console.log(`👥 Deleting department teams...`);
            const teamsDeleted = await postgrestDb
              .delete(deptSchema.departmentTeams)
              .where(eq(deptSchema.departmentTeams.departmentId, input.id))
              .returning({ id: deptSchema.departmentTeams.id, name: deptSchema.departmentTeams.name });

            console.log(`✅ Deleted ${teamsDeleted.length} teams`);
            
            // Wait 2 seconds after teams deletion
            console.log(`⏳ Waiting 2 seconds before proceeding to ranks deletion...`);
            await delay(2000);

            // Step 5: Delete all ranks
            console.log(`🎖️ Deleting department ranks...`);
            const ranksDeleted = await postgrestDb
              .delete(deptSchema.departmentRanks)
              .where(eq(deptSchema.departmentRanks.departmentId, input.id))
              .returning({ id: deptSchema.departmentRanks.id, name: deptSchema.departmentRanks.name });

            console.log(`✅ Deleted ${ranksDeleted.length} ranks`);
            
            // Wait 2 seconds after ranks deletion
            console.log(`⏳ Waiting 2 seconds before proceeding to meetings cleanup...`);
            await delay(2000);

            // Step 6: Clean up meetings (cascade should handle this, but being explicit)
            console.log(`📅 Cleaning up meetings...`);
            await postgrestDb
              .delete(deptSchema.departmentMeetingAttendance)
              .where(
                sql`${deptSchema.departmentMeetingAttendance.meetingId} IN (
                  SELECT id FROM ${deptSchema.departmentMeetings} 
                  WHERE department_id = ${input.id}
                )`
              );
            
            const meetingsDeleted = await postgrestDb
              .delete(deptSchema.departmentMeetings)
              .where(eq(deptSchema.departmentMeetings.departmentId, input.id))
              .returning({ id: deptSchema.departmentMeetings.id, title: deptSchema.departmentMeetings.title });

            console.log(`✅ Deleted ${meetingsDeleted.length} meetings`);
            
            // Wait 2 seconds after meetings cleanup
            console.log(`⏳ Waiting 2 seconds before proceeding to ID numbers cleanup...`);
            await delay(2000);

            // Step 7: Clean up ID numbers
            console.log(`🔢 Cleaning up ID numbers...`);
            await postgrestDb
              .delete(deptSchema.departmentIdNumbers)
              .where(eq(deptSchema.departmentIdNumbers.departmentId, input.id));
            
            // Wait 2 seconds before final department deletion
            console.log(`⏳ Waiting 2 seconds before final department deletion...`);
            await delay(2000);

            // Step 8: Finally, soft delete the department
            console.log(`🏢 Soft-deleting department...`);
            const result = await postgrestDb
              .update(deptSchema.departments)
              .set({ isActive: false })
              .where(eq(deptSchema.departments.id, input.id))
              .returning();

            console.log(`✅ Department "${department.name}" successfully deleted`);

            return {
              ...result[0],
              deletionSummary: {
                membersProcessed: memberCount,
                teamsDeleted: teamsDeleted.length,
                ranksDeleted: ranksDeleted.length,
                meetingsDeleted: meetingsDeleted.length,
              }
            };

          } catch (error) {
            console.error(`❌ Error deleting department:`, error);
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to delete department",
            });
          }
        }),
    }),

    // ===== RANK MANAGEMENT =====
    ranks: createTRPCRouter({
      // CREATE rank
      create: adminProcedure
        .input(createRankSchema)
        .mutation(async ({ input }) => {
          try {
            // Check if department exists
            const department = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, input.departmentId))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }

            // Check for duplicate rank name within department
            const existingRank = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(
                and(
                  eq(deptSchema.departmentRanks.departmentId, input.departmentId),
                  eq(deptSchema.departmentRanks.name, input.name)
                )
              )
              .limit(1);

            if (existingRank.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Rank with this name already exists in the department",
              });
            }

            // Check for duplicate rank callsign within department
            const existingCallsign = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(
                and(
                  eq(deptSchema.departmentRanks.departmentId, input.departmentId),
                  eq(deptSchema.departmentRanks.callsign, input.callsign)
                )
              )
              .limit(1);

            if (existingCallsign.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Rank with this callsign already exists in the department",
              });
            }

            // Check for duplicate Discord role ID
            const existingRole = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(eq(deptSchema.departmentRanks.discordRoleId, input.discordRoleId))
              .limit(1);

            if (existingRole.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Discord role is already assigned to another rank",
              });
            }

            const result = await postgrestDb
              .insert(deptSchema.departmentRanks)
              .values(input)
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create rank",
            });
          }
        }),

      // READ ranks by department
      listByDepartment: adminProcedure
        .input(z.object({ 
          departmentId: z.number().int().positive(),
          includeInactive: z.boolean().default(false)
        }))
        .query(async ({ input }) => {
          try {
            const conditions = [eq(deptSchema.departmentRanks.departmentId, input.departmentId)];
            
            if (!input.includeInactive) {
              conditions.push(eq(deptSchema.departmentRanks.isActive, true));
            }

            const ranks = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(and(...conditions))
              .orderBy(desc(deptSchema.departmentRanks.level));
              
            return ranks;
          } catch (error) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to fetch ranks: ${error as string}`,
            });
          }
        }),

      // UPDATE rank
      update: adminProcedure
        .input(updateRankSchema)
        .mutation(async ({ input }) => {
          const { id, ...updateData } = input;
          
          try {
            // Check if rank exists
            const existingRank = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(eq(deptSchema.departmentRanks.id, id))
              .limit(1);

            if (existingRank.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Rank not found",
              });
            }

            // Check for name conflicts within department (if name is being updated)
            if (updateData.name) {
              const nameConflict = await postgrestDb
                .select()
                .from(deptSchema.departmentRanks)
                .where(
                  and(
                    eq(deptSchema.departmentRanks.departmentId, existingRank[0]!.departmentId),
                    eq(deptSchema.departmentRanks.name, updateData.name),
                    sql`${deptSchema.departmentRanks.id} != ${id}`
                  )
                )
                .limit(1);

              if (nameConflict.length > 0) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Rank with this name already exists in the department",
                });
              }
            }

            // Check for callsign conflicts within department (if callsign is being updated)
            if (updateData.callsign) {
              const callsignConflict = await postgrestDb
                .select()
                .from(deptSchema.departmentRanks)
                .where(
                  and(
                    eq(deptSchema.departmentRanks.departmentId, existingRank[0]!.departmentId),
                    eq(deptSchema.departmentRanks.callsign, updateData.callsign),
                    sql`${deptSchema.departmentRanks.id} != ${id}`
                  )
                )
                .limit(1);

              if (callsignConflict.length > 0) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Rank with this callsign already exists in the department",
                });
              }
            }

            const result = await postgrestDb
              .update(deptSchema.departmentRanks)
              .set(updateData)
              .where(eq(deptSchema.departmentRanks.id, id))
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update rank",
            });
          }
        }),

      // DELETE rank
      delete: adminProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          try {
            // Check if rank exists
            const existingRank = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(eq(deptSchema.departmentRanks.id, input.id))
              .limit(1);

            if (existingRank.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Rank not found",
              });
            }

            // Check if rank is assigned to any members
            const membersWithRank = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.rankId, input.id))
              .limit(1);

            if (membersWithRank.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Cannot delete rank that is assigned to members",
              });
            }

            await postgrestDb
              .delete(deptSchema.departmentRanks)
              .where(eq(deptSchema.departmentRanks.id, input.id));

            return { success: true };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to delete rank",
            });
          }
        }),
    }),

    // ===== TEAM MANAGEMENT =====
    teams: createTRPCRouter({
      // CREATE team
      create: adminProcedure
        .input(createTeamSchema)
        .mutation(async ({ input }) => {
          try {
            // Check if department exists
            const department = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, input.departmentId))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }

            // Check for duplicate team name within department
            const existingTeam = await postgrestDb
              .select()
              .from(deptSchema.departmentTeams)
              .where(
                and(
                  eq(deptSchema.departmentTeams.departmentId, input.departmentId),
                  eq(deptSchema.departmentTeams.name, input.name)
                )
              )
              .limit(1);

            if (existingTeam.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Team with this name already exists in the department",
              });
            }

            const result = await postgrestDb
              .insert(deptSchema.departmentTeams)
              .values(input)
              .returning();

            const newTeam = result[0];
            if (!newTeam) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to create team",
              });
            }

            // If team has a Discord role ID, we don't need to create it
            // The role should already exist in Discord and just be referenced here
            if (newTeam.discordRoleId) {
              console.log(`Team ${newTeam.name} created with Discord role ${newTeam.discordRoleId}`);
            }

            return newTeam;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create team",
            });
          }
        }),

      // READ teams by department
      listByDepartment: adminProcedure
        .input(z.object({ 
          departmentId: z.number().int().positive(),
          includeInactive: z.boolean().default(false)
        }))
        .query(async ({ input }) => {
          try {
            const conditions = [eq(deptSchema.departmentTeams.departmentId, input.departmentId)];
            
            if (!input.includeInactive) {
              conditions.push(eq(deptSchema.departmentTeams.isActive, true));
            }

            const teams = await postgrestDb
              .select()
              .from(deptSchema.departmentTeams)
              .where(and(...conditions))
              .orderBy(asc(deptSchema.departmentTeams.name));
              
            return teams;
          } catch (error) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to fetch teams: ${error as string}`,
            });
          }
        }),

      // UPDATE team
      update: adminProcedure
        .input(updateTeamSchema)
        .mutation(async ({ input }) => {
          const { id, ...updateData } = input;
          
          try {
            // Check if team exists and get current data
            const existingTeam = await postgrestDb
              .select()
              .from(deptSchema.departmentTeams)
              .where(eq(deptSchema.departmentTeams.id, id))
              .limit(1);

            if (existingTeam.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team not found",
              });
            }

            const currentTeam = existingTeam[0]!;

            // Update the team
            const result = await postgrestDb
              .update(deptSchema.departmentTeams)
              .set(updateData)
              .where(eq(deptSchema.departmentTeams.id, id))
              .returning();

            const updatedTeam = result[0];
            if (!updatedTeam) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to update team",
              });
            }

            // Get department info for Discord operations
            const department = await postgrestDb
              .select({ discordGuildId: deptSchema.departments.discordGuildId })
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, updatedTeam.departmentId))
              .limit(1);

            if (department.length === 0) {
              return updatedTeam; // Return early if no department found
            }


            // Handle Discord role changes
            if (currentTeam.discordRoleId !== updatedTeam.discordRoleId) {
              // Get all current team members
              const teamMembers = await postgrestDb
                .select({
                  discordId: deptSchema.departmentMembers.discordId,
                })
                .from(deptSchema.departmentTeamMemberships)
                .innerJoin(
                  deptSchema.departmentMembers,
                  eq(deptSchema.departmentTeamMemberships.memberId, deptSchema.departmentMembers.id)
                )
                .where(
                  and(
                    eq(deptSchema.departmentTeamMemberships.teamId, id),
                    eq(deptSchema.departmentMembers.isActive, true)
                  )
                );

              // Remove old Discord role from all members
              if (currentTeam.discordRoleId) {
                const serverId = await getServerIdFromRoleId(currentTeam.discordRoleId);
                if (serverId) {
                  for (const member of teamMembers) {
                    await manageDiscordRole('remove', member.discordId, currentTeam.discordRoleId, serverId);
                  }
                }
              }

              // Add new Discord role to all members
              if (updatedTeam.discordRoleId) {
                const serverId = await getServerIdFromRoleId(updatedTeam.discordRoleId);
                if (serverId) {
                  for (const member of teamMembers) {
                    await manageDiscordRole('add', member.discordId, updatedTeam.discordRoleId, serverId);
                  }
                }
              }
            }

            return updatedTeam;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update team",
            });
          }
        }),

      // DELETE team
      delete: adminProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          try {
            // Check if team exists and get its data
            const existingTeam = await postgrestDb
              .select()
              .from(deptSchema.departmentTeams)
              .where(eq(deptSchema.departmentTeams.id, input.id))
              .limit(1);

            if (existingTeam.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team not found",
              });
            }

            const team = existingTeam[0]!;

            // Check if team is assigned as primary team to any members
            const membersWithTeam = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.primaryTeamId, input.id))
              .limit(1);

            if (membersWithTeam.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Cannot delete team that is assigned as primary team to members",
              });
            }

            // Get department info for Discord operations

            // Remove Discord role from all team members before deleting
            if (team.discordRoleId) {
              const teamMembers = await postgrestDb
                .select({
                  discordId: deptSchema.departmentMembers.discordId,
                })
                .from(deptSchema.departmentTeamMemberships)
                .innerJoin(
                  deptSchema.departmentMembers,
                  eq(deptSchema.departmentTeamMemberships.memberId, deptSchema.departmentMembers.id)
                )
                .where(
                  and(
                    eq(deptSchema.departmentTeamMemberships.teamId, input.id),
                    eq(deptSchema.departmentMembers.isActive, true)
                  )
                );

              const serverId = await getServerIdFromRoleId(team.discordRoleId);
              if (serverId) {
                for (const member of teamMembers) {
                  await manageDiscordRole('remove', member.discordId, team.discordRoleId, serverId);
                }
              }
            }

            // Delete team memberships first (foreign key constraint)
            await postgrestDb
              .delete(deptSchema.departmentTeamMemberships)
              .where(eq(deptSchema.departmentTeamMemberships.teamId, input.id));

            // Delete the team
            await postgrestDb
              .delete(deptSchema.departmentTeams)
              .where(eq(deptSchema.departmentTeams.id, input.id));

            return { success: true };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to delete team",
            });
          }
        }),

      // Add member to team
      addMember: adminProcedure
        .input(z.object({
          teamId: z.number().int().positive(),
          memberId: z.number().int().positive(),
          isLeader: z.boolean().default(false),
        }))
        .mutation(async ({ input }) => {
          try {
            // Verify team exists and get its data
            const team = await postgrestDb
              .select()
              .from(deptSchema.departmentTeams)
              .where(
                and(
                  eq(deptSchema.departmentTeams.id, input.teamId),
                  eq(deptSchema.departmentTeams.isActive, true)
                )
              )
              .limit(1);

            if (team.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team not found or inactive",
              });
            }

            // Verify member exists and get their data
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                departmentId: deptSchema.departmentMembers.departmentId,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
                isActive: deptSchema.departmentMembers.isActive,
              })
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const memberData = member[0]!;

            // Verify member is in the same department as the team
            if (memberData.departmentId !== team[0]!.departmentId) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Member and team must be in the same department",
              });
            }

            // Check if member is already in this team
            const existingMembership = await postgrestDb
              .select()
              .from(deptSchema.departmentTeamMemberships)
              .where(
                and(
                  eq(deptSchema.departmentTeamMemberships.teamId, input.teamId),
                  eq(deptSchema.departmentTeamMemberships.memberId, input.memberId)
                )
              )
              .limit(1);

            if (existingMembership.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Member is already part of this team",
              });
            }

            // First, add Discord role if team has one and member is active
            if (team[0]!.discordRoleId && memberData.isActive) {
              const serverId = await getServerIdFromRoleId(team[0]!.discordRoleId);
              if (serverId) {
                await manageDiscordRole(
                  'add',
                  memberData.discordId,
                  team[0]!.discordRoleId,
                  serverId
                );
              }
            }

            // Wait a moment for Discord role changes to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Now sync the database based on actual Discord roles
            const teamUpdateResult = await updateUserTeamFromDiscordRoles(memberData.discordId, memberData.departmentId);
            
            if (!teamUpdateResult.success) {
              console.warn('Discord team role sync had issues:', teamUpdateResult);
            }

            // Add team membership record with leadership flag
            const result = await postgrestDb
              .insert(deptSchema.departmentTeamMemberships)
              .values({
                memberId: input.memberId,
                teamId: input.teamId,
                isLeader: input.isLeader,
              })
              .returning();

            // If member doesn't have a primary team, set this as their primary team
            if (!memberData.primaryTeamId) {
              await postgrestDb
                .update(deptSchema.departmentMembers)
                .set({ primaryTeamId: input.teamId })
                .where(eq(deptSchema.departmentMembers.id, input.memberId));
            }

            return {
              success: true,
              membership: result[0],
              message: `Member added to ${team[0]!.name} successfully`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to add member to team",
            });
          }
        }),

      // Remove member from team
      removeMember: adminProcedure
        .input(z.object({
          teamId: z.number().int().positive(),
          memberId: z.number().int().positive(),
        }))
        .mutation(async ({ input }) => {
          try {
            // Verify membership exists and get team/member data
            const membership = await postgrestDb
              .select({
                membershipId: deptSchema.departmentTeamMemberships.id,
                discordId: deptSchema.departmentMembers.discordId,
                teamName: deptSchema.departmentTeams.name,
                teamDiscordRoleId: deptSchema.departmentTeams.discordRoleId,
                departmentId: deptSchema.departmentTeams.departmentId,
                memberPrimaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentTeamMemberships)
              .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentTeamMemberships.memberId, deptSchema.departmentMembers.id)
              )
              .innerJoin(
                deptSchema.departmentTeams,
                eq(deptSchema.departmentTeamMemberships.teamId, deptSchema.departmentTeams.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentTeamMemberships.teamId, input.teamId),
                  eq(deptSchema.departmentTeamMemberships.memberId, input.memberId)
                )
              )
              .limit(1);

            if (membership.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team membership not found",
              });
            }

            const membershipData = membership[0]!;

            // Check if this is the member's primary team
            if (membershipData.memberPrimaryTeamId === input.teamId) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Cannot remove member from their primary team. Please assign a different primary team first.",
              });
            }

            // First, remove Discord role if team has one
            if (membershipData.teamDiscordRoleId) {
              const serverId = await getServerIdFromRoleId(membershipData.teamDiscordRoleId);
              if (serverId) {
                await manageDiscordRole(
                  'remove',
                  membershipData.discordId,
                  membershipData.teamDiscordRoleId,
                  serverId
                );
              }
            }

            // Wait a moment for Discord role changes to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Now sync the database based on actual Discord roles
            const teamUpdateResult = await updateUserTeamFromDiscordRoles(membershipData.discordId, membershipData.departmentId);
            
            if (!teamUpdateResult.success) {
              console.warn('Discord team role sync had issues:', teamUpdateResult);
            }

            // Remove team membership record
            await postgrestDb
              .delete(deptSchema.departmentTeamMemberships)
              .where(eq(deptSchema.departmentTeamMemberships.id, membershipData.membershipId));

            return {
              success: true,
              message: `Member removed from ${membershipData.teamName} successfully`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to remove member from team",
            });
          }
        }),

      // Sync Discord roles for all team members
      syncTeamDiscordRoles: adminProcedure
        .input(z.object({
          teamId: z.number().int().positive(),
        }))
        .mutation(async ({ input }) => {
          try {
            // Get team info
            const team = await postgrestDb
              .select({
                id: deptSchema.departmentTeams.id,
                name: deptSchema.departmentTeams.name,
                discordRoleId: deptSchema.departmentTeams.discordRoleId,
                departmentId: deptSchema.departmentTeams.departmentId,
                isActive: deptSchema.departmentTeams.isActive,
              })
              .from(deptSchema.departmentTeams)
              .where(eq(deptSchema.departmentTeams.id, input.teamId))
              .limit(1);

            if (team.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team not found",
              });
            }

            const teamData = team[0]!;

            if (!teamData.discordRoleId) {
              return {
                success: true,
                message: `Team ${teamData.name} has no Discord role configured`,
                syncedMembers: 0,
              };
            }

            // Get department Discord guild ID
            const department = await postgrestDb
              .select({ discordGuildId: deptSchema.departments.discordGuildId })
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, teamData.departmentId))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }


            // Get all active team members
            const teamMembers = await postgrestDb
              .select({
                discordId: deptSchema.departmentMembers.discordId,
                callsign: deptSchema.departmentMembers.callsign,
              })
              .from(deptSchema.departmentTeamMemberships)
              .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentTeamMemberships.memberId, deptSchema.departmentMembers.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentTeamMemberships.teamId, input.teamId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              );

            let syncedCount = 0;
            const errors: string[] = [];

            // Add Discord role to all team members
            for (const member of teamMembers) {
              try {
                const serverId = await getServerIdFromRoleId(teamData.discordRoleId);
                if (serverId) {
                  await manageDiscordRole(
                    'add',
                    member.discordId,
                    teamData.discordRoleId,
                    serverId
                  );
                  syncedCount++;
                } else {
                  errors.push(`Failed to get server ID for role ${teamData.discordRoleId} for ${member.callsign}`);
                }
              } catch (error) {
                errors.push(`Failed to sync role for ${member.callsign}: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }

            return {
              success: true,
              message: `Synced Discord roles for ${syncedCount} members of ${teamData.name}`,
              syncedMembers: syncedCount,
              totalMembers: teamMembers.length,
              errors: errors.length > 0 ? errors : undefined,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to sync team Discord roles",
            });
          }
        }),
    }),

    // ===== MEMBER MANAGEMENT =====
    members: createTRPCRouter({
      // CREATE member
      create: adminProcedure
        .input(createMemberSchema)
        .mutation(async ({ input }) => {
          try {
            // Check if department exists
            const department = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, input.departmentId))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }

            // Check if user is already a member of this department
            const existingMember = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, input.discordId),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId)
                )
              )
              .limit(1);

            if (existingMember.length > 0) {
              const member = existingMember[0]!;
              
              // If member is inactive, reactivate them instead of throwing error
              if (!member.isActive) {
                const updatedMember = await postgrestDb
                  .update(deptSchema.departmentMembers)
                  .set({ 
                    isActive: true,
                    status: input.status ?? member.status,
                    rankId: input.rankId ?? member.rankId,
                    primaryTeamId: input.primaryTeamId ?? member.primaryTeamId,
                    badgeNumber: input.badgeNumber ?? member.badgeNumber,
                    roleplayName: input.roleplayName ?? member.roleplayName,
                    notes: input.notes ?? member.notes,
                    lastActiveDate: null // Clear the last active date
                  })
                  .where(eq(deptSchema.departmentMembers.id, member.id))
                  .returning();

                return {
                  ...updatedMember[0],
                  syncResults: {
                    rankSync: null,
                    teamSync: null,
                  }
                };
              } else {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "User is already an active member of this department",
                });
              }
            }

            const departmentData = department[0]!;

            // STEP 1: Assign Discord roles FIRST if rank or team provided
            let assignedRankRole = false;
            let assignedTeamRole = false;
            let rankData = null;
            let teamData = null;

            console.log("=== MEMBER CREATION DEBUG ===");
            console.log("Input:", { discordId: input.discordId, rankId: input.rankId, primaryTeamId: input.primaryTeamId });
            console.log("API_BASE_URL:", API_BASE_URL);
            console.log("M2M_API_KEY exists:", !!M2M_API_KEY);

            if (input.rankId) {
              console.log("Processing rank assignment for rankId:", input.rankId);
              // Get rank and assign Discord role
              const rank = await postgrestDb
                .select()
                .from(deptSchema.departmentRanks)
                .where(eq(deptSchema.departmentRanks.id, input.rankId))
                .limit(1);

              console.log("Found rank data:", rank);

              if (rank.length > 0) {
                rankData = rank[0]!;
                console.log("Rank Discord Role ID:", rankData.discordRoleId);
                
                if (rankData.discordRoleId) {
                  try {
                    console.log("Getting server ID for role:", rankData.discordRoleId);
                    const serverId = await getServerIdFromRoleId(rankData.discordRoleId);
                    console.log("Retrieved server ID:", serverId);
                    
                    if (serverId) {
                      console.log("Attempting to assign Discord role:", {
                        action: 'add',
                        userDiscordId: input.discordId,
                        roleId: rankData.discordRoleId,
                        serverId
                      });
                      
                      const roleAssigned = await manageDiscordRole(
                        'add',
                        input.discordId,
                        rankData.discordRoleId,
                        serverId
                      );
                      
                      if (roleAssigned) {
                        assignedRankRole = true;
                        console.log("✅ Successfully assigned rank Discord role");
                      } else {
                        console.log("❌ Failed to assign rank Discord role");
                      }
                    } else {
                      console.log("❌ No server ID found, cannot assign rank role");
                    }
                  } catch (error) {
                    console.error("❌ Failed to assign rank Discord role:", error);
                    // Continue without throwing - role assignment is not critical for member creation
                  }
                } else {
                  console.log("❌ Rank has no Discord role ID configured");
                }
              } else {
                console.log("❌ No rank found with ID:", input.rankId);
              }
            }

            if (input.primaryTeamId) {
              console.log("Processing team assignment for teamId:", input.primaryTeamId);
              // Get team and assign Discord role
              const team = await postgrestDb
                .select()
                .from(deptSchema.departmentTeams)
                .where(eq(deptSchema.departmentTeams.id, input.primaryTeamId))
                .limit(1);

              console.log("Found team data:", team);

              if (team.length > 0) {
                teamData = team[0]!;
                console.log("Team Discord Role ID:", teamData.discordRoleId);
                
                if (teamData.discordRoleId) {
                  try {
                    console.log("Getting server ID for team role:", teamData.discordRoleId);
                    const serverId = await getServerIdFromRoleId(teamData.discordRoleId);
                    console.log("Retrieved server ID for team:", serverId);
                    
                    if (serverId) {
                      console.log("Attempting to assign team Discord role:", {
                        action: 'add',
                        userDiscordId: input.discordId,
                        roleId: teamData.discordRoleId,
                        serverId
                      });
                      
                      const roleAssigned = await manageDiscordRole(
                        'add',
                        input.discordId,
                        teamData.discordRoleId,
                        serverId
                      );
                      
                      if (roleAssigned) {
                        assignedTeamRole = true;
                        console.log("✅ Successfully assigned team Discord role");
                      } else {
                        console.log("❌ Failed to assign team Discord role");
                      }
                    } else {
                      console.log("❌ No server ID found, cannot assign team role");
                    }
                  } catch (error) {
                    console.error("❌ Failed to assign team Discord role:", error);
                    // Continue without throwing - role assignment is not critical for member creation
                  }
                } else {
                  console.log("❌ Team has no Discord role ID configured");
                }
              } else {
                console.log("❌ No team found with ID:", input.primaryTeamId);
              }
            }

            // STEP 2: Create member in database with the provided rank and team
            // Get next available ID number
            const departmentIdNumber = await getNextAvailableIdNumber(input.departmentId);

            // Generate callsign based on rank and team if available
            const rankCallsign = rankData?.callsign ?? "0";
            const teamPrefix = teamData?.callsignPrefix ?? undefined;
            const basicCallsign = generateCallsign(rankCallsign, departmentData.callsignPrefix, departmentIdNumber, teamPrefix);

            const result = await postgrestDb
              .insert(deptSchema.departmentMembers)
              .values({
                discordId: input.discordId,
                departmentId: input.departmentId,
                roleplayName: input.roleplayName,
                departmentIdNumber,
                callsign: basicCallsign,
                status: input.status ?? "in_training",
                badgeNumber: input.badgeNumber,
                notes: input.notes,
                // Set rank and team directly if provided
                rankId: input.rankId ?? null,
                primaryTeamId: input.primaryTeamId ?? null,
              })
              .returning();

            // Update the ID number record to reference this member
            await postgrestDb
              .update(deptSchema.departmentIdNumbers)
              .set({ currentMemberId: result[0]!.id })
              .where(
                and(
                  eq(deptSchema.departmentIdNumbers.departmentId, input.departmentId),
                  eq(deptSchema.departmentIdNumbers.idNumber, departmentIdNumber)
                )
              );

            const createdMember = result[0]!;

            // STEP 3: If Discord roles were assigned, run sync functions to verify and update database
            const syncResults = {
              rankSync: null as unknown,
              teamSync: null as unknown,
            };

            console.log("=== SYNC FUNCTIONS DEBUG ===");
            console.log("assignedRankRole:", assignedRankRole);
            console.log("assignedTeamRole:", assignedTeamRole);

            // Only run sync functions if we want to verify role assignment
            // For new member creation, we trust that the role assignment worked
            // and skip the immediate sync to avoid timing issues
            const shouldSync = false; // Set to true if you want to verify roles were actually assigned

            if (shouldSync && assignedRankRole) {
              console.log("Running rank sync for user:", input.discordId);
              // Add longer delay to allow Discord roles to propagate
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              try {
                syncResults.rankSync = await updateUserRankFromDiscordRoles(input.discordId, input.departmentId);
                console.log("Rank sync result:", syncResults.rankSync);
              } catch (error) {
                console.error("❌ Failed to sync rank after creation:", error);
                syncResults.rankSync = {
                  success: false,
                  updatedDepartments: [],
                  message: "Failed to sync rank from Discord roles"
                };
              }
            } else {
              console.log("Skipping rank sync - trusting role assignment worked or role assignment failed");
              if (assignedRankRole) {
                syncResults.rankSync = {
                  success: true,
                  updatedDepartments: [{ departmentId: input.departmentId, newRankId: input.rankId, oldRankId: null }],
                  message: "Rank assigned via Discord API"
                };
              }
            }

            if (shouldSync && assignedTeamRole) {
              console.log("Running team sync for user:", input.discordId);
              // Add longer delay to allow Discord roles to propagate
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              try {
                syncResults.teamSync = await updateUserTeamFromDiscordRoles(input.discordId, input.departmentId);
                console.log("Team sync result:", syncResults.teamSync);
              } catch (error) {
                console.error("❌ Failed to sync team after creation:", error);
                syncResults.teamSync = {
                  success: false,
                  updatedDepartments: [],
                  message: "Failed to sync team from Discord roles"
                };
              }
            } else {
              console.log("Skipping team sync - trusting role assignment worked or role assignment failed");
              if (assignedTeamRole) {
                syncResults.teamSync = {
                  success: true,
                  updatedDepartments: [{ departmentId: input.departmentId, newTeamId: input.primaryTeamId, oldTeamId: null }],
                  message: "Team assigned via Discord API"
                };
              }
            }

            console.log("Final sync results:", syncResults);

            // STEP 4: If team was assigned, add team membership
            if (input.primaryTeamId) {
              try {
                const existingMembership = await postgrestDb
                  .select()
                  .from(deptSchema.departmentTeamMemberships)
                  .where(
                    and(
                      eq(deptSchema.departmentTeamMemberships.memberId, createdMember.id),
                      eq(deptSchema.departmentTeamMemberships.teamId, input.primaryTeamId)
                    )
                  )
                  .limit(1);

                if (existingMembership.length === 0) {
                  await postgrestDb
                    .insert(deptSchema.departmentTeamMemberships)
                    .values({
                      memberId: createdMember.id,
                      teamId: input.primaryTeamId,
                      isLeader: false,
                    });
                }
              } catch (error) {
                console.error("Failed to create team membership:", error);
              }
            }

            // STEP 5: Fetch the final updated member data
            const finalMember = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, createdMember.id))
              .limit(1);

            return {
              ...createdMember,
              ...(finalMember.length > 0 ? finalMember[0] : {}),
              syncResults,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create member",
            });
          }
        }),

      // READ members by department
      listByDepartment: adminProcedure
        .input(z.object({ 
          departmentId: z.number().int().positive(),
          includeInactive: z.boolean().default(false),
          status: deptSchema.departmentMemberStatusEnum.optional()
        }))
        .query(async ({ input }) => {
          try {
            const conditions = [eq(deptSchema.departmentMembers.departmentId, input.departmentId)];
            
            if (!input.includeInactive) {
              conditions.push(eq(deptSchema.departmentMembers.isActive, true));
            }
            if (input.status) {
              conditions.push(eq(deptSchema.departmentMembers.status, input.status));
            }

            const members = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                roleplayName: deptSchema.departmentMembers.roleplayName,
                callsign: deptSchema.departmentMembers.callsign,
                badgeNumber: deptSchema.departmentMembers.badgeNumber,
                status: deptSchema.departmentMembers.status,
                hireDate: deptSchema.departmentMembers.hireDate,
                rankName: deptSchema.departmentRanks.name,
                rankLevel: deptSchema.departmentRanks.level,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(and(...conditions))
              .orderBy(asc(deptSchema.departmentMembers.callsign));

            return members;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch members",
            });
          }
        }),

      // UPDATE member
      update: adminProcedure
        .input(updateMemberSchema)
        .mutation(async ({ input }) => {
          const { id, ...updateData } = input;
          
          try {
            // Check if member exists
            const existingMember = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, id))
              .limit(1);

            if (existingMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const currentMember = existingMember[0]!;

            // Get department info for Discord operations
            const department = await postgrestDb
              .select({ 
                callsignPrefix: deptSchema.departments.callsignPrefix,
                discordGuildId: deptSchema.departments.discordGuildId 
              })
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, currentMember.departmentId))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }


            // Handle rank changes through Discord roles first
            if (updateData.rankId !== undefined && updateData.rankId !== currentMember.rankId) {
              // Remove old rank Discord role if member had one
              if (currentMember.rankId) {
                const oldRank = await postgrestDb
                  .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
                  .from(deptSchema.departmentRanks)
                  .where(eq(deptSchema.departmentRanks.id, currentMember.rankId))
                  .limit(1);

                if (oldRank.length > 0 && oldRank[0]!.discordRoleId) {
                  const serverId = await getServerIdFromRoleId(oldRank[0]!.discordRoleId);
                  if (serverId) {
                    await manageDiscordRole(
                      'remove',
                      currentMember.discordId,
                      oldRank[0]!.discordRoleId,
                      serverId
                    );
                  }
                }
              }

              // Add new rank Discord role if new rank has one
              if (updateData.rankId) {
                const newRank = await postgrestDb
                  .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
                  .from(deptSchema.departmentRanks)
                  .where(eq(deptSchema.departmentRanks.id, updateData.rankId))
                  .limit(1);

                if (newRank.length > 0 && newRank[0]!.discordRoleId) {
                  const serverId = await getServerIdFromRoleId(newRank[0]!.discordRoleId);
                  if (serverId) {
                    await manageDiscordRole(
                      'add',
                      currentMember.discordId,
                      newRank[0]!.discordRoleId,
                      serverId
                    );
                  }
                }
              }
            }

            // Handle team changes through Discord roles first
            if (updateData.primaryTeamId !== undefined && updateData.primaryTeamId !== currentMember.primaryTeamId) {
              // Remove old primary team Discord role if member had one
              if (currentMember.primaryTeamId) {
                const oldTeam = await postgrestDb
                  .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
                  .from(deptSchema.departmentTeams)
                  .where(eq(deptSchema.departmentTeams.id, currentMember.primaryTeamId))
                  .limit(1);

                if (oldTeam.length > 0 && oldTeam[0]!.discordRoleId) {
                  const serverId = await getServerIdFromRoleId(oldTeam[0]!.discordRoleId);
                  if (serverId) {
                    await manageDiscordRole(
                      'remove',
                      currentMember.discordId,
                      oldTeam[0]!.discordRoleId,
                      serverId
                    );
                  }
                }
              }

              // Add new primary team Discord role if new team has one
              if (updateData.primaryTeamId) {
                const newTeam = await postgrestDb
                  .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
                  .from(deptSchema.departmentTeams)
                  .where(eq(deptSchema.departmentTeams.id, updateData.primaryTeamId))
                  .limit(1);

                if (newTeam.length > 0 && newTeam[0]!.discordRoleId) {
                  const serverId = await getServerIdFromRoleId(newTeam[0]!.discordRoleId);
                  if (serverId) {
                    await manageDiscordRole(
                      'add',
                      currentMember.discordId,
                      newTeam[0]!.discordRoleId,
                      serverId
                    );
                  }
                }
              }
            }

            // Wait a moment for Discord role changes to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Now update the database based on actual Discord roles
            if (updateData.rankId !== undefined || updateData.primaryTeamId !== undefined) {
              const rankUpdateResult = await updateUserRankFromDiscordRoles(currentMember.discordId, currentMember.departmentId);
              const teamUpdateResult = await updateUserTeamFromDiscordRoles(currentMember.discordId, currentMember.departmentId);
              
              if (!rankUpdateResult.success || !teamUpdateResult.success) {
                console.warn('Discord role sync had issues:', { rankUpdateResult, teamUpdateResult });
              }
            }

            // Prepare update data for non-role/team fields only
            const memberUpdateData: Partial<Pick<typeof deptSchema.departmentMembers.$inferInsert, 'roleplayName' | 'badgeNumber' | 'status' | 'notes' | 'isActive'>> = {};
            
            // Handle non-role/team fields that can be updated directly
            if (updateData.roleplayName !== undefined) {
              memberUpdateData.roleplayName = updateData.roleplayName;
            }
            if (updateData.badgeNumber !== undefined) {
              memberUpdateData.badgeNumber = updateData.badgeNumber;
            }
            if (updateData.status !== undefined) {
              memberUpdateData.status = updateData.status;
            }
            if (updateData.notes !== undefined) {
              memberUpdateData.notes = updateData.notes;
            }
            if (updateData.isActive !== undefined) {
              memberUpdateData.isActive = updateData.isActive;
            }

            // Check if member is being moved to inactive status and remove Discord roles
            if (updateData.status && ['inactive', 'suspended', 'blacklisted', 'leave_of_absence'].includes(updateData.status)) {
              console.log(`🗑️ Member status changing to ${updateData.status}, removing Discord roles`);
              const roleRemovalResult = await removeDiscordRolesForInactiveMember(
                currentMember.discordId, 
                currentMember.departmentId
              );
              
              if (roleRemovalResult.success) {
                console.log(`✅ Successfully removed Discord roles: ${roleRemovalResult.message}`);
              } else {
                console.warn(`⚠️ Failed to remove Discord roles: ${roleRemovalResult.message}`);
              }
            }

            // Check if member is being moved to active status and restore Discord roles
            if (updateData.status === 'active') {
              console.log("➕ Member status changing to active, restoring Discord roles");
              const roleRestoreResult = await restoreDiscordRolesForActiveMember(
                currentMember.discordId, 
                currentMember.departmentId
              );
              
              if (roleRestoreResult.success) {
                console.log(`✅ Successfully restored Discord roles: ${roleRestoreResult.message}`);
              } else {
                console.warn(`⚠️ Failed to restore Discord roles: ${roleRestoreResult.message}`);
              }
            }

            // Check if member is being set to active (isActive: true) and restore Discord roles
            if (updateData.isActive === true && currentMember.isActive === false) {
              console.log("➕ Member set to active (isActive: true), restoring Discord roles");
              const roleRestoreResult = await restoreDiscordRolesForActiveMember(
                currentMember.discordId, 
                currentMember.departmentId
              );
              
              if (roleRestoreResult.success) {
                console.log(`✅ Successfully restored Discord roles: ${roleRestoreResult.message}`);
              } else {
                console.warn(`⚠️ Failed to restore Discord roles: ${roleRestoreResult.message}`);
              }
            }

            // Check if member is being set to inactive (isActive: false) and remove Discord roles
            if (updateData.isActive === false) {
              console.log("🗑️ Member set to inactive (isActive: false), removing Discord roles");
              const roleRemovalResult = await removeDiscordRolesForInactiveMember(
                currentMember.discordId, 
                currentMember.departmentId
              );
              
              if (roleRemovalResult.success) {
                console.log(`✅ Successfully removed Discord roles: ${roleRemovalResult.message}`);
              } else {
                console.warn(`⚠️ Failed to remove Discord roles: ${roleRemovalResult.message}`);
              }
            }

            // Update only non-role/team fields if any
            let result;
            if (Object.keys(memberUpdateData).length > 0) {
              const updateResult = await postgrestDb
                .update(deptSchema.departmentMembers)
                .set(memberUpdateData)
                .where(eq(deptSchema.departmentMembers.id, id))
                .returning();
              result = updateResult[0];
            } else {
              // If only rank/team was updated, fetch the current data
              const currentData = await postgrestDb
                .select()
                .from(deptSchema.departmentMembers)
                .where(eq(deptSchema.departmentMembers.id, id))
                .limit(1);
              result = currentData[0];
            }

            return result;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update member",
            });
          }
        }),

      // DELETE member (soft delete and free up ID number)
      delete: adminProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          try {
            // Check if member exists
            const existingMember = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.id))
              .limit(1);

            if (existingMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = existingMember[0]!;

            // Remove Discord roles when soft-deleting member
            console.log("🗑️ Soft-deleting member, removing Discord roles");
            const roleRemovalResult = await removeDiscordRolesForInactiveMember(
              member.discordId, 
              member.departmentId
            );
            
            if (roleRemovalResult.success) {
              console.log(`✅ Successfully removed Discord roles: ${roleRemovalResult.message}`);
            } else {
              console.warn(`⚠️ Failed to remove Discord roles: ${roleRemovalResult.message}`);
            }

            // Free up the ID number for reuse
            if (member.departmentIdNumber) {
              await postgrestDb
                .update(deptSchema.departmentIdNumbers)
                .set({ 
                  isAvailable: true,
                  currentMemberId: null,
                })
                .where(
                  and(
                    eq(deptSchema.departmentIdNumbers.departmentId, member.departmentId),
                    eq(deptSchema.departmentIdNumbers.idNumber, member.departmentIdNumber)
                  )
                );
            }

            // Soft delete the member
            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({ 
                isActive: false,
                lastActiveDate: new Date()
              })
              .where(eq(deptSchema.departmentMembers.id, input.id))
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to delete member",
            });
          }
        }),

      // HARD DELETE member (permanent removal)
      hardDelete: adminProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          try {
            // Check if member exists
            const existingMember = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.id))
              .limit(1);

            if (existingMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = existingMember[0]!;

            // Free up the ID number for reuse
            if (member.departmentIdNumber) {
              await postgrestDb
                .update(deptSchema.departmentIdNumbers)
                .set({ 
                  isAvailable: true,
                  currentMemberId: null,
                })
                .where(
                  and(
                    eq(deptSchema.departmentIdNumbers.departmentId, member.departmentId),
                    eq(deptSchema.departmentIdNumbers.idNumber, member.departmentIdNumber)
                  )
                );
            }

            // Remove from team memberships first (foreign key constraint)
            await postgrestDb
              .delete(deptSchema.departmentTeamMemberships)
              .where(eq(deptSchema.departmentTeamMemberships.memberId, input.id));

            // Permanently delete the member
            await postgrestDb
              .delete(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.id));

            return { success: true, message: "Member permanently deleted" };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to permanently delete member",
            });
          }
        }),
    }),

    // ===== ANALYTICS AND REPORTS =====
    analytics: createTRPCRouter({
      // Get department overview stats
      departmentOverview: adminProcedure
        .input(z.object({ departmentId: z.number().int().positive() }))
        .query(async ({ input }) => {
          try {
            const [
              totalMembers,
              activeMembers,
              ranks,
              teams,
              recentPromotions,
              disciplinaryActions
            ] = await Promise.all([
              // Total members
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentMembers)
                .where(eq(deptSchema.departmentMembers.departmentId, input.departmentId)),
              
              // Active members
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentMembers)
                .where(
                  and(
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                    eq(deptSchema.departmentMembers.isActive, true),
                    eq(deptSchema.departmentMembers.status, "active")
                  )
                ),

              // Total ranks
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentRanks)
                .where(
                  and(
                    eq(deptSchema.departmentRanks.departmentId, input.departmentId),
                    eq(deptSchema.departmentRanks.isActive, true)
                  )
                ),

              // Total teams
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentTeams)
                .where(
                  and(
                    eq(deptSchema.departmentTeams.departmentId, input.departmentId),
                    eq(deptSchema.departmentTeams.isActive, true)
                  )
                ),

              // Recent promotions (last 30 days)
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentPromotionHistory)
                .leftJoin(
                  deptSchema.departmentMembers,
                  eq(deptSchema.departmentPromotionHistory.memberId, deptSchema.departmentMembers.id)
                )
                .where(
                  and(
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                    sql`${deptSchema.departmentPromotionHistory.effectiveDate} >= NOW() - INTERVAL '30 days'`
                  )
                ),

              // Active disciplinary actions
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentDisciplinaryActions)
                .leftJoin(
                  deptSchema.departmentMembers,
                  eq(deptSchema.departmentDisciplinaryActions.memberId, deptSchema.departmentMembers.id)
                )
                .where(
                  and(
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                    eq(deptSchema.departmentDisciplinaryActions.isActive, true)
                  )
                ),
            ]);

            return {
              totalMembers: Number(totalMembers[0]?.count ?? 0),
              activeMembers: Number(activeMembers[0]?.count ?? 0),
              totalRanks: Number(ranks[0]?.count ?? 0),
              totalTeams: Number(teams[0]?.count ?? 0),
              recentPromotions: Number(recentPromotions[0]?.count ?? 0),
              activeDisciplinaryActions: Number(disciplinaryActions[0]?.count ?? 0),
            };
          } catch (error) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to fetch department analytics: ${error as string}`,
            });
          }
        }),
    }),

    // Enhanced member management for training workflow
    memberManagement: createTRPCRouter({
      // Get members pending team assignment
      getPendingMembers: adminProcedure
        .input(z.object({ 
          departmentId: z.number().int().positive(),
          includeInTraining: z.boolean().default(false),
        }))
        .query(async ({ input }) => {
          try {
            const conditions = [
              eq(deptSchema.departmentMembers.departmentId, input.departmentId),
              eq(deptSchema.departmentMembers.isActive, true),
            ];

            if (input.includeInTraining) {
              conditions.push(
                sql`${deptSchema.departmentMembers.status} = 'pending' OR ${deptSchema.departmentMembers.status} = 'in_training'`
              );
            } else {
              conditions.push(eq(deptSchema.departmentMembers.status, "pending"));
            }

            const members = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                status: deptSchema.departmentMembers.status,
                hireDate: deptSchema.departmentMembers.hireDate,
                notes: deptSchema.departmentMembers.notes,
                rankName: deptSchema.departmentRanks.name,
                rankLevel: deptSchema.departmentRanks.level,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(and(...conditions))
              .orderBy(asc(deptSchema.departmentMembers.hireDate));

            return members;
          } catch (error) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch pending members",
            });
          }
        }),

      // Assign team to member (and activate them)
      assignTeam: adminProcedure
        .input(assignTeamSchema)
        .mutation(async ({ input }) => {
          try {
            // Get member info
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                departmentId: deptSchema.departmentMembers.departmentId,
                departmentIdNumber: deptSchema.departmentMembers.departmentIdNumber,
                status: deptSchema.departmentMembers.status,
                rankId: deptSchema.departmentMembers.rankId,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const memberData = member[0]!;

            // Verify team exists and is in same department
            const team = await postgrestDb
              .select()
              .from(deptSchema.departmentTeams)
              .where(
                and(
                  eq(deptSchema.departmentTeams.id, input.teamId),
                  eq(deptSchema.departmentTeams.departmentId, memberData.departmentId),
                  eq(deptSchema.departmentTeams.isActive, true)
                )
              )
              .limit(1);

            if (team.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team not found or not in same department",
              });
            }

            const teamData = team[0]!;

            // Get department info for Discord operations
            const department = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, memberData.departmentId))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }


            // First, handle Discord role changes for primary team assignment
            // Remove old primary team role if member had one
            if (memberData.primaryTeamId && memberData.primaryTeamId !== input.teamId) {
              const oldTeam = await postgrestDb
                .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
                .from(deptSchema.departmentTeams)
                .where(eq(deptSchema.departmentTeams.id, memberData.primaryTeamId))
                .limit(1);

              if (oldTeam.length > 0 && oldTeam[0]!.discordRoleId) {
                const serverId = await getServerIdFromRoleId(oldTeam[0]!.discordRoleId);
                if (serverId) {
                  await manageDiscordRole(
                    'remove',
                    memberData.discordId,
                    oldTeam[0]!.discordRoleId,
                    serverId
                  );
                }
              }
            }

            // Add new primary team Discord role
            if (teamData.discordRoleId) {
              const serverId = await getServerIdFromRoleId(teamData.discordRoleId);
              if (serverId) {
                await manageDiscordRole(
                  'add',
                  memberData.discordId,
                  teamData.discordRoleId,
                  serverId
                );
              }
            }

            // Wait for Discord role changes to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Now sync the database based on actual Discord roles
            const teamUpdateResult = await updateUserTeamFromDiscordRoles(memberData.discordId, memberData.departmentId);
            
            if (!teamUpdateResult.success) {
              console.warn('Discord team role sync had issues:', teamUpdateResult);
            }

            // Update member status to active and timestamp
            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({
                status: "active",
                lastActiveDate: new Date(),
              })
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .returning();

            // Add team membership if not already exists
            const existingMembership = await postgrestDb
              .select()
              .from(deptSchema.departmentTeamMemberships)
              .where(
                and(
                  eq(deptSchema.departmentTeamMemberships.memberId, input.memberId),
                  eq(deptSchema.departmentTeamMemberships.teamId, input.teamId)
                )
              )
              .limit(1);

            if (existingMembership.length === 0) {
              await postgrestDb
                .insert(deptSchema.departmentTeamMemberships)
                .values({
                  memberId: input.memberId,
                  teamId: input.teamId,
                  isLeader: false,
                });
            }

            return {
              success: true,
              member: result[0],
              message: `Member assigned to ${teamData.name} and activated successfully`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to assign team",
            });
          }
        }),

      // Update member status (bypass training)
      updateStatus: adminProcedure
        .input(updateMemberStatusSchema)
        .mutation(async ({ input }) => {
          try {
            // Get member info before updating
            const memberInfo = await postgrestDb
              .select({
                discordId: deptSchema.departmentMembers.discordId,
                departmentId: deptSchema.departmentMembers.departmentId,
              })
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (memberInfo.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = memberInfo[0]!;

            // Check if member is being moved to inactive status and remove Discord roles
            if (['inactive', 'suspended', 'blacklisted'].includes(input.status)) {
              console.log(`🗑️ Member status changing to ${input.status}, removing Discord roles`);
              const roleRemovalResult = await removeDiscordRolesForInactiveMember(
                member.discordId, 
                member.departmentId
              );
              
              if (roleRemovalResult.success) {
                console.log(`✅ Successfully removed Discord roles: ${roleRemovalResult.message}`);
              } else {
                console.warn(`⚠️ Failed to remove Discord roles: ${roleRemovalResult.message}`);
              }
            }

            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({ 
                status: input.status,
                lastActiveDate: new Date(),
              })
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .returning();

            return {
              success: true,
              member: result[0],
              message: `Member status updated to ${input.status}`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update member status",
            });
          }
        }),

      // Bypass training - move directly from in_training to pending
      bypassTraining: adminProcedure
        .input(z.object({ memberId: z.number().int().positive() }))
        .mutation(async ({ input }) => {
          try {
            // Verify member is in training
            const member = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.id, input.memberId),
                  eq(deptSchema.departmentMembers.status, "in_training")
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found or not in training",
              });
            }

            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({ 
                status: "pending",
                lastActiveDate: new Date(),
              })
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .returning();

            return {
              success: true,
              member: result[0],
              message: "Training bypassed. Member is now pending team assignment.",
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to bypass training",
            });
          }
        }),
    }),

    // ===== RANK LIMIT MANAGEMENT =====
    rankLimits: createTRPCRouter({
      // Set department-wide rank limit
      setDepartmentLimit: adminProcedure
        .input(setDepartmentRankLimitSchema)
        .mutation(async ({ input }) => {
          try {
            // Verify rank exists
            const rank = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(eq(deptSchema.departmentRanks.id, input.rankId))
              .limit(1);

            if (rank.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Rank not found",
              });
            }

            // Update the rank's max members limit
            const result = await postgrestDb
              .update(deptSchema.departmentRanks)
              .set({ maxMembers: input.maxMembers })
              .where(eq(deptSchema.departmentRanks.id, input.rankId))
              .returning();

            return {
              success: true,
              rank: result[0],
              message: input.maxMembers === null 
                ? "Rank limit removed (unlimited)" 
                : `Rank limit set to ${input.maxMembers} members`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to set department rank limit",
            });
          }
        }),

      // Remove department rank limit (set to unlimited)
      removeDepartmentLimit: adminProcedure
        .input(removeRankLimitSchema)
        .mutation(async ({ input }) => {
          try {
            const result = await postgrestDb
              .update(deptSchema.departmentRanks)
              .set({ maxMembers: null })
              .where(eq(deptSchema.departmentRanks.id, input.rankId))
              .returning();

            if (result.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Rank not found",
              });
            }

            return {
              success: true,
              rank: result[0],
              message: "Rank limit removed - unlimited members allowed",
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to remove department rank limit",
            });
          }
        }),

      // Set team-specific rank limit (override)
      setTeamLimit: adminProcedure
        .input(setTeamRankLimitSchema)
        .mutation(async ({ input }) => {
          try {
            // Verify team and rank exist and are in same department
            const teamRank = await postgrestDb
              .select({
                teamId: deptSchema.departmentTeams.id,
                teamName: deptSchema.departmentTeams.name,
                teamDeptId: deptSchema.departmentTeams.departmentId,
                rankId: deptSchema.departmentRanks.id,
                rankName: deptSchema.departmentRanks.name,
                rankDeptId: deptSchema.departmentRanks.departmentId,
              })
              .from(deptSchema.departmentTeams)
              .innerJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentTeams.departmentId, deptSchema.departmentRanks.departmentId)
              )
              .where(
                and(
                  eq(deptSchema.departmentTeams.id, input.teamId),
                  eq(deptSchema.departmentRanks.id, input.rankId)
                )
              )
              .limit(1);

            if (teamRank.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team or rank not found, or they belong to different departments",
              });
            }

            // Upsert team rank limit
            const result = await postgrestDb
              .insert(deptSchema.departmentTeamRankLimits)
              .values({
                teamId: input.teamId,
                rankId: input.rankId,
                maxMembers: input.maxMembers,
              })
              .onConflictDoUpdate({
                target: [
                  deptSchema.departmentTeamRankLimits.teamId,
                  deptSchema.departmentTeamRankLimits.rankId
                ],
                set: {
                  maxMembers: input.maxMembers,
                  updatedAt: new Date(),
                },
              })
              .returning();

            return {
              success: true,
              teamRankLimit: result[0],
              message: `Team ${teamRank[0]!.teamName} rank limit set: ${input.maxMembers} ${teamRank[0]!.rankName}(s)`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to set team rank limit",
            });
          }
        }),

      // Remove team rank limit (revert to department limit)
      removeTeamLimit: adminProcedure
        .input(removeTeamRankLimitSchema)
        .mutation(async ({ input }) => {
          try {
            const result = await postgrestDb
              .delete(deptSchema.departmentTeamRankLimits)
              .where(
                and(
                  eq(deptSchema.departmentTeamRankLimits.teamId, input.teamId),
                  eq(deptSchema.departmentTeamRankLimits.rankId, input.rankId)
                )
              )
              .returning();

            if (result.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team rank limit not found",
              });
            }

            return {
              success: true,
              message: "Team rank limit removed - will use department limit",
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to remove team rank limit",
            });
          }
        }),

      // Get rank limit information for a department/team
      getRankLimits: adminProcedure
        .input(getRankLimitsSchema)
        .query(async ({ input }) => {
          try {
            const rankLimitInfo = await getRankLimitInfo(input.departmentId, input.teamId);
            return rankLimitInfo;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to get rank limits",
            });
          }
        }),

      // Check if a specific promotion would be allowed
      checkPromotion: adminProcedure
        .input(z.object({
          memberId: z.number().int().positive(),
          toRankId: z.number().int().positive(),
        }))
        .query(async ({ input }) => {
          try {
            // Get member info
            const member = await postgrestDb
              .select({
                departmentId: deptSchema.departmentMembers.departmentId,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const validationResult = await validateRankLimit(
              input.toRankId,
              member[0]!.departmentId,
              member[0]!.primaryTeamId ?? undefined
            );

            return validationResult;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to check promotion eligibility",
            });
          }
        }),
    }),
  }),

  // ===== USER INTERACTIONS WITH PERMISSION RESTRICTIONS =====
  user: createTRPCRouter({
    // ===== PERMISSION HELPERS =====
    // Check if user has specific permission in a department
    checkPermission: protectedProcedure
      .input(z.object({
        departmentId: z.number().int().positive(),
        permission: z.enum([
          'manage_department', 'manage_ranks', 'manage_teams', 'manage_members', 'view_all_members',
          'recruit_members', 'promote_members', 'demote_members', 'discipline_members', 'remove_members',
          'manage_timeclock', 'view_all_timeclock', 'edit_timeclock',
          'schedule_meetings', 'manage_meetings', 'take_attendance', 'view_all_meetings',
          'manage_team_members', 'view_team_members'
        ])
      }))
      .query(async ({ ctx, input }) => {
        try {
          const member = await postgrestDb
            .select({
              rankId: deptSchema.departmentMembers.rankId,
              permissions: deptSchema.departmentRanks.permissions,
              level: deptSchema.departmentRanks.level
            })
            .from(deptSchema.departmentMembers)
            .leftJoin(
              deptSchema.departmentRanks,
              eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
            )
            .where(
              and(
                eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                eq(deptSchema.departmentMembers.isActive, true)
              )
            )
            .limit(1);

          if (member.length === 0) {
            return { hasPermission: false, reason: 'Not a member of this department' };
          }

          const permissions = member[0]!.permissions!;
          const hasPermission = permissions[input.permission] === true;

          return { 
            hasPermission, 
            level: member[0]!.level,
            reason: hasPermission ? 'Permission granted' : 'Insufficient permissions'
          };
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to check permissions",
          });
        }
      }),

    // ===== PROMOTION/DEMOTION SYSTEM =====
    promotions: createTRPCRouter({
      // Promote a member
      promote: protectedProcedure
        .input(z.object({
          memberId: z.number().int().positive(),
          toRankId: z.number().int().positive(),
          reason: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Get the member being promoted and their current info
            const targetMember = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                departmentId: deptSchema.departmentMembers.departmentId,
                currentRankId: deptSchema.departmentMembers.rankId,
                currentRankLevel: deptSchema.departmentRanks.level,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (targetMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = targetMember[0]!;

            // Get the promoter's permissions
            const promoter = await postgrestDb
              .select({
                rankId: deptSchema.departmentMembers.rankId,
                permissions: deptSchema.departmentRanks.permissions,
                level: deptSchema.departmentRanks.level
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, member.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (promoter.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const promoterPermissions = promoter[0]!.permissions!;
            if (!promoterPermissions.promote_members) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to promote members",
              });
            }

            // Prevent acting on self or equal/higher rank
            assertCanActOnMember({
              actorDiscordId: String(ctx.dbUser.discordId),
              actorRankLevel: promoter[0]!.level!,
              targetDiscordId: member.discordId,
              targetRankLevel: member.currentRankLevel!,
              actionName: "promote"
            });

            // Get the target rank info
            const targetRank = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(
                and(
                  eq(deptSchema.departmentRanks.id, input.toRankId),
                  eq(deptSchema.departmentRanks.departmentId, member.departmentId)
                )
              )
              .limit(1);

            if (targetRank.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Target rank not found in this department",
              });
            }

            // Check if this is actually a promotion (higher level)
            if (member.currentRankLevel && targetRank[0]!.level <= member.currentRankLevel) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Target rank is not higher than current rank. Use demote for rank reductions.",
              });
            }

            // Check rank limits before promotion
            const memberInfo = await postgrestDb
              .select({
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            const rankLimitCheck = await validateRankLimit(
              input.toRankId,
              member.departmentId,
              memberInfo[0]?.primaryTeamId ?? undefined
            );

            if (!rankLimitCheck.canPromote) {
              throw new TRPCError({
                code: "CONFLICT",
                message: `Promotion denied: ${rankLimitCheck.reason}`,
              });
            }

            // Record the promotion in history (before Discord call for audit trail)
            await postgrestDb.insert(deptSchema.departmentPromotionHistory).values({
              memberId: input.memberId,
              fromRankId: member.currentRankId,
              toRankId: input.toRankId,
              promotedBy: String(ctx.dbUser.discordId),
              reason: input.reason,
              notes: input.notes,
            });

            // Update Discord roles FIRST - this is the source of truth
            try {
              // Get department's Discord guild ID
              const department = await postgrestDb
                .select({ discordGuildId: deptSchema.departments.discordGuildId })
                .from(deptSchema.departments)
                .where(eq(deptSchema.departments.id, member.departmentId))
                .limit(1);

              if (department.length === 0) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Department Discord configuration not found",
                });
              }

              const serverId = department[0]!.discordGuildId;

              // Remove old Discord role if it exists
              if (member.currentRankId) {
                const oldRank = await postgrestDb
                  .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
                  .from(deptSchema.departmentRanks)
                  .where(eq(deptSchema.departmentRanks.id, member.currentRankId))
                  .limit(1);

                if (oldRank.length > 0 && oldRank[0]!.discordRoleId) {
                  await manageDiscordRole('remove', member.discordId, oldRank[0]!.discordRoleId, serverId);
                }
              }

              // Add new Discord role
              if (targetRank[0]!.discordRoleId) {
                await manageDiscordRole('add', member.discordId, targetRank[0]!.discordRoleId, serverId);
              }

              // Wait for Discord role changes to propagate (3 seconds should be sufficient)
              console.log("⏳ Waiting for Discord role changes to propagate...");
              await new Promise(resolve => setTimeout(resolve, 3000));

              // Synchronize database with actual Discord roles
              console.log("🔄 Synchronizing database with Discord roles...");
              const rankUpdateResult = await updateUserRankFromDiscordRoles(member.discordId, member.departmentId);
              
              if (!rankUpdateResult.success) {
                console.warn("⚠️ Failed to sync rank from Discord roles, but Discord update succeeded");
              } else {
                console.log("✅ Database synchronized with Discord roles");
              }

              // Return success - promotion is complete
              return {
                success: true,
                message: "Promotion successful. Discord roles updated and database synchronized.",
                memberId: input.memberId,
                fromRankId: member.currentRankId,
                toRankId: input.toRankId,
                discordId: member.discordId,
                syncResult: rankUpdateResult,
              };

            } catch (discordError) {
              console.error("Discord role update failed for promotion:", discordError);
              
              // Discord failed - promotion fails
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to update Discord roles. Promotion cancelled.",
                cause: discordError,
              });
            }
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to promote member",
            });
          }
        }),

      // Demote a member
      demote: protectedProcedure
        .input(z.object({
          memberId: z.number().int().positive(),
          toRankId: z.number().int().positive(),
          reason: z.string().min(1, "Reason is required for demotions"),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Similar logic to promote but checking for demotion permissions
            const targetMember = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                departmentId: deptSchema.departmentMembers.departmentId,
                currentRankId: deptSchema.departmentMembers.rankId,
                currentRankLevel: deptSchema.departmentRanks.level,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (targetMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = targetMember[0]!;

            // Get the demoter's permissions
            const demoter = await postgrestDb
              .select({
                rankId: deptSchema.departmentMembers.rankId,
                permissions: deptSchema.departmentRanks.permissions,
                level: deptSchema.departmentRanks.level
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, member.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (demoter.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const demoterPermissions = demoter[0]!.permissions!;
            if (!demoterPermissions.demote_members) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to demote members",
              });
            }

            // Prevent acting on self or equal/higher rank
            assertCanActOnMember({
              actorDiscordId: String(ctx.dbUser.discordId),
              actorRankLevel: demoter[0]!.level!,
              targetDiscordId: member.discordId,
              targetRankLevel: member.currentRankLevel!,
              actionName: "demote"
            });

            // Get the target rank info
            const targetRank = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(
                and(
                  eq(deptSchema.departmentRanks.id, input.toRankId),
                  eq(deptSchema.departmentRanks.departmentId, member.departmentId)
                )
              )
              .limit(1);

            if (targetRank.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Target rank not found in this department",
              });
            }

            // Check if this is actually a demotion (lower level)
            if (member.currentRankLevel && targetRank[0]!.level >= member.currentRankLevel) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Target rank is not lower than current rank. Use promote for rank increases.",
              });
            }

            // Record the demotion in history (before Discord call for audit trail)
            await postgrestDb.insert(deptSchema.departmentPromotionHistory).values({
              memberId: input.memberId,
              fromRankId: member.currentRankId,
              toRankId: input.toRankId,
              promotedBy: String(ctx.dbUser.discordId),
              reason: input.reason,
              notes: input.notes,
            });

            // Update Discord roles FIRST - this is the source of truth
            try {
              // Get department's Discord guild ID
              const department = await postgrestDb
                .select({ discordGuildId: deptSchema.departments.discordGuildId })
                .from(deptSchema.departments)
                .where(eq(deptSchema.departments.id, member.departmentId))
                .limit(1);

              if (department.length === 0) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Department Discord configuration not found",
                });
              }

              const serverId = department[0]!.discordGuildId;

              // Remove old Discord role if it exists
              if (member.currentRankId) {
                const oldRank = await postgrestDb
                  .select({ discordRoleId: deptSchema.departmentRanks.discordRoleId })
                  .from(deptSchema.departmentRanks)
                  .where(eq(deptSchema.departmentRanks.id, member.currentRankId))
                  .limit(1);

                if (oldRank.length > 0 && oldRank[0]!.discordRoleId) {
                  await manageDiscordRole('remove', member.discordId, oldRank[0]!.discordRoleId, serverId);
                }
              }

              // Add new Discord role
              if (targetRank[0]!.discordRoleId) {
                await manageDiscordRole('add', member.discordId, targetRank[0]!.discordRoleId, serverId);
              }

              // Wait for Discord role changes to propagate (3 seconds should be sufficient)
              console.log("⏳ Waiting for Discord role changes to propagate...");
              await new Promise(resolve => setTimeout(resolve, 3000));

              // Synchronize database with actual Discord roles
              console.log("🔄 Synchronizing database with Discord roles...");
              const rankUpdateResult = await updateUserRankFromDiscordRoles(member.discordId, member.departmentId);
              
              if (!rankUpdateResult.success) {
                console.warn("⚠️ Failed to sync rank from Discord roles, but Discord update succeeded");
              } else {
                console.log("✅ Database synchronized with Discord roles");
              }

              // Return success - demotion is complete
              return {
                success: true,
                message: "Demotion successful. Discord roles updated and database synchronized.",
                memberId: input.memberId,
                fromRankId: member.currentRankId,
                toRankId: input.toRankId,
                discordId: member.discordId,
                syncResult: rankUpdateResult,
              };

            } catch (discordError) {
              console.error("Discord role update failed for demotion:", discordError);
              
              // Discord failed - demotion fails
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to update Discord roles. Demotion cancelled.",
                cause: discordError,
              });
            }
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to demote member",
            });
          }
        }),

      // Get promotion history for a member
      getHistory: protectedProcedure
        .input(z.object({
          memberId: z.number().int().positive(),
          limit: z.number().int().min(1).max(50).default(10)
        }))
        .query(async ({ ctx, input }) => {
          try {
            // First check if user has permission to view this info
            const targetMember = await postgrestDb
              .select({
                departmentId: deptSchema.departmentMembers.departmentId,
                discordId: deptSchema.departmentMembers.discordId,
              })
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (targetMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = targetMember[0]!;

            // Check if requester is viewing their own history or has permission
            const canView = member.discordId === String(ctx.dbUser.discordId);
            
            if (!canView) {
              // Check if requester has view_all_members permission
              const requester = await postgrestDb
                .select({
                  permissions: deptSchema.departmentRanks.permissions,
                })
                .from(deptSchema.departmentMembers)
                .leftJoin(
                  deptSchema.departmentRanks,
                  eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                )
                .where(
                  and(
                    eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                    eq(deptSchema.departmentMembers.departmentId, member.departmentId),
                    eq(deptSchema.departmentMembers.isActive, true)
                  )
                )
                .limit(1);

              if (requester.length === 0) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You are not a member of this department",
                });
              }

              const permissions = requester[0]!.permissions!;
              if (!permissions.view_all_members) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You do not have permission to view other members' promotion history",
                });
              }
            }

            // Get promotion history with rank names
            const history = await postgrestDb
              .select({
                id: deptSchema.departmentPromotionHistory.id,
                promotedBy: deptSchema.departmentPromotionHistory.promotedBy,
                reason: deptSchema.departmentPromotionHistory.reason,
                effectiveDate: deptSchema.departmentPromotionHistory.effectiveDate,
                notes: deptSchema.departmentPromotionHistory.notes,
              })
              .from(deptSchema.departmentPromotionHistory)
              .where(eq(deptSchema.departmentPromotionHistory.memberId, input.memberId))
              .orderBy(desc(deptSchema.departmentPromotionHistory.effectiveDate))
              .limit(input.limit);

            return history;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch promotion history",
            });
          }
        }),
    }),

    // ===== DISCIPLINARY ACTIONS =====
    discipline: createTRPCRouter({
      // Issue disciplinary action
      issue: protectedProcedure
        .input(z.object({
          memberId: z.number().int().positive(),
          actionType: z.string().min(1, "Action type is required"),
          reason: z.string().min(1, "Reason is required"),
          description: z.string().optional(),
          expiresAt: z.date().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Get target member info
            const targetMember = await postgrestDb
              .select({
                departmentId: deptSchema.departmentMembers.departmentId,
                discordId: deptSchema.departmentMembers.discordId,
                rankId: deptSchema.departmentMembers.rankId,
              })
              .from(deptSchema.departmentMembers)
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .limit(1);

            if (targetMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = targetMember[0]!;

            // Get target member's rank level
            const targetRank = member.rankId
              ? await postgrestDb
                  .select({ level: deptSchema.departmentRanks.level })
                  .from(deptSchema.departmentRanks)
                  .where(eq(deptSchema.departmentRanks.id, member.rankId))
                  .limit(1)
              : [];
            const targetRankLevel = targetRank.length > 0 ? targetRank[0]!.level : 0;

            // Check issuer permissions and get issuer's rank level
            const issuer = await postgrestDb
              .select({
                permissions: deptSchema.departmentRanks.permissions,
                level: deptSchema.departmentRanks.level,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, member.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (issuer.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = issuer[0]!.permissions!;
            if (!permissions.discipline_members) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to issue disciplinary actions",
              });
            }

            // Prevent acting on self or equal/higher rank
            assertCanActOnMember({
              actorDiscordId: String(ctx.dbUser.discordId),
              actorRankLevel: issuer[0]!.level!,
              targetDiscordId: member.discordId,
              targetRankLevel,
              actionName: "discipline"
            });

            // Create disciplinary action
            const result = await postgrestDb
              .insert(deptSchema.departmentDisciplinaryActions)
              .values({
                memberId: input.memberId,
                actionType: input.actionType,
                reason: input.reason,
                description: input.description,
                issuedBy: String(ctx.dbUser.discordId),
                expiresAt: input.expiresAt,
              })
              .returning();

            // If warning or suspension, update member status with escalation logic
            if (input.actionType === 'warning') {
              // Fetch current status
              const currentStatusResult = await postgrestDb
                .select({ status: deptSchema.departmentMembers.status })
                .from(deptSchema.departmentMembers)
                .where(eq(deptSchema.departmentMembers.id, input.memberId))
                .limit(1);
              const currentStatus = currentStatusResult[0]?.status;
              let newStatus = 'warned_1';
              if (currentStatus === 'warned_1') newStatus = 'warned_2';
              else if (currentStatus === 'warned_2') newStatus = 'warned_3';
              else if (currentStatus === 'warned_3') newStatus = 'warned_3';
              await postgrestDb
                .update(deptSchema.departmentMembers)
                .set({ status: newStatus as 'warned_1' | 'warned_2' | 'warned_3', updatedAt: new Date() })
                .where(eq(deptSchema.departmentMembers.id, input.memberId));
            } else if (input.actionType === 'suspension') {
              await postgrestDb
                .update(deptSchema.departmentMembers)
                .set({ status: 'suspended', updatedAt: new Date() })
                .where(eq(deptSchema.departmentMembers.id, input.memberId));
            }

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to issue disciplinary action",
            });
          }
        }),

      // View disciplinary actions for a member
      getByMember: protectedProcedure
        .input(z.object({
          memberId: z.number().int().positive(),
          includeExpired: z.boolean().default(false),
          limit: z.number().int().min(1).max(50).default(10)
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check permissions (similar to promotion history)
            const targetMember = await postgrestDb
              .select({
                departmentId: deptSchema.departmentMembers.departmentId,
                discordId: deptSchema.departmentMembers.discordId,
              })
                .from(deptSchema.departmentMembers)
                .where(eq(deptSchema.departmentMembers.id, input.memberId))
                .limit(1);

            if (targetMember.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

            const member = targetMember[0]!;
            const canView = member.discordId === String(ctx.dbUser.discordId);
            
            if (!canView) {
              const requester = await postgrestDb
                .select({
                  permissions: deptSchema.departmentRanks.permissions,
                })
                .from(deptSchema.departmentMembers)
                .leftJoin(
                  deptSchema.departmentRanks,
                  eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                )
                .where(
                  and(
                    eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                    eq(deptSchema.departmentMembers.departmentId, member.departmentId),
                    eq(deptSchema.departmentMembers.isActive, true)
                  )
                )
                .limit(1);

              if (requester.length === 0) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You are not a member of this department",
                });
              }

              const permissions = requester[0]!.permissions!;
              if (!permissions.view_all_members) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You do not have permission to view other members' disciplinary records",
                });
              }
            }

            // Build conditions
            const conditions = [eq(deptSchema.departmentDisciplinaryActions.memberId, input.memberId)];
            
            if (!input.includeExpired) {
              conditions.push(eq(deptSchema.departmentDisciplinaryActions.isActive, true));
            }

            const actions = await postgrestDb
              .select()
              .from(deptSchema.departmentDisciplinaryActions)
              .where(and(...conditions))
              .orderBy(desc(deptSchema.departmentDisciplinaryActions.issuedAt))
              .limit(input.limit);

            return actions;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch disciplinary actions",
            });
          }
        }),

      // Dismiss/remove disciplinary action
      dismiss: protectedProcedure
        .input(z.object({
          actionId: z.number().int().positive(),
          reason: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Get disciplinary action details
            const action = await postgrestDb
              .select({
                id: deptSchema.departmentDisciplinaryActions.id,
                memberId: deptSchema.departmentDisciplinaryActions.memberId,
                actionType: deptSchema.departmentDisciplinaryActions.actionType,
                isActive: deptSchema.departmentDisciplinaryActions.isActive,
                departmentId: deptSchema.departmentMembers.departmentId,
                memberDiscordId: deptSchema.departmentMembers.discordId,
                memberRankId: deptSchema.departmentMembers.rankId,
              })
              .from(deptSchema.departmentDisciplinaryActions)
              .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentDisciplinaryActions.memberId, deptSchema.departmentMembers.id)
              )
              .where(eq(deptSchema.departmentDisciplinaryActions.id, input.actionId))
              .limit(1);

            if (action.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Disciplinary action not found",
              });
            }

            const disciplinaryAction = action[0]!;

            if (!disciplinaryAction.isActive) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Disciplinary action is already inactive",
              });
            }

            // Get target member's rank level
            const targetRank = disciplinaryAction.memberRankId
              ? await postgrestDb
                  .select({ level: deptSchema.departmentRanks.level })
                  .from(deptSchema.departmentRanks)
                  .where(eq(deptSchema.departmentRanks.id, disciplinaryAction.memberRankId))
                  .limit(1)
              : [];
            const targetRankLevel = targetRank.length > 0 ? targetRank[0]!.level : 0;

            // Check permissions - user must have discipline_members permission and get their rank level
            const requester = await postgrestDb
              .select({
                permissions: deptSchema.departmentRanks.permissions,
                level: deptSchema.departmentRanks.level,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, disciplinaryAction.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = requester[0]!.permissions!;
            if (!permissions.discipline_members) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to dismiss disciplinary actions",
              });
            }

            // Prevent acting on self or equal/higher rank
            assertCanActOnMember({
              actorDiscordId: String(ctx.dbUser.discordId),
              actorRankLevel: requester[0]!.level!,
              targetDiscordId: disciplinaryAction.memberDiscordId,
              targetRankLevel,
              actionName: "dismiss a disciplinary action"
            });

            // Mark the disciplinary action as inactive
            const result = await postgrestDb
              .update(deptSchema.departmentDisciplinaryActions)
              .set({
                isActive: false,
                appealNotes: input.reason ? `Dismissed by management: ${input.reason}` : "Dismissed by management",
                updatedAt: new Date(),
              })
              .where(eq(deptSchema.departmentDisciplinaryActions.id, input.actionId))
              .returning();

            // If it was a warning or suspension, we should also check if member status needs to be updated
            if (disciplinaryAction.actionType === 'warning' || disciplinaryAction.actionType === 'suspension') {
              // Check if member has any other active disciplinary actions
              const otherActiveActions = await postgrestDb
                .select()
                .from(deptSchema.departmentDisciplinaryActions)
                .where(
                  and(
                    eq(deptSchema.departmentDisciplinaryActions.memberId, disciplinaryAction.memberId),
                    eq(deptSchema.departmentDisciplinaryActions.isActive, true),
                    ne(deptSchema.departmentDisciplinaryActions.id, input.actionId)
                  )
                );

              // If no other active actions, potentially reset member status to active
              if (otherActiveActions.length === 0) {
                const memberInfo = await postgrestDb
                  .select({
                    status: deptSchema.departmentMembers.status,
                  })
                  .from(deptSchema.departmentMembers)
                  .where(eq(deptSchema.departmentMembers.id, disciplinaryAction.memberId))
                  .limit(1);

                if (memberInfo.length > 0) {
                  const currentStatus = memberInfo[0]!.status;
                  
                  // Only update status if it's currently a disciplinary status
                  if (currentStatus === 'warned_1' || currentStatus === 'warned_2' || currentStatus === 'warned_3' || currentStatus === 'suspended') {
              await postgrestDb
                .update(deptSchema.departmentMembers)
                      .set({
                        status: 'active',
                        updatedAt: new Date(),
                      })
                      .where(eq(deptSchema.departmentMembers.id, disciplinaryAction.memberId));
                  }
                }
              }
            }

            return {
              success: true,
              message: `Disciplinary action dismissed successfully`,
              action: result[0],
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to dismiss disciplinary action",
            });
          }
        }),
    }),

    // ===== TIME CLOCK MANAGEMENT =====
    timeclock: createTRPCRouter({
      // Clock in
      clockIn: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Get member info
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
              })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not an active member of this department",
              });
            }

            // Check if already clocked in
            const existingEntry = await postgrestDb
              .select()
              .from(deptSchema.departmentTimeClockEntries)
              .where(
                and(
                  eq(deptSchema.departmentTimeClockEntries.memberId, member[0]!.id),
                  isNull(deptSchema.departmentTimeClockEntries.clockOutTime)
                )
              )
              .limit(1);

            if (existingEntry.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "You are already clocked in",
              });
            }

            // Create clock in entry
            const result = await postgrestDb
              .insert(deptSchema.departmentTimeClockEntries)
              .values({
                memberId: member[0]!.id,
                clockInTime: new Date(),
                status: "clocked_in",
                notes: input.notes,
              })
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to clock in",
            });
          }
        }),

      // Clock out
      clockOut: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Get member info
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
              })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not an active member of this department",
              });
            }

            // Find active clock entry
            const activeEntry = await postgrestDb
              .select()
              .from(deptSchema.departmentTimeClockEntries)
              .where(
                and(
                  eq(deptSchema.departmentTimeClockEntries.memberId, member[0]!.id),
                  isNull(deptSchema.departmentTimeClockEntries.clockOutTime)
                )
              )
              .limit(1);

            if (activeEntry.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "No active clock in entry found",
              });
            }

            const entry = activeEntry[0]!;
            const clockOutTime = new Date();
            const totalMinutes = Math.floor((clockOutTime.getTime() - entry.clockInTime.getTime()) / (1000 * 60));

            // Update entry with clock out time
            const result = await postgrestDb
              .update(deptSchema.departmentTimeClockEntries)
              .set({
                clockOutTime,
                totalMinutes,
                status: "clocked_out",
                notes: input.notes ? `${entry.notes ?? ''}${entry.notes ? '\n' : ''}Clock out: ${input.notes}` : entry.notes,
              })
              .where(eq(deptSchema.departmentTimeClockEntries.id, entry.id))
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to clock out",
            });
          }
        }),

      // Get current status
      getStatus: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
        }))
        .query(async ({ ctx, input }) => {
          try {
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
              })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not an active member of this department",
              });
            }

            const activeEntry = await postgrestDb
              .select()
              .from(deptSchema.departmentTimeClockEntries)
              .where(
                and(
                  eq(deptSchema.departmentTimeClockEntries.memberId, member[0]!.id),
                  isNull(deptSchema.departmentTimeClockEntries.clockOutTime)
                )
              )
              .limit(1);

            return {
              isClockedIn: activeEntry.length > 0,
              currentEntry: activeEntry[0] ?? null,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to get clock status",
            });
          }
        }),

      // Get member's time history 
      getHistory: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          memberId: z.number().int().positive().optional(), // For managers to view other members
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        }))
        .query(async ({ ctx, input }) => {
          try {
            console.log('[getHistory] Starting query with input:', {
              departmentId: input.departmentId,
              memberId: input.memberId,
              startDate: input.startDate?.toISOString(),
              endDate: input.endDate?.toISOString(),
              limit: input.limit,
              offset: input.offset
            });

            // Check permissions - either viewing own time or have manage_timeclock permission
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            console.log('[getHistory] Found requester:', requester.length > 0 ? 'Yes' : 'No');

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not an active member of this department",
              });
            }

            const permissions = requester[0]!.permissions;
            const canViewOthers = (permissions?.view_all_timeclock ?? false) || (permissions?.manage_timeclock ?? false);

            console.log('[getHistory] Permissions check:', {
              canViewOthers,
              viewAllTimeclock: permissions?.view_all_timeclock,
              manageTimeclock: permissions?.manage_timeclock
            });

            // Determine target member
            let targetMemberId = requester[0]!.id;
            if (input.memberId) {
              if (!canViewOthers) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You do not have permission to view other members' time records",
                });
              }
              
              // Verify the target member exists and is in the same department
              const targetMember = await postgrestDb
                .select({ id: deptSchema.departmentMembers.id })
                .from(deptSchema.departmentMembers)
                .where(
                  and(
                    eq(deptSchema.departmentMembers.id, input.memberId),
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId)
                  )
                )
                .limit(1);

              if (targetMember.length === 0) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Member not found in this department",
                });
              }

              targetMemberId = input.memberId;
            }

            console.log('[getHistory] Target member ID:', targetMemberId);

            // Build conditions
            const conditions = [eq(deptSchema.departmentTimeClockEntries.memberId, targetMemberId)];
            
            if (input.startDate) {
              conditions.push(gte(deptSchema.departmentTimeClockEntries.clockInTime, input.startDate));
            }
            
            if (input.endDate) {
              conditions.push(lte(deptSchema.departmentTimeClockEntries.clockInTime, input.endDate)); 
            }

            console.log('[getHistory] Built conditions, starting entries query...');

            // Get time entries
            const entries = await postgrestDb
              .select({
                id: deptSchema.departmentTimeClockEntries.id,
                clockInTime: deptSchema.departmentTimeClockEntries.clockInTime,
                clockOutTime: deptSchema.departmentTimeClockEntries.clockOutTime,
                totalMinutes: deptSchema.departmentTimeClockEntries.totalMinutes,
                breakMinutes: deptSchema.departmentTimeClockEntries.breakMinutes,
                status: deptSchema.departmentTimeClockEntries.status,
                notes: deptSchema.departmentTimeClockEntries.notes,
              })
              .from(deptSchema.departmentTimeClockEntries)
              .where(and(...conditions))
              .orderBy(desc(deptSchema.departmentTimeClockEntries.clockInTime))
              .limit(input.limit)
              .offset(input.offset);

            console.log('[getHistory] Entries query completed, found:', entries.length, 'entries');

            // Get total count
            const totalCountResult = await postgrestDb
              .select({ count: sql`count(*)` })
              .from(deptSchema.departmentTimeClockEntries)
              .where(and(...conditions));

            const totalCount = Number(totalCountResult[0]?.count ?? 0);

            console.log('[getHistory] Total count:', totalCount);

            const result = {
              entries,
              totalCount,
              hasMore: input.offset + input.limit < totalCount,
            };

            console.log('[getHistory] Returning result with', result.entries.length, 'entries');
            return result;
          } catch (error) {
            console.error('[getHistory] Error occurred:', {
              error,
              message: error instanceof Error ? error.message : 'Unknown error',
              stack: error instanceof Error ? error.stack : undefined,
              input: {
                departmentId: input.departmentId,
                memberId: input.memberId,
                startDate: input.startDate?.toISOString(),
                endDate: input.endDate?.toISOString()
              }
            });

            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch time history",
              cause: error,
            });
          }
        }),

      // Get weekly hours summary
      getWeeklyHours: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          memberId: z.number().int().positive().optional(), // For managers to view other members
          weekOffset: z.number().int().default(0), // 0 = current week, -1 = last week, etc.
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check permissions
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not an active member of this department",
              });
            }

            const permissions = requester[0]!.permissions;
            const canViewOthers = (permissions?.view_all_timeclock ?? false) || (permissions?.manage_timeclock ?? false);

            // Determine target member
            let targetMemberId = requester[0]!.id;
            if (input.memberId) {
              if (!canViewOthers) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You do not have permission to view other members' time records",
                });
              }
              
              // Verify the target member exists and is in the same department
              const targetMember = await postgrestDb
                .select({ id: deptSchema.departmentMembers.id })
                .from(deptSchema.departmentMembers)
                .where(
                  and(
                    eq(deptSchema.departmentMembers.id, input.memberId),
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId)
                  )
                )
                .limit(1);

              if (targetMember.length === 0) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Member not found in this department",
                });
              }

              targetMemberId = input.memberId;
            }

            // Calculate week boundaries (Sunday to Sunday)
            const now = new Date();
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay() + (7 * input.weekOffset));
            startOfWeek.setHours(0, 0, 0, 0);
            
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 7);
            endOfWeek.setHours(0, 0, 0, 0);

            // Get completed entries for the week
            const weeklyEntries = await postgrestDb
              .select({
                totalMinutes: deptSchema.departmentTimeClockEntries.totalMinutes,
                clockInTime: deptSchema.departmentTimeClockEntries.clockInTime,
              })
              .from(deptSchema.departmentTimeClockEntries)
              .where(
                and(
                  eq(deptSchema.departmentTimeClockEntries.memberId, targetMemberId),
                  gte(deptSchema.departmentTimeClockEntries.clockInTime, startOfWeek),
                  lt(deptSchema.departmentTimeClockEntries.clockInTime, endOfWeek),
                  isNotNull(deptSchema.departmentTimeClockEntries.totalMinutes)
                )
              );

            // Calculate total hours
            const totalMinutes = weeklyEntries.reduce((sum, entry) => sum + (entry.totalMinutes ?? 0), 0);
            const totalHours = Math.round((totalMinutes / 60) * 100) / 100; // Round to 2 decimal places

            const result = {
              weekStartDate: startOfWeek,
              weekEndDate: endOfWeek,
              totalHours,
              totalMinutes,
              entriesCount: weeklyEntries.length,
              entries: weeklyEntries,
            };

            return result;
          } catch (error) {
            console.error('Error in getWeeklyHours:', error);
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch weekly hours",
              cause: error,
            });
          }
        }),

      // Admin endpoint to edit time entries
      editEntry: protectedProcedure
        .input(z.object({
          entryId: z.number().int().positive(),
          clockInTime: z.date().optional(),
          clockOutTime: z.date().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Get the entry and verify permissions
            const entry = await postgrestDb
              .select({
                id: deptSchema.departmentTimeClockEntries.id,
                memberId: deptSchema.departmentTimeClockEntries.memberId,
                memberDepartmentId: deptSchema.departmentMembers.departmentId,
              })
              .from(deptSchema.departmentTimeClockEntries)
              .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentTimeClockEntries.memberId, deptSchema.departmentMembers.id)
              )
              .where(eq(deptSchema.departmentTimeClockEntries.id, input.entryId))
              .limit(1);

            if (entry.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Time entry not found",
              });
            }

            const timeEntry = entry[0]!;

            // Check if user has permission to edit time entries
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, timeEntry.memberDepartmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = requester[0]!.permissions;
            if (!permissions?.edit_timeclock && !permissions?.manage_timeclock) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to edit time entries",
              });
            }

            // Build update data
            const updateData: Partial<{
              clockInTime: Date;
              clockOutTime: Date;
              totalMinutes: number;
              notes: string;
            }> = {};

            if (input.clockInTime) {
              updateData.clockInTime = input.clockInTime;
            }

            if (input.clockOutTime) {
              updateData.clockOutTime = input.clockOutTime;
            }

            if (input.notes !== undefined) {
              updateData.notes = input.notes;
            }

            // Recalculate total minutes if both times are provided
            if (updateData.clockInTime && updateData.clockOutTime) {
              const totalMinutes = Math.floor((updateData.clockOutTime.getTime() - updateData.clockInTime.getTime()) / (1000 * 60));
              updateData.totalMinutes = totalMinutes;
            }

            // Update the entry
            const result = await postgrestDb
              .update(deptSchema.departmentTimeClockEntries)
              .set(updateData)
              .where(eq(deptSchema.departmentTimeClockEntries.id, input.entryId))
              .returning();

            return result[0];
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to edit time entry",
            });
          }
        }),

      // Get weekly hours for multiple members (for roster display)
      getBatchWeeklyHours: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          memberIds: z.array(z.number().int().positive()).max(50), // Limit to 50 members per batch
          weekOffset: z.number().int().default(0),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check permissions
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not an active member of this department",
              });
            }

            const permissions = requester[0]!.permissions;
            const canViewOthers = (permissions?.view_all_timeclock ?? false) || (permissions?.manage_timeclock ?? false);

            if (!canViewOthers) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to view other members' time records",
              });
            }

            // Calculate week boundaries (Sunday to Sunday)
            const now = new Date();
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay() + (7 * input.weekOffset));
            startOfWeek.setHours(0, 0, 0, 0);
            
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 7);
            endOfWeek.setHours(0, 0, 0, 0);

            // Get all entries for the specified members and week
            const weeklyEntries = await postgrestDb
              .select({
                memberId: deptSchema.departmentTimeClockEntries.memberId,
                totalMinutes: deptSchema.departmentTimeClockEntries.totalMinutes,
              })
              .from(deptSchema.departmentTimeClockEntries)
              .where(
                and(
                  inArray(deptSchema.departmentTimeClockEntries.memberId, input.memberIds),
                  gte(deptSchema.departmentTimeClockEntries.clockInTime, startOfWeek),
                  lt(deptSchema.departmentTimeClockEntries.clockInTime, endOfWeek),
                  isNotNull(deptSchema.departmentTimeClockEntries.totalMinutes)
                )
              );

            // Group entries by member ID and calculate totals
            const memberHours: Record<number, { totalHours: number; entriesCount: number }> = {};

            // Initialize all members with zero hours
            input.memberIds.forEach(memberId => {
              memberHours[memberId] = { totalHours: 0, entriesCount: 0 };
            });

            // Calculate hours for each member
            weeklyEntries.forEach(entry => {
              if (memberHours[entry.memberId]) {
                memberHours[entry.memberId]!.totalHours += (entry.totalMinutes ?? 0) / 60;
                memberHours[entry.memberId]!.entriesCount += 1;
              }
            });

            // Round hours to 2 decimal places
            Object.keys(memberHours).forEach(memberIdStr => {
              const memberId = parseInt(memberIdStr);
              if (memberHours[memberId]) {
                memberHours[memberId].totalHours = Math.round(memberHours[memberId].totalHours * 100) / 100;
              }
            });

            return {
              weekStartDate: startOfWeek,
              weekEndDate: endOfWeek,
              memberHours,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch batch weekly hours",
              cause: error,
            });
          }
        }),
    }),

    // ===== DEPARTMENT INFO AND MEMBERS =====
    info: createTRPCRouter({
      // Update my roleplay name
      updateMyRoleplayName: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          roleplayName: z.string().min(1, "Roleplay name is required").max(100, "Roleplay name must be 100 characters or less"),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Check if user is member of department
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
              })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            // Update roleplay name
            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({ roleplayName: input.roleplayName })
              .where(eq(deptSchema.departmentMembers.id, member[0]!.id))
              .returning();

            return {
              success: true,
              member: result[0],
              message: "Roleplay name updated successfully",
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update roleplay name",
            });
          }
        }),

      // Get department info that user has access to
      getDepartment: protectedProcedure
        .input(z.object({ departmentId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
          try {
            // Check if user is member of department
            const member = await postgrestDb
              .select({
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            // Get department basic info
            const department = await postgrestDb
              .select()
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, input.departmentId))
              .limit(1);

            if (department.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Department not found",
              });
            }

            // Get ranks (always visible to members)
            const ranks = await postgrestDb
              .select()
              .from(deptSchema.departmentRanks)
              .where(
                and(
                  eq(deptSchema.departmentRanks.departmentId, input.departmentId),
                  eq(deptSchema.departmentRanks.isActive, true)
                )
              )
              .orderBy(desc(deptSchema.departmentRanks.level));

            // Get teams (always visible to members)
            const teams = await postgrestDb
              .select()
              .from(deptSchema.departmentTeams)
              .where(
                and(
                  eq(deptSchema.departmentTeams.departmentId, input.departmentId),
                  eq(deptSchema.departmentTeams.isActive, true)
                )
              )
              .orderBy(asc(deptSchema.departmentTeams.name));

            return {
              ...department[0],
              ranks,
              teams,
              userPermissions: member[0]!.permissions!,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch department info",
            });
          }
        }),

      // Get members list (with permission restrictions)
      getMembers: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          teamId: z.number().int().positive().optional(),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check permissions
            const requester = await postgrestDb
              .select({
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = requester[0]!.permissions!;

            // Check if user can view all members or just team members
            if (!permissions.view_all_members && !permissions.view_team_members) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to view members",
              });
            }

            // Build base query
            const conditions = [
              eq(deptSchema.departmentMembers.departmentId, input.departmentId),
              eq(deptSchema.departmentMembers.isActive, true)
            ];

            // If user can only view team members and a specific team is requested
            if (!permissions.view_all_members && input.teamId) {
              // This would require a more complex query with team memberships
              // For now, we'll return an error
              throw new TRPCError({
                code: "NOT_IMPLEMENTED",
                message: "Team-specific member viewing not yet implemented",
              });
            }

            const members = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                roleplayName: deptSchema.departmentMembers.roleplayName,
                callsign: deptSchema.departmentMembers.callsign,
                badgeNumber: deptSchema.departmentMembers.badgeNumber,
                status: deptSchema.departmentMembers.status,
                hireDate: deptSchema.departmentMembers.hireDate,
                rankName: deptSchema.departmentRanks.name,
                rankLevel: deptSchema.departmentRanks.level,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(and(...conditions))
              .orderBy(asc(deptSchema.departmentMembers.callsign));

            return members;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch members",
            });
          }
        }),

      // Get rank limits (read-only for users)
      getRankLimits: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          teamId: z.number().int().positive().optional(),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check if user is member of department
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            // Use provided teamId or user's primary team
            const targetTeamId = input.teamId ?? member[0]!.primaryTeamId ?? undefined;

            const rankLimitInfo = await getRankLimitInfo(input.departmentId, targetTeamId);
            
            return {
              departmentId: input.departmentId,
              teamId: targetTeamId,
              ranks: rankLimitInfo,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch rank limits",
            });
          }
        }),

      // Get department roster with enhanced filtering and details
      getDepartmentRoster: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          includeInactive: z.boolean().default(false),
          statusFilter: z.array(deptSchema.departmentMemberStatusEnum).optional(),
          rankFilter: z.array(z.number().int().positive()).optional(),
          teamFilter: z.array(z.number().int().positive()).optional(),
          // Add member ID filter for finding specific members
          memberIdFilter: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
          // Add cursor support for infinite queries
          cursor: z.number().int().positive().optional(),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check permissions
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = requester[0]!.permissions!;

            // Check if user can view members
            if (!permissions.view_all_members && !permissions.view_team_members) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to view members",
              });
            }

            // Build conditions
            const conditions = [eq(deptSchema.departmentMembers.departmentId, input.departmentId)];

            // Member ID filter (for finding specific members)
            if (input.memberIdFilter) {
              conditions.push(eq(deptSchema.departmentMembers.id, input.memberIdFilter));
            }

            // Active filter
            if (!input.includeInactive) {
              conditions.push(eq(deptSchema.departmentMembers.isActive, true));
            }

            // Status filter
            if (input.statusFilter && input.statusFilter.length > 0) {
              conditions.push(inArray(deptSchema.departmentMembers.status, input.statusFilter));
            }

            // Rank filter
            if (input.rankFilter && input.rankFilter.length > 0) {
              conditions.push(inArray(deptSchema.departmentMembers.rankId, input.rankFilter));
            }

            // Team filter - if user can only view team members, restrict to their teams
            if (!permissions.view_all_members) {
              if (input.teamFilter && input.teamFilter.length > 0) {
                // Further restrict to intersection of user's teams and requested teams
                conditions.push(inArray(deptSchema.departmentMembers.primaryTeamId, input.teamFilter));
              } else {
                // Only show members in user's primary team
                if (requester[0]!.primaryTeamId !== null) {
                  conditions.push(eq(deptSchema.departmentMembers.primaryTeamId, requester[0]!.primaryTeamId));
                } else {
                  // If user has no primary team, show no members
                  conditions.push(sql`FALSE`);
                }
              }
            } else if (input.teamFilter && input.teamFilter.length > 0) {
              conditions.push(inArray(deptSchema.departmentMembers.primaryTeamId, input.teamFilter));
            }

            // Add cursor-based pagination if cursor is provided
            if (input.cursor) {
              conditions.push(gt(deptSchema.departmentMembers.id, input.cursor));
            }

            // Get members with enhanced details
            const members = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                roleplayName: deptSchema.departmentMembers.roleplayName,
                callsign: deptSchema.departmentMembers.callsign,
                badgeNumber: deptSchema.departmentMembers.badgeNumber,
                status: deptSchema.departmentMembers.status,
                hireDate: deptSchema.departmentMembers.hireDate,
                lastActiveDate: deptSchema.departmentMembers.lastActiveDate,
                isActive: deptSchema.departmentMembers.isActive,
                notes: deptSchema.departmentMembers.notes,
                rankId: deptSchema.departmentRanks.id,
                rankName: deptSchema.departmentRanks.name,
                rankLevel: deptSchema.departmentRanks.level,
                rankCallsign: deptSchema.departmentRanks.callsign,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
                teamName: deptSchema.departmentTeams.name,
                teamCallsignPrefix: deptSchema.departmentTeams.callsignPrefix,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .leftJoin(
                deptSchema.departmentTeams,
                eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
              )
              .where(and(...conditions))
              .orderBy(
                asc(deptSchema.departmentMembers.id) // Use ID for consistent cursor-based pagination
              )
              .limit(input.limit)
              .offset(input.cursor ? 0 : input.offset); // Skip offset when using cursor

            // Get total count for pagination (only when not using cursor or member filter)
            let totalCount = 0;
            let hasMore = false;

            if (!input.cursor && !input.memberIdFilter) {
              // Build conditions without cursor for count query
              const countConditions = [eq(deptSchema.departmentMembers.departmentId, input.departmentId)];
              
              if (!input.includeInactive) {
                countConditions.push(eq(deptSchema.departmentMembers.isActive, true));
              }
              
              if (input.statusFilter && input.statusFilter.length > 0) {
                countConditions.push(inArray(deptSchema.departmentMembers.status, input.statusFilter));
              }
              
              if (input.rankFilter && input.rankFilter.length > 0) {
                countConditions.push(inArray(deptSchema.departmentMembers.rankId, input.rankFilter));
              }
              
              if (!permissions.view_all_members) {
                if (input.teamFilter && input.teamFilter.length > 0) {
                  countConditions.push(inArray(deptSchema.departmentMembers.primaryTeamId, input.teamFilter));
                } else {
                  if (requester[0]!.primaryTeamId !== null) {
                    countConditions.push(eq(deptSchema.departmentMembers.primaryTeamId, requester[0]!.primaryTeamId));
                  } else {
                    countConditions.push(sql`FALSE`);
                  }
                }
              } else if (input.teamFilter && input.teamFilter.length > 0) {
                countConditions.push(inArray(deptSchema.departmentMembers.primaryTeamId, input.teamFilter));
              }

              const totalCountResult = await postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentMembers)
                .leftJoin(
                  deptSchema.departmentRanks,
                  eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                )
                .leftJoin(
                  deptSchema.departmentTeams,
                  eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
                )
                .where(and(...countConditions));

              totalCount = Number(totalCountResult[0]?.count ?? 0);
              hasMore = input.offset + input.limit < totalCount;
            } else {
              // For cursor-based pagination, check if there are more records
              hasMore = members.length === input.limit;
            }

            // Calculate next cursor for infinite pagination
            const nextCursor = hasMore && members.length > 0 
              ? members[members.length - 1]?.id 
              : undefined;

            return {
              members,
              totalCount,
              hasMore,
              nextCursor, // For infinite pagination
              userPermissions: permissions,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch department roster",
            });
          }
        }),

      // Get team roster with member details
      getTeamRoster: protectedProcedure
        .input(z.object({
          teamId: z.number().int().positive(),
          includeInactive: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Get team and verify access
            const team = await postgrestDb
              .select({
                id: deptSchema.departmentTeams.id,
                name: deptSchema.departmentTeams.name,
                description: deptSchema.departmentTeams.description,
                departmentId: deptSchema.departmentTeams.departmentId,
                callsignPrefix: deptSchema.departmentTeams.callsignPrefix,
                discordRoleId: deptSchema.departmentTeams.discordRoleId,
                leaderId: deptSchema.departmentTeams.leaderId,
                isActive: deptSchema.departmentTeams.isActive,
              })
              .from(deptSchema.departmentTeams)
              .where(eq(deptSchema.departmentTeams.id, input.teamId))
              .limit(1);

            if (team.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Team not found",
              });
            }

            const teamData = team[0]!;

            // Check if user is member of this department
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, teamData.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = requester[0]!.permissions!;

            // Check permissions - can view if they can view all members, or if this is their team and they can view team members
            const canView = permissions.view_all_members || 
              (permissions.view_team_members && requester[0]!.primaryTeamId === input.teamId);

            if (!canView) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to view this team roster",
              });
            }

            // Get team members via team memberships
            const conditions = [eq(deptSchema.departmentTeamMemberships.teamId, input.teamId)];
            
            if (!input.includeInactive) {
              conditions.push(eq(deptSchema.departmentMembers.isActive, true));
            }

            const teamMembers = await postgrestDb
              .select({
                membershipId: deptSchema.departmentTeamMemberships.id,
                isLeader: deptSchema.departmentTeamMemberships.isLeader,
                joinedAt: deptSchema.departmentTeamMemberships.joinedAt,
                memberId: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                roleplayName: deptSchema.departmentMembers.roleplayName,
                callsign: deptSchema.departmentMembers.callsign,
                badgeNumber: deptSchema.departmentMembers.badgeNumber,
                status: deptSchema.departmentMembers.status,
                hireDate: deptSchema.departmentMembers.hireDate,
                lastActiveDate: deptSchema.departmentMembers.lastActiveDate,
                isActive: deptSchema.departmentMembers.isActive,
                isPrimaryTeam: sql`CASE WHEN ${deptSchema.departmentMembers.primaryTeamId} = ${input.teamId} THEN true ELSE false END`.as('isPrimaryTeam'),
                rankId: deptSchema.departmentRanks.id,
                rankName: deptSchema.departmentRanks.name,
                rankLevel: deptSchema.departmentRanks.level,
                rankCallsign: deptSchema.departmentRanks.callsign,
              })
              .from(deptSchema.departmentTeamMemberships)
              .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentTeamMemberships.memberId, deptSchema.departmentMembers.id)
              )
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(and(...conditions))
              .orderBy(
                desc(deptSchema.departmentTeamMemberships.isLeader),
                desc(deptSchema.departmentRanks.level),
                asc(deptSchema.departmentMembers.callsign)
              );

            return {
              team: teamData,
              members: teamMembers,
              userPermissions: permissions,
              canManageTeam: permissions.manage_team_members || permissions.manage_members,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch team roster",
            });
          }
        }),

      // Get pending and training members for management (user-facing with permissions)
      getTrainingManagement: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          includeCompleted: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check permissions
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = requester[0]!.permissions!;

            // Check if user can manage members or recruit
            if (!permissions.manage_members && !permissions.recruit_members) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to manage training workflow",
              });
            }

            // Build status conditions
            const statusConditions = [
              eq(deptSchema.departmentMembers.status, "in_training"),
              eq(deptSchema.departmentMembers.status, "pending"),
            ];

            if (input.includeCompleted) {
              statusConditions.push(eq(deptSchema.departmentMembers.status, "active"));
            }

            const members = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                discordId: deptSchema.departmentMembers.discordId,
                roleplayName: deptSchema.departmentMembers.roleplayName,
                callsign: deptSchema.departmentMembers.callsign,
                status: deptSchema.departmentMembers.status,
                hireDate: deptSchema.departmentMembers.hireDate,
                lastActiveDate: deptSchema.departmentMembers.lastActiveDate,
                notes: deptSchema.departmentMembers.notes,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
                rankId: deptSchema.departmentRanks.id,
                rankName: deptSchema.departmentRanks.name,
                rankLevel: deptSchema.departmentRanks.level,
                teamName: deptSchema.departmentTeams.name,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .leftJoin(
                deptSchema.departmentTeams,
                eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true),
                  sql`${deptSchema.departmentMembers.status} IN ('in_training', 'pending'${input.includeCompleted ? sql`, 'active'` : sql``})`
                )
              )
              .orderBy(
                asc(deptSchema.departmentMembers.status),
                asc(deptSchema.departmentMembers.hireDate)
              );

            // Group by status for easier UI handling
            const groupedMembers = {
              in_training: members.filter(m => m.status === 'in_training'),
              pending: members.filter(m => m.status === 'pending'),
              ...(input.includeCompleted && { active: members.filter(m => m.status === 'active') }),
            };

            return {
              members: groupedMembers,
              userPermissions: permissions,
              canAssignTeams: permissions.manage_members || permissions.recruit_members,
              canBypassTraining: permissions.manage_members || permissions.recruit_members,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch training management data",
            });
          }
        }),

      // Get department statistics for management dashboard
      getDepartmentStats: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check if user is member of department
            const requester = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (requester.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = requester[0]!.permissions!;

            // Basic stats available to all members
            const [
              totalMembers,
              activeMembers,
              inTrainingMembers,
              pendingMembers,
              teamStats,
              rankStats
            ] = await Promise.all([
              // Total members
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentMembers)
                .where(eq(deptSchema.departmentMembers.departmentId, input.departmentId)),

              // Active members
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentMembers)
                .where(
                  and(
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                    eq(deptSchema.departmentMembers.isActive, true),
                    eq(deptSchema.departmentMembers.status, "active")
                  )
                ),

              // In training
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentMembers)
                .where(
                  and(
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                    eq(deptSchema.departmentMembers.isActive, true),
                    eq(deptSchema.departmentMembers.status, "in_training")
                  )
                ),

              // Pending assignment
              postgrestDb
                .select({ count: sql`count(*)` })
                .from(deptSchema.departmentMembers)
                .where(
                  and(
                    eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                    eq(deptSchema.departmentMembers.isActive, true),
                    eq(deptSchema.departmentMembers.status, "pending")
                  )
                ),

              // Team distribution
              postgrestDb
                .select({
                  teamId: deptSchema.departmentTeams.id,
                  teamName: deptSchema.departmentTeams.name,
                  memberCount: sql`count(${deptSchema.departmentMembers.id})`.as('memberCount'),
                })
                .from(deptSchema.departmentTeams)
                .leftJoin(
                  deptSchema.departmentMembers,
                  and(
                    eq(deptSchema.departmentTeams.id, deptSchema.departmentMembers.primaryTeamId),
                    eq(deptSchema.departmentMembers.isActive, true)
                  )
                )
                .where(
                  and(
                    eq(deptSchema.departmentTeams.departmentId, input.departmentId),
                    eq(deptSchema.departmentTeams.isActive, true)
                  )
                )
                .groupBy(deptSchema.departmentTeams.id, deptSchema.departmentTeams.name)
                .orderBy(asc(deptSchema.departmentTeams.name)),

              // Rank distribution
              postgrestDb
                .select({
                  rankId: deptSchema.departmentRanks.id,
                  rankName: deptSchema.departmentRanks.name,
                  rankLevel: deptSchema.departmentRanks.level,
                  memberCount: sql`count(${deptSchema.departmentMembers.id})`.as('memberCount'),
                })
                .from(deptSchema.departmentRanks)
                .leftJoin(
                  deptSchema.departmentMembers,
                  and(
                    eq(deptSchema.departmentRanks.id, deptSchema.departmentMembers.rankId),
                    eq(deptSchema.departmentMembers.isActive, true)
                  )
                )
                .where(
                  and(
                    eq(deptSchema.departmentRanks.departmentId, input.departmentId),
                    eq(deptSchema.departmentRanks.isActive, true)
                  )
                )
                .groupBy(
                  deptSchema.departmentRanks.id,
                  deptSchema.departmentRanks.name,
                  deptSchema.departmentRanks.level
                )
                .orderBy(desc(deptSchema.departmentRanks.level)),
            ]);

            return {
              totalMembers: Number(totalMembers[0]?.count ?? 0),
              activeMembers: Number(activeMembers[0]?.count ?? 0),
              inTrainingMembers: Number(inTrainingMembers[0]?.count ?? 0),
              pendingMembers: Number(pendingMembers[0]?.count ?? 0),
              teamDistribution: teamStats,
              rankDistribution: rankStats,
              userPermissions: permissions,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch department statistics",
            });
          }
        }),
    }),

    // ===== MEETING MANAGEMENT =====
    meetings: createTRPCRouter({
      // CREATE meeting (requires schedule_meetings permission)
      create: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          title: z.string().min(1, "Meeting title is required").max(256),
          description: z.string().optional(),
          scheduledAt: z.date().min(new Date(), "Meeting must be scheduled in the future"),
          location: z.string().optional(),
          duration: z.number().int().min(1).default(60), // Duration in minutes
          isMandatory: z.boolean().default(false),
          teamId: z.number().int().positive().optional(), // For team-specific meetings
          discordChannelId: z.string().max(30).optional(),
          requiredRankLevel: z.number().int().min(1).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Check permissions
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = member[0]!.permissions!;
            if (!permissions.schedule_meetings) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to schedule meetings",
              });
            }

            // Verify team exists if teamId provided
            if (input.teamId) {
              const team = await postgrestDb
                .select()
                .from(deptSchema.departmentTeams)
                .where(
                  and(
                    eq(deptSchema.departmentTeams.id, input.teamId),
                    eq(deptSchema.departmentTeams.departmentId, input.departmentId),
                    eq(deptSchema.departmentTeams.isActive, true)
                  )
                )
                .limit(1);

              if (team.length === 0) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Team not found or not in this department",
                });
              }
            }

            // Create meeting
            const result = await postgrestDb
              .insert(deptSchema.departmentMeetings)
              .values({
                departmentId: input.departmentId,
                title: input.title,
                description: input.description,
                scheduledAt: input.scheduledAt,
                location: input.location,
                duration: input.duration,
                isMandatory: input.isMandatory,
                teamId: input.teamId,
                discordChannelId: input.discordChannelId,
                requiredRankLevel: input.requiredRankLevel,
                organizedBy: String(ctx.dbUser.discordId),
              })
              .returning();

            return {
              success: true,
              meeting: result[0],
              message: "Meeting scheduled successfully",
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create meeting",
            });
          }
        }),

      // READ meetings list
      list: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          teamId: z.number().int().positive().optional(),
          includePast: z.boolean().default(false),
          limit: z.number().int().min(1).max(50).default(20),
          offset: z.number().int().min(0).default(0),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Check if user is member
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = member[0]!.permissions!;
            const canViewAllMeetings = permissions.view_all_meetings;

            // Build conditions
            const conditions = [eq(deptSchema.departmentMeetings.departmentId, input.departmentId)];

            // Time filter
            if (!input.includePast) {
              conditions.push(sql`${deptSchema.departmentMeetings.scheduledAt} >= NOW()`);
            }

            // Team filter
            if (input.teamId) {
              conditions.push(eq(deptSchema.departmentMeetings.teamId, input.teamId));
            } else if (!canViewAllMeetings) {
              // If user can't view all meetings, only show department-wide and their team meetings
              conditions.push(
                sql`${deptSchema.departmentMeetings.teamId} IS NULL OR ${deptSchema.departmentMeetings.teamId} = ${member[0]!.primaryTeamId}`
              );
            }

            const meetings = await postgrestDb
              .select({
                id: deptSchema.departmentMeetings.id,
                title: deptSchema.departmentMeetings.title,
                description: deptSchema.departmentMeetings.description,
                scheduledAt: deptSchema.departmentMeetings.scheduledAt,
                location: deptSchema.departmentMeetings.location,
                duration: deptSchema.departmentMeetings.duration,
                isMandatory: deptSchema.departmentMeetings.isMandatory,
                status: deptSchema.departmentMeetings.status,
                organizedBy: deptSchema.departmentMeetings.organizedBy,
                teamName: deptSchema.departmentTeams.name,
                attendeeCount: sql`COUNT(${deptSchema.departmentMeetingAttendance.id})`.as('attendeeCount'),
              })
              .from(deptSchema.departmentMeetings)
              .leftJoin(
                deptSchema.departmentTeams,
                eq(deptSchema.departmentMeetings.teamId, deptSchema.departmentTeams.id)
              )
              .leftJoin(
                deptSchema.departmentMeetingAttendance,
                eq(deptSchema.departmentMeetings.id, deptSchema.departmentMeetingAttendance.meetingId)
              )
              .where(and(...conditions))
              .groupBy(
                deptSchema.departmentMeetings.id,
                deptSchema.departmentTeams.name
              )
              .orderBy(asc(deptSchema.departmentMeetings.scheduledAt))
              .limit(input.limit)
              .offset(input.offset);

            return meetings;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch meetings",
            });
          }
        }),

      // READ meeting by ID with attendance
      getById: protectedProcedure
        .input(z.object({
          meetingId: z.number().int().positive(),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Get meeting and verify access
            const meeting = await postgrestDb
              .select({
                id: deptSchema.departmentMeetings.id,
                departmentId: deptSchema.departmentMeetings.departmentId,
                title: deptSchema.departmentMeetings.title,
                description: deptSchema.departmentMeetings.description,
                scheduledAt: deptSchema.departmentMeetings.scheduledAt,
                location: deptSchema.departmentMeetings.location,
                duration: deptSchema.departmentMeetings.duration,
                isMandatory: deptSchema.departmentMeetings.isMandatory,
                status: deptSchema.departmentMeetings.status,
                teamId: deptSchema.departmentMeetings.teamId,
                organizedBy: deptSchema.departmentMeetings.organizedBy,
                discordChannelId: deptSchema.departmentMeetings.discordChannelId,
                requiredRankLevel: deptSchema.departmentMeetings.requiredRankLevel,
                notes: deptSchema.departmentMeetings.notes,
                teamName: deptSchema.departmentTeams.name,
              })
              .from(deptSchema.departmentMeetings)
              .leftJoin(
                deptSchema.departmentTeams,
                eq(deptSchema.departmentMeetings.teamId, deptSchema.departmentTeams.id)
              )
              .where(eq(deptSchema.departmentMeetings.id, input.meetingId))
              .limit(1);

            if (meeting.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Meeting not found",
              });
            }

            const meetingData = meeting[0]!;

            // Check if user has access to this meeting
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, meetingData.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = member[0]!.permissions!;
            const canViewAllMeetings = permissions.view_all_meetings;

            // Check team-specific meeting access
            if (meetingData.teamId && !canViewAllMeetings && meetingData.teamId !== member[0]!.primaryTeamId) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have access to this team meeting",
              });
            }

            // Get attendance records
            const attendance = await postgrestDb
              .select({
                id: deptSchema.departmentMeetingAttendance.id,
                status: deptSchema.departmentMeetingAttendance.status,
                notes: deptSchema.departmentMeetingAttendance.notes,
                recordedAt: deptSchema.departmentMeetingAttendance.recordedAt,
                memberCallsign: deptSchema.departmentMembers.callsign,
                memberDiscordId: deptSchema.departmentMembers.discordId,
                rankName: deptSchema.departmentRanks.name,
              })
              .from(deptSchema.departmentMeetingAttendance)
              .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentMeetingAttendance.memberId, deptSchema.departmentMembers.id)
              )
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(eq(deptSchema.departmentMeetingAttendance.meetingId, input.meetingId))
              .orderBy(asc(deptSchema.departmentMembers.callsign));

            return {
              ...meetingData,
              attendance,
              userAttendance: attendance.find(a => a.memberDiscordId === String(ctx.dbUser.discordId)),
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch meeting details",
            });
          }
        }),

      // UPDATE meeting (requires manage_meetings permission)
      update: protectedProcedure
        .input(z.object({
          meetingId: z.number().int().positive(),
          title: z.string().min(1).max(256).optional(),
          description: z.string().optional().nullable(),
          scheduledAt: z.date().optional(),
          location: z.string().optional().nullable(),
          duration: z.number().int().min(1).optional(),
          isMandatory: z.boolean().optional(),
          status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
          discordChannelId: z.string().max(30).optional().nullable(),
          requiredRankLevel: z.number().int().min(1).optional().nullable(),
          notes: z.string().optional().nullable(),
        }))
        .mutation(async ({ ctx, input }) => {
          const { meetingId, ...updateData } = input;

          try {
            // Get meeting and verify permissions
            const meeting = await postgrestDb
              .select({
                departmentId: deptSchema.departmentMeetings.departmentId,
                organizedBy: deptSchema.departmentMeetings.organizedBy,
                status: deptSchema.departmentMeetings.status,
              })
              .from(deptSchema.departmentMeetings)
              .where(eq(deptSchema.departmentMeetings.id, meetingId))
              .limit(1);

            if (meeting.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Meeting not found",
              });
            }

            const meetingData = meeting[0]!;

            // Check permissions
            const member = await postgrestDb
              .select({
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, meetingData.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = member[0]!.permissions!;
            const canManage = permissions.manage_meetings || meetingData.organizedBy === String(ctx.dbUser.discordId);

            if (!canManage) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to edit this meeting",
              });
            }

            // Validate scheduled time if updating
            if (updateData.scheduledAt && updateData.scheduledAt < new Date()) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Cannot schedule meeting in the past",
              });
            }

            const result = await postgrestDb
              .update(deptSchema.departmentMeetings)
              .set(updateData)
              .where(eq(deptSchema.departmentMeetings.id, meetingId))
              .returning();

            return {
              success: true,
              meeting: result[0],
              message: "Meeting updated successfully",
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update meeting",
            });
          }
        }),

      // DELETE meeting (requires manage_meetings permission)
      delete: protectedProcedure
        .input(z.object({
          meetingId: z.number().int().positive(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            // Get meeting and verify permissions
            const meeting = await postgrestDb
              .select({
                departmentId: deptSchema.departmentMeetings.departmentId,
                organizedBy: deptSchema.departmentMeetings.organizedBy,
                status: deptSchema.departmentMeetings.status,
                title: deptSchema.departmentMeetings.title,
              })
              .from(deptSchema.departmentMeetings)
              .where(eq(deptSchema.departmentMeetings.id, input.meetingId))
              .limit(1);

            if (meeting.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Meeting not found",
              });
            }

            const meetingData = meeting[0]!;

            // Check permissions
            const member = await postgrestDb
              .select({
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, meetingData.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            const permissions = member[0]!.permissions!;
            const canDelete = permissions.manage_meetings || meetingData.organizedBy === String(ctx.dbUser.discordId);

            if (!canDelete) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You do not have permission to delete this meeting",
              });
            }

            // Don't allow deletion of completed meetings (for audit trail)
            if (meetingData.status === 'completed') {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Cannot delete completed meetings",
              });
            }

            // Delete attendance records first
              await postgrestDb
              .delete(deptSchema.departmentMeetingAttendance)
              .where(eq(deptSchema.departmentMeetingAttendance.meetingId, input.meetingId));

            // Delete meeting
            await postgrestDb
              .delete(deptSchema.departmentMeetings)
              .where(eq(deptSchema.departmentMeetings.id, input.meetingId));

            return {
              success: true,
              message: `Meeting "${meetingData.title}" deleted successfully`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to delete meeting",
            });
          }
        }),

      // Record attendance (requires take_attendance permission or self-check-in)
      recordAttendance: protectedProcedure
        .input(z.object({
          meetingId: z.number().int().positive(),
          attendeeDiscordId: z.string().optional(), // If not provided, records for self
          status: z.enum(['present', 'absent', 'excused', 'late']),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          try {
            const targetDiscordId = input.attendeeDiscordId ?? String(ctx.dbUser.discordId);
            const isRecordingForSelf = targetDiscordId === String(ctx.dbUser.discordId);

            // Get meeting info
            const meeting = await postgrestDb
              .select({
                departmentId: deptSchema.departmentMeetings.departmentId,
                status: deptSchema.departmentMeetings.status,
                scheduledAt: deptSchema.departmentMeetings.scheduledAt,
                title: deptSchema.departmentMeetings.title,
              })
              .from(deptSchema.departmentMeetings)
              .where(eq(deptSchema.departmentMeetings.id, input.meetingId))
              .limit(1);

            if (meeting.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Meeting not found",
              });
            }

            const meetingData = meeting[0]!;

            // Get recorder's permissions
            const recorder = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                permissions: deptSchema.departmentRanks.permissions,
              })
              .from(deptSchema.departmentMembers)
              .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
              )
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, meetingData.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (recorder.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            // Check permissions for recording others' attendance
            if (!isRecordingForSelf) {
              const permissions = recorder[0]!.permissions!;
              if (!permissions.take_attendance) {
                throw new TRPCError({
                  code: "FORBIDDEN",
                  message: "You do not have permission to record attendance for others",
                });
              }
            }

            // Get attendee member info
            const attendee = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                callsign: deptSchema.departmentMembers.callsign,
              })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, targetDiscordId),
                  eq(deptSchema.departmentMembers.departmentId, meetingData.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (attendee.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Attendee is not an active member of this department",
              });
            }

            // Upsert attendance record
            const result = await postgrestDb
              .insert(deptSchema.departmentMeetingAttendance)
              .values({
                meetingId: input.meetingId,
                memberId: attendee[0]!.id,
                status: input.status,
                notes: input.notes,
                recordedBy: String(ctx.dbUser.discordId),
              })
              .onConflictDoUpdate({
                target: [
                  deptSchema.departmentMeetingAttendance.meetingId,
                  deptSchema.departmentMeetingAttendance.memberId
                ],
                set: {
                  status: input.status,
                  notes: input.notes,
                  recordedBy: String(ctx.dbUser.discordId),
                  recordedAt: new Date(),
                },
              })
              .returning();

            return {
              success: true,
              attendance: result[0],
              message: `Attendance recorded for ${attendee[0]!.callsign}: ${input.status}`,
            };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to record attendance",
            });
          }
        }),

      // Get my upcoming meetings
      getMyUpcoming: protectedProcedure
        .input(z.object({
          departmentId: z.number().int().positive(),
          limit: z.number().int().min(1).max(20).default(10),
        }))
        .query(async ({ ctx, input }) => {
          try {
            // Get member info
            const member = await postgrestDb
              .select({
                id: deptSchema.departmentMembers.id,
                primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
              })
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                  eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (member.length === 0) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You are not a member of this department",
              });
            }

            // Get upcoming meetings (department-wide or my team)
            const meetings = await postgrestDb
              .select({
                id: deptSchema.departmentMeetings.id,
                title: deptSchema.departmentMeetings.title,
                scheduledAt: deptSchema.departmentMeetings.scheduledAt,
                location: deptSchema.departmentMeetings.location,
                duration: deptSchema.departmentMeetings.duration,
                isMandatory: deptSchema.departmentMeetings.isMandatory,
                teamName: deptSchema.departmentTeams.name,
                myAttendanceStatus: deptSchema.departmentMeetingAttendance.status,
              })
              .from(deptSchema.departmentMeetings)
              .leftJoin(
                deptSchema.departmentTeams,
                eq(deptSchema.departmentMeetings.teamId, deptSchema.departmentTeams.id)
              )
              .leftJoin(
                deptSchema.departmentMeetingAttendance,
                and(
                  eq(deptSchema.departmentMeetingAttendance.meetingId, deptSchema.departmentMeetings.id),
                  eq(deptSchema.departmentMeetingAttendance.memberId, member[0]!.id)
                )
              )
              .where(
                and(
                  eq(deptSchema.departmentMeetings.departmentId, input.departmentId),
                  sql`${deptSchema.departmentMeetings.scheduledAt} >= NOW()`,
                  eq(deptSchema.departmentMeetings.status, 'scheduled'),
                  sql`${deptSchema.departmentMeetings.teamId} IS NULL OR ${deptSchema.departmentMeetings.teamId} = ${member[0]!.primaryTeamId}`
                )
              )
              .orderBy(asc(deptSchema.departmentMeetings.scheduledAt))
              .limit(input.limit);

            return meetings;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch upcoming meetings",
            });
          }
        }),
    }),
  }),

  // ===== DEPARTMENT DISCOVERY FOR USERS =====
  discovery: createTRPCRouter({
    // List available departments user can join
    listAvailableDepartments: protectedProcedure
      .input(z.object({
        type: deptSchema.departmentTypeEnum.optional(),
        includeAlreadyJoined: z.boolean().default(false),
      }).optional())
      .query(async ({ ctx, input }) => {
        try {
          // Get departments user is already a member of
          const existingMemberships = await postgrestDb
            .select({
              departmentId: deptSchema.departmentMembers.departmentId,
            })
            .from(deptSchema.departmentMembers)
            .where(
              and(
                eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                eq(deptSchema.departmentMembers.isActive, true)
              )
            );

          const memberDepartmentIds = existingMemberships.map(m => m.departmentId);

          // Build conditions
          const conditions = [eq(deptSchema.departments.isActive, true)];
          
          if (input?.type) {
            conditions.push(eq(deptSchema.departments.type, input.type));
          }

          if (!input?.includeAlreadyJoined && memberDepartmentIds.length > 0) {
            conditions.push(sql`${deptSchema.departments.id} NOT IN (${sql.join(memberDepartmentIds, sql`, `)})`);
          }

          // Get available departments with basic stats
          const departments = await postgrestDb
            .select({
              id: deptSchema.departments.id,
              name: deptSchema.departments.name,
              type: deptSchema.departments.type,
              description: deptSchema.departments.description,
              callsignPrefix: deptSchema.departments.callsignPrefix,
              memberCount: sql`COUNT(${deptSchema.departmentMembers.id})`.as('memberCount'),
              isAlreadyMember: sql`CASE WHEN ${memberDepartmentIds.length > 0 ? sql`${deptSchema.departments.id} IN (${sql.join(memberDepartmentIds, sql`, `)})` : sql`FALSE`} THEN true ELSE false END`.as('isAlreadyMember'),
            })
            .from(deptSchema.departments)
            .leftJoin(
              deptSchema.departmentMembers,
              and(
                eq(deptSchema.departments.id, deptSchema.departmentMembers.departmentId),
                eq(deptSchema.departmentMembers.isActive, true)
              )
            )
            .where(and(...conditions))
            .groupBy(deptSchema.departments.id)
            .orderBy(asc(deptSchema.departments.name));

          return departments;
        } catch (error) {
          console.error('listAvailableDepartments error:', error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch available departments",
          });
        }
      }),

    // Get detailed department info (for prospective members)
    getDepartmentInfo: protectedProcedure
      .input(z.object({
        departmentId: z.number().int().positive(),
      }))
      .query(async ({ ctx, input }) => {
        try {
          // Get department info
          const department = await postgrestDb
            .select()
            .from(deptSchema.departments)
            .where(
              and(
                eq(deptSchema.departments.id, input.departmentId),
                eq(deptSchema.departments.isActive, true)
              )
            )
            .limit(1);

          if (department.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Department not found or inactive",
            });
          }

          // Check if user is already a member
          const existingMembership = await postgrestDb
            .select({
              status: deptSchema.departmentMembers.status,
              rankName: deptSchema.departmentRanks.name,
            })
            .from(deptSchema.departmentMembers)
            .leftJoin(
              deptSchema.departmentRanks,
              eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
            )
            .where(
              and(
                eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                eq(deptSchema.departmentMembers.isActive, true)
              )
            )
            .limit(1);

          // Get teams (for information)
          const teams = await postgrestDb
            .select({
              id: deptSchema.departmentTeams.id,
              name: deptSchema.departmentTeams.name,
              description: deptSchema.departmentTeams.description,
              memberCount: sql`COUNT(${deptSchema.departmentTeamMemberships.id})`.as('memberCount'),
            })
            .from(deptSchema.departmentTeams)
            .leftJoin(
              deptSchema.departmentTeamMemberships,
              eq(deptSchema.departmentTeams.id, deptSchema.departmentTeamMemberships.teamId)
            )
            .where(
              and(
                eq(deptSchema.departmentTeams.departmentId, input.departmentId),
                eq(deptSchema.departmentTeams.isActive, true)
              )
            )
            .groupBy(deptSchema.departmentTeams.id)
            .orderBy(asc(deptSchema.departmentTeams.name));

          // Get ranks (for information)
          const ranks = await postgrestDb
            .select({
              id: deptSchema.departmentRanks.id,
              name: deptSchema.departmentRanks.name,
              level: deptSchema.departmentRanks.level,
              memberCount: sql`COUNT(${deptSchema.departmentMembers.id})`.as('memberCount'),
            })
            .from(deptSchema.departmentRanks)
            .leftJoin(
              deptSchema.departmentMembers,
              and(
                eq(deptSchema.departmentRanks.id, deptSchema.departmentMembers.rankId),
                eq(deptSchema.departmentMembers.isActive, true)
              )
            )
            .where(
              and(
                eq(deptSchema.departmentRanks.departmentId, input.departmentId),
                eq(deptSchema.departmentRanks.isActive, true)
              )
            )
            .groupBy(deptSchema.departmentRanks.id)
            .orderBy(desc(deptSchema.departmentRanks.level));

          return {
            ...department[0],
            teams,
            ranks,
            existingMembership: existingMembership[0] ?? null,
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch department information",
          });
        }
      }),

    // Join department (puts user in "need_training" status)
    joinDepartment: protectedProcedure
      .input(z.object({
        departmentId: z.number().int().positive(),
        roleplayName: z.string().min(1, "Roleplay name is required").max(100, "Roleplay name must be 100 characters or less").optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          // Verify department exists and is active
          const department = await postgrestDb
            .select()
            .from(deptSchema.departments)
            .where(
              and(
                eq(deptSchema.departments.id, input.departmentId),
                eq(deptSchema.departments.isActive, true)
              )
            )
            .limit(1);

          if (department.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Department not found or inactive",
            });
          }

          // Check if user is already a member
          const existingMember = await postgrestDb
            .select()
            .from(deptSchema.departmentMembers)
            .where(
              and(
                eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                eq(deptSchema.departmentMembers.departmentId, input.departmentId)
              )
            )
            .limit(1);

          if (existingMember.length > 0) {
            const member = existingMember[0]!;
            if (member.isActive) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "You are already a member of this department",
              });
            } else {
              // Reactivate inactive membership
              const result = await postgrestDb
                .update(deptSchema.departmentMembers)
                .set({
                  isActive: true,
                  status: "in_training",
                  roleplayName: input.roleplayName,
                  notes: input.notes,
                  hireDate: new Date(),
                })
                .where(eq(deptSchema.departmentMembers.id, member.id))
                .returning();

              return {
                success: true,
                member: result[0],
                message: "Successfully rejoined department. You are now pending training.",
              };
            }
          }

          // Get next available ID number
          const departmentIdNumber = await getNextAvailableIdNumber(input.departmentId);

          // Generate basic callsign without rank (since no rank assigned yet)
          const callsign = generateCallsign("0", department[0]!.callsignPrefix, departmentIdNumber);

          // Mark the ID number as unavailable
          await postgrestDb
            .update(deptSchema.departmentIdNumbers)
            .set({
              isAvailable: false,
              lastAssignedTo: String(ctx.dbUser.discordId),
              lastAssignedAt: new Date(),
            })
            .where(
              and(
                eq(deptSchema.departmentIdNumbers.departmentId, input.departmentId),
                eq(deptSchema.departmentIdNumbers.idNumber, departmentIdNumber)
              )
            );

          // Create member record with no rank (in_training status)
          const result = await postgrestDb
            .insert(deptSchema.departmentMembers)
            .values({
              discordId: String(ctx.dbUser.discordId),
              departmentId: input.departmentId,
              roleplayName: input.roleplayName,
              departmentIdNumber,
              callsign,
              status: "in_training",
              rankId: null, // No rank until training is completed
              notes: input.notes,
            })
            .returning();

          // Update the ID number record to reference this member
          await postgrestDb
            .update(deptSchema.departmentIdNumbers)
            .set({ currentMemberId: result[0]!.id })
            .where(
              and(
                eq(deptSchema.departmentIdNumbers.departmentId, input.departmentId),
                eq(deptSchema.departmentIdNumbers.idNumber, departmentIdNumber)
              )
            );

          return {
            success: true,
            member: result[0],
            message: `Successfully joined ${department[0]!.name}. You are now pending training.`,
          };
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
            message: "Failed to join department",
            });
          }
        }),

    // Get my department memberships and their status
    getMyMemberships: protectedProcedure
      .query(async ({ ctx }) => {
        try {
          const memberships = await postgrestDb
            .select({
              id: deptSchema.departmentMembers.id,
              departmentId: deptSchema.departmentMembers.departmentId,
              departmentName: deptSchema.departments.name,
              departmentType: deptSchema.departments.type,
              roleplayName: deptSchema.departmentMembers.roleplayName,
              callsign: deptSchema.departmentMembers.callsign,
              status: deptSchema.departmentMembers.status,
              hireDate: deptSchema.departmentMembers.hireDate,
              rankName: deptSchema.departmentRanks.name,
              rankLevel: deptSchema.departmentRanks.level,
              teamName: deptSchema.departmentTeams.name,
              isActive: deptSchema.departmentMembers.isActive,
            })
            .from(deptSchema.departmentMembers)
            .innerJoin(
              deptSchema.departments,
              eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id)
            )
            .leftJoin(
              deptSchema.departmentRanks,
              eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
            )
            .leftJoin(
              deptSchema.departmentTeams,
              eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
            )
            .where(eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)))
            .orderBy(asc(deptSchema.departments.name));

          return memberships;
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch memberships",
          });
        }
      }),
  }),

  // ===== DISCORD INTEGRATION ENDPOINTS =====
  discord: createTRPCRouter({
    // Webhook endpoint for Discord role changes (API key protected)
    webhook: publicProcedure
      .input(discordWebhookSchema)
      .mutation(async ({ input }) => {
        try {
          // Validate API key (same as training API key for now)
          if (!validateApiKey(input.apiKey)) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid API key",
            });
          }

          // Update user's rank based on current Discord roles
          const result = await updateUserRankFromDiscordRoles(input.discordId);

          return {
            success: result.success,
            message: result.message,
            updatedDepartments: result.updatedDepartments,
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to process Discord webhook",
          });
        }
      }),

    // Update user rank by Discord ID (API key protected)
    updateRankByDiscordId: publicProcedure
      .input(updateRankByDiscordIdSchema.extend({
        apiKey: z.string().min(1, "API key is required"),
      }))
      .mutation(async ({ input }) => {
        try {
          // Validate API key
          if (!validateApiKey(input.apiKey)) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid API key",
            });
          }

          const result = await updateUserRankFromDiscordRoles(input.discordId, input.departmentId);

          return {
            success: result.success,
            message: result.message,
            updatedDepartments: result.updatedDepartments,
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update rank by Discord ID",
          });
        }
      }),

    // Update team by Discord ID (API key protected)
    updateTeamByDiscordId: publicProcedure
      .input(updateTeamByDiscordIdSchema.extend({
        apiKey: z.string().min(1, "API key is required"),
      }))
      .mutation(async ({ input }) => {
        try {
          // Validate API key
          if (!validateApiKey(input.apiKey)) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid API key",
            });
          }

          const result = await updateUserTeamFromDiscordRoles(input.discordId, input.departmentId);

          return {
            success: result.success,
            message: result.message,
            updatedDepartments: result.updatedDepartments,
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update team by Discord ID",
          });
        }
      }),

    // Comprehensive sync endpoint for when Discord roles change
    syncUserRoles: publicProcedure
      .input(z.object({
        apiKey: z.string().min(1, "API key is required"),
        discordId: z.string().min(1, "Discord ID is required"),
        departmentId: z.number().int().positive().optional(),
        syncType: z.enum(['both', 'rank_only', 'team_only']).default('both'),
        skipDelay: z.boolean().default(false), // For internal calls that already waited
      }))
      .mutation(async ({ input }) => {
        try {
          console.log(`🔄 Comprehensive Discord role sync initiated for user ${input.discordId}`);
          
          // Validate API key
          if (!validateApiKey(input.apiKey)) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid API key",
            });
          }

          // Optional delay for Discord propagation (unless skipped)
          if (!input.skipDelay && DISCORD_SYNC_FEATURE_FLAGS.ENABLE_AUTO_SYNC_AFTER_ROLE_CHANGE) {
            console.log(`⏳ Waiting ${DISCORD_SYNC_FEATURE_FLAGS.SYNC_DELAY_MS}ms for Discord role propagation...`);
            await new Promise(resolve => setTimeout(resolve, DISCORD_SYNC_FEATURE_FLAGS.SYNC_DELAY_MS));
          }

          const results: {
            rankSync?: Awaited<ReturnType<typeof updateUserRankFromDiscordRoles>>;
            teamSync?: Awaited<ReturnType<typeof updateUserTeamFromDiscordRoles>>;
          } = {};

          // Sync ranks if requested
          if (input.syncType === 'both' || input.syncType === 'rank_only') {
            console.log('🎭 Syncing user ranks from Discord roles...');
            results.rankSync = await updateUserRankFromDiscordRoles(input.discordId, input.departmentId);
          }

          // Sync teams if requested
          if (input.syncType === 'both' || input.syncType === 'team_only') {
            console.log('👥 Syncing user teams from Discord roles...');
            results.teamSync = await updateUserTeamFromDiscordRoles(input.discordId, input.departmentId);
          }

          // Aggregate results
          const allUpdatedDepartments = [
            ...(results.rankSync?.updatedDepartments ?? []),
            ...(results.teamSync?.updatedDepartments ?? [])
          ];

          const overallSuccess = (results.rankSync?.success ?? true) && (results.teamSync?.success ?? true);
          
          const messages = [
            results.rankSync?.message,
            results.teamSync?.message
          ].filter(Boolean);

          console.log(`✅ Discord role sync completed. Success: ${overallSuccess}`);

          return {
            success: overallSuccess,
            message: messages.length > 0 ? messages.join(' | ') : 'No changes needed',
            syncResults: results,
            totalUpdatedDepartments: allUpdatedDepartments.length,
            updatedDepartments: allUpdatedDepartments,
          };
        } catch (error) {
          console.error('💥 Discord role sync failed:', error);
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to sync user roles from Discord",
          });
        }
      }),
  }),

  // ===== PUBLIC TRAINING ENDPOINTS (API KEY PROTECTED) =====
  training: createTRPCRouter({
    // Complete training - move user from in_training to pending
    completeTraining: publicProcedure
      .input(trainingCompletionSchema)
      .mutation(async ({ input }) => {
        try {
          // Validate API key
          if (!validateApiKey(input.apiKey)) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid API key",
            });
          }

          // Find the member
          const member = await postgrestDb
            .select()
            .from(deptSchema.departmentMembers)
            .where(
              and(
                eq(deptSchema.departmentMembers.discordId, input.discordId),
                eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                eq(deptSchema.departmentMembers.isActive, true),
                eq(deptSchema.departmentMembers.status, "in_training")
              )
            )
            .limit(1);

          if (member.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Member not found or not in training status",
            });
          }

          // Update status to pending
          const result = await postgrestDb
            .update(deptSchema.departmentMembers)
            .set({ 
              status: "pending",
              lastActiveDate: new Date(),
            })
            .where(eq(deptSchema.departmentMembers.id, member[0]!.id))
            .returning();

          return {
            success: true,
            member: result[0],
            message: "Training completed successfully. Member is now pending team assignment.",
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to complete training",
          });
        }
      }),
  }),
});



