import { eq, and, desc, asc, sql, gte, lte, between, count, avg, sum } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface DepartmentAnalytics {
    totalMembers: number;
    activeMembers: number;
    membersByStatus: Record<string, number>;
    membersByRank: Array<{ rankName: string; count: number; percentage: number }>;
    membersByTeam: Array<{ teamName: string; count: number; percentage: number }>;
    recentHires: number;
    recentPromotions: number;
    averageTenure: number; // in days
    turnoverRate: number; // percentage
    attendanceRate: number; // percentage
    trainingCompletionRate: number; // percentage
    
    // Additional properties expected by the frontend
    memberGrowth: number; // percentage growth from previous period
    avgResponseTime: number; // average response time in minutes
    performanceScore: number; // overall department performance score (0-100)
    avgTrainingTime: number; // average training completion time in days
    membersInTraining: number; // number of members currently in training
    totalIncidents: number; // total incidents in timeframe
    resolvedIncidents: number; // resolved incidents in timeframe
    totalEquipment: number; // total equipment items
    equipmentInUse: number; // equipment currently in use
    equipmentMaintenanceDue: number; // equipment needing maintenance
}

export interface MemberMetrics {
    memberId: number;
    totalHours: number;
    attendanceRate: number;
    trainingCompleted: number;
    trainingRequired: number;
    disciplinaryActions: number;
    commendations: number;
    performanceScore: number;
    rankProgression: Array<{
        rankName: string;
        promotedDate: Date;
        daysInRank: number;
    }>;
}

export interface PerformanceReport {
    departmentId: number;
    reportPeriod: {
        startDate: Date;
        endDate: Date;
    };
    summary: DepartmentAnalytics;
    topPerformers: Array<{
        memberId: number;
        memberName: string;
        performanceScore: number;
        highlights: string[];
    }>;
    areasForImprovement: string[];
    recommendations: string[];
    charts?: {
        membershipTrends: Array<{ date: string; count: number }>;
        attendanceTrends: Array<{ date: string; rate: number }>;
        trainingProgress: Array<{ certification: string; completionRate: number }>;
    };
}

export async function getDepartmentAnalytics(
    departmentId: number,
    timeframe: "week" | "month" | "quarter" | "year"
): Promise<DepartmentAnalytics> {
    const now = new Date();
    const startDate = getTimeframeStartDate(now, timeframe);

    // Get total and active member counts
    const [totalMembersResult, activeMembersResult] = await Promise.all([
        postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.departmentId, departmentId)),

        postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMembers)
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentMembers.isActive, true)
                )
            ),
    ]);

    const totalMembers = totalMembersResult[0]?.count ?? 0;
    const activeMembers = activeMembersResult[0]?.count ?? 0;

    // Get members by status
    const membersByStatusResult = await postgrestDb
        .select({
            status: deptSchema.departmentMembers.status,
            count: count(),
        })
        .from(deptSchema.departmentMembers)
        .where(eq(deptSchema.departmentMembers.departmentId, departmentId))
        .groupBy(deptSchema.departmentMembers.status);

    const membersByStatus = membersByStatusResult.reduce((acc, row) => {
        acc[row.status] = row.count;
        return acc;
    }, {} as Record<string, number>);

    // Get members by rank
    const membersByRankResult = await postgrestDb
        .select({
            rankName: deptSchema.departmentRanks.name,
            count: count(),
        })
        .from(deptSchema.departmentMembers)
        .innerJoin(
            deptSchema.departmentRanks,
            eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
        )
        .where(
            and(
                eq(deptSchema.departmentMembers.departmentId, departmentId),
                eq(deptSchema.departmentMembers.isActive, true)
            )
        )
        .groupBy(deptSchema.departmentRanks.name);

    const membersByRank = membersByRankResult.map(row => ({
        rankName: row.rankName,
        count: row.count,
        percentage: activeMembers > 0 ? (row.count / activeMembers) * 100 : 0,
    }));

    // Get members by team
    const membersByTeamResult = await postgrestDb
        .select({
            teamName: deptSchema.departmentTeams.name,
            count: count(),
        })
        .from(deptSchema.departmentMembers)
        .innerJoin(
            deptSchema.departmentTeams,
            eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
        )
        .where(
            and(
                eq(deptSchema.departmentMembers.departmentId, departmentId),
                eq(deptSchema.departmentMembers.isActive, true)
            )
        )
        .groupBy(deptSchema.departmentTeams.name);

    const membersByTeam = membersByTeamResult.map(row => ({
        teamName: row.teamName,
        count: row.count,
        percentage: activeMembers > 0 ? (row.count / activeMembers) * 100 : 0,
    }));

    // Get recent hires (within timeframe)
    const recentHiresResult = await postgrestDb
        .select({ count: count() })
        .from(deptSchema.departmentMembers)
        .where(
            and(
                eq(deptSchema.departmentMembers.departmentId, departmentId),
                gte(deptSchema.departmentMembers.hireDate, startDate)
            )
        );

    const recentHires = recentHiresResult[0]?.count ?? 0;

    // Get recent promotions (within timeframe)
    const recentPromotionsResult = await postgrestDb
        .select({ count: count() })
        .from(deptSchema.departmentPromotionHistory)
        .innerJoin(
            deptSchema.departmentMembers,
            eq(deptSchema.departmentPromotionHistory.memberId, deptSchema.departmentMembers.id)
        )
        .where(
            and(
                eq(deptSchema.departmentMembers.departmentId, departmentId),
                gte(deptSchema.departmentPromotionHistory.effectiveDate, startDate)
            )
        );

    const recentPromotions = recentPromotionsResult[0]?.count ?? 0;

    // Calculate average tenure
    const tenureResult = await postgrestDb
        .select({
            avgTenure: avg(sql`EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${deptSchema.departmentMembers.hireDate})) / 86400`),
        })
        .from(deptSchema.departmentMembers)
        .where(
            and(
                eq(deptSchema.departmentMembers.departmentId, departmentId),
                eq(deptSchema.departmentMembers.isActive, true)
            )
        );

    const averageTenure = Number(tenureResult[0]?.avgTenure ?? 0);

    // Calculate turnover rate (simplified - members who left in timeframe / total members)
    const leftMembersResult = await postgrestDb
        .select({ count: count() })
        .from(deptSchema.departmentMembers)
        .where(
            and(
                eq(deptSchema.departmentMembers.departmentId, departmentId),
                eq(deptSchema.departmentMembers.isActive, false),
                gte(deptSchema.departmentMembers.updatedAt, startDate)
            )
        );

    const leftMembers = leftMembersResult[0]?.count ?? 0;
    const turnoverRate = totalMembers > 0 ? (leftMembers / totalMembers) * 100 : 0;

    // Calculate actual attendance rate from meeting attendance
    const attendanceRate = await calculateDepartmentAttendanceRate(departmentId, startDate, now);

    // Calculate actual training completion rate
    const trainingCompletionRate = await calculateTrainingCompletionRate(departmentId);

    // Calculate member growth (compare with previous period)
    const memberGrowth = await calculateMemberGrowth(departmentId, timeframe, startDate);

    // Calculate average response time (from incident reports)
    const avgResponseTime = await calculateAverageResponseTime(departmentId, startDate, now);

    // Calculate overall department performance score
    const performanceScore = calculateDepartmentPerformanceScore({
        attendanceRate,
        trainingCompletionRate,
        turnoverRate,
        memberGrowth,
    });

    // Calculate average training time
    const avgTrainingTime = await calculateAverageTrainingTime(departmentId);

    // Get members currently in training
    const membersInTraining = await getMembersInTraining(departmentId);

    // Get incident statistics
    const [totalIncidents, resolvedIncidents] = await getIncidentStatistics(departmentId, startDate, now);

    // Get equipment statistics
    const [totalEquipment, equipmentInUse, equipmentMaintenanceDue] = await getEquipmentStatistics(departmentId);

    return {
        totalMembers,
        activeMembers,
        membersByStatus,
        membersByRank,
        membersByTeam,
        recentHires,
        recentPromotions,
        averageTenure,
        turnoverRate,
        attendanceRate,
        trainingCompletionRate,
        memberGrowth,
        avgResponseTime,
        performanceScore,
        avgTrainingTime,
        membersInTraining,
        totalIncidents,
        resolvedIncidents,
        totalEquipment,
        equipmentInUse,
        equipmentMaintenanceDue,
    };
}

export async function calculateMemberMetrics(params: {
    memberId: number;
    startDate: Date;
    endDate: Date;
    includeTraining?: boolean;
    includeAttendance?: boolean;
    includeDisciplinary?: boolean;
}): Promise<MemberMetrics> {
    const { memberId, startDate, endDate } = params;

    // Get member's rank progression
    const rankProgressionResult = await postgrestDb
        .select({
            rankName: deptSchema.departmentRanks.name,
            effectiveDate: deptSchema.departmentPromotionHistory.effectiveDate,
        })
        .from(deptSchema.departmentPromotionHistory)
        .innerJoin(
            deptSchema.departmentRanks,
            eq(deptSchema.departmentPromotionHistory.toRankId, deptSchema.departmentRanks.id)
        )
        .where(
            and(
                eq(deptSchema.departmentPromotionHistory.memberId, memberId),
                between(deptSchema.departmentPromotionHistory.effectiveDate, startDate, endDate)
            )
        )
        .orderBy(asc(deptSchema.departmentPromotionHistory.effectiveDate));

    const rankProgression = rankProgressionResult.map((row, index, array) => {
        const nextPromotion = array[index + 1];
        const endOfPeriod = nextPromotion ? nextPromotion.effectiveDate : endDate;
        const daysInRank = Math.floor(
            (endOfPeriod.getTime() - row.effectiveDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
            rankName: row.rankName,
            promotedDate: row.effectiveDate,
            daysInRank,
        };
    });

    // Get total hours from time clock entries
    const totalHoursResult = await postgrestDb
        .select({
            totalMinutes: sum(sql`EXTRACT(EPOCH FROM (${deptSchema.departmentTimeClockEntries.clockOutTime} - ${deptSchema.departmentTimeClockEntries.clockInTime})) / 60`),
        })
        .from(deptSchema.departmentTimeClockEntries)
        .where(
            and(
                eq(deptSchema.departmentTimeClockEntries.memberId, memberId),
                between(deptSchema.departmentTimeClockEntries.clockInTime, startDate, endDate),
                sql`${deptSchema.departmentTimeClockEntries.clockOutTime} IS NOT NULL`
            )
        );

    const totalHours = Number(totalHoursResult[0]?.totalMinutes ?? 0) / 60;

    // Get disciplinary actions count
    const disciplinaryActionsResult = await postgrestDb
        .select({ count: count() })
        .from(deptSchema.departmentDisciplinaryActions)
        .where(
            and(
                eq(deptSchema.departmentDisciplinaryActions.memberId, memberId),
                between(deptSchema.departmentDisciplinaryActions.issuedAt, startDate, endDate)
            )
        );

    const disciplinaryActions = disciplinaryActionsResult[0]?.count ?? 0;

    // Get training completion data
    const trainingCompletedResult = await postgrestDb
        .select({ count: count() })
        .from(deptSchema.departmentMemberCertifications)
        .where(
            and(
                eq(deptSchema.departmentMemberCertifications.memberId, memberId),
                between(deptSchema.departmentMemberCertifications.issuedAt, startDate, endDate)
            )
        );

    const trainingCompleted = trainingCompletedResult[0]?.count ?? 0;

    // Calculate actual attendance rate for this member
    const attendanceRate = await calculateMemberAttendanceRate(memberId, startDate, endDate);

    // Calculate required training count for member's rank/team
    const trainingRequired = await calculateRequiredTrainingCount(memberId);

    // Get commendations count (positive disciplinary actions or separate commendations table)
    const commendations = await getCommendationsCount(memberId, startDate, endDate);

    // Calculate performance score based on multiple factors
    const performanceScore = calculatePerformanceScore({
        attendanceRate,
        trainingCompleted,
        trainingRequired,
        disciplinaryActions,
        commendations,
        totalHours,
    });

    return {
        memberId,
        totalHours,
        attendanceRate,
        trainingCompleted,
        trainingRequired,
        disciplinaryActions,
        commendations,
        performanceScore,
        rankProgression,
    };
}

export async function generatePerformanceReport(params: {
    departmentId: number;
    reportType: "monthly" | "quarterly" | "annual" | "custom";
    startDate?: Date;
    endDate?: Date;
    includeCharts?: boolean;
}): Promise<PerformanceReport> {
    const { departmentId, reportType, includeCharts = true } = params;

    let startDate = params.startDate;
    let endDate = params.endDate;

    if (!startDate || !endDate) {
        const now = new Date();
        switch (reportType) {
            case "monthly":
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case "quarterly":
                const quarter = Math.floor(now.getMonth() / 3);
                startDate = new Date(now.getFullYear(), quarter * 3, 1);
                endDate = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
                break;
            case "annual":
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31);
                break;
            default:
                startDate = startDate ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                endDate = endDate ?? now;
        }
    }

    // Get department analytics for the period
    const timeframe = reportType === "annual" ? "year" :
        reportType === "quarterly" ? "quarter" : "month";
    const summary = await getDepartmentAnalytics(departmentId, timeframe);

    // Get top performers (placeholder implementation)
    const topPerformers = [
        {
            memberId: 1,
            memberName: "Officer Smith",
            performanceScore: 95,
            highlights: ["Excellent attendance", "Completed advanced training", "Zero disciplinary actions"],
        },
        {
            memberId: 2,
            memberName: "Sergeant Johnson",
            performanceScore: 92,
            highlights: ["Strong leadership", "Mentored new recruits", "High case closure rate"],
        },
    ];

    // Generate recommendations based on analytics
    const areasForImprovement = [];
    const recommendations = [];

    if (summary.attendanceRate < 80) {
        areasForImprovement.push("Low attendance rate");
        recommendations.push("Implement attendance improvement program");
    }

    if (summary.trainingCompletionRate < 75) {
        areasForImprovement.push("Training completion below target");
        recommendations.push("Review training requirements and scheduling");
    }

    if (summary.turnoverRate > 20) {
        areasForImprovement.push("High turnover rate");
        recommendations.push("Conduct exit interviews and improve retention strategies");
    }

    let charts;
    if (includeCharts) {
        const [membershipTrends, attendanceTrends, trainingProgress] = await Promise.all([
            generateMembershipTrends(departmentId, startDate, endDate),
            generateAttendanceTrends(departmentId, startDate, endDate),
            generateTrainingProgress(departmentId),
        ]);
        
        charts = {
            membershipTrends,
            attendanceTrends,
            trainingProgress,
        };
    }

    return {
        departmentId,
        reportPeriod: { startDate, endDate },
        summary,
        topPerformers,
        areasForImprovement,
        recommendations,
        charts,
    };
}

function getTimeframeStartDate(now: Date, timeframe: string): Date {
    switch (timeframe) {
        case "week":
            return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        case "month":
            return new Date(now.getFullYear(), now.getMonth(), 1);
        case "quarter":
            const quarter = Math.floor(now.getMonth() / 3);
            return new Date(now.getFullYear(), quarter * 3, 1);
        case "year":
            return new Date(now.getFullYear(), 0, 1);
        default:
            return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
}

// Calculate department-wide attendance rate from meeting attendance
async function calculateDepartmentAttendanceRate(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<number> {
    try {
        // Get all meetings for the department in the timeframe
        const meetingsResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMeetings)
            .where(
                and(
                    eq(deptSchema.departmentMeetings.departmentId, departmentId),
                    between(deptSchema.departmentMeetings.scheduledAt, startDate, endDate),
                    eq(deptSchema.departmentMeetings.status, "completed")
                )
            );

        const totalMeetings = meetingsResult[0]?.count ?? 0;
        if (totalMeetings === 0) return 100; // No meetings = 100% attendance

        // Get total attendance records for these meetings
        const attendanceResult = await postgrestDb
            .select({
                totalAttendees: count(),
                presentAttendees: sql<number>`COUNT(CASE WHEN ${deptSchema.departmentMeetingAttendance.status} = 'present' THEN 1 END)`,
            })
            .from(deptSchema.departmentMeetingAttendance)
            .innerJoin(
                deptSchema.departmentMeetings,
                eq(deptSchema.departmentMeetingAttendance.meetingId, deptSchema.departmentMeetings.id)
            )
            .where(
                and(
                    eq(deptSchema.departmentMeetings.departmentId, departmentId),
                    between(deptSchema.departmentMeetings.scheduledAt, startDate, endDate),
                    eq(deptSchema.departmentMeetings.status, "completed")
                )
            );

        const totalAttendees = attendanceResult[0]?.totalAttendees ?? 0;
        const presentAttendees = Number(attendanceResult[0]?.presentAttendees ?? 0);

        return totalAttendees > 0 ? (presentAttendees / totalAttendees) * 100 : 100;
    } catch (error) {
        console.error("Error calculating department attendance rate:", error);
        return 0;
    }
}

// Calculate training completion rate for department
async function calculateTrainingCompletionRate(departmentId: number): Promise<number> {
    try {
        // Get all active members in department
        const activeMembersResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMembers)
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentMembers.isActive, true)
                )
            );

        const totalActiveMembers = activeMembersResult[0]?.count ?? 0;
        if (totalActiveMembers === 0) return 100;

        // Get total certifications available for this department
        const availableCertificationsResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentCertifications)
            .where(eq(deptSchema.departmentCertifications.departmentId, departmentId));

        const totalCertifications = availableCertificationsResult[0]?.count ?? 0;
        if (totalCertifications === 0) return 100;

        // Get total member certifications earned
        const earnedCertificationsResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMemberCertifications)
            .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentMemberCertifications.memberId, deptSchema.departmentMembers.id)
            )
            .innerJoin(
                deptSchema.departmentCertifications,
                eq(deptSchema.departmentMemberCertifications.certificationId, deptSchema.departmentCertifications.id)
            )
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentMembers.isActive, true)
                )
            );

        const totalEarnedCertifications = earnedCertificationsResult[0]?.count ?? 0;
        const maxPossibleCertifications = totalActiveMembers * totalCertifications;

        return maxPossibleCertifications > 0 ? (totalEarnedCertifications / maxPossibleCertifications) * 100 : 0;
    } catch (error) {
        console.error("Error calculating training completion rate:", error);
        return 0;
    }
}

// Calculate individual member attendance rate
async function calculateMemberAttendanceRate(
    memberId: number,
    startDate: Date,
    endDate: Date
): Promise<number> {
    try {
        const attendanceResult = await postgrestDb
            .select({
                totalMeetings: count(),
                presentMeetings: sql<number>`COUNT(CASE WHEN ${deptSchema.departmentMeetingAttendance.status} = 'present' THEN 1 END)`,
            })
            .from(deptSchema.departmentMeetingAttendance)
            .innerJoin(
                deptSchema.departmentMeetings,
                eq(deptSchema.departmentMeetingAttendance.meetingId, deptSchema.departmentMeetings.id)
            )
            .where(
                and(
                    eq(deptSchema.departmentMeetingAttendance.memberId, memberId),
                    between(deptSchema.departmentMeetings.scheduledAt, startDate, endDate),
                    eq(deptSchema.departmentMeetings.status, "completed")
                )
            );

        const totalMeetings = attendanceResult[0]?.totalMeetings ?? 0;
        const presentMeetings = Number(attendanceResult[0]?.presentMeetings ?? 0);

        return totalMeetings > 0 ? (presentMeetings / totalMeetings) * 100 : 100;
    } catch (error) {
        console.error("Error calculating member attendance rate:", error);
        return 0;
    }
}

// Calculate required training count for a member based on their rank/team
async function calculateRequiredTrainingCount(memberId: number): Promise<number> {
    try {
        // Get member's department
        const memberResult = await postgrestDb
            .select({ departmentId: deptSchema.departmentMembers.departmentId })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, memberId))
            .limit(1);

        if (memberResult.length === 0) return 0;

        const departmentId = memberResult[0]!.departmentId;

        // Get all certifications for the department (assuming all are required)
        const certificationsResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentCertifications)
            .where(eq(deptSchema.departmentCertifications.departmentId, departmentId));

        return certificationsResult[0]?.count ?? 0;
    } catch (error) {
        console.error("Error calculating required training count:", error);
        return 0;
    }
}

// Get commendations count (positive disciplinary actions)
async function getCommendationsCount(
    memberId: number,
    startDate: Date,
    endDate: Date
): Promise<number> {
    try {
        // Look for positive disciplinary actions (commendations, awards, etc.)
        const commendationsResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentDisciplinaryActions)
            .where(
                and(
                    eq(deptSchema.departmentDisciplinaryActions.memberId, memberId),
                    between(deptSchema.departmentDisciplinaryActions.issuedAt, startDate, endDate),
                    eq(deptSchema.departmentDisciplinaryActions.isActive, true),
                    // Look for positive action types
                    sql`LOWER(${deptSchema.departmentDisciplinaryActions.actionType}) IN ('commendation', 'award', 'recognition', 'merit', 'excellence')`
                )
            );

        return commendationsResult[0]?.count ?? 0;
    } catch (error) {
        console.error("Error getting commendations count:", error);
        return 0;
    }
}

// Calculate performance score based on multiple factors
function calculatePerformanceScore(params: {
    attendanceRate: number;
    trainingCompleted: number;
    trainingRequired: number;
    disciplinaryActions: number;
    commendations: number;
    totalHours: number;
}): number {
    const {
        attendanceRate,
        trainingCompleted,
        trainingRequired,
        disciplinaryActions,
        commendations,
        totalHours,
    } = params;

    let score = 0;

    // Attendance component (30% of score)
    score += (attendanceRate / 100) * 30;

    // Training completion component (25% of score)
    const trainingCompletionRate = trainingRequired > 0 ? trainingCompleted / trainingRequired : 1;
    score += Math.min(trainingCompletionRate, 1) * 25;

    // Activity component based on hours worked (20% of score)
    // Assume 40 hours per month as baseline (480 hours per year)
    const expectedHoursPerMonth = 40;
    const monthsInPeriod = 1; // This could be calculated based on date range
    const expectedHours = expectedHoursPerMonth * monthsInPeriod;
    const activityRate = Math.min(totalHours / expectedHours, 1.5); // Cap at 150%
    score += (activityRate / 1.5) * 20;

    // Disciplinary component (15% of score) - negative impact
    const disciplinaryPenalty = Math.min(disciplinaryActions * 5, 15); // Max 15 point penalty
    score += Math.max(15 - disciplinaryPenalty, 0);

    // Commendations component (10% of score) - positive impact
    const commendationBonus = Math.min(commendations * 2, 10); // Max 10 point bonus
    score += commendationBonus;

    return Math.round(Math.min(score, 100)); // Cap at 100
}

// Generate actual membership trends
async function generateMembershipTrends(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<Array<{ date: string; count: number }>> {
    try {
        const trends: Array<{ date: string; count: number }> = [];
        const current = new Date(startDate);

        while (current <= endDate) {
            const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
            const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

            // Count active members at the end of this month
            const memberCountResult = await postgrestDb
                .select({ count: count() })
                .from(deptSchema.departmentMembers)
                .where(
                    and(
                        eq(deptSchema.departmentMembers.departmentId, departmentId),
                        lte(deptSchema.departmentMembers.hireDate, monthEnd),
                        // Either still active or left after this month
                        sql`(${deptSchema.departmentMembers.isActive} = true OR ${deptSchema.departmentMembers.updatedAt} > ${monthEnd})`
                    )
                );

            const dateString = monthStart.toISOString().split('T')[0];
            trends.push({
                date: dateString || monthStart.toDateString(),
                count: memberCountResult[0]?.count ?? 0,
            });

            current.setMonth(current.getMonth() + 1);
        }

        return trends;
    } catch (error) {
        console.error("Error generating membership trends:", error);
        return [];
    }
}

// Generate actual attendance trends
async function generateAttendanceTrends(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<Array<{ date: string; rate: number }>> {
    try {
        const trends: Array<{ date: string; rate: number }> = [];
        const current = new Date(startDate);

        while (current <= endDate) {
            const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
            const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

            const attendanceRate = await calculateDepartmentAttendanceRate(departmentId, monthStart, monthEnd);

            const dateString = monthStart.toISOString().split('T')[0];
            trends.push({
                date: dateString || monthStart.toDateString(),
                rate: Math.round(attendanceRate * 100) / 100, // Round to 2 decimal places
            });

            current.setMonth(current.getMonth() + 1);
        }

        return trends;
    } catch (error) {
        console.error("Error generating attendance trends:", error);
        return [];
    }
}

// Generate actual training progress
async function generateTrainingProgress(departmentId: number): Promise<Array<{ certification: string; completionRate: number }>> {
    try {
        // Get all certifications for the department
        const certificationsResult = await postgrestDb
            .select({
                id: deptSchema.departmentCertifications.id,
                name: deptSchema.departmentCertifications.name,
            })
            .from(deptSchema.departmentCertifications)
            .where(eq(deptSchema.departmentCertifications.departmentId, departmentId));

        const progress: Array<{ certification: string; completionRate: number }> = [];

        // Get total active members
        const activeMembersResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMembers)
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentMembers.isActive, true)
                )
            );

        const totalActiveMembers = activeMembersResult[0]?.count ?? 0;

        for (const certification of certificationsResult) {
            // Count members who have this certification
            const completedResult = await postgrestDb
                .select({ count: count() })
                .from(deptSchema.departmentMemberCertifications)
                .innerJoin(
                    deptSchema.departmentMembers,
                    eq(deptSchema.departmentMemberCertifications.memberId, deptSchema.departmentMembers.id)
                )
                .where(
                    and(
                        eq(deptSchema.departmentMemberCertifications.certificationId, certification.id),
                        eq(deptSchema.departmentMembers.departmentId, departmentId),
                        eq(deptSchema.departmentMembers.isActive, true)
                    )
                );

            const completedCount = completedResult[0]?.count ?? 0;
            const completionRate = totalActiveMembers > 0 ? (completedCount / totalActiveMembers) * 100 : 0;

            progress.push({
                certification: certification.name,
                completionRate: Math.round(completionRate * 100) / 100, // Round to 2 decimal places
            });
        }

        return progress.sort((a, b) => b.completionRate - a.completionRate); // Sort by completion rate descending
    } catch (error) {
        console.error("Error generating training progress:", error);
        return [];
    }
}
// Calculate member growth compared to previous period
async function calculateMemberGrowth(
    departmentId: number,
    timeframe: "week" | "month" | "quarter" | "year",
    currentStartDate: Date
): Promise<number> {
    try {
        // Calculate previous period dates
        const previousStartDate = getPreviousPeriodStartDate(currentStartDate, timeframe);
        const previousEndDate = new Date(currentStartDate.getTime() - 1); // Day before current period

        // Get member count for current period
        const currentMembersResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMembers)
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    lte(deptSchema.departmentMembers.hireDate, new Date()),
                    eq(deptSchema.departmentMembers.isActive, true)
                )
            );

        const currentMembers = currentMembersResult[0]?.count ?? 0;

        // Get member count for previous period
        const previousMembersResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMembers)
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    lte(deptSchema.departmentMembers.hireDate, previousEndDate),
                    // Either still active or left after the previous period
                    sql`(${deptSchema.departmentMembers.isActive} = true OR ${deptSchema.departmentMembers.updatedAt} > ${previousEndDate})`
                )
            );

        const previousMembers = previousMembersResult[0]?.count ?? 0;

        if (previousMembers === 0) return currentMembers > 0 ? 100 : 0;

        return ((currentMembers - previousMembers) / previousMembers) * 100;
    } catch (error) {
        console.error("Error calculating member growth:", error);
        return 0;
    }
}

// Calculate average response time from incident reports
async function calculateAverageResponseTime(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<number> {
    try {
        // Get incident reports with response times (using dateReported and reviewedAt as proxy for response time)
        const responseTimeResult = await postgrestDb
            .select({
                avgResponseTime: avg(sql`EXTRACT(EPOCH FROM (${deptSchema.departmentIncidents.reviewedAt} - ${deptSchema.departmentIncidents.dateReported})) / 60`),
            })
            .from(deptSchema.departmentIncidents)
            .where(
                and(
                    eq(deptSchema.departmentIncidents.departmentId, departmentId),
                    between(deptSchema.departmentIncidents.dateReported, startDate, endDate),
                    sql`${deptSchema.departmentIncidents.reviewedAt} IS NOT NULL`,
                    sql`${deptSchema.departmentIncidents.reviewedAt} > ${deptSchema.departmentIncidents.dateReported}`
                )
            );

        return Number(responseTimeResult[0]?.avgResponseTime ?? 0);
    } catch (error) {
        console.error("Error calculating average response time:", error);
        return 0;
    }
}

// Calculate overall department performance score
function calculateDepartmentPerformanceScore(params: {
    attendanceRate: number;
    trainingCompletionRate: number;
    turnoverRate: number;
    memberGrowth: number;
}): number {
    const { attendanceRate, trainingCompletionRate, turnoverRate, memberGrowth } = params;

    let score = 0;

    // Attendance component (30% of score)
    score += (attendanceRate / 100) * 30;

    // Training completion component (25% of score)
    score += (trainingCompletionRate / 100) * 25;

    // Turnover rate component (20% of score) - lower is better
    const turnoverScore = Math.max(0, (100 - turnoverRate) / 100) * 20;
    score += turnoverScore;

    // Member growth component (15% of score) - positive growth is good
    const growthScore = memberGrowth > 0 ? Math.min(memberGrowth / 10, 1) * 15 : 0;
    score += growthScore;

    // Base stability score (10% of score)
    score += 10;

    return Math.round(Math.min(score, 100));
}

// Calculate average training completion time
async function calculateAverageTrainingTime(departmentId: number): Promise<number> {
    try {
        // Since we don't have startedAt, we'll use a different approach
        // Calculate average time from member hire date to certification completion
        const avgTrainingTimeResult = await postgrestDb
            .select({
                avgDays: avg(sql`EXTRACT(EPOCH FROM (${deptSchema.departmentMemberCertifications.issuedAt} - ${deptSchema.departmentMembers.hireDate})) / 86400`),
            })
            .from(deptSchema.departmentMemberCertifications)
            .innerJoin(
                deptSchema.departmentMembers,
                eq(deptSchema.departmentMemberCertifications.memberId, deptSchema.departmentMembers.id)
            )
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    sql`${deptSchema.departmentMemberCertifications.issuedAt} > ${deptSchema.departmentMembers.hireDate}`
                )
            );

        return Math.min(Number(avgTrainingTimeResult[0]?.avgDays ?? 30), 365); // Cap at 1 year, default to 30 days
    } catch (error) {
        console.error("Error calculating average training time:", error);
        return 30; // Default fallback
    }
}

// Get count of members currently in training
async function getMembersInTraining(departmentId: number): Promise<number> {
    try {
        // Count members with "in_training" status as a proxy for members currently in training
        const inTrainingResult = await postgrestDb
            .select({ count: count() })
            .from(deptSchema.departmentMembers)
            .where(
                and(
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentMembers.isActive, true),
                    eq(deptSchema.departmentMembers.status, "in_training")
                )
            );

        return inTrainingResult[0]?.count ?? 0;
    } catch (error) {
        console.error("Error getting members in training:", error);
        return 0;
    }
}

// Get incident statistics
async function getIncidentStatistics(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<[number, number]> {
    try {
        const [totalResult, resolvedResult] = await Promise.all([
            // Total incidents
            postgrestDb
                .select({ count: count() })
                .from(deptSchema.departmentIncidents)
                .where(
                    and(
                        eq(deptSchema.departmentIncidents.departmentId, departmentId),
                        between(deptSchema.departmentIncidents.dateReported, startDate, endDate)
                    )
                ),
            
            // Resolved incidents (using reviewedAt as proxy for resolution)
            postgrestDb
                .select({ count: count() })
                .from(deptSchema.departmentIncidents)
                .where(
                    and(
                        eq(deptSchema.departmentIncidents.departmentId, departmentId),
                        between(deptSchema.departmentIncidents.dateReported, startDate, endDate),
                        sql`${deptSchema.departmentIncidents.reviewedAt} IS NOT NULL`
                    )
                ),
        ]);

        const totalIncidents = totalResult[0]?.count ?? 0;
        const resolvedIncidents = resolvedResult[0]?.count ?? 0;

        return [totalIncidents, resolvedIncidents];
    } catch (error) {
        console.error("Error getting incident statistics:", error);
        return [0, 0];
    }
}

// Get equipment statistics
async function getEquipmentStatistics(departmentId: number): Promise<[number, number, number]> {
    try {
        const [totalResult, inUseResult, maintenanceResult] = await Promise.all([
            // Total equipment
            postgrestDb
                .select({ count: count() })
                .from(deptSchema.departmentEquipment)
                .where(
                    and(
                        eq(deptSchema.departmentEquipment.departmentId, departmentId),
                        eq(deptSchema.departmentEquipment.isActive, true)
                    )
                ),
            
            // Equipment in use (assigned and not returned)
            postgrestDb
                .select({ count: count() })
                .from(deptSchema.departmentEquipmentAssignments)
                .innerJoin(
                    deptSchema.departmentEquipment,
                    eq(deptSchema.departmentEquipmentAssignments.equipmentId, deptSchema.departmentEquipment.id)
                )
                .where(
                    and(
                        eq(deptSchema.departmentEquipment.departmentId, departmentId),
                        eq(deptSchema.departmentEquipmentAssignments.isActive, true),
                        sql`${deptSchema.departmentEquipmentAssignments.returnDate} IS NULL`
                    )
                ),
            
            // Equipment needing maintenance (using condition as proxy)
            postgrestDb
                .select({ count: count() })
                .from(deptSchema.departmentEquipment)
                .where(
                    and(
                        eq(deptSchema.departmentEquipment.departmentId, departmentId),
                        eq(deptSchema.departmentEquipment.isActive, true),
                        sql`${deptSchema.departmentEquipment.condition} IN ('poor', 'damaged')`
                    )
                ),
        ]);

        const totalEquipment = totalResult[0]?.count ?? 0;
        const equipmentInUse = inUseResult[0]?.count ?? 0;
        const equipmentMaintenanceDue = maintenanceResult[0]?.count ?? 0;

        return [totalEquipment, equipmentInUse, equipmentMaintenanceDue];
    } catch (error) {
        console.error("Error getting equipment statistics:", error);
        return [0, 0, 0];
    }
}

// Helper function to get previous period start date
function getPreviousPeriodStartDate(currentStartDate: Date, timeframe: string): Date {
    switch (timeframe) {
        case "week":
            return new Date(currentStartDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        case "month":
            const prevMonth = new Date(currentStartDate);
            prevMonth.setMonth(prevMonth.getMonth() - 1);
            return prevMonth;
        case "quarter":
            const prevQuarter = new Date(currentStartDate);
            prevQuarter.setMonth(prevQuarter.getMonth() - 3);
            return prevQuarter;
        case "year":
            const prevYear = new Date(currentStartDate);
            prevYear.setFullYear(prevYear.getFullYear() - 1);
            return prevYear;
        default:
            return new Date(currentStartDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
}