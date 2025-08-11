import { z } from "zod";
import { eq, and, desc, asc, sql, inArray, gte, lte, between, count, avg, sum } from "drizzle-orm";
import { adminProcedure, protectedProcedure, createTRPCRouter } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

// Import services
import {
    generatePerformanceReport,
    calculateMemberMetrics,
    getDepartmentAnalytics,
    scheduleShift,
    manageEquipment,
    createIncidentReport,
    conductPerformanceReview,
    sendDepartmentAnnouncement,
    bulkUpdateMembers,
    searchMembersAdvanced,
    searchAnnouncements,
    bulkPromoteMembers,
} from "@/server/api/services/department";

// Enhanced validation schemas
const performanceMetricsSchema = z.object({
    memberId: z.number().int().positive(),
    startDate: z.date(),
    endDate: z.date(),
    includeTraining: z.boolean().default(true),
    includeAttendance: z.boolean().default(true),
    includeDisciplinary: z.boolean().default(true),
});

const shiftScheduleSchema = z.object({
    departmentId: z.number().int().positive(),
    memberId: z.number().int().positive(),
    startTime: z.date(),
    endTime: z.date(),
    shiftType: z.enum(["patrol", "training", "administrative", "special_ops", "court_duty"]),
    notes: z.string().optional(),
});

const equipmentAssignmentSchema = z.object({
    memberId: z.number().int().positive(),
    equipmentId: z.number().int().positive(),
    assignedDate: z.date().default(() => new Date()),
    returnDate: z.date().optional(),
    condition: z.enum(["excellent", "good", "fair", "poor", "damaged"]).default("good"),
    notes: z.string().optional(),
});

const incidentReportSchema = z.object({
    departmentId: z.number().int().positive(),
    reportingMemberId: z.number().int().positive(),
    incidentType: z.enum(["arrest", "citation", "investigation", "emergency_response", "training", "other"]),
    title: z.string().min(1).max(200),
    description: z.string().min(10),
    location: z.string().optional(),
    dateOccurred: z.date(),
    involvedMembers: z.array(z.number().int().positive()).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    status: z.enum(["draft", "submitted"]).default("draft"),
});

const performanceReviewSchema = z.object({
    memberId: z.number().int().positive(),
    reviewerId: z.number().int().positive(),
    reviewPeriodStart: z.date(),
    reviewPeriodEnd: z.date(),
    overallRating: z.number().min(1).max(5),
    strengths: z.string(),
    areasForImprovement: z.string(),
    goals: z.string(),
    recommendedActions: z.array(z.enum(["promotion", "training", "mentoring", "disciplinary", "no_action"])),
});

const announcementSchema = z.object({
    departmentId: z.number().int().positive(),
    title: z.string().min(1).max(200),
    content: z.string().min(1),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    targetAudience: z.enum(["all_members", "active_only", "specific_ranks", "specific_teams"]),
    targetRankIds: z.array(z.number().int().positive()).optional(),
    targetTeamIds: z.array(z.number().int().positive()).optional(),
    expiresAt: z.date().optional(),
    requiresAcknowledgment: z.boolean().default(false),
});

const bulkUpdateSchema = z.object({
    memberIds: z.array(z.number().int().positive()).min(1),
    updates: z.object({
        status: deptSchema.departmentMemberStatusEnum.optional(),
        rankId: z.number().int().positive().optional(),
        primaryTeamId: z.number().int().positive().optional(),
        notes: z.string().optional(),
    }),
    reason: z.string().min(1, "Reason for bulk update is required"),
});

const advancedSearchSchema = z.object({
    departmentId: z.number().int().positive().optional(),
    status: z.array(deptSchema.departmentMemberStatusEnum).optional(),
    rankIds: z.array(z.number().int().positive()).optional(),
    teamIds: z.array(z.number().int().positive()).optional(),
    hireDateFrom: z.date().optional(),
    hireDateTo: z.date().optional(),
    searchTerm: z.string().optional(), // Search in names, callsigns, badge numbers
    sortBy: z.enum(["name", "rank", "hire_date", "status", "callsign"]).default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
});

export const deptMoreRouter = createTRPCRouter({
    // ===== PERMISSION HELPERS =====
    // Helper procedure-less functions to check membership and permissions consistently
    // Note: These are plain functions, used within routes below
    
    // ... routes continue below ...
    // ===== PERFORMANCE ANALYTICS =====
    analytics: createTRPCRouter({
        // Get department-wide analytics
        getDepartmentStats: protectedProcedure
            .input(z.object({
                departmentId: z.number().int().positive(),
                timeframe: z.enum(["week", "month", "quarter", "year"]).default("month"),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Ensure requester is an active member of this department
                    const requester = await postgrestDb
                        .select({
                            id: deptSchema.departmentMembers.id,
                        })
                        .from(deptSchema.departmentMembers)
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (requester.length === 0) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this department" });
                    }
                    return await getDepartmentAnalytics(input.departmentId, input.timeframe);
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to get department analytics: ${error}`,
                    });
                }
            }),

        // Get individual member performance metrics
        getMemberMetrics: protectedProcedure
            .input(performanceMetricsSchema)
            .query(async ({ input, ctx }) => {
                try {
                    return await calculateMemberMetrics(input);
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to calculate member metrics: ${error}`,
                    });
                }
            }),

        // Generate comprehensive performance report
        generateReport: protectedProcedure
            .input(z.object({
                departmentId: z.number().int().positive(),
                reportType: z.enum(["monthly", "quarterly", "annual", "custom"]),
                startDate: z.date().optional(),
                endDate: z.date().optional(),
                includeCharts: z.boolean().default(true),
            }))
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_department or manage_members to generate reports
                    const perm = await postgrestDb
                        .select({ permissions: deptSchema.departmentRanks.permissions })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    const permissions = perm[0]?.permissions;
                    if (!permissions?.manage_department && !permissions?.manage_members) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to generate reports" });
                    }
                    return await generatePerformanceReport(input);
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to generate performance report: ${error}`,
                    });
                }
            }),
    }),

    // ===== SHIFT SCHEDULING =====
    scheduling: createTRPCRouter({
        // Schedule a shift for a member
        scheduleShift: protectedProcedure
            .input(shiftScheduleSchema)
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_members to schedule shifts in the department
                    const perm = await postgrestDb
                        .select({ permissions: deptSchema.departmentRanks.permissions })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    const permissions = perm[0]?.permissions;
                    if (!permissions?.manage_members) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to schedule shifts" });
                    }
                    return await scheduleShift(input);
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to schedule shift: ${error}`,
                    });
                }
            }),

        // Get shifts for a department or member
        getShifts: protectedProcedure
            .input(z.object({
                departmentId: z.number().int().positive().optional(),
                memberId: z.number().int().positive().optional(),
                startDate: z.date(),
                endDate: z.date(),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Must be an active member of the queried department (if departmentId provided)
                    if (input.departmentId) {
                        const requester = await postgrestDb
                            .select({ id: deptSchema.departmentMembers.id })
                            .from(deptSchema.departmentMembers)
                            .where(and(
                                eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                                eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                                eq(deptSchema.departmentMembers.isActive, true)
                            ))
                            .limit(1);
                        if (requester.length === 0) {
                            throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this department" });
                        }
                    }
                    // Build where conditions
                    const conditions = [];

                    if (input.departmentId) {
                        conditions.push(eq(deptSchema.departmentShifts.departmentId, input.departmentId));
                    }

                    if (input.memberId) {
                        conditions.push(eq(deptSchema.departmentShifts.memberId, input.memberId));
                    }

                    // Add date range conditions
                    conditions.push(gte(deptSchema.departmentShifts.startTime, input.startDate));
                    conditions.push(lte(deptSchema.departmentShifts.startTime, input.endDate));

                    // Get shifts with member information
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
                            scheduledBy: deptSchema.departmentShifts.scheduledBy,
                            actualStartTime: deptSchema.departmentShifts.actualStartTime,
                            actualEndTime: deptSchema.departmentShifts.actualEndTime,
                            createdAt: deptSchema.departmentShifts.createdAt,
                            updatedAt: deptSchema.departmentShifts.updatedAt,
                            memberName: deptSchema.departmentMembers.roleplayName,
                            memberCallsign: deptSchema.departmentMembers.callsign,
                        })
                        .from(deptSchema.departmentShifts)
                        .leftJoin(
                            deptSchema.departmentMembers,
                            eq(deptSchema.departmentShifts.memberId, deptSchema.departmentMembers.id)
                        )
                        .where(and(...conditions))
                        .orderBy(asc(deptSchema.departmentShifts.startTime));

                    return shifts.map(shift => ({
                        id: shift.id,
                        memberId: shift.memberId,
                        memberName: shift.memberName || shift.memberCallsign || `Member ${shift.memberId}`,
                        memberCallsign: shift.memberCallsign || "",
                        startTime: shift.startTime,
                        endTime: shift.endTime,
                        shiftType: shift.shiftType,
                        status: shift.status,
                        notes: shift.notes || "",
                        scheduledBy: shift.scheduledBy,
                        actualStartTime: shift.actualStartTime,
                        actualEndTime: shift.actualEndTime,
                        createdAt: shift.createdAt,
                        updatedAt: shift.updatedAt,
                    }));
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to get shifts: ${error}`,
                    });
                }
            }),
    }),

    // ===== EQUIPMENT MANAGEMENT =====
    equipment: createTRPCRouter({
        // Get equipment for a department
        getEquipment: protectedProcedure
            .input(z.object({
                departmentId: z.number().int().positive(),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Membership required
                    const requester = await postgrestDb
                        .select({ id: deptSchema.departmentMembers.id })
                        .from(deptSchema.departmentMembers)
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (requester.length === 0) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this department" });
                    }
                    // Get all equipment for the department with assignment info
                    const equipment = await postgrestDb
                        .select({
                            id: deptSchema.departmentEquipment.id,
                            name: deptSchema.departmentEquipment.name,
                            category: deptSchema.departmentEquipment.category,
                            type: deptSchema.departmentEquipment.category, // Using category as type for compatibility
                            serialNumber: deptSchema.departmentEquipment.serialNumber,
                            model: deptSchema.departmentEquipment.model,
                            manufacturer: deptSchema.departmentEquipment.manufacturer,
                            condition: deptSchema.departmentEquipment.condition,
                            location: deptSchema.departmentEquipment.location,
                            isAssignable: deptSchema.departmentEquipment.isAssignable,
                            requiresTraining: deptSchema.departmentEquipment.requiresTraining,
                            notes: deptSchema.departmentEquipment.notes,
                            isActive: deptSchema.departmentEquipment.isActive,
                            createdAt: deptSchema.departmentEquipment.createdAt,
                        })
                        .from(deptSchema.departmentEquipment)
                        .where(
                            and(
                                eq(deptSchema.departmentEquipment.departmentId, input.departmentId),
                                eq(deptSchema.departmentEquipment.isActive, true)
                            )
                        )
                        .orderBy(asc(deptSchema.departmentEquipment.name));

                    // Get active assignments to determine status and assigned member info
                    const activeAssignments = await postgrestDb
                        .select({
                            equipmentId: deptSchema.departmentEquipmentAssignments.equipmentId,
                            memberId: deptSchema.departmentEquipmentAssignments.memberId,
                            assignedDate: deptSchema.departmentEquipmentAssignments.assignedDate,
                            memberName: deptSchema.departmentMembers.roleplayName,
                            memberCallsign: deptSchema.departmentMembers.callsign,
                        })
                        .from(deptSchema.departmentEquipmentAssignments)
                        .innerJoin(
                            deptSchema.departmentMembers,
                            eq(deptSchema.departmentEquipmentAssignments.memberId, deptSchema.departmentMembers.id)
                        )
                        .innerJoin(
                            deptSchema.departmentEquipment,
                            eq(deptSchema.departmentEquipmentAssignments.equipmentId, deptSchema.departmentEquipment.id)
                        )
                        .where(
                            and(
                                eq(deptSchema.departmentEquipment.departmentId, input.departmentId),
                                eq(deptSchema.departmentEquipmentAssignments.isActive, true)
                            )
                        );

                    // Create a map of equipment assignments
                    const assignmentMap = new Map(
                        activeAssignments.map(assignment => [
                            assignment.equipmentId,
                            {
                                assignedTo: assignment.memberName || assignment.memberCallsign || `Member ${assignment.memberId}`,
                                assignedDate: assignment.assignedDate,
                            }
                        ])
                    );

                    // Combine equipment data with assignment info
                    return equipment.map(item => {
                        const assignment = assignmentMap.get(item.id);
                        return {
                            id: item.id,
                            name: item.name,
                            category: item.category,
                            type: item.type,
                            serialNumber: item.serialNumber || "",
                            model: item.model || "",
                            manufacturer: item.manufacturer || "",
                            condition: item.condition,
                            location: item.location || "",
                            isAssignable: item.isAssignable,
                            requiresTraining: item.requiresTraining,
                            notes: item.notes || "",
                            isActive: item.isActive,
                            createdAt: item.createdAt,
                            status: assignment ? "assigned" : "available",
                            assignedTo: assignment?.assignedTo || null,
                            assignedDate: assignment?.assignedDate || null,
                        };
                    });
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to get equipment: ${error}`,
                    });
                }
            }),

        // Assign equipment to member
        assignEquipment: protectedProcedure
            .input(equipmentAssignmentSchema)
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_members for the department of the target member
                    const memberRow = await postgrestDb
                        .select({ departmentId: deptSchema.departmentMembers.departmentId })
                        .from(deptSchema.departmentMembers)
                        .where(eq(deptSchema.departmentMembers.id, input.memberId))
                        .limit(1);
                    if (memberRow.length === 0) {
                        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
                    }
                    const departmentId = memberRow[0]!.departmentId;
                    const perm = await postgrestDb
                        .select({ permissions: deptSchema.departmentRanks.permissions })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (!perm[0]?.permissions?.manage_members) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to assign equipment" });
                    }
                    const assignResult = await manageEquipment("assign", input);
                    // Audit log
                    const actor = await postgrestDb
                      .select({ id: deptSchema.departmentMembers.id })
                      .from(deptSchema.departmentMembers)
                      .where(and(
                        eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                        eq(deptSchema.departmentMembers.departmentId, departmentId),
                        eq(deptSchema.departmentMembers.isActive, true)
                      ))
                      .limit(1);
                    const performedBy = actor[0]?.id ? String(ctx.dbUser.discordId) : "system";
                    await postgrestDb.insert(deptSchema.departmentMemberAuditLogs).values({
                      memberId: input.memberId,
                      departmentId,
                      actionType: 'equipment_assigned',
                      reason: input.notes ?? null,
                      details: {
                        equipmentId: input.equipmentId,
                        assignedDate: input.assignedDate,
                        condition: input.condition,
                        success: assignResult?.success ?? true,
                      },
                      performedBy,
                    });
                    return assignResult;
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to assign equipment: ${error}`,
                    });
                }
            }),

        // Return equipment from member
        returnEquipment: protectedProcedure
            .input(z.object({
                assignmentId: z.number().int().positive(),
                returnCondition: z.enum(["excellent", "good", "fair", "poor", "damaged"]),
                returnNotes: z.string().optional(),
            }))
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_members (look up assignment to derive department)
                    const assignment = await postgrestDb
                        .select({
                            departmentId: deptSchema.departmentEquipment.departmentId,
                        })
                        .from(deptSchema.departmentEquipmentAssignments)
                        .innerJoin(
                            deptSchema.departmentEquipment,
                            eq(deptSchema.departmentEquipmentAssignments.equipmentId, deptSchema.departmentEquipment.id)
                        )
                        .where(eq(deptSchema.departmentEquipmentAssignments.id, input.assignmentId))
                        .limit(1);
                    if (assignment.length === 0) {
                        throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found" });
                    }
                    const perm = await postgrestDb
                        .select({ permissions: deptSchema.departmentRanks.permissions })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, assignment[0]!.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (!perm[0]?.permissions?.manage_members) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to return equipment" });
                    }
                    const returnResult = await manageEquipment("return", input);
                    // Fetch assignment/member for audit
                    const assignmentInfo = await postgrestDb
                      .select({
                        memberId: deptSchema.departmentEquipmentAssignments.memberId,
                        equipmentId: deptSchema.departmentEquipmentAssignments.equipmentId,
                      })
                      .from(deptSchema.departmentEquipmentAssignments)
                      .where(eq(deptSchema.departmentEquipmentAssignments.id, input.assignmentId))
                      .limit(1);
                    const memberId = assignmentInfo[0]?.memberId;
                    await postgrestDb.insert(deptSchema.departmentMemberAuditLogs).values({
                      memberId: memberId ?? 0,
                      departmentId: assignment[0]!.departmentId,
                      actionType: 'equipment_returned',
                      reason: input.returnNotes ?? null,
                      details: {
                        equipmentId: assignmentInfo[0]?.equipmentId ?? null,
                        assignmentId: input.assignmentId,
                        returnCondition: input.returnCondition,
                        success: returnResult?.success ?? true,
                      },
                      performedBy: String(ctx.dbUser.discordId),
                    });
                    return returnResult;
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to return equipment: ${error}`,
                    });
                }
            }),
    }),

    // ===== INCIDENT REPORTING =====
    incidents: createTRPCRouter({
        // Create incident report
        createReport: protectedProcedure
            .input(incidentReportSchema)
            .mutation(async ({ input, ctx }) => {
                try {
                    // Ensure the actor is the reporting member and active in department
                    const actorMember = await postgrestDb
                        .select({ id: deptSchema.departmentMembers.id })
                        .from(deptSchema.departmentMembers)
                        .where(and(
                            eq(deptSchema.departmentMembers.id, input.reportingMemberId),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (actorMember.length === 0) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You can only file reports for yourself in this department" });
                    }
                    return await createIncidentReport(input);
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to create incident report: ${error}`,
                    });
                }
            }),

        // Update incident report (drafts or if manager)
        updateReport: protectedProcedure
            .input(z.object({
                id: z.number().int().positive(),
                title: z.string().min(1).max(200).optional(),
                description: z.string().min(1).optional(),
                location: z.string().optional().nullable(),
                status: z.enum(["draft", "submitted"]).optional(),
            }))
            .mutation(async ({ input, ctx }) => {
                try {
                    // Load incident and member
                    const inc = await postgrestDb
                      .select({
                        departmentId: deptSchema.departmentIncidents.departmentId,
                        reportingMemberId: deptSchema.departmentIncidents.reportingMemberId,
                        status: deptSchema.departmentIncidents.status,
                      })
                      .from(deptSchema.departmentIncidents)
                      .where(eq(deptSchema.departmentIncidents.id, input.id))
                      .limit(1);
                    if (inc.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
                    const incident = inc[0]!;

                    // Check permissions: author can edit drafts; managers can edit
                    const memberRow = await postgrestDb
                      .select({ id: deptSchema.departmentMembers.id, permissions: deptSchema.departmentRanks.permissions })
                      .from(deptSchema.departmentMembers)
                      .leftJoin(deptSchema.departmentRanks, eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id))
                      .where(and(
                        eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                        eq(deptSchema.departmentMembers.departmentId, incident.departmentId),
                        eq(deptSchema.departmentMembers.isActive, true)
                      ))
                      .limit(1);
                    if (memberRow.length === 0) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this department' });
                    const isAuthor = memberRow[0]!.id === incident.reportingMemberId;
                    const isManager = !!memberRow[0]!.permissions?.manage_members;
                    if (!isAuthor && !isManager) throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to edit incident' });
                    if (isAuthor && incident.status !== 'draft') throw new TRPCError({ code: 'FORBIDDEN', message: 'Only drafts can be edited by the author' });

                    const update: any = {};
                    if (input.title !== undefined) update.title = input.title;
                    if (input.description !== undefined) update.description = input.description;
                    if (input.location !== undefined) update.location = input.location;
                    if (input.status !== undefined) update.status = input.status;
                    update.updatedAt = new Date();
                    await postgrestDb
                      .update(deptSchema.departmentIncidents)
                      .set(update)
                      .where(eq(deptSchema.departmentIncidents.id, input.id));
                    return { success: true };
                } catch (error) {
                    if (error instanceof TRPCError) throw error;
                    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to update incident report: ${error}` });
                }
            }),

        // Get incident reports
        getReports: protectedProcedure
            .input(z.object({
                departmentId: z.number().int().positive(),
                status: z.enum(["draft", "submitted", "under_review", "approved", "rejected"]).optional(),
                dateFrom: z.date().optional(),
                dateTo: z.date().optional(),
                limit: z.number().int().min(1).max(100).default(50),
                offset: z.number().int().min(0).default(0),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Membership required
                    const requester = await postgrestDb
                        .select({ id: deptSchema.departmentMembers.id })
                        .from(deptSchema.departmentMembers)
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (requester.length === 0) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this department" });
                    }
                    // Build where conditions
                    const conditions = [
                        eq(deptSchema.departmentIncidents.departmentId, input.departmentId),
                        eq(deptSchema.departmentIncidents.isActive, true),
                    ];

                    if (input.status) {
                        conditions.push(eq(deptSchema.departmentIncidents.status, input.status));
                    }

                    if (input.dateFrom) {
                        conditions.push(gte(deptSchema.departmentIncidents.dateOccurred, input.dateFrom));
                    }

                    if (input.dateTo) {
                        conditions.push(lte(deptSchema.departmentIncidents.dateOccurred, input.dateTo));
                    }

                    // Get total count
                    const totalResult = await postgrestDb
                        .select({ count: sql<number>`count(*)` })
                        .from(deptSchema.departmentIncidents)
                        .where(and(...conditions));

                    const total = totalResult[0]?.count || 0;

                    // Get incidents with pagination
                    const incidents = await postgrestDb
                        .select({
                            id: deptSchema.departmentIncidents.id,
                            departmentId: deptSchema.departmentIncidents.departmentId,
                            reportingMemberId: deptSchema.departmentIncidents.reportingMemberId,
                            incidentNumber: deptSchema.departmentIncidents.incidentNumber,
                            incidentType: deptSchema.departmentIncidents.incidentType,
                            title: deptSchema.departmentIncidents.title,
                            description: deptSchema.departmentIncidents.description,
                            location: deptSchema.departmentIncidents.location,
                            dateOccurred: deptSchema.departmentIncidents.dateOccurred,
                            dateReported: deptSchema.departmentIncidents.dateReported,
                            involvedMembers: deptSchema.departmentIncidents.involvedMembers,
                            severity: deptSchema.departmentIncidents.severity,
                            status: deptSchema.departmentIncidents.status,
                            reviewedBy: deptSchema.departmentIncidents.reviewedBy,
                            reviewedAt: deptSchema.departmentIncidents.reviewedAt,
                            reviewNotes: deptSchema.departmentIncidents.reviewNotes,
                            followUpRequired: deptSchema.departmentIncidents.followUpRequired,
                            followUpDate: deptSchema.departmentIncidents.followUpDate,
                            tags: deptSchema.departmentIncidents.tags,
                            isActive: deptSchema.departmentIncidents.isActive,
                            createdAt: deptSchema.departmentIncidents.createdAt,
                            updatedAt: deptSchema.departmentIncidents.updatedAt,
                        })
                        .from(deptSchema.departmentIncidents)
                        .where(and(...conditions))
                        .orderBy(desc(deptSchema.departmentIncidents.dateOccurred))
                        .limit(input.limit)
                        .offset(input.offset);

                    // Get reporting member information for each incident
                    const reportsWithDetails = await Promise.all(
                        incidents.map(async (incident) => {
                            // Get reporting member information
                            const reportingMember = await postgrestDb
                                .select({
                                    roleplayName: deptSchema.departmentMembers.roleplayName,
                                    callsign: deptSchema.departmentMembers.callsign,
                                })
                                .from(deptSchema.departmentMembers)
                                .where(eq(deptSchema.departmentMembers.id, incident.reportingMemberId))
                                .limit(1);

                            return {
                                id: incident.id,
                                title: incident.title,
                                description: incident.description,
                                incidentType: incident.incidentType,
                                severity: incident.severity,
                                status: incident.status,
                                location: incident.location,
                                dateOccurred: incident.dateOccurred,
                                reportingMember: reportingMember[0]?.roleplayName || reportingMember[0]?.callsign || `Member ${incident.reportingMemberId}`,
                                involvedMembers: incident.involvedMembers || [],
                            };
                        })
                    );

                    return { reports: reportsWithDetails, total };
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to get incident reports: ${error}`,
                    });
                }
            }),
    }),

    // ===== PERFORMANCE REVIEWS =====
    reviews: createTRPCRouter({
        // Conduct performance review
        conductReview: protectedProcedure
            .input(performanceReviewSchema)
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_members in the department of the member being reviewed
                    const memberDept = await postgrestDb
                        .select({ departmentId: deptSchema.departmentMembers.departmentId })
                        .from(deptSchema.departmentMembers)
                        .where(eq(deptSchema.departmentMembers.id, input.memberId))
                        .limit(1);
                    if (memberDept.length === 0) {
                        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
                    }
                    const departmentId = memberDept[0]!.departmentId;
                    const perm = await postgrestDb
                        .select({ permissions: deptSchema.departmentRanks.permissions, id: deptSchema.departmentMembers.id })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    const permissions = perm[0]?.permissions;
                    if (!permissions?.manage_members) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to conduct reviews" });
                    }
                    // Reviewer must be the actor's member id
                    const reviewerId = perm[0]!.id;
                    return await conductPerformanceReview({ ...input, reviewerId });
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to conduct performance review: ${error}`,
                    });
                }
            }),

        // Get performance reviews
        getReviews: protectedProcedure
            .input(z.object({
                memberId: z.number().int().positive().optional(),
                departmentId: z.number().int().positive().optional(),
                dateFrom: z.date().optional(),
                dateTo: z.date().optional(),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Must be a member of the department to view reviews (if department scope provided)
                    if (input.departmentId) {
                        const requester = await postgrestDb
                            .select({ id: deptSchema.departmentMembers.id })
                            .from(deptSchema.departmentMembers)
                            .where(and(
                                eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                                eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                                eq(deptSchema.departmentMembers.isActive, true)
                            ))
                            .limit(1);
                        if (requester.length === 0) {
                            throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this department" });
                        }
                    }
                    // Build the where conditions
                    const whereConditions = [];

                    if (input.departmentId) {
                        whereConditions.push(
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId)
                        );
                    }

                    if (input.memberId) {
                        whereConditions.push(
                            eq(deptSchema.departmentPerformanceReviews.memberId, input.memberId)
                        );
                    }

                    if (input.dateFrom) {
                        whereConditions.push(
                            gte(deptSchema.departmentPerformanceReviews.reviewPeriodStart, input.dateFrom)
                        );
                    }

                    if (input.dateTo) {
                        whereConditions.push(
                            lte(deptSchema.departmentPerformanceReviews.reviewPeriodEnd, input.dateTo)
                        );
                    }

                    // Create aliases for the member tables to avoid ambiguity
                    const memberAlias = deptSchema.departmentMembers;
                    const reviewerAlias = deptSchema.departmentMembers;

                    // First, get the basic review data without joins to avoid relation conflicts
                    const reviews = await postgrestDb
                        .select({
                            id: deptSchema.departmentPerformanceReviews.id,
                            memberId: deptSchema.departmentPerformanceReviews.memberId,
                            reviewerId: deptSchema.departmentPerformanceReviews.reviewerId,
                            reviewPeriodStart: deptSchema.departmentPerformanceReviews.reviewPeriodStart,
                            reviewPeriodEnd: deptSchema.departmentPerformanceReviews.reviewPeriodEnd,
                            overallRating: deptSchema.departmentPerformanceReviews.overallRating,
                            strengths: deptSchema.departmentPerformanceReviews.strengths,
                            areasForImprovement: deptSchema.departmentPerformanceReviews.areasForImprovement,
                            goals: deptSchema.departmentPerformanceReviews.goals,
                            recommendedActions: deptSchema.departmentPerformanceReviews.recommendedActions,
                            createdAt: deptSchema.departmentPerformanceReviews.createdAt,
                        })
                        .from(deptSchema.departmentPerformanceReviews)
                        .where(
                            input.departmentId ?
                                sql`EXISTS (
                                    SELECT 1 FROM ${deptSchema.departmentMembers} 
                                    WHERE ${deptSchema.departmentMembers.id} = ${deptSchema.departmentPerformanceReviews.memberId}
                                    AND ${deptSchema.departmentMembers.departmentId} = ${input.departmentId}
                                )` :
                                undefined
                        )
                        .orderBy(desc(deptSchema.departmentPerformanceReviews.createdAt));

                    // Get member and reviewer information separately for each review
                    const reviewsWithDetails = await Promise.all(
                        reviews.map(async (review) => {
                            // Get member information
                            const member = await postgrestDb
                                .select({
                                    roleplayName: deptSchema.departmentMembers.roleplayName,
                                    callsign: deptSchema.departmentMembers.callsign,
                                })
                                .from(deptSchema.departmentMembers)
                                .where(eq(deptSchema.departmentMembers.id, review.memberId))
                                .limit(1);

                            // Get reviewer information
                            const reviewer = await postgrestDb
                                .select({
                                    roleplayName: deptSchema.departmentMembers.roleplayName,
                                    callsign: deptSchema.departmentMembers.callsign,
                                })
                                .from(deptSchema.departmentMembers)
                                .where(eq(deptSchema.departmentMembers.id, review.reviewerId))
                                .limit(1);

                            return {
                                ...review,
                                memberName: member[0]?.roleplayName || `Member ${review.memberId}`,
                                memberCallsign: member[0]?.callsign || "",
                                reviewerName: reviewer[0]?.roleplayName || reviewer[0]?.callsign || `Reviewer ${review.reviewerId}`,
                            };
                        })
                    );

                    return reviewsWithDetails.map(review => ({
                        id: review.id,
                        memberId: review.memberId,
                        memberName: review.memberName || `Member ${review.memberId}`,
                        memberCallsign: review.memberCallsign || "",
                        reviewerId: review.reviewerId,
                        reviewerName: review.reviewerName || `Reviewer ${review.reviewerId}`,
                        reviewPeriodStart: review.reviewPeriodStart,
                        reviewPeriodEnd: review.reviewPeriodEnd,
                        overallRating: review.overallRating,
                        strengths: review.strengths,
                        areasForImprovement: review.areasForImprovement,
                        goals: review.goals,
                        recommendedActions: review.recommendedActions || [],
                        createdAt: review.createdAt,
                    }));
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to get performance reviews: ${error}`,
                    });
                }
            }),
    }),

    // ===== COMMUNICATION =====
    communication: createTRPCRouter({
        getAcknowledgments: protectedProcedure
            .input(z.object({ announcementId: z.number().int().positive() }))
            .query(async ({ input, ctx }) => {
                try {
                    const rows = await postgrestDb
                      .select({
                        memberId: deptSchema.departmentAnnouncementAcknowledgments.memberId,
                        acknowledgedAt: deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt,
                        memberName: deptSchema.departmentMembers.roleplayName,
                        memberCallsign: deptSchema.departmentMembers.callsign,
                      })
                      .from(deptSchema.departmentAnnouncementAcknowledgments)
                      .innerJoin(
                        deptSchema.departmentMembers,
                        eq(deptSchema.departmentAnnouncementAcknowledgments.memberId, deptSchema.departmentMembers.id)
                      )
                      .where(eq(deptSchema.departmentAnnouncementAcknowledgments.announcementId, input.announcementId))
                      .orderBy(desc(deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt));
                    return rows.map(r => ({
                      memberId: r.memberId,
                      memberName: r.memberName || r.memberCallsign || `Member ${r.memberId}`,
                      acknowledgedAt: r.acknowledgedAt,
                    }));
                } catch (error) {
                    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to get acknowledgments: ${error}` });
                }
            }),
        // Send department announcement
        sendAnnouncement: protectedProcedure
            .input(announcementSchema)
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_members to send announcements
                    const perm = await postgrestDb
                        .select({ id: deptSchema.departmentMembers.id, permissions: deptSchema.departmentRanks.permissions })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    const permissions = perm[0]?.permissions;
                    const authorMemberId = perm[0]?.id;
                    if (!authorMemberId) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this department" });
                    }
                    if (!permissions?.manage_members && !permissions?.manage_department) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to send announcements" });
                    }
                    return await sendDepartmentAnnouncement({
                        ...input,
                        authorId: authorMemberId,
                    });
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to send announcement: ${error}`,
                    });
                }
            }),

        // Get announcements
        getAnnouncements: protectedProcedure
            .input(z.object({
                departmentId: z.number().int().positive(),
                activeOnly: z.boolean().default(true),
                limit: z.number().int().min(1).max(50).default(20),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Membership required
                    const requester = await postgrestDb
                        .select({ id: deptSchema.departmentMembers.id })
                        .from(deptSchema.departmentMembers)
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, input.departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (requester.length === 0) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this department" });
                    }
                    console.log("Getting announcements for department:", input.departmentId);
                    
                    // Get announcements using the search service
                    const result = await searchAnnouncements({
                        departmentId: input.departmentId,
                        isActive: input.activeOnly ? true : undefined,
                        limit: input.limit,
                        offset: 0,
                    });

                    console.log(`Found ${result.announcements.length} announcements`);

                    // Get author information for each announcement
                    const announcementsWithAuthors = await Promise.all(
                        result.announcements.map(async (announcement) => {
                            // Get author information
                            const author = await postgrestDb
                                .select({
                                    roleplayName: deptSchema.departmentMembers.roleplayName,
                                    callsign: deptSchema.departmentMembers.callsign,
                                })
                                .from(deptSchema.departmentMembers)
                                .where(eq(deptSchema.departmentMembers.id, announcement.authorId))
                                .limit(1);

                            // Calculate total targets and acknowledgments
                            let totalTargets = 0;
                            
                            // Build conditions based on target audience
                            const conditions = [eq(deptSchema.departmentMembers.departmentId, announcement.departmentId)];
                            
                            switch (announcement.targetAudience) {
                                case "active_only":
                                    conditions.push(eq(deptSchema.departmentMembers.isActive, true));
                                    break;
                                case "specific_ranks":
                                    conditions.push(eq(deptSchema.departmentMembers.isActive, true));
                                    if (announcement.targetRankIds && announcement.targetRankIds.length > 0) {
                                        conditions.push(inArray(deptSchema.departmentMembers.rankId, announcement.targetRankIds));
                                    }
                                    break;
                                case "specific_teams":
                                    conditions.push(eq(deptSchema.departmentMembers.isActive, true));
                                    if (announcement.targetTeamIds && announcement.targetTeamIds.length > 0) {
                                        conditions.push(inArray(deptSchema.departmentMembers.primaryTeamId, announcement.targetTeamIds));
                                    }
                                    break;
                                default: // all_members
                                    // No additional conditions
                                    break;
                            }
                            
                            const [targetCountResult] = await postgrestDb
                                .select({ count: sql<number>`count(*)` })
                                .from(deptSchema.departmentMembers)
                                .where(and(...conditions));
                            
                            totalTargets = targetCountResult?.count || 0;

                            // Get acknowledgment count if required
                            let acknowledgedCount = 0;
                            if (announcement.requiresAcknowledgment) {
                                const [ackResult] = await postgrestDb
                                    .select({ count: sql<number>`count(*)` })
                                    .from(deptSchema.departmentAnnouncementAcknowledgments)
                                    .where(eq(deptSchema.departmentAnnouncementAcknowledgments.announcementId, announcement.id));
                                acknowledgedCount = ackResult?.count || 0;
                            }

                            return {
                                id: announcement.id,
                                title: announcement.title,
                                content: announcement.content,
                                priority: announcement.priority,
                                targetAudience: announcement.targetAudience,
                                authorName: author[0]?.roleplayName || author[0]?.callsign || `Author ${announcement.authorId}`,
                                createdAt: announcement.publishedAt,
                                expiresAt: announcement.expiresAt,
                                requiresAcknowledgment: announcement.requiresAcknowledgment,
                                totalTargets,
                                acknowledgedCount,
                            };
                        })
                    );

                    return announcementsWithAuthors;
                } catch (error) {
                    console.error("Error getting announcements:", error);
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to get announcements: ${error}`,
                    });
                }
            }),
    }),

    // ===== BULK OPERATIONS =====
    bulk: createTRPCRouter({
        // Bulk update members
        updateMembers: protectedProcedure
            .input(bulkUpdateSchema)
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_members in the department context of all members
                    // Determine a set of departments involved
                    const targets = await postgrestDb
                        .select({ departmentId: deptSchema.departmentMembers.departmentId })
                        .from(deptSchema.departmentMembers)
                        .where(inArray(deptSchema.departmentMembers.id, input.memberIds));
                    const uniqueDeptIds = Array.from(new Set(targets.map(t => t.departmentId)));
                    if (uniqueDeptIds.length !== 1) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "All members in a bulk update must belong to the same department" });
                    }
                    const departmentId = uniqueDeptIds[0]!;
                    const perm = await postgrestDb
                        .select({ permissions: deptSchema.departmentRanks.permissions })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (!perm[0]?.permissions?.manage_members) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to bulk update members" });
                    }
                    const actor = await postgrestDb
                      .select({ id: deptSchema.departmentMembers.id })
                      .from(deptSchema.departmentMembers)
                      .where(and(
                        eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                        eq(deptSchema.departmentMembers.departmentId, departmentId),
                        eq(deptSchema.departmentMembers.isActive, true)
                      ))
                      .limit(1);
                    const performedBy = String(ctx.dbUser.discordId);
                    const result = await bulkUpdateMembers({ ...input, performedBy: actor[0]?.id });
                    // Audit each successful update
                    const auditValues = result.results
                      .filter(r => r.success)
                      .map(r => ({
                        memberId: r.memberId,
                        departmentId,
                        actionType: 'bulk_member_update',
                        reason: input.reason,
                        details: r.data ?? { updated: true },
                        performedBy,
                      }));
                    if (auditValues.length > 0) {
                      await postgrestDb.insert(deptSchema.departmentMemberAuditLogs).values(auditValues);
                    }
                    return result;
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to bulk update members: ${error}`,
                    });
                }
            }),

        // Bulk promote members
        promoteMembers: protectedProcedure
            .input(z.object({
                memberIds: z.array(z.number().int().positive()).min(1),
                newRankId: z.number().int().positive(),
                reason: z.string().min(1),
                effectiveDate: z.date().default(() => new Date()),
            }))
            .mutation(async ({ input, ctx }) => {
                try {
                    // Require manage_members in the single department context
                    const targets = await postgrestDb
                        .select({ departmentId: deptSchema.departmentMembers.departmentId })
                        .from(deptSchema.departmentMembers)
                        .where(inArray(deptSchema.departmentMembers.id, input.memberIds));
                    const uniqueDeptIds = Array.from(new Set(targets.map(t => t.departmentId)));
                    if (uniqueDeptIds.length !== 1) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "All members in a bulk promotion must belong to the same department" });
                    }
                    const departmentId = uniqueDeptIds[0]!;
                    const perm = await postgrestDb
                        .select({ permissions: deptSchema.departmentRanks.permissions })
                        .from(deptSchema.departmentMembers)
                        .leftJoin(
                            deptSchema.departmentRanks,
                            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
                        )
                        .where(and(
                            eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                            eq(deptSchema.departmentMembers.departmentId, departmentId),
                            eq(deptSchema.departmentMembers.isActive, true)
                        ))
                        .limit(1);
                    if (!perm[0]?.permissions?.manage_members) {
                        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to bulk promote members" });
                    }
                    // Execute real bulk promotions
                    const actorMember = await postgrestDb
                      .select({ id: deptSchema.departmentMembers.id })
                      .from(deptSchema.departmentMembers)
                      .where(and(
                        eq(deptSchema.departmentMembers.discordId, String(ctx.dbUser.discordId)),
                        eq(deptSchema.departmentMembers.departmentId, departmentId),
                        eq(deptSchema.departmentMembers.isActive, true)
                      ))
                      .limit(1);
                    const performedBy = actorMember[0]?.id;
                    const result = await bulkPromoteMembers({
                      memberIds: input.memberIds,
                      newRankId: input.newRankId,
                      reason: input.reason,
                      effectiveDate: input.effectiveDate,
                      performedBy,
                    });
                    // Audit each successful promotion
                    const auditValues = result.results
                      .filter(r => r.success)
                      .map(r => ({
                        memberId: r.memberId,
                        departmentId,
                        actionType: 'bulk_member_promote',
                        reason: input.reason,
                        details: r.data ?? { promoted: true, toRankId: input.newRankId },
                        performedBy: String(ctx.dbUser.discordId),
                      }));
                    if (auditValues.length > 0) {
                      await postgrestDb.insert(deptSchema.departmentMemberAuditLogs).values(auditValues);
                    }
                    return { success: result.success, updatedCount: result.successCount, summary: result.summary, results: result.results };
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to bulk promote members: ${error}`,
                    });
                }
            }),
    }),

    // ===== ADVANCED SEARCH =====
    search: createTRPCRouter({
        // Advanced member search
        searchMembers: protectedProcedure
            .input(advancedSearchSchema)
            .query(async ({ input, ctx }) => {
                try {
                    return await searchMembersAdvanced(input);
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to search members: ${error}`,
                    });
                }
            }),

        // Search with filters and facets
        searchWithFacets: protectedProcedure
            .input(z.object({
                departmentId: z.number().int().positive(),
                query: z.string().optional(),
                filters: z.record(z.any()).optional(),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Implementation would provide faceted search results
                    return {
                        results: [],
                        facets: {
                            ranks: [],
                            teams: [],
                            statuses: [],
                        },
                        total: 0,
                    };
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to search with facets: ${error}`,
                    });
                }
            }),
    }),

    // ===== TRAINING MANAGEMENT =====
    training: createTRPCRouter({
        // Get training requirements for rank/team
        getRequirements: protectedProcedure
            .input(z.object({
                rankId: z.number().int().positive().optional(),
                teamId: z.number().int().positive().optional(),
            }))
            .query(async ({ input, ctx }) => {
                try {
                    // Implementation would fetch training requirements
                    return [];
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to get training requirements: ${error}`,
                    });
                }
            }),

        // Track training completion
        recordCompletion: protectedProcedure
            .input(z.object({
                memberId: z.number().int().positive(),
                certificationId: z.number().int().positive(),
                completedDate: z.date(),
                instructorId: z.number().int().positive(),
                score: z.number().min(0).max(100).optional(),
                notes: z.string().optional(),
            }))
            .mutation(async ({ input, ctx }) => {
                try {
                    // Implementation would record training completion
                    return { success: true };
                } catch (error) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to record training completion: ${error}`,
                    });
                }
            }),
    }),
});