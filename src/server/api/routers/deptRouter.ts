import { z } from "zod";
import { eq, and, desc, asc, isNull, isNotNull, sql } from "drizzle-orm";
import { adminProcedure, protectedProcedure, publicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

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
  abbreviation: z.string().max(10).optional(),
  discordRoleId: z.string().min(1, "Discord Role ID is required").max(30),
  level: z.number().int().min(1, "Level must be at least 1"),
  permissions: deptSchema.departmentPermissionsSchema.optional(),
  salary: z.number().int().min(0).optional(),
});

const updateRankSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(256).optional(),
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
  rankId: z.number().int().positive().optional(),
  badgeNumber: z.string().max(20).optional(),
  primaryTeamId: z.number().int().positive().optional(),
  status: deptSchema.departmentMemberStatusEnum.optional(),
  notes: z.string().optional(),
});

const updateMemberSchema = z.object({
  id: z.number().int().positive(),
  rankId: z.number().int().positive().optional().nullable(),
  badgeNumber: z.string().max(20).optional().nullable(),
  primaryTeamId: z.number().int().positive().optional().nullable(),
  status: deptSchema.departmentMemberStatusEnum.optional(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// Utility function to generate callsign
const generateCallsign = (departmentPrefix: string, teamPrefix?: string, idNumber?: number): string => {
  if (!idNumber) return departmentPrefix;
  if (teamPrefix) {
    return `${departmentPrefix}-${teamPrefix}-${idNumber}`;
  }
  return `${departmentPrefix}-${idNumber}`;
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

            return result[0];
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
            // Check if team exists
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

            const result = await postgrestDb
              .update(deptSchema.departmentTeams)
              .set(updateData)
              .where(eq(deptSchema.departmentTeams.id, id))
              .returning();

            return result[0];
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
            // Check if team exists
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

            // Generate callsign
            let callsign = department[0]!.callsignPrefix;
            if (input.primaryTeamId) {
              const team = await postgrestDb
                .select()
                .from(deptSchema.departmentTeams)
                .where(eq(deptSchema.departmentTeams.id, input.primaryTeamId))
                .limit(1);
              
              if (team.length > 0 && team[0]!.callsignPrefix) {
                callsign = generateCallsign(
                  department[0]!.callsignPrefix,
                  team[0]!.callsignPrefix,
                  departmentIdNumber
                );
              } else {
                callsign = generateCallsign(department[0]!.callsignPrefix, undefined, departmentIdNumber);
              }
            } else {
              callsign = generateCallsign(department[0]!.callsignPrefix, undefined, departmentIdNumber);
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
                ...input,
                departmentIdNumber,
                callsign,
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
              .select()
              .from(deptSchema.departmentMembers)
              .where(and(...conditions))
              .orderBy(asc(deptSchema.departmentMembers.callsign));
              
            return members;
          } catch (error) {
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

            // Prepare update data with proper null handling
            const memberUpdateData: Partial<Pick<typeof deptSchema.departmentMembers.$inferInsert, 'rankId' | 'badgeNumber' | 'primaryTeamId' | 'status' | 'notes' | 'isActive' | 'callsign'>> = {};
            
            // Handle null values properly for nullable fields
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

            // If primary team is changing, update callsign
            if (updateData.primaryTeamId !== undefined) {
              const department = await postgrestDb
                .select()
                .from(deptSchema.departments)
                .where(eq(deptSchema.departments.id, existingMember[0]!.departmentId))
                .limit(1);

              let newCallsign = department[0]!.callsignPrefix;
              
              if (updateData.primaryTeamId) {
                const team = await postgrestDb
                  .select()
                  .from(deptSchema.departmentTeams)
                  .where(eq(deptSchema.departmentTeams.id, updateData.primaryTeamId))
                  .limit(1);
                
                if (team.length > 0 && team[0]!.callsignPrefix) {
                  newCallsign = generateCallsign(
                    department[0]!.callsignPrefix,
                    team[0]!.callsignPrefix,
                    existingMember[0]!.departmentIdNumber ?? undefined
                  );
                } else {
                  newCallsign = generateCallsign(
                    department[0]!.callsignPrefix,
                    undefined,
                    existingMember[0]!.departmentIdNumber ?? undefined
                  );
                }
              } else {
                newCallsign = generateCallsign(
                  department[0]!.callsignPrefix,
                  undefined,
                  existingMember[0]!.departmentIdNumber ?? undefined
                );
              }

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

            // Record the promotion in history
            await postgrestDb.insert(deptSchema.departmentPromotionHistory).values({
              memberId: input.memberId,
              fromRankId: member.currentRankId,
              toRankId: input.toRankId,
              promotedBy: ctx.session.user.id,
              reason: input.reason,
              notes: input.notes,
            });

            // Update member's rank
            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({ rankId: input.toRankId })
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .returning();

            return result[0];
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

            // Record the demotion in history
            await postgrestDb.insert(deptSchema.departmentPromotionHistory).values({
              memberId: input.memberId,
              fromRankId: member.currentRankId,
              toRankId: input.toRankId,
              promotedBy: ctx.session.user.id,
              reason: input.reason,
              notes: input.notes,
            });

            // Update member's rank
            const result = await postgrestDb
              .update(deptSchema.departmentMembers)
              .set({ rankId: input.toRankId })
              .where(eq(deptSchema.departmentMembers.id, input.memberId))
              .returning();

            return result[0];
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
    }),
  }),
});
