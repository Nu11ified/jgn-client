import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import { eq, and, lte } from "drizzle-orm";
import { restoreDiscordRolesForActiveMember } from "@/server/api/services/department";

/**
 * Cron job to auto-revert LOA members to active when their LOA expires,
 * auto-dismiss warnings when they expire, and auto-unsuspend members when their suspension expires.
 * Should be run periodically (e.g., every hour).
 */
export async function runLoaAutoRevertJob() {
  const now = new Date();

  // --- LOA Expiry ---
  const expiredLoas = await postgrestDb
    .select({
      id: deptSchema.departmentDisciplinaryActions.id,
      memberId: deptSchema.departmentDisciplinaryActions.memberId,
      expiresAt: deptSchema.departmentDisciplinaryActions.expiresAt,
    })
    .from(deptSchema.departmentDisciplinaryActions)
    .where(
      and(
        eq(deptSchema.departmentDisciplinaryActions.actionType, 'leave_of_absence'),
        eq(deptSchema.departmentDisciplinaryActions.isActive, true),
        lte(deptSchema.departmentDisciplinaryActions.expiresAt, now)
      )
    );

  for (const loa of expiredLoas) {
    // Set member status to active
    await postgrestDb
      .update(deptSchema.departmentMembers)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(deptSchema.departmentMembers.id, loa.memberId));
    // Mark the LOA action as inactive
    await postgrestDb
      .update(deptSchema.departmentDisciplinaryActions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(deptSchema.departmentDisciplinaryActions.id, loa.id));
    // Log the return from LOA as a new disciplinary action
    await postgrestDb
      .insert(deptSchema.departmentDisciplinaryActions)
      .values({
        memberId: loa.memberId,
        actionType: 'loa_returned',
        reason: 'Automatic return from LOA',
        description: 'Member automatically returned to active status after LOA expired.',
        issuedBy: 'system',
        issuedAt: new Date(),
        isActive: false,
      });
    // Restore Discord roles
    await restoreDiscordRolesForActiveMemberByMemberId(loa.memberId);
  }

  // --- Warning Expiry ---
  const expiredWarnings = await postgrestDb
    .select({
      id: deptSchema.departmentDisciplinaryActions.id,
      memberId: deptSchema.departmentDisciplinaryActions.memberId,
      expiresAt: deptSchema.departmentDisciplinaryActions.expiresAt,
    })
    .from(deptSchema.departmentDisciplinaryActions)
    .where(
      and(
        eq(deptSchema.departmentDisciplinaryActions.actionType, 'warning'),
        eq(deptSchema.departmentDisciplinaryActions.isActive, true),
        lte(deptSchema.departmentDisciplinaryActions.expiresAt, now)
      )
    );

  for (const warning of expiredWarnings) {
    // Mark the warning as inactive
    await postgrestDb
      .update(deptSchema.departmentDisciplinaryActions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(deptSchema.departmentDisciplinaryActions.id, warning.id));
    // Adjust member's warning status
    const member = await postgrestDb
      .select({ status: deptSchema.departmentMembers.status })
      .from(deptSchema.departmentMembers)
      .where(eq(deptSchema.departmentMembers.id, warning.memberId))
      .limit(1);
    if (member.length > 0) {
      let newStatus = member[0]!.status;
      if (newStatus === 'warned_3') newStatus = 'warned_2';
      else if (newStatus === 'warned_2') newStatus = 'warned_1';
      else if (newStatus === 'warned_1') newStatus = 'active';
      if (newStatus !== member[0]!.status) {
        await postgrestDb
          .update(deptSchema.departmentMembers)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(deptSchema.departmentMembers.id, warning.memberId));
      }
    }
    // Log the warning dismissal
    await postgrestDb
      .insert(deptSchema.departmentDisciplinaryActions)
      .values({
        memberId: warning.memberId,
        actionType: 'warning_dismissed',
        reason: 'Warning expired and was dismissed automatically',
        description: 'Member warning expired and was dismissed by cron job.',
        issuedBy: 'system',
        issuedAt: new Date(),
        isActive: false,
      });
  }

  // --- Suspension Expiry ---
  const expiredSuspensions = await postgrestDb
    .select({
      id: deptSchema.departmentDisciplinaryActions.id,
      memberId: deptSchema.departmentDisciplinaryActions.memberId,
      expiresAt: deptSchema.departmentDisciplinaryActions.expiresAt,
    })
    .from(deptSchema.departmentDisciplinaryActions)
    .where(
      and(
        eq(deptSchema.departmentDisciplinaryActions.actionType, 'suspension'),
        eq(deptSchema.departmentDisciplinaryActions.isActive, true),
        lte(deptSchema.departmentDisciplinaryActions.expiresAt, now)
      )
    );

  for (const suspension of expiredSuspensions) {
    // Set member status to active
    await postgrestDb
      .update(deptSchema.departmentMembers)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(deptSchema.departmentMembers.id, suspension.memberId));
    // Mark the suspension as inactive
    await postgrestDb
      .update(deptSchema.departmentDisciplinaryActions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(deptSchema.departmentDisciplinaryActions.id, suspension.id));
    // Log the unsuspension
    await postgrestDb
      .insert(deptSchema.departmentDisciplinaryActions)
      .values({
        memberId: suspension.memberId,
        actionType: 'unsuspended',
        reason: 'Automatic unsuspension after suspension expired',
        description: 'Member automatically unsuspended after suspension expired.',
        issuedBy: 'system',
        issuedAt: new Date(),
        isActive: false,
      });
    // Restore Discord roles
    await restoreDiscordRolesForActiveMemberByMemberId(suspension.memberId);
  }
}

// Helper to restore Discord roles by memberId
async function restoreDiscordRolesForActiveMemberByMemberId(memberId: number) {
  // Get member info
  const member = await postgrestDb
    .select({ discordId: deptSchema.departmentMembers.discordId, departmentId: deptSchema.departmentMembers.departmentId })
    .from(deptSchema.departmentMembers)
    .where(eq(deptSchema.departmentMembers.id, memberId))
    .limit(1);
  if (member.length > 0) {
    await restoreDiscordRolesForActiveMember(member[0]!.discordId, member[0]!.departmentId);
  }
} 