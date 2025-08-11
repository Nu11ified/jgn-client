import { eq, inArray, and } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface BulkOperationResult {
  success: boolean;
  totalRequested: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    memberId: number;
    success: boolean;
    message: string;
    data?: any;
  }>;
  summary: string;
}

export interface BulkUpdateParams {
  memberIds: number[];
  updates: {
    status?: string;
    rankId?: number;
    primaryTeamId?: number;
    notes?: string;
  };
  reason: string;
  performedBy?: number;
}

export async function bulkUpdateMembers(params: BulkUpdateParams): Promise<BulkOperationResult> {
  const { memberIds, updates, reason, performedBy } = params;
  const results: BulkOperationResult["results"] = [];
  let successCount = 0;
  let failureCount = 0;

  try {
    // Validate all members exist and get their current data
    const existingMembers = await postgrestDb
      .select({
        id: deptSchema.departmentMembers.id,
        discordId: deptSchema.departmentMembers.discordId,
        departmentId: deptSchema.departmentMembers.departmentId,
        rankId: deptSchema.departmentMembers.rankId,
        primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
        status: deptSchema.departmentMembers.status,
        isActive: deptSchema.departmentMembers.isActive,
      })
      .from(deptSchema.departmentMembers)
      .where(inArray(deptSchema.departmentMembers.id, memberIds));

    // Check for missing members
    const foundMemberIds = existingMembers.map(m => m.id);
    const missingMemberIds = memberIds.filter(id => !foundMemberIds.includes(id));

    // Add failure results for missing members
    missingMemberIds.forEach(memberId => {
      results.push({
        memberId,
        success: false,
        message: "Member not found",
      });
      failureCount++;
    });

    // Process members in parallel, but safely collect results
    const settledUpdates = await Promise.allSettled(
      existingMembers.map(async (member) => {
        try {
          const validationResult = await validateMemberUpdate(member, updates, performedBy);
          if (!validationResult.valid) {
            return {
              memberId: member.id,
              success: false,
              message: validationResult.reason || "Update not allowed",
            } as BulkOperationResult["results"][number];
          }
          const updateResult = await updateSingleMember(member, updates, reason, performedBy);
          return {
            memberId: member.id,
            success: updateResult.success,
            message: updateResult.message,
            data: updateResult.data,
          } as BulkOperationResult["results"][number];
        } catch (error) {
          return {
            memberId: member.id,
            success: false,
            message: `Update failed: ${error}`,
          } as BulkOperationResult["results"][number];
        }
      })
    );

    for (const s of settledUpdates) {
      if (s.status === 'fulfilled') {
        results.push(s.value);
        if (s.value.success) successCount++; else failureCount++;
      } else {
        failureCount++;
      }
    }

    const summary = `Bulk update completed: ${successCount} successful, ${failureCount} failed out of ${memberIds.length} requested`;

    return {
      success: successCount > 0,
      totalRequested: memberIds.length,
      successCount,
      failureCount,
      results,
      summary,
    };
  } catch (error) {
    console.error("Bulk update error:", error);
    return {
      success: false,
      totalRequested: memberIds.length,
      successCount: 0,
      failureCount: memberIds.length,
      results: memberIds.map(memberId => ({
        memberId,
        success: false,
        message: `Bulk operation failed: ${error}`,
      })),
      summary: `Bulk update failed: ${error}`,
    };
  }
}

export async function bulkPromoteMembers(params: {
  memberIds: number[];
  newRankId: number;
  reason: string;
  effectiveDate?: Date;
  performedBy?: number;
}): Promise<BulkOperationResult> {
  const { memberIds, newRankId, reason, effectiveDate = new Date(), performedBy } = params;
  const results: BulkOperationResult["results"] = [];
  let successCount = 0;
  let failureCount = 0;

  try {
    // Validate the target rank exists
    const targetRank = await postgrestDb
      .select({
        id: deptSchema.departmentRanks.id,
        name: deptSchema.departmentRanks.name,
        departmentId: deptSchema.departmentRanks.departmentId,
        level: deptSchema.departmentRanks.level,
        isActive: deptSchema.departmentRanks.isActive,
      })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, newRankId))
      .limit(1);

    if (targetRank.length === 0) {
      return {
        success: false,
        totalRequested: memberIds.length,
        successCount: 0,
        failureCount: memberIds.length,
        results: memberIds.map(memberId => ({
          memberId,
          success: false,
          message: "Target rank not found",
        })),
        summary: "Bulk promotion failed: Target rank not found",
      };
    }

    const rank = targetRank[0]!;

    if (!rank.isActive) {
      return {
        success: false,
        totalRequested: memberIds.length,
        successCount: 0,
        failureCount: memberIds.length,
        results: memberIds.map(memberId => ({
          memberId,
          success: false,
          message: "Target rank is not active",
        })),
        summary: "Bulk promotion failed: Target rank is not active",
      };
    }

    // Get all members and validate
    const members = await postgrestDb
      .select({
        id: deptSchema.departmentMembers.id,
        discordId: deptSchema.departmentMembers.discordId,
        departmentId: deptSchema.departmentMembers.departmentId,
        rankId: deptSchema.departmentMembers.rankId,
        isActive: deptSchema.departmentMembers.isActive,
        status: deptSchema.departmentMembers.status,
      })
      .from(deptSchema.departmentMembers)
      .where(inArray(deptSchema.departmentMembers.id, memberIds));

    const memberById = new Map<number, typeof members[number]>();
    for (const m of members) memberById.set(m.id, m);

    // Process each member in parallel
    const settledPromotions = await Promise.allSettled(
      memberIds.map(async (memberId) => {
        const member = memberById.get(memberId);
        if (!member) {
          return { memberId, success: false, message: "Member not found" } as BulkOperationResult["results"][number];
        }
        try {
          const validationResult = await validatePromotion(member, rank, performedBy);
          if (!validationResult.valid) {
            return { memberId, success: false, message: validationResult.reason || "Promotion not allowed" } as BulkOperationResult["results"][number];
          }
          const promotionResult = await promoteSingleMember(member, rank, reason, effectiveDate, performedBy);
          return { memberId, success: promotionResult.success, message: promotionResult.message, data: promotionResult.data } as BulkOperationResult["results"][number];
        } catch (error) {
          return { memberId, success: false, message: `Promotion failed: ${error}` } as BulkOperationResult["results"][number];
        }
      })
    );

    for (const s of settledPromotions) {
      if (s.status === 'fulfilled') {
        results.push(s.value);
        if (s.value.success) successCount++; else failureCount++;
      } else {
        failureCount++;
      }
    }

    const summary = `Bulk promotion to ${rank.name} completed: ${successCount} successful, ${failureCount} failed out of ${memberIds.length} requested`;

    return {
      success: successCount > 0,
      totalRequested: memberIds.length,
      successCount,
      failureCount,
      results,
      summary,
    };
  } catch (error) {
    console.error("Bulk promotion error:", error);
    return {
      success: false,
      totalRequested: memberIds.length,
      successCount: 0,
      failureCount: memberIds.length,
      results: memberIds.map(memberId => ({
        memberId,
        success: false,
        message: `Bulk promotion failed: ${error}`,
      })),
      summary: `Bulk promotion failed: ${error}`,
    };
  }
}

export async function bulkAssignTeam(params: {
  memberIds: number[];
  teamId: number;
  reason: string;
  performedBy?: number;
}): Promise<BulkOperationResult> {
  const { memberIds, teamId, reason, performedBy } = params;
  const results: BulkOperationResult["results"] = [];
  let successCount = 0;
  let failureCount = 0;

  try {
    // Validate the target team exists
    const targetTeam = await postgrestDb
      .select({
        id: deptSchema.departmentTeams.id,
        name: deptSchema.departmentTeams.name,
        departmentId: deptSchema.departmentTeams.departmentId,
        isActive: deptSchema.departmentTeams.isActive,
      })
      .from(deptSchema.departmentTeams)
      .where(eq(deptSchema.departmentTeams.id, teamId))
      .limit(1);

    if (targetTeam.length === 0) {
      return {
        success: false,
        totalRequested: memberIds.length,
        successCount: 0,
        failureCount: memberIds.length,
        results: memberIds.map(memberId => ({
          memberId,
          success: false,
          message: "Target team not found",
        })),
        summary: "Bulk team assignment failed: Target team not found",
      };
    }

    const team = targetTeam[0]!;

    if (!team.isActive) {
      return {
        success: false,
        totalRequested: memberIds.length,
        successCount: 0,
        failureCount: memberIds.length,
        results: memberIds.map(memberId => ({
          memberId,
          success: false,
          message: "Target team is not active",
        })),
        summary: "Bulk team assignment failed: Target team is not active",
      };
    }

    // Get all members and validate
    const members = await postgrestDb
      .select({
        id: deptSchema.departmentMembers.id,
        discordId: deptSchema.departmentMembers.discordId,
        departmentId: deptSchema.departmentMembers.departmentId,
        primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
        isActive: deptSchema.departmentMembers.isActive,
        status: deptSchema.departmentMembers.status,
      })
      .from(deptSchema.departmentMembers)
      .where(inArray(deptSchema.departmentMembers.id, memberIds));

    // Process each member in parallel
    const settledAssignments = await Promise.allSettled(
      memberIds.map(async (memberId) => {
        const member = members.find(m => m.id === memberId);
        if (!member) {
          return { memberId, success: false, message: "Member not found" } as BulkOperationResult["results"][number];
        }
        try {
          const validationResult = await validateTeamAssignment(member, team, performedBy);
          if (!validationResult.valid) {
            return { memberId, success: false, message: validationResult.reason || "Team assignment not allowed" } as BulkOperationResult["results"][number];
          }
          const assignmentResult = await assignMemberToTeam(member, team, reason, performedBy);
          return { memberId, success: assignmentResult.success, message: assignmentResult.message, data: assignmentResult.data } as BulkOperationResult["results"][number];
        } catch (error) {
          return { memberId, success: false, message: `Team assignment failed: ${error}` } as BulkOperationResult["results"][number];
        }
      })
    );

    for (const s of settledAssignments) {
      if (s.status === 'fulfilled') {
        results.push(s.value);
        if (s.value.success) successCount++; else failureCount++;
      } else {
        failureCount++;
      }
    }

    const summary = `Bulk team assignment to ${team.name} completed: ${successCount} successful, ${failureCount} failed out of ${memberIds.length} requested`;

    return {
      success: successCount > 0,
      totalRequested: memberIds.length,
      successCount,
      failureCount,
      results,
      summary,
    };
  } catch (error) {
    console.error("Bulk team assignment error:", error);
    return {
      success: false,
      totalRequested: memberIds.length,
      successCount: 0,
      failureCount: memberIds.length,
      results: memberIds.map(memberId => ({
        memberId,
        success: false,
        message: `Bulk team assignment failed: ${error}`,
      })),
      summary: `Bulk team assignment failed: ${error}`,
    };
  }
}

// Helper functions

async function validateMemberUpdate(
  member: any,
  updates: any,
  performedBy?: number
): Promise<{ valid: boolean; reason?: string }> {
  // Check if member is active
  if (!member.isActive) {
    return { valid: false, reason: "Cannot update inactive member" };
  }

  // Check if trying to update rank
  if (updates.rankId && updates.rankId !== member.rankId) {
    // Validate rank exists and is in same department
    const rank = await postgrestDb
      .select({
        id: deptSchema.departmentRanks.id,
        departmentId: deptSchema.departmentRanks.departmentId,
        isActive: deptSchema.departmentRanks.isActive,
      })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, updates.rankId))
      .limit(1);

    if (rank.length === 0) {
      return { valid: false, reason: "Target rank not found" };
    }

    if (rank[0]!.departmentId !== member.departmentId) {
      return { valid: false, reason: "Rank not in member's department" };
    }

    if (!rank[0]!.isActive) {
      return { valid: false, reason: "Target rank is not active" };
    }
  }

  // Check if trying to update team
  if (updates.primaryTeamId && updates.primaryTeamId !== member.primaryTeamId) {
    const team = await postgrestDb
      .select({
        id: deptSchema.departmentTeams.id,
        departmentId: deptSchema.departmentTeams.departmentId,
        isActive: deptSchema.departmentTeams.isActive,
      })
      .from(deptSchema.departmentTeams)
      .where(eq(deptSchema.departmentTeams.id, updates.primaryTeamId))
      .limit(1);

    if (team.length === 0) {
      return { valid: false, reason: "Target team not found" };
    }

    if (team[0]!.departmentId !== member.departmentId) {
      return { valid: false, reason: "Team not in member's department" };
    }

    if (!team[0]!.isActive) {
      return { valid: false, reason: "Target team is not active" };
    }
  }

  return { valid: true };
}

async function updateSingleMember(
  member: any,
  updates: any,
  reason: string,
  performedBy?: number
): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    // Perform actual database update
    const updateData: any = {};

    if (updates.status !== undefined) {
      updateData.status = updates.status;
    }
    if (updates.rankId !== undefined) {
      updateData.rankId = updates.rankId;
    }
    if (updates.primaryTeamId !== undefined) {
      updateData.primaryTeamId = updates.primaryTeamId;
    }
    if (updates.notes !== undefined) {
      updateData.notes = updates.notes;
    }

    // Add updated timestamp
    updateData.updatedAt = new Date();

    await postgrestDb
      .update(deptSchema.departmentMembers)
      .set(updateData)
      .where(eq(deptSchema.departmentMembers.id, member.id));

    // If rank changed, record promotion history
    if (updates.rankId && updates.rankId !== member.rankId) {
      await recordPromotionHistory(member.id, member.rankId, updates.rankId, reason, performedBy);
    }

    return {
      success: true,
      message: "Member updated successfully",
      data: { updatedFields: Object.keys(updates) },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to update member: ${error}`,
    };
  }
}

async function validatePromotion(
  member: any,
  targetRank: any,
  performedBy?: number
): Promise<{ valid: boolean; reason?: string }> {
  // Check if member is in same department as target rank
  if (member.departmentId !== targetRank.departmentId) {
    return { valid: false, reason: "Member and rank are in different departments" };
  }

  // Check if member is active
  if (!member.isActive) {
    return { valid: false, reason: "Cannot promote inactive member" };
  }

  // Check if member status allows promotion
  if (member.status !== "active") {
    return { valid: false, reason: `Cannot promote member with status: ${member.status}` };
  }

  // Check if it's actually a promotion (not demotion or lateral move)
  if (member.rankId) {
    const currentRank = await postgrestDb
      .select({ level: deptSchema.departmentRanks.level })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, member.rankId))
      .limit(1);

    if (currentRank.length > 0 && currentRank[0]!.level >= targetRank.level) {
      return { valid: false, reason: "Target rank is not higher than current rank" };
    }
  }

  return { valid: true };
}

async function promoteSingleMember(
  member: any,
  targetRank: any,
  reason: string,
  effectiveDate: Date,
  performedBy?: number
): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    // Update member's rank in database
    await postgrestDb
      .update(deptSchema.departmentMembers)
      .set({
        rankId: targetRank.id,
        updatedAt: new Date(),
      })
      .where(eq(deptSchema.departmentMembers.id, member.id));

    // Record promotion history
    await recordPromotionHistory(member.id, member.rankId, targetRank.id, reason, performedBy);

    return {
      success: true,
      message: `Promoted to ${targetRank.name}`,
      data: { newRankId: targetRank.id, newRankName: targetRank.name },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to promote member: ${error}`,
    };
  }
}

async function validateTeamAssignment(
  member: any,
  targetTeam: any,
  performedBy?: number
): Promise<{ valid: boolean; reason?: string }> {
  // Check if member is in same department as target team
  if (member.departmentId !== targetTeam.departmentId) {
    return { valid: false, reason: "Member and team are in different departments" };
  }

  // Check if member is active
  if (!member.isActive) {
    return { valid: false, reason: "Cannot assign inactive member to team" };
  }

  // Check if already in the team
  if (member.primaryTeamId === targetTeam.id) {
    return { valid: false, reason: "Member is already in this team" };
  }

  return { valid: true };
}

async function assignMemberToTeam(
  member: any,
  targetTeam: any,
  reason: string,
  performedBy?: number
): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    // Update member's primary team in database
    await postgrestDb
      .update(deptSchema.departmentMembers)
      .set({
        primaryTeamId: targetTeam.id,
        updatedAt: new Date(),
      })
      .where(eq(deptSchema.departmentMembers.id, member.id));

    // Add team membership record if not already exists
    const existingMembership = await postgrestDb
      .select({ id: deptSchema.departmentTeamMemberships.id })
      .from(deptSchema.departmentTeamMemberships)
      .where(
        and(
          eq(deptSchema.departmentTeamMemberships.memberId, member.id),
          eq(deptSchema.departmentTeamMemberships.teamId, targetTeam.id)
        )
      )
      .limit(1);

    if (existingMembership.length === 0) {
      await postgrestDb
        .insert(deptSchema.departmentTeamMemberships)
        .values({
          memberId: member.id,
          teamId: targetTeam.id,
          isLeader: false,
          joinedAt: new Date(),
        });
    }

    return {
      success: true,
      message: `Assigned to ${targetTeam.name}`,
      data: { newTeamId: targetTeam.id, newTeamName: targetTeam.name },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to assign member to team: ${error}`,
    };
  }
}

async function recordPromotionHistory(
  memberId: number,
  oldRankId: number | null,
  newRankId: number,
  reason: string,
  performedBy?: number
): Promise<void> {
  try {
    await postgrestDb
      .insert(deptSchema.departmentPromotionHistory)
      .values({
        memberId,
        fromRankId: oldRankId,
        toRankId: newRankId,
        reason,
        promotedBy: performedBy?.toString() || "system", // Default to "system" if no performer specified
        effectiveDate: new Date(),
        notes: null,
      });
  } catch (error) {
    console.error("Failed to record promotion history:", error);
    // Don't throw error to avoid breaking the main operation
  }
}