import { z } from "zod";
import { eq, and, desc, asc, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { adminProcedure, protectedProcedure, publicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import type { RankLimitInfo, RankLimitValidationResult } from "@/server/postgres/schema/department";
import { env } from "@/env";
import axios from "axios";

const API_BASE_URL = (env.INTERNAL_API_URL as string | undefined) ?? "http://localhost:8000";
const M2M_API_KEY = env.M2M_API_KEY as string | undefined;

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

// Utility function to call Discord role management API
const manageDiscordRole = async (action: 'add' | 'remove', userDiscordId: string, roleId: string, serverId: string): Promise<void> => {
  try {
    if (!M2M_API_KEY) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "M2M API key not configured",
      });
    }

    const response = await axios.post(
      `${API_BASE_URL}/discord_role_router/manage`,
      {
        action,
        user_discord_id: userDiscordId,
        role_id: roleId,
        server_id: serverId,
      },
      {
        headers: { "X-API-Key": M2M_API_KEY },
      }
    );

    console.log(`Discord role ${action} successful:`, response.data);
  } catch (error) {
    console.error(`Discord role ${action} failed:`, error);
    // Don't throw error to prevent blocking database operations
    // Just log the error for monitoring
  }
};

// Utility function to get server ID from role ID
const getServerIdFromRoleId = async (roleId: string): Promise<string | null> => {
  try {
    if (!M2M_API_KEY) {
      return null;
    }

    const response = await axios.get(
      `${API_BASE_URL}/admin/roles/${roleId}`,
      {
        headers: { "X-API-Key": M2M_API_KEY },
      }
    );

    // Check if response.data exists and has server_id property
    if (response.data && typeof response.data === 'object' && 'server_id' in response.data) {
      const serverId = (response.data as { server_id: unknown }).server_id;
      return typeof serverId === 'string' ? serverId : null;
    }
    return null;
  } catch (error) {
    console.error("Failed to get server ID from role ID:", error);
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
    // Get user's current Discord roles
    let userRoles: Array<{ roleId: string; serverId: string; }> = [];
    
    try {
      if (M2M_API_KEY) {
        const rolesResponse = await axios.get(
          `${API_BASE_URL}/admin/user_server_roles/`,
          {
            params: { user_discord_id: discordId },
            headers: { "X-API-Key": M2M_API_KEY },
          }
        );
        userRoles = rolesResponse.data as Array<{ roleId: string; serverId: string; }> ?? [];
      }
    } catch (error) {
      console.error("Failed to fetch user Discord roles:", error);
      // Continue with empty roles array
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
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(deptSchema.departments, eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id))
      .where(and(...departmentConditions, eq(deptSchema.departmentMembers.isActive, true)));

    const updatedDepartments: Array<{ departmentId: number; newRankId: number | null; oldRankId: number | null; }> = [];

    for (const membership of memberships) {
      // Get all ranks for this department with their Discord role IDs
      const departmentRanks = await postgrestDb
        .select({
          id: deptSchema.departmentRanks.id,
          discordRoleId: deptSchema.departmentRanks.discordRoleId,
          level: deptSchema.departmentRanks.level,
        })
        .from(deptSchema.departmentRanks)
        .where(
          and(
            eq(deptSchema.departmentRanks.departmentId, membership.departmentId),
            eq(deptSchema.departmentRanks.isActive, true),
            isNotNull(deptSchema.departmentRanks.discordRoleId)
          )
        )
        .orderBy(desc(deptSchema.departmentRanks.level)); // Highest level first

      // Find the highest rank the user has based on their Discord roles
      let newRankId: number | null = null;
      
      for (const rank of departmentRanks) {
        const hasRole = userRoles.some(
          userRole => userRole.roleId === rank.discordRoleId && userRole.serverId === membership.discordGuildId
        );
        
        if (hasRole) {
          newRankId = rank.id;
          break; // Take the highest level rank they have
        }
      }

      // Update rank if it has changed
      if (newRankId !== membership.currentRankId) {
        await postgrestDb
          .update(deptSchema.departmentMembers)
          .set({ rankId: newRankId })
          .where(eq(deptSchema.departmentMembers.id, membership.memberId));

        updatedDepartments.push({
          departmentId: membership.departmentId,
          newRankId,
          oldRankId: membership.currentRankId,
        });
      }
    }

    return {
      success: true,
      updatedDepartments,
      message: updatedDepartments.length > 0 
        ? `Updated ranks in ${updatedDepartments.length} department(s)`
        : "No rank changes needed",
    };
  } catch (error) {
    console.error("Failed to update user rank from Discord roles:", error);
    return {
      success: false,
      updatedDepartments: [],
      message: "Failed to update ranks from Discord roles",
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
      reason: "Failed to validate rank limit",
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
      message: "Failed to get rank limit information",
    });
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
              message: "Failed to fetch departments",
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
            const [ranks, teams, members] = await Promise.all([
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
                .select()
                .from(deptSchema.departmentMembers)
                .where(eq(deptSchema.departmentMembers.departmentId, input.id))
                .orderBy(asc(deptSchema.departmentMembers.callsign)),
            ]);

            return {
              ...department[0],
              ranks,
              teams,
              members,
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

      // DELETE department (soft delete)
      delete: adminProcedure
        .input(z.object({ id: z.number().int().positive() }))
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

            // Check if department has active members
            const activeMembers = await postgrestDb
              .select()
              .from(deptSchema.departmentMembers)
              .where(
                and(
                  eq(deptSchema.departmentMembers.departmentId, input.id),
                  eq(deptSchema.departmentMembers.isActive, true)
                )
              )
              .limit(1);

            if (activeMembers.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Cannot delete department with active members",
              });
            }

            // Soft delete (set isActive to false)
            const result = await postgrestDb
              .update(deptSchema.departments)
              .set({ isActive: false })
              .where(eq(deptSchema.departments.id, input.id))
              .returning();

            return result[0];
          } catch (error) {
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
              message: "Failed to fetch ranks",
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
              message: "Failed to fetch teams",
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

            const discordGuildId = department[0]!.discordGuildId;

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
                for (const member of teamMembers) {
                  await manageDiscordRole('remove', member.discordId, currentTeam.discordRoleId, discordGuildId);
                }
              }

              // Add new Discord role to all members
              if (updatedTeam.discordRoleId) {
                for (const member of teamMembers) {
                  await manageDiscordRole('add', member.discordId, updatedTeam.discordRoleId, discordGuildId);
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
            const department = await postgrestDb
              .select({ discordGuildId: deptSchema.departments.discordGuildId })
              .from(deptSchema.departments)
              .where(eq(deptSchema.departments.id, team.departmentId))
              .limit(1);

            // Remove Discord role from all team members before deleting
            if (team.discordRoleId && department.length > 0) {
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

              const discordGuildId = department[0]!.discordGuildId;

              for (const member of teamMembers) {
                await manageDiscordRole('remove', member.discordId, team.discordRoleId, discordGuildId);
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

            // Add team membership
            const result = await postgrestDb
              .insert(deptSchema.departmentTeamMemberships)
              .values({
                memberId: input.memberId,
                teamId: input.teamId,
                isLeader: input.isLeader,
              })
              .returning();

            // Add Discord role if team has one and member is active
            if (team[0]!.discordRoleId && memberData.isActive) {
              const department = await postgrestDb
                .select({ discordGuildId: deptSchema.departments.discordGuildId })
                .from(deptSchema.departments)
                .where(eq(deptSchema.departments.id, team[0]!.departmentId))
                .limit(1);

              if (department.length > 0) {
                await manageDiscordRole(
                  'add',
                  memberData.discordId,
                  team[0]!.discordRoleId,
                  department[0]!.discordGuildId
                );
              }
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

            // Remove team membership
            await postgrestDb
              .delete(deptSchema.departmentTeamMemberships)
              .where(eq(deptSchema.departmentTeamMemberships.id, membershipData.membershipId));

            // Remove Discord role if team has one
            if (membershipData.teamDiscordRoleId) {
              const department = await postgrestDb
                .select({ discordGuildId: deptSchema.departments.discordGuildId })
                .from(deptSchema.departments)
                .where(eq(deptSchema.departments.id, membershipData.departmentId))
                .limit(1);

              if (department.length > 0) {
                await manageDiscordRole(
                  'remove',
                  membershipData.discordId,
                  membershipData.teamDiscordRoleId,
                  department[0]!.discordGuildId
                );
              }
            }

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

            const discordGuildId = department[0]!.discordGuildId;

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
                await manageDiscordRole(
                  'add',
                  member.discordId,
                  teamData.discordRoleId,
                  discordGuildId
                );
                syncedCount++;
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
              throw new TRPCError({
                code: "CONFLICT",
                message: "User is already a member of this department",
              });
            }

            // Get next available ID number
            const departmentIdNumber = await getNextAvailableIdNumber(input.departmentId);

            // Generate callsign - need rank callsign
            let callsign: string;
            let rankCallsign = "0"; // Default if no rank

            // Get rank callsign if rank is provided
            if (input.rankId) {
              const rank = await postgrestDb
                .select({ callsign: deptSchema.departmentRanks.callsign })
                .from(deptSchema.departmentRanks)
                .where(eq(deptSchema.departmentRanks.id, input.rankId))
                .limit(1);
              
              if (rank.length > 0) {
                rankCallsign = rank[0]!.callsign;
              }
            }

            if (input.primaryTeamId) {
              const team = await postgrestDb
                .select()
                .from(deptSchema.departmentTeams)
                .where(eq(deptSchema.departmentTeams.id, input.primaryTeamId))
                .limit(1);
              
              if (team.length > 0 && team[0]!.callsignPrefix) {
                callsign = generateCallsign(
                  rankCallsign,
                  department[0]!.callsignPrefix,
                  departmentIdNumber,
                  team[0]!.callsignPrefix
                );
              } else {
                callsign = generateCallsign(rankCallsign, department[0]!.callsignPrefix, departmentIdNumber);
              }
            } else {
              callsign = generateCallsign(rankCallsign, department[0]!.callsignPrefix, departmentIdNumber);
            }

            // Mark the ID number as unavailable
            await postgrestDb
              .update(deptSchema.departmentIdNumbers)
              .set({ 
                isAvailable: false,
                lastAssignedTo: input.discordId,
                lastAssignedAt: new Date()
              })
              .where(
                and(
                  eq(deptSchema.departmentIdNumbers.departmentId, input.departmentId),
                  eq(deptSchema.departmentIdNumbers.idNumber, departmentIdNumber)
                )
              );

            const result = await postgrestDb
              .insert(deptSchema.departmentMembers)
              .values({
                discordId: input.discordId,
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

            return result[0];
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

            const departmentData = department[0]!;

            // Handle Discord role changes for primary team changes
            if (updateData.primaryTeamId !== undefined && updateData.primaryTeamId !== currentMember.primaryTeamId) {
              // Remove old primary team Discord role if member had one
              if (currentMember.primaryTeamId) {
                const oldTeam = await postgrestDb
                  .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
                  .from(deptSchema.departmentTeams)
                  .where(eq(deptSchema.departmentTeams.id, currentMember.primaryTeamId))
                  .limit(1);

                if (oldTeam.length > 0 && oldTeam[0]!.discordRoleId) {
                  await manageDiscordRole(
                    'remove',
                    currentMember.discordId,
                    oldTeam[0]!.discordRoleId,
                    departmentData.discordGuildId
                  );
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
                  await manageDiscordRole(
                    'add',
                    currentMember.discordId,
                    newTeam[0]!.discordRoleId,
                    departmentData.discordGuildId
                  );
                }
              }
            }

            // Prepare update data with proper null handling
            const memberUpdateData: Partial<Pick<typeof deptSchema.departmentMembers.$inferInsert, 'roleplayName' | 'rankId' | 'badgeNumber' | 'primaryTeamId' | 'status' | 'notes' | 'isActive' | 'callsign'>> = {};
            
            // Handle null values properly for nullable fields
            if (updateData.roleplayName !== undefined) {
              memberUpdateData.roleplayName = updateData.roleplayName;
            }
            if (updateData.rankId !== undefined) {
              memberUpdateData.rankId = updateData.rankId;
            }
            if (updateData.badgeNumber !== undefined) {
              memberUpdateData.badgeNumber = updateData.badgeNumber;
            }
            if (updateData.primaryTeamId !== undefined) {
              memberUpdateData.primaryTeamId = updateData.primaryTeamId;
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

            // If rank or team is changing, update callsign
            if (updateData.rankId !== undefined || updateData.primaryTeamId !== undefined) {
              // Determine the rank to use (new rank or current rank)
              const rankIdToUse = updateData.rankId !== undefined ? updateData.rankId : currentMember.rankId;
              
              // Determine the team to use (new team or current team)
              const teamIdToUse = updateData.primaryTeamId !== undefined ? updateData.primaryTeamId : currentMember.primaryTeamId;

              // Get rank callsign
              let rankCallsign = "0"; // Default if no rank
              if (rankIdToUse) {
                const rank = await postgrestDb
                  .select({ callsign: deptSchema.departmentRanks.callsign })
                  .from(deptSchema.departmentRanks)
                  .where(eq(deptSchema.departmentRanks.id, rankIdToUse))
                  .limit(1);
                
                if (rank.length > 0) {
                  rankCallsign = rank[0]!.callsign;
                }
              }

              // Get team callsign if applicable
              let teamCallsign: string | undefined;
              if (teamIdToUse) {
                const team = await postgrestDb
                  .select({ callsignPrefix: deptSchema.departmentTeams.callsignPrefix })
                  .from(deptSchema.departmentTeams)
                  .where(eq(deptSchema.departmentTeams.id, teamIdToUse))
                  .limit(1);
                
                if (team.length > 0 && team[0]!.callsignPrefix) {
                  teamCallsign = team[0]!.callsignPrefix;
                }
              }

              // Generate new callsign
              const newCallsign = generateCallsign(
                rankCallsign,
                departmentData.callsignPrefix,
                currentMember.departmentIdNumber ?? undefined,
                teamCallsign
              );

              memberUpdateData.callsign = newCallsign;
            }

            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set(memberUpdateData)
              .where(eq(deptSchema.departmentMembers.id, id))
              .returning();

            return result[0];
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
              message: "Failed to fetch department analytics",
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

            // Get department info for callsign generation and Discord operations
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

            const departmentData = department[0]!;

            // Get member's current rank callsign
            let rankCallsign = "0"; // Default if no rank
            if (memberData.rankId) {
              const rank = await postgrestDb
                .select({ callsign: deptSchema.departmentRanks.callsign })
                .from(deptSchema.departmentRanks)
                .where(eq(deptSchema.departmentRanks.id, memberData.rankId))
                .limit(1);
              
              if (rank.length > 0) {
                rankCallsign = rank[0]!.callsign;
              }
            }

            // Generate new callsign with team
            const newCallsign = generateCallsign(
              rankCallsign,
              departmentData.callsignPrefix,
              memberData.departmentIdNumber ?? undefined,
              teamData.callsignPrefix ?? undefined
            );

            // Handle Discord role changes for primary team assignment
            // Remove old primary team role if member had one
            if (memberData.primaryTeamId && memberData.primaryTeamId !== input.teamId) {
              const oldTeam = await postgrestDb
                .select({ discordRoleId: deptSchema.departmentTeams.discordRoleId })
                .from(deptSchema.departmentTeams)
                .where(eq(deptSchema.departmentTeams.id, memberData.primaryTeamId))
                .limit(1);

              if (oldTeam.length > 0 && oldTeam[0]!.discordRoleId) {
                await manageDiscordRole(
                  'remove',
                  memberData.discordId,
                  oldTeam[0]!.discordRoleId,
                  departmentData.discordGuildId
                );
              }
            }

            // Update member with team assignment and activate
            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({
                primaryTeamId: input.teamId,
                callsign: newCallsign,
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

            // Add new primary team Discord role
            if (teamData.discordRoleId) {
              await manageDiscordRole(
                'add',
                memberData.discordId,
                teamData.discordRoleId,
                departmentData.discordGuildId
              );
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
            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({ 
                status: input.status,
                lastActiveDate: new Date(),
              })
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .returning();

            if (result.length === 0) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Member not found",
              });
            }

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
                eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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

            // Check if promoter has sufficient rank level (can't promote above their own level)
            if (targetRank[0]!.level >= promoter[0]!.level!) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You cannot promote someone to a rank equal to or higher than your own",
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
              promotedBy: ctx.session.user.id,
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

              // Return success - webhook will update database when Discord bot detects changes
              return {
                success: true,
                message: "Promotion successful. Discord roles updated.",
                memberId: input.memberId,
                fromRankId: member.currentRankId,
                toRankId: input.toRankId,
                discordId: member.discordId,
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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

            // Check if demoter has sufficient rank level
            if (member.currentRankLevel && member.currentRankLevel >= demoter[0]!.level!) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "You cannot demote someone of equal or higher rank",
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
              promotedBy: ctx.session.user.id,
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

              // Return success - webhook will update database when Discord bot detects changes
              return {
                success: true,
                message: "Demotion successful. Discord roles updated.",
                memberId: input.memberId,
                fromRankId: member.currentRankId,
                toRankId: input.toRankId,
                discordId: member.discordId,
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
            const canView = member.discordId === ctx.session.user.id;
            
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
                    eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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

            // Check issuer permissions
            const issuer = await postgrestDb
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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

            // Create disciplinary action
            const result = await postgrestDb
              .insert(deptSchema.departmentDisciplinaryActions)
              .values({
                memberId: input.memberId,
                actionType: input.actionType,
                reason: input.reason,
                description: input.description,
                issuedBy: ctx.session.user.id,
                expiresAt: input.expiresAt,
              })
              .returning();

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
            const canView = member.discordId === ctx.session.user.id;
            
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
                    eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                organizedBy: ctx.session.user.id,
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
              userAttendance: attendance.find(a => a.memberDiscordId === ctx.session.user.id),
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
            const canManage = permissions.manage_meetings || meetingData.organizedBy === ctx.session.user.id;

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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
            const canDelete = permissions.manage_meetings || meetingData.organizedBy === ctx.session.user.id;

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
            const targetDiscordId = input.attendeeDiscordId ?? ctx.session.user.id;
            const isRecordingForSelf = targetDiscordId === ctx.session.user.id;

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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                recordedBy: ctx.session.user.id,
              })
              .onConflictDoUpdate({
                target: [
                  deptSchema.departmentMeetingAttendance.meetingId,
                  deptSchema.departmentMeetingAttendance.memberId
                ],
                set: {
                  status: input.status,
                  notes: input.notes,
                  recordedBy: ctx.session.user.id,
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
                  eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
                eq(deptSchema.departmentMembers.discordId, ctx.session.user.id),
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
              lastAssignedTo: ctx.session.user.id,
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
              discordId: ctx.session.user.id,
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
            .where(eq(deptSchema.departmentMembers.discordId, ctx.session.user.id))
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
