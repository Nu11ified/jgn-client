import { eq, and, desc, sql, gte, lte, or } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface ShiftSchedule {
    id: number;
    departmentId: number;
    memberId: number;
    startTime: Date;
    endTime: Date;
    shiftType: "patrol" | "training" | "administrative" | "special_ops" | "court_duty";
    notes?: string;
    status: "scheduled" | "in_progress" | "completed" | "cancelled" | "no_show";
    createdAt: Date;
    updatedAt?: Date;
}

export interface ShiftConflict {
    conflictType: "overlap" | "double_booking" | "insufficient_rest";
    existingShift: ShiftSchedule;
    message: string;
}

export interface SchedulingResult {
    success: boolean;
    shiftId?: number;
    conflicts?: ShiftConflict[];
    message: string;
}

/**
 * Get member name by ID
 */
async function getMemberName(memberId: number): Promise<string> {
    try {
        const [member] = await postgrestDb
            .select({
                roleplayName: deptSchema.departmentMembers.roleplayName,
                discordId: deptSchema.departmentMembers.discordId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, memberId))
            .limit(1);

        return member?.roleplayName || `User ${member?.discordId || memberId}`;
    } catch (error) {
        console.error("Error getting member name:", error);
        return `Member ${memberId}`;
    }
}

/**
 * Validate shift type
 */
function validateShiftType(shiftType: string): shiftType is ShiftSchedule['shiftType'] {
    const validTypes = ["patrol", "training", "administrative", "special_ops", "court_duty"];
    return validTypes.includes(shiftType);
}

/**
 * Extract shift type from notes field with better validation
 */
function extractShiftTypeFromNotes(notes: string | null): ShiftSchedule['shiftType'] {
    if (!notes) return "patrol";

    const lowerNotes = notes.toLowerCase();

    if (lowerNotes.includes("training")) return "training";
    if (lowerNotes.includes("administrative") || lowerNotes.includes("admin")) return "administrative";
    if (lowerNotes.includes("special_ops") || lowerNotes.includes("swat") || lowerNotes.includes("special ops")) return "special_ops";
    if (lowerNotes.includes("court_duty") || lowerNotes.includes("court")) return "court_duty";

    return "patrol";
}

/**
 * Map time clock status to shift status
 */
function mapTimeClockStatusToShiftStatus(timeClockStatus: string): ShiftSchedule['status'] {
    switch (timeClockStatus) {
        case "clocked_in":
            return "in_progress";
        case "clocked_out":
            return "completed";
        case "on_break":
            return "in_progress";
        default:
            return "scheduled";
    }
}

/**
 * Map shift status to time clock status
 */
function mapShiftStatusToTimeClockStatus(shiftStatus: ShiftSchedule['status']): string {
    switch (shiftStatus) {
        case "scheduled":
            return "clocked_out";
        case "in_progress":
            return "clocked_in";
        case "completed":
            return "clocked_out";
        case "cancelled":
            return "clocked_out";
        case "no_show":
            return "clocked_out";
        default:
            return "clocked_out";
    }
}

export async function scheduleShift(params: {
    departmentId: number;
    memberId: number;
    startTime: Date;
    endTime: Date;
    shiftType: "patrol" | "training" | "administrative" | "special_ops" | "court_duty";
    notes?: string;
    scheduledBy?: string;
}): Promise<SchedulingResult> {
    const { departmentId, memberId, startTime, endTime, shiftType, notes } = params;

    try {
        // Validate shift times
        if (startTime >= endTime) {
            return {
                success: false,
                message: "Start time must be before end time",
            };
        }

        if (startTime < new Date()) {
            return {
                success: false,
                message: "Cannot schedule shifts in the past",
            };
        }

        // Check for conflicts
        const conflicts = await checkShiftConflicts(memberId, startTime, endTime);

        if (conflicts.length > 0) {
            return {
                success: false,
                conflicts,
                message: `Scheduling conflicts detected: ${conflicts.map(c => c.message).join(", ")}`,
            };
        }

        // Validate member exists and is active
        const member = await postgrestDb
            .select({
                id: deptSchema.departmentMembers.id,
                isActive: deptSchema.departmentMembers.isActive,
                status: deptSchema.departmentMembers.status,
            })
            .from(deptSchema.departmentMembers)
            .where(
                and(
                    eq(deptSchema.departmentMembers.id, memberId),
                    eq(deptSchema.departmentMembers.departmentId, departmentId)
                )
            )
            .limit(1);

        if (member.length === 0) {
            return {
                success: false,
                message: "Member not found in department",
            };
        }

        if (!member[0]!.isActive) {
            return {
                success: false,
                message: "Cannot schedule shifts for inactive members",
            };
        }

        if (member[0]!.status !== "active") {
            return {
                success: false,
                message: `Cannot schedule shifts for members with status: ${member[0]!.status}`,
            };
        }

        // Create the shift in the shifts table
        const [newShift] = await postgrestDb
            .insert(deptSchema.departmentShifts)
            .values({
                departmentId,
                memberId,
                startTime,
                endTime,
                shiftType,
                status: "scheduled",
                notes,
                scheduledBy: params.scheduledBy || "system",
            })
            .returning({ id: deptSchema.departmentShifts.id });

        if (!newShift) {
            return {
                success: false,
                message: "Failed to create shift schedule",
            };
        }

        return {
            success: true,
            shiftId: newShift.id,
            message: "Shift scheduled successfully",
        };
    } catch (error) {
        console.error("Error scheduling shift:", error);
        return {
            success: false,
            message: `Failed to schedule shift: ${error}`,
        };
    }
}

export async function checkShiftConflicts(
    memberId: number,
    startTime: Date,
    endTime: Date
): Promise<ShiftConflict[]> {
    const conflicts: ShiftConflict[] = [];

    try {
        // Get existing shifts that could conflict
        const existingShifts = await getExistingShifts(memberId, startTime, endTime);

        for (const shift of existingShifts) {
            // Skip cancelled shifts
            if (shift.status === "cancelled") continue;

            // Check for time overlap
            if (
                (startTime >= shift.startTime && startTime < shift.endTime) ||
                (endTime > shift.startTime && endTime <= shift.endTime) ||
                (startTime <= shift.startTime && endTime >= shift.endTime)
            ) {
                conflicts.push({
                    conflictType: "overlap",
                    existingShift: shift,
                    message: `Overlaps with existing ${shift.shiftType} shift from ${shift.startTime.toLocaleString()} to ${shift.endTime.toLocaleString()}`,
                });
            }

            // Check for insufficient rest period (minimum 8 hours between shifts)
            const timeBetweenShifts = Math.abs(startTime.getTime() - shift.endTime.getTime()) / (1000 * 60 * 60);
            if (timeBetweenShifts < 8) {
                conflicts.push({
                    conflictType: "insufficient_rest",
                    existingShift: shift,
                    message: `Insufficient rest period (${timeBetweenShifts.toFixed(1)} hours) between shifts`,
                });
            }
        }

        return conflicts;
    } catch (error) {
        console.error("Error checking shift conflicts:", error);
        return [];
    }
}

export async function getExistingShifts(
    memberId: number,
    startTime: Date,
    endTime: Date
): Promise<ShiftSchedule[]> {
    try {
        // Query the shifts table directly
        const shifts = await postgrestDb
            .select({
                id: deptSchema.departmentShifts.id,
                departmentId: deptSchema.departmentShifts.departmentId,
                memberId: deptSchema.departmentShifts.memberId,
                startTime: deptSchema.departmentShifts.startTime,
                endTime: deptSchema.departmentShifts.endTime,
                shiftType: deptSchema.departmentShifts.shiftType,
                status: deptSchema.departmentShifts.status,
                notes: deptSchema.departmentShifts.notes,
                createdAt: deptSchema.departmentShifts.createdAt,
                updatedAt: deptSchema.departmentShifts.updatedAt,
            })
            .from(deptSchema.departmentShifts)
            .where(
                and(
                    eq(deptSchema.departmentShifts.memberId, memberId),
                    or(
                        // Overlapping time ranges
                        and(
                            lte(deptSchema.departmentShifts.startTime, endTime),
                            gte(deptSchema.departmentShifts.endTime, startTime)
                        ),
                        // Within 24 hours for rest period checking
                        and(
                            gte(deptSchema.departmentShifts.startTime, new Date(startTime.getTime() - 24 * 60 * 60 * 1000)),
                            lte(deptSchema.departmentShifts.startTime, new Date(endTime.getTime() + 24 * 60 * 60 * 1000))
                        )
                    )
                )
            );

        // Convert to ShiftSchedule interface
        return shifts.map(shift => ({
            id: shift.id,
            departmentId: shift.departmentId,
            memberId: shift.memberId,
            startTime: shift.startTime,
            endTime: shift.endTime,
            shiftType: shift.shiftType as ShiftSchedule['shiftType'],
            notes: shift.notes || undefined,
            status: shift.status as ShiftSchedule['status'],
            createdAt: shift.createdAt,
            updatedAt: shift.updatedAt || undefined,
        }));
    } catch (error) {
        console.error("Error getting existing shifts:", error);
        return [];
    }
}

export async function getShiftsForMember(
    memberId: number,
    startDate: Date,
    endDate: Date
): Promise<ShiftSchedule[]> {
    try {
        const shifts = await postgrestDb
            .select({
                id: deptSchema.departmentShifts.id,
                departmentId: deptSchema.departmentShifts.departmentId,
                memberId: deptSchema.departmentShifts.memberId,
                startTime: deptSchema.departmentShifts.startTime,
                endTime: deptSchema.departmentShifts.endTime,
                shiftType: deptSchema.departmentShifts.shiftType,
                status: deptSchema.departmentShifts.status,
                notes: deptSchema.departmentShifts.notes,
                createdAt: deptSchema.departmentShifts.createdAt,
                updatedAt: deptSchema.departmentShifts.updatedAt,
            })
            .from(deptSchema.departmentShifts)
            .where(
                and(
                    eq(deptSchema.departmentShifts.memberId, memberId),
                    gte(deptSchema.departmentShifts.startTime, startDate),
                    lte(deptSchema.departmentShifts.startTime, endDate)
                )
            )
            .orderBy(desc(deptSchema.departmentShifts.startTime));

        return shifts.map(shift => ({
            id: shift.id,
            departmentId: shift.departmentId,
            memberId: shift.memberId,
            startTime: shift.startTime,
            endTime: shift.endTime,
            shiftType: shift.shiftType as ShiftSchedule['shiftType'],
            notes: shift.notes || undefined,
            status: shift.status as ShiftSchedule['status'],
            createdAt: shift.createdAt,
            updatedAt: shift.updatedAt || undefined,
        }));
    } catch (error) {
        console.error("Error getting shifts for member:", error);
        return [];
    }
}

export async function getShiftsForDepartment(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<ShiftSchedule[]> {
    try {
        const shifts = await postgrestDb
            .select({
                id: deptSchema.departmentShifts.id,
                departmentId: deptSchema.departmentShifts.departmentId,
                memberId: deptSchema.departmentShifts.memberId,
                startTime: deptSchema.departmentShifts.startTime,
                endTime: deptSchema.departmentShifts.endTime,
                shiftType: deptSchema.departmentShifts.shiftType,
                status: deptSchema.departmentShifts.status,
                notes: deptSchema.departmentShifts.notes,
                createdAt: deptSchema.departmentShifts.createdAt,
                updatedAt: deptSchema.departmentShifts.updatedAt,
            })
            .from(deptSchema.departmentShifts)
            .where(
                and(
                    eq(deptSchema.departmentShifts.departmentId, departmentId),
                    gte(deptSchema.departmentShifts.startTime, startDate),
                    lte(deptSchema.departmentShifts.startTime, endDate)
                )
            )
            .orderBy(desc(deptSchema.departmentShifts.startTime));

        return shifts.map(shift => ({
            id: shift.id,
            departmentId: shift.departmentId,
            memberId: shift.memberId,
            startTime: shift.startTime,
            endTime: shift.endTime,
            shiftType: shift.shiftType as ShiftSchedule['shiftType'],
            notes: shift.notes || undefined,
            status: shift.status as ShiftSchedule['status'],
            createdAt: shift.createdAt,
            updatedAt: shift.updatedAt || undefined,
        }));
    } catch (error) {
        console.error("Error getting shifts for department:", error);
        return [];
    }
}

export async function updateShiftStatus(
    shiftId: number,
    status: "scheduled" | "in_progress" | "completed" | "cancelled" | "no_show",
    notes?: string
): Promise<{ success: boolean; message: string }> {
    try {
        // Prepare update data for the shifts table
        const updateData: any = {
            status,
        };

        // Add notes if provided
        if (notes) {
            const [existingShift] = await postgrestDb
                .select({ notes: deptSchema.departmentShifts.notes })
                .from(deptSchema.departmentShifts)
                .where(eq(deptSchema.departmentShifts.id, shiftId))
                .limit(1);

            if (existingShift) {
                const existingNotes = existingShift.notes || '';
                updateData.notes = existingNotes + (existingNotes ? ' | ' : '') + `Status updated to ${status}: ${notes}`;
            } else {
                updateData.notes = `Status updated to ${status}: ${notes}`;
            }
        }

        // Update actual start/end times based on status
        const now = new Date();
        if (status === "in_progress") {
            updateData.actualStartTime = now;
        } else if (status === "completed") {
            updateData.actualEndTime = now;
        }

        const result = await postgrestDb
            .update(deptSchema.departmentShifts)
            .set(updateData)
            .where(eq(deptSchema.departmentShifts.id, shiftId))
            .returning({ id: deptSchema.departmentShifts.id });

        if (result.length === 0) {
            return {
                success: false,
                message: "Shift not found",
            };
        }

        return {
            success: true,
            message: "Shift status updated successfully",
        };
    } catch (error) {
        console.error("Error updating shift status:", error);
        return {
            success: false,
            message: `Failed to update shift status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

export async function cancelShift(
    shiftId: number,
    reason: string
): Promise<{ success: boolean; message: string }> {
    try {
        // Get existing shift to preserve notes
        const [existingShift] = await postgrestDb
            .select({ notes: deptSchema.departmentShifts.notes })
            .from(deptSchema.departmentShifts)
            .where(eq(deptSchema.departmentShifts.id, shiftId))
            .limit(1);

        if (!existingShift) {
            return {
                success: false,
                message: "Shift not found",
            };
        }

        const existingNotes = existingShift.notes || '';
        const updatedNotes = existingNotes + (existingNotes ? ' | ' : '') + `CANCELLED: ${reason}`;

        // Update the shift to cancelled status
        const result = await postgrestDb
            .update(deptSchema.departmentShifts)
            .set({
                status: "cancelled",
                notes: updatedNotes,
            })
            .where(eq(deptSchema.departmentShifts.id, shiftId))
            .returning({ id: deptSchema.departmentShifts.id });

        if (result.length === 0) {
            return {
                success: false,
                message: "Failed to cancel shift",
            };
        }

        return {
            success: true,
            message: "Shift cancelled successfully",
        };
    } catch (error) {
        console.error("Error cancelling shift:", error);
        return {
            success: false,
            message: `Failed to cancel shift: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

export async function getShiftStatistics(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<{
    totalShifts: number;
    completedShifts: number;
    cancelledShifts: number;
    noShowShifts: number;
    averageShiftLength: number; // in hours
    shiftsByType: Record<string, number>;
}> {
    try {
        // Get all shifts for the department in the date range
        const shifts = await postgrestDb
            .select({
                id: deptSchema.departmentShifts.id,
                startTime: deptSchema.departmentShifts.startTime,
                endTime: deptSchema.departmentShifts.endTime,
                shiftType: deptSchema.departmentShifts.shiftType,
                status: deptSchema.departmentShifts.status,
                actualStartTime: deptSchema.departmentShifts.actualStartTime,
                actualEndTime: deptSchema.departmentShifts.actualEndTime,
            })
            .from(deptSchema.departmentShifts)
            .where(
                and(
                    eq(deptSchema.departmentShifts.departmentId, departmentId),
                    gte(deptSchema.departmentShifts.startTime, startDate),
                    lte(deptSchema.departmentShifts.startTime, endDate)
                )
            );

        const totalShifts = shifts.length;
        let completedShifts = 0;
        let cancelledShifts = 0;
        let noShowShifts = 0;
        let totalMinutes = 0;
        const shiftsByType: Record<string, number> = {
            patrol: 0,
            training: 0,
            administrative: 0,
            special_ops: 0,
            court_duty: 0,
        };

        for (const shift of shifts) {
            // Count by status
            if (shift.status === "completed") completedShifts++;
            else if (shift.status === "cancelled") cancelledShifts++;
            else if (shift.status === "no_show") noShowShifts++;

            // Count by type
            if (shiftsByType.hasOwnProperty(shift.shiftType)) {
                shiftsByType[shift.shiftType]++;
            }

            // Calculate shift length using actual times if available, otherwise scheduled times
            const startTime = shift.actualStartTime || shift.startTime;
            const endTime = shift.actualEndTime || shift.endTime;
            const shiftMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60));
            totalMinutes += shiftMinutes;
        }

        const averageShiftLength = totalShifts > 0 ? totalMinutes / totalShifts / 60 : 0; // Convert to hours

        return {
            totalShifts,
            completedShifts,
            cancelledShifts,
            noShowShifts,
            averageShiftLength: Math.round(averageShiftLength * 10) / 10, // Round to 1 decimal
            shiftsByType,
        };
    } catch (error) {
        console.error("Error getting shift statistics:", error);
        // Return default values on error
        return {
            totalShifts: 0,
            completedShifts: 0,
            cancelledShifts: 0,
            noShowShifts: 0,
            averageShiftLength: 0,
            shiftsByType: {
                patrol: 0,
                training: 0,
                administrative: 0,
                special_ops: 0,
                court_duty: 0,
            },
        };
    }
}

export async function generateShiftReport(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<{
    summary: Awaited<ReturnType<typeof getShiftStatistics>>;
    memberStats: Array<{
        memberId: number;
        memberName: string;
        totalShifts: number;
        completedShifts: number;
        totalHours: number;
        attendanceRate: number;
    }>;
    recommendations: string[];
}> {
    try {
        const summary = await getShiftStatistics(departmentId, startDate, endDate);

        // Get member statistics from actual data
        const memberStatsQuery = await postgrestDb
            .select({
                memberId: deptSchema.departmentMembers.id,
                memberName: deptSchema.departmentMembers.roleplayName,
                discordId: deptSchema.departmentMembers.discordId,
                timeClockEntries: {
                    id: deptSchema.departmentTimeClockEntries.id,
                    clockInTime: deptSchema.departmentTimeClockEntries.clockInTime,
                    clockOutTime: deptSchema.departmentTimeClockEntries.clockOutTime,
                    totalMinutes: deptSchema.departmentTimeClockEntries.totalMinutes,
                    status: deptSchema.departmentTimeClockEntries.status,
                    notes: deptSchema.departmentTimeClockEntries.notes,
                },
            })
            .from(deptSchema.departmentMembers)
            .leftJoin(
                deptSchema.departmentTimeClockEntries,
                eq(deptSchema.departmentMembers.id, deptSchema.departmentTimeClockEntries.memberId)
            )
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentMembers.isActive, true),
                    or(
                        sql`${deptSchema.departmentTimeClockEntries.clockInTime} IS NULL`,
                        and(
                            gte(deptSchema.departmentTimeClockEntries.clockInTime, startDate),
                            lte(deptSchema.departmentTimeClockEntries.clockInTime, endDate)
                        )
                    )
                )
            );

        // Group by member and calculate stats
        const memberStatsMap = new Map<number, {
            memberId: number;
            memberName: string;
            totalShifts: number;
            completedShifts: number;
            totalHours: number;
            attendanceRate: number;
        }>();

        for (const row of memberStatsQuery) {
            if (!memberStatsMap.has(row.memberId)) {
                memberStatsMap.set(row.memberId, {
                    memberId: row.memberId,
                    memberName: row.memberName || `User ${row.discordId}`,
                    totalShifts: 0,
                    completedShifts: 0,
                    totalHours: 0,
                    attendanceRate: 0,
                });
            }

            const memberStats = memberStatsMap.get(row.memberId)!;

            if (row.timeClockEntries?.id) {
                memberStats.totalShifts++;

                const shiftStatus = mapTimeClockStatusToShiftStatus(row.timeClockEntries.status);
                if (shiftStatus === "completed") {
                    memberStats.completedShifts++;
                }

                // Calculate hours
                if (row.timeClockEntries.totalMinutes) {
                    memberStats.totalHours += row.timeClockEntries.totalMinutes / 60;
                } else if (row.timeClockEntries.clockOutTime) {
                    const minutes = Math.floor(
                        (row.timeClockEntries.clockOutTime.getTime() - row.timeClockEntries.clockInTime.getTime()) / (1000 * 60)
                    );
                    memberStats.totalHours += minutes / 60;
                }
            }
        }

        // Calculate attendance rates and format
        const memberStats = Array.from(memberStatsMap.values()).map(stats => ({
            ...stats,
            totalHours: Math.round(stats.totalHours * 10) / 10,
            attendanceRate: stats.totalShifts > 0 ? Math.round((stats.completedShifts / stats.totalShifts) * 1000) / 10 : 0,
        }));

        // Generate recommendations based on actual data
        const recommendations = [];

        if (summary.noShowShifts > summary.totalShifts * 0.05) {
            recommendations.push("High no-show rate detected. Consider implementing attendance policies.");
        }

        if (summary.cancelledShifts > summary.totalShifts * 0.1) {
            recommendations.push("High cancellation rate. Review scheduling practices and advance notice requirements.");
        }

        if (summary.averageShiftLength > 10) {
            recommendations.push("Long average shift length detected. Consider fatigue management policies.");
        }

        if (summary.averageShiftLength < 4) {
            recommendations.push("Short average shift length. Consider consolidating shifts for better efficiency.");
        }

        // Check for members with low attendance
        const lowAttendanceMembers = memberStats.filter(m => m.attendanceRate < 80 && m.totalShifts > 5);
        if (lowAttendanceMembers.length > 0) {
            recommendations.push(`${lowAttendanceMembers.length} member(s) have attendance rates below 80%. Consider individual performance reviews.`);
        }

        // Check for uneven shift distribution
        const avgShiftsPerMember = memberStats.length > 0 ? summary.totalShifts / memberStats.length : 0;
        const unevenDistribution = memberStats.some(m =>
            m.totalShifts > avgShiftsPerMember * 1.5 || m.totalShifts < avgShiftsPerMember * 0.5
        );
        if (unevenDistribution && memberStats.length > 1) {
            recommendations.push("Uneven shift distribution detected. Consider balancing workload across members.");
        }

        return {
            summary,
            memberStats,
            recommendations,
        };
    } catch (error) {
        console.error("Error generating shift report:", error);

        // Fallback to basic summary with empty member stats
        const summary = await getShiftStatistics(departmentId, startDate, endDate);
        return {
            summary,
            memberStats: [],
            recommendations: ["Error generating detailed report. Please check system logs."],
        };
    }
}

/**
 * Get upcoming shifts for a member (next 7 days)
 */
export async function getUpcomingShifts(memberId: number): Promise<ShiftSchedule[]> {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return getShiftsForMember(memberId, now, nextWeek);
}

/**
 * Get shift coverage for a department on a specific date
 */
export async function getShiftCoverage(
    departmentId: number,
    date: Date
): Promise<{
    date: Date;
    totalShifts: number;
    activeShifts: number;
    coverage: Array<{
        timeSlot: string;
        memberCount: number;
        members: Array<{
            memberId: number;
            memberName: string;
            shiftType: string;
        }>;
    }>;
}> {
    try {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const shifts = await getShiftsForDepartment(departmentId, startOfDay, endOfDay);

        // Create 24-hour time slots
        const timeSlots = [];
        for (let hour = 0; hour < 24; hour++) {
            const timeSlot = `${hour.toString().padStart(2, '0')}:00-${(hour + 1).toString().padStart(2, '0')}:00`;
            const slotStart = new Date(startOfDay);
            slotStart.setHours(hour);
            const slotEnd = new Date(startOfDay);
            slotEnd.setHours(hour + 1);

            const membersInSlot = shifts.filter(shift => {
                return shift.startTime <= slotEnd && shift.endTime >= slotStart;
            });

            // Get member names for this slot
            const membersWithNames = await Promise.all(
                membersInSlot.map(async shift => ({
                    memberId: shift.memberId,
                    memberName: await getMemberName(shift.memberId),
                    shiftType: shift.shiftType,
                }))
            );

            timeSlots.push({
                timeSlot,
                memberCount: membersInSlot.length,
                members: membersWithNames,
            });
        }

        const activeShifts = shifts.filter(s => s.status === "in_progress" || s.status === "scheduled").length;

        return {
            date,
            totalShifts: shifts.length,
            activeShifts,
            coverage: timeSlots,
        };
    } catch (error) {
        console.error("Error getting shift coverage:", error);
        return {
            date,
            totalShifts: 0,
            activeShifts: 0,
            coverage: [],
        };
    }
}

/**
 * Bulk schedule shifts for multiple members
 */
export async function bulkScheduleShifts(
    shifts: Array<{
        departmentId: number;
        memberId: number;
        startTime: Date;
        endTime: Date;
        shiftType: "patrol" | "training" | "administrative" | "special_ops" | "court_duty";
        notes?: string;
    }>,
    scheduledBy?: string
): Promise<{
    success: boolean;
    results: Array<{
        memberId: number;
        result: SchedulingResult;
    }>;
    summary: {
        total: number;
        successful: number;
        failed: number;
    };
}> {
    const results: Array<{
        memberId: number;
        result: SchedulingResult;
    }> = [];

    let successful = 0;
    let failed = 0;

    for (const shift of shifts) {
        try {
            const result = await scheduleShift({
                ...shift,
                scheduledBy,
            });

            results.push({
                memberId: shift.memberId,
                result,
            });

            if (result.success) {
                successful++;
            } else {
                failed++;
            }
        } catch (error) {
            results.push({
                memberId: shift.memberId,
                result: {
                    success: false,
                    message: `Failed to schedule shift: ${error instanceof Error ? error.message : 'Unknown error'}`,
                },
            });
            failed++;
        }
    }

    return {
        success: successful > 0,
        results,
        summary: {
            total: shifts.length,
            successful,
            failed,
        },
    };
}

/**
 * Get shift templates for common scheduling patterns
 */
export async function getShiftTemplates(departmentId: number): Promise<Array<{
    id: string;
    name: string;
    description: string;
    shiftType: ShiftSchedule['shiftType'];
    duration: number; // in hours
    defaultStartTime: string; // HH:MM format
}>> {
    // These could be stored in database, but for now return common templates
    return [
        {
            id: "patrol_day",
            name: "Day Patrol",
            description: "Standard daytime patrol shift",
            shiftType: "patrol",
            duration: 8,
            defaultStartTime: "08:00",
        },
        {
            id: "patrol_night",
            name: "Night Patrol",
            description: "Standard nighttime patrol shift",
            shiftType: "patrol",
            duration: 8,
            defaultStartTime: "20:00",
        },
        {
            id: "training_session",
            name: "Training Session",
            description: "Standard training session",
            shiftType: "training",
            duration: 4,
            defaultStartTime: "14:00",
        },
        {
            id: "admin_duty",
            name: "Administrative Duty",
            description: "Office and administrative work",
            shiftType: "administrative",
            duration: 6,
            defaultStartTime: "09:00",
        },
        {
            id: "special_ops",
            name: "Special Operations",
            description: "Special operations deployment",
            shiftType: "special_ops",
            duration: 6,
            defaultStartTime: "18:00",
        },
        {
            id: "court_duty",
            name: "Court Duty",
            description: "Court appearance and testimony",
            shiftType: "court_duty",
            duration: 4,
            defaultStartTime: "10:00",
        },
    ];
}