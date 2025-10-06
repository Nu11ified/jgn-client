import { eq, and, asc, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

/**
 * Generates a callsign based on rank, department, ID number, and team
 */
export const generateCallsign = (
  rankCallsign: string,
  departmentPrefix: string,
  idNumber?: number,
  teamPrefix?: string
): string => {
  if (!idNumber) return `${rankCallsign}${departmentPrefix}`;
  if (teamPrefix) {
    return `${rankCallsign}${departmentPrefix}-${idNumber}(${teamPrefix})`;
  }
  return `${rankCallsign}${departmentPrefix}-${idNumber}`;
};

/**
 * Regenerates and updates a member's callsign based on their current rank, team, and department
 */
export const regenerateAndUpdateMemberCallsign = async (memberId: number): Promise<void> => {
  // Fetch member with rank, team, department, and departmentIdNumber
  const member = await postgrestDb
    .select({
      id: deptSchema.departmentMembers.id,
      departmentId: deptSchema.departmentMembers.departmentId,
      departmentIdNumber: deptSchema.departmentMembers.departmentIdNumber,
      rankId: deptSchema.departmentMembers.rankId,
      primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
      isActive: deptSchema.departmentMembers.isActive,
    })
    .from(deptSchema.departmentMembers)
    .where(eq(deptSchema.departmentMembers.id, memberId))
    .limit(1);

  if (member.length === 0) return;
  const m = member[0]!;

  // If callsign is being regenerated for an active member without an ID number,
  // allocate the next available department ID atomically and assign it.
  if (!m.departmentIdNumber) {
    const newIdNumber = await postgrestDb.transaction(async (tx) => {
      // Find the next available ID number
      const available = await tx
        .select()
        .from(deptSchema.departmentIdNumbers)
        .where(
          and(
            eq(deptSchema.departmentIdNumbers.departmentId, m.departmentId),
            eq(deptSchema.departmentIdNumbers.isAvailable, true)
          )
        )
        .orderBy(asc(deptSchema.departmentIdNumbers.idNumber))
        .limit(1);

      let idNumber: number;
      if (available.length > 0) {
        idNumber = available[0]!.idNumber;
      } else {
        // Create the next ID number (100-999)
        const maxId = await tx
          .select()
          .from(deptSchema.departmentIdNumbers)
          .where(eq(deptSchema.departmentIdNumbers.departmentId, m.departmentId))
          .orderBy(desc(deptSchema.departmentIdNumbers.idNumber))
          .limit(1);

        idNumber = maxId.length > 0 ? maxId[0]!.idNumber + 1 : 100;
        if (idNumber > 999) {
          throw new TRPCError({ code: "CONFLICT", message: "No available ID numbers (100-999) for this department" });
        }

        await tx.insert(deptSchema.departmentIdNumbers).values({
          departmentId: m.departmentId,
          idNumber,
          isAvailable: true,
        });
      }

      // Reserve the ID for this member
      await tx
        .update(deptSchema.departmentIdNumbers)
        .set({
          isAvailable: false,
          currentMemberId: m.id,
        })
        .where(
          and(
            eq(deptSchema.departmentIdNumbers.departmentId, m.departmentId),
            eq(deptSchema.departmentIdNumbers.idNumber, idNumber)
          )
        );

      return idNumber;
    });

    // Persist the assigned ID on the member
    await postgrestDb
      .update(deptSchema.departmentMembers)
      .set({ departmentIdNumber: newIdNumber })
      .where(eq(deptSchema.departmentMembers.id, m.id));

    // Reflect the assigned ID in local variable so callsign includes it
    m.departmentIdNumber = newIdNumber as any;
  }

  // Get department prefix
  const department = await postgrestDb
    .select({ callsignPrefix: deptSchema.departments.callsignPrefix })
    .from(deptSchema.departments)
    .where(eq(deptSchema.departments.id, m.departmentId))
    .limit(1);
  if (department.length === 0) return;
  const departmentPrefix = department[0]!.callsignPrefix;

  // Get rank callsign
  let rankCallsign = "0";
  if (m.rankId) {
    const rank = await postgrestDb
      .select({ callsign: deptSchema.departmentRanks.callsign })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, m.rankId))
      .limit(1);
    if (rank.length > 0) rankCallsign = rank[0]!.callsign;
  }

  // Get team prefix
  let teamPrefix: string | undefined = undefined;
  if (m.primaryTeamId) {
    const team = await postgrestDb
      .select({ callsignPrefix: deptSchema.departmentTeams.callsignPrefix })
      .from(deptSchema.departmentTeams)
      .where(eq(deptSchema.departmentTeams.id, m.primaryTeamId))
      .limit(1);
    if (team.length > 0 && team[0]!.callsignPrefix) teamPrefix = team[0]!.callsignPrefix;
  }

  // Generate new callsign
  const newCallsign = generateCallsign(rankCallsign, departmentPrefix, m.departmentIdNumber ?? undefined, teamPrefix);

  // Update member's callsign
  await postgrestDb
    .update(deptSchema.departmentMembers)
    .set({ callsign: newCallsign })
    .where(eq(deptSchema.departmentMembers.id, m.id));
};

/**
 * Gets the next available ID number for a department (100-999)
 */
export const getNextAvailableIdNumber = async (departmentId: number): Promise<number> => {
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