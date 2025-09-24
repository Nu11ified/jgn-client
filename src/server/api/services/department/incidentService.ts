import { eq, and, desc, asc, sql, gte, lte, between, inArray, like, ilike, or } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface IncidentReport {
    id: number;
    departmentId: number;
    reportingMemberId: number;
    incidentNumber: string; // Auto-generated unique identifier
    incidentType: "arrest" | "citation" | "investigation" | "emergency_response" | "training" | "other";
    title: string;
    description: string;
    location?: string;
    dateOccurred: Date;
    dateReported: Date;
    involvedMembers: number[];
    involvedCivilians?: Array<{
        name: string;
        role: "victim" | "suspect" | "witness" | "complainant";
        contactInfo?: string;
    }>;
    evidence?: Array<{
        type: "photo" | "video" | "document" | "physical";
        description: string;
        location?: string;
        collectedBy: number;
    }>;
    severity: "low" | "medium" | "high" | "critical";
    status: "draft" | "submitted" | "under_review" | "approved" | "rejected" | "closed";
    reviewedBy?: number;
    reviewedAt?: Date;
    reviewNotes?: string;
    followUpRequired: boolean;
    followUpDate?: Date;
    tags: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt?: Date;
}

export interface IncidentStatistics {
    totalIncidents: number;
    incidentsByType: Record<string, number>;
    incidentsBySeverity: Record<string, number>;
    incidentsByStatus: Record<string, number>;
    averageResolutionTime: number; // in hours
    topLocations: Array<{ location: string; count: number }>;
    trendData: Array<{ date: string; count: number }>;
}

export async function createIncidentReport(params: {
    departmentId: number;
    reportingMemberId: number;
    incidentType: "arrest" | "citation" | "investigation" | "emergency_response" | "training" | "other";
    title: string;
    description: string;
    location?: string;
    dateOccurred: Date;
    involvedMembers?: number[];
    severity?: "low" | "medium" | "high" | "critical";
    status?: "draft" | "submitted";
}): Promise<{ success: boolean; message: string; incidentId?: number; incidentNumber?: string }> {
    try {
        const {
            departmentId,
            reportingMemberId,
            incidentType,
            title,
            description,
            location,
            dateOccurred,
            involvedMembers = [],
            severity = "medium",
            status = "draft",
        } = params;

        // Validate reporting member exists and is active
        const reportingMember = await postgrestDb
            .select({
                id: deptSchema.departmentMembers.id,
                isActive: deptSchema.departmentMembers.isActive,
                departmentId: deptSchema.departmentMembers.departmentId,
            })
            .from(deptSchema.departmentMembers)
            .where(eq(deptSchema.departmentMembers.id, reportingMemberId))
            .limit(1);

        if (reportingMember.length === 0) {
            return {
                success: false,
                message: "Reporting member not found",
            };
        }

        if (!reportingMember[0]!.isActive) {
            return {
                success: false,
                message: "Reporting member is not active",
            };
        }

        if (reportingMember[0]!.departmentId !== departmentId) {
            return {
                success: false,
                message: "Reporting member is not in the specified department",
            };
        }

        // Validate involved members if provided
        if (involvedMembers.length > 0) {
            const validMembers = await postgrestDb
                .select({ id: deptSchema.departmentMembers.id })
                .from(deptSchema.departmentMembers)
                .where(
                    and(
                        inArray(deptSchema.departmentMembers.id, involvedMembers),
                        eq(deptSchema.departmentMembers.departmentId, departmentId),
                        eq(deptSchema.departmentMembers.isActive, true)
                    )
                );

            if (validMembers.length !== involvedMembers.length) {
                return {
                    success: false,
                    message: "One or more involved members are invalid or not in the department",
                };
            }
        }

        // Generate unique incident number
        const incidentNumber = await generateIncidentNumber(departmentId, incidentType);

        // Generate tags based on incident type and content
        const tags = generateIncidentTags(incidentType, title, description);

        // Create incident report in database
        const [newIncident] = await postgrestDb
            .insert(deptSchema.departmentIncidents)
            .values({
                departmentId,
                reportingMemberId,
                incidentNumber,
                incidentType,
                title,
                description,
                location,
                dateOccurred,
                dateReported: new Date(),
                involvedMembers,
                severity,
                status,
                followUpRequired: severity === "high" || severity === "critical",
                tags,
                isActive: true,
            })
            .returning({ 
                id: deptSchema.departmentIncidents.id,
                incidentNumber: deptSchema.departmentIncidents.incidentNumber 
            });

        if (!newIncident) {
            return {
                success: false,
                message: "Failed to create incident report",
            };
        }

        // If status is submitted, trigger review workflow
        if (status === "submitted") {
            await triggerIncidentReview(newIncident.id, severity);
        }

        return {
            success: true,
            message: "Incident report created successfully",
            incidentId: newIncident.id,
            incidentNumber: newIncident.incidentNumber,
        };
    } catch (error) {
        console.error("Error creating incident report:", error);
        return {
            success: false,
            message: `Failed to create incident report: ${error}`,
        };
    }
}

export async function updateIncidentReport(
    incidentId: number,
    updates: Partial<IncidentReport>,
    updatedBy: number
): Promise<{ success: boolean; message: string }> {
    try {
        // Validate incident exists
        const incident = await getIncidentById(incidentId);
        if (!incident) {
            return {
                success: false,
                message: "Incident report not found",
            };
        }

        // Check permissions - only reporting member, supervisors, or admins can update
        const canUpdate = await checkIncidentUpdatePermissions(incidentId, updatedBy);
        if (!canUpdate) {
            return {
                success: false,
                message: "Insufficient permissions to update this incident report",
            };
        }

        // Prevent updates to closed incidents unless by admin
        if (incident.status === "closed" && !await isAdmin(updatedBy)) {
            return {
                success: false,
                message: "Cannot update closed incident reports",
            };
        }

        // Prepare update data
        const updateData: any = {};
        
        if (updates.title !== undefined) updateData.title = updates.title;
        if (updates.description !== undefined) updateData.description = updates.description;
        if (updates.location !== undefined) updateData.location = updates.location;
        if (updates.dateOccurred !== undefined) updateData.dateOccurred = updates.dateOccurred;
        if (updates.involvedMembers !== undefined) updateData.involvedMembers = updates.involvedMembers;
        if (updates.involvedCivilians !== undefined) updateData.involvedCivilians = updates.involvedCivilians;
        if (updates.evidence !== undefined) updateData.evidence = updates.evidence;
        if (updates.severity !== undefined) updateData.severity = updates.severity;
        if (updates.status !== undefined) updateData.status = updates.status;
        if (updates.followUpRequired !== undefined) updateData.followUpRequired = updates.followUpRequired;
        if (updates.followUpDate !== undefined) updateData.followUpDate = updates.followUpDate;
        if (updates.tags !== undefined) updateData.tags = updates.tags;

        // Update incident in database
        const result = await postgrestDb
            .update(deptSchema.departmentIncidents)
            .set(updateData)
            .where(eq(deptSchema.departmentIncidents.id, incidentId))
            .returning({ id: deptSchema.departmentIncidents.id });

        if (result.length === 0) {
            return {
                success: false,
                message: "Failed to update incident report",
            };
        }

        // If status changed to submitted, trigger review
        if (updates.status === "submitted" && incident.status === "draft") {
            await triggerIncidentReview(incidentId, incident.severity);
        }

        return {
            success: true,
            message: "Incident report updated successfully",
        };
    } catch (error) {
        console.error("Error updating incident report:", error);
        return {
            success: false,
            message: `Failed to update incident report: ${error}`,
        };
    }
}

export async function reviewIncidentReport(
    incidentId: number,
    reviewerId: number,
    decision: "approved" | "rejected",
    reviewNotes: string
): Promise<{ success: boolean; message: string }> {
    try {
        // Validate incident exists and is under review
        const incident = await getIncidentById(incidentId);
        if (!incident) {
            return {
                success: false,
                message: "Incident report not found",
            };
        }

        if (incident.status !== "under_review") {
            return {
                success: false,
                message: "Incident report is not under review",
            };
        }

        // Check reviewer permissions
        const canReview = await checkIncidentReviewPermissions(reviewerId, incident.departmentId);
        if (!canReview) {
            return {
                success: false,
                message: "Insufficient permissions to review incident reports",
            };
        }

        // Update incident with review decision
        const updateData: any = {
            status: decision === "approved" ? "approved" : "rejected",
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
            reviewNotes,
        };

        // If approved and follow-up is required, schedule it
        if (decision === "approved" && incident.followUpRequired) {
            updateData.followUpDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
        }

        const result = await postgrestDb
            .update(deptSchema.departmentIncidents)
            .set(updateData)
            .where(eq(deptSchema.departmentIncidents.id, incidentId))
            .returning({ id: deptSchema.departmentIncidents.id });

        if (result.length === 0) {
            return {
                success: false,
                message: "Failed to update incident review",
            };
        }

        return {
            success: true,
            message: `Incident report ${decision} successfully`,
        };
    } catch (error) {
        console.error("Error reviewing incident report:", error);
        return {
            success: false,
            message: `Failed to review incident report: ${error}`,
        };
    }
}

export async function getIncidentStatistics(
    departmentId: number,
    startDate: Date,
    endDate: Date
): Promise<IncidentStatistics> {
    try {
        // Get all incidents for the department in the date range
        const incidents = await postgrestDb
            .select({
                id: deptSchema.departmentIncidents.id,
                incidentType: deptSchema.departmentIncidents.incidentType,
                severity: deptSchema.departmentIncidents.severity,
                status: deptSchema.departmentIncidents.status,
                location: deptSchema.departmentIncidents.location,
                dateOccurred: deptSchema.departmentIncidents.dateOccurred,
                dateReported: deptSchema.departmentIncidents.dateReported,
                reviewedAt: deptSchema.departmentIncidents.reviewedAt,
            })
            .from(deptSchema.departmentIncidents)
            .where(
                and(
                    eq(deptSchema.departmentIncidents.departmentId, departmentId),
                    eq(deptSchema.departmentIncidents.isActive, true),
                    gte(deptSchema.departmentIncidents.dateOccurred, startDate),
                    lte(deptSchema.departmentIncidents.dateOccurred, endDate)
                )
            );

        const totalIncidents = incidents.length;

        // Calculate statistics by type
        const incidentsByType: Record<string, number> = {
            arrest: 0,
            citation: 0,
            investigation: 0,
            emergency_response: 0,
            training: 0,
            other: 0,
        };

        // Calculate statistics by severity
        const incidentsBySeverity: Record<string, number> = {
            low: 0,
            medium: 0,
            high: 0,
            critical: 0,
        };

        // Calculate statistics by status
        const incidentsByStatus: Record<string, number> = {
            draft: 0,
            submitted: 0,
            under_review: 0,
            approved: 0,
            rejected: 0,
            closed: 0,
        };

        // Calculate top locations
        const locationCounts: Record<string, number> = {};
        let totalResolutionTime = 0;
        let resolvedCount = 0;

        for (const incident of incidents) {
            // Count by type
            incidentsByType[incident.incidentType] = (incidentsByType[incident.incidentType] ?? 0) + 1;

            // Count by severity
            incidentsBySeverity[incident.severity] = (incidentsBySeverity[incident.severity] ?? 0) + 1;

            // Count by status
            incidentsByStatus[incident.status] = (incidentsByStatus[incident.status] ?? 0) + 1;

            // Count locations
            if (incident.location) {
                locationCounts[incident.location] = (locationCounts[incident.location] || 0) + 1;
            }

            // Calculate resolution time for approved/rejected incidents
            if ((incident.status === "approved" || incident.status === "rejected") && incident.reviewedAt) {
                const resolutionTime = incident.reviewedAt.getTime() - incident.dateReported.getTime();
                totalResolutionTime += resolutionTime;
                resolvedCount++;
            }
        }

        // Sort locations by count
        const topLocations = Object.entries(locationCounts)
            .map(([location, count]) => ({ location, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Calculate average resolution time
        const averageResolutionTime = resolvedCount > 0 ? totalResolutionTime / resolvedCount / (1000 * 60 * 60) : 0;

        // Generate trend data
        const trendData = generateIncidentTrendData(startDate, endDate, incidents);

        return {
            totalIncidents,
            incidentsByType,
            incidentsBySeverity,
            incidentsByStatus,
            averageResolutionTime: Math.round(averageResolutionTime * 10) / 10,
            topLocations,
            trendData,
        };
    } catch (error) {
        console.error("Error getting incident statistics:", error);
        return {
            totalIncidents: 0,
            incidentsByType: {},
            incidentsBySeverity: {},
            incidentsByStatus: {},
            averageResolutionTime: 0,
            topLocations: [],
            trendData: [],
        };
    }
}

export async function searchIncidents(params: {
    departmentId: number;
    searchTerm?: string;
    incidentType?: string;
    severity?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    reportingMemberId?: number;
    location?: string;
    limit?: number;
    offset?: number;
}): Promise<{
    incidents: IncidentReport[];
    total: number;
}> {
    try {
        const {
            departmentId,
            searchTerm,
            incidentType,
            severity,
            status,
            dateFrom,
            dateTo,
            reportingMemberId,
            location,
            limit = 50,
            offset = 0,
        } = params;

        // Build where conditions - start with required conditions
        const conditions = [
            eq(deptSchema.departmentIncidents.departmentId, departmentId),
            eq(deptSchema.departmentIncidents.isActive, true),
        ];

        if (searchTerm && typeof searchTerm === "string" && searchTerm.trim() !== "") {
            const term = `%${searchTerm.trim()}%`;
            const searchCondition = or(
                ilike(deptSchema.departmentIncidents.title, term),
                ilike(deptSchema.departmentIncidents.description, term),
                ilike(deptSchema.departmentIncidents.incidentNumber, term)
            );
            if (searchCondition) {
                conditions.push(searchCondition);
            }
        }

        if (incidentType) {
            conditions.push(eq(deptSchema.departmentIncidents.incidentType, incidentType as any));
        }

        if (severity) {
            conditions.push(eq(deptSchema.departmentIncidents.severity, severity as any));
        }

        if (status) {
            conditions.push(eq(deptSchema.departmentIncidents.status, status as any));
        }

        if (dateFrom) {
            conditions.push(gte(deptSchema.departmentIncidents.dateOccurred, dateFrom));
        }

        if (dateTo) {
            conditions.push(lte(deptSchema.departmentIncidents.dateOccurred, dateTo));
        }

        if (reportingMemberId) {
            conditions.push(eq(deptSchema.departmentIncidents.reportingMemberId, reportingMemberId));
        }

        if (location) {
            conditions.push(ilike(deptSchema.departmentIncidents.location, `%${location}%`));
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
                involvedCivilians: deptSchema.departmentIncidents.involvedCivilians,
                evidence: deptSchema.departmentIncidents.evidence,
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
            .limit(limit)
            .offset(offset);

        return {
            incidents: incidents.map(incident => ({
                id: incident.id,
                departmentId: incident.departmentId,
                reportingMemberId: incident.reportingMemberId,
                incidentNumber: incident.incidentNumber,
                incidentType: incident.incidentType as IncidentReport['incidentType'],
                title: incident.title,
                description: incident.description,
                location: incident.location || undefined,
                dateOccurred: incident.dateOccurred,
                dateReported: incident.dateReported,
                involvedMembers: incident.involvedMembers || [],
                involvedCivilians: incident.involvedCivilians as IncidentReport['involvedCivilians'] || undefined,
                evidence: incident.evidence as IncidentReport['evidence'] || undefined,
                severity: incident.severity as IncidentReport['severity'],
                status: incident.status as IncidentReport['status'],
                reviewedBy: incident.reviewedBy || undefined,
                reviewedAt: incident.reviewedAt || undefined,
                reviewNotes: incident.reviewNotes || undefined,
                followUpRequired: incident.followUpRequired,
                followUpDate: incident.followUpDate || undefined,
                tags: incident.tags || [],
                isActive: incident.isActive,
                createdAt: incident.createdAt,
                updatedAt: incident.updatedAt || undefined,
            })),
            total,
        };
    } catch (error) {
        console.error("Error searching incidents:", error);
        return {
            incidents: [],
            total: 0,
        };
    }
}

async function generateIncidentNumber(
    departmentId: number,
    incidentType: string
): Promise<string> {
    try {
        // Get department prefix
        const [department] = await postgrestDb
            .select({ name: deptSchema.departments.name })
            .from(deptSchema.departments)
            .where(eq(deptSchema.departments.id, departmentId))
            .limit(1);

        if (!department) {
            throw new Error("Department not found");
        }

        // Get current year
        const currentYear = new Date().getFullYear();
        
        // Get count of incidents for this department this year
        const startOfYear = new Date(currentYear, 0, 1);
        const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

        const [countResult] = await postgrestDb
            .select({ count: sql<number>`count(*)` })
            .from(deptSchema.departmentIncidents)
            .where(
                and(
                    eq(deptSchema.departmentIncidents.departmentId, departmentId),
                    gte(deptSchema.departmentIncidents.dateOccurred, startOfYear),
                    lte(deptSchema.departmentIncidents.dateOccurred, endOfYear)
                )
            );

        const incidentCount = (countResult?.count || 0) + 1;
        
        // Format: DEPT-YYYY-XXXX (e.g., LSPD-2024-0001)
        const departmentPrefix = (department.name || 'DEPT').replace(/\s+/g, '').toUpperCase();
        return `${departmentPrefix}-${currentYear}-${incidentCount.toString().padStart(4, '0')}`;
    } catch (error) {
        console.error("Error generating incident number:", error);
        // Fallback format
        return `INC-${Date.now()}`;
    }
}

function generateIncidentTags(
    incidentType: string,
    title: string,
    description: string
): string[] {
    const tags = new Set<string>();
    
    // Add type-based tags
    tags.add(incidentType);
    
    // Add severity-based tags
    const text = `${title} ${description}`.toLowerCase();
    
    // Add location-based tags
    if (text.includes("downtown") || text.includes("city center")) tags.add("downtown");
    if (text.includes("highway") || text.includes("freeway")) tags.add("highway");
    if (text.includes("residential") || text.includes("neighborhood")) tags.add("residential");
    if (text.includes("commercial") || text.includes("business")) tags.add("commercial");
    
    // Add time-based tags
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 18) tags.add("day");
    else tags.add("night");
    
    // Add weather-based tags (if mentioned)
    if (text.includes("rain") || text.includes("storm")) tags.add("weather");
    if (text.includes("traffic") || text.includes("accident")) tags.add("traffic");
    
    return Array.from(tags);
}

async function triggerIncidentReview(incidentId: number, severity: string): Promise<void> {
    try {
        // Update incident status to under_review
        await postgrestDb
            .update(deptSchema.departmentIncidents)
            .set({ status: "under_review" })
            .where(eq(deptSchema.departmentIncidents.id, incidentId));

        // For high/critical severity, schedule immediate follow-up
        if (severity === "high" || severity === "critical") {
            await scheduleIncidentFollowUp(incidentId);
        }
    } catch (error) {
        console.error("Error triggering incident review:", error);
    }
}

async function scheduleIncidentFollowUp(incidentId: number): Promise<void> {
    try {
        // Schedule follow-up for 3 days from now
        const followUpDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        
        await postgrestDb
            .update(deptSchema.departmentIncidents)
            .set({ 
                followUpRequired: true,
                followUpDate 
            })
            .where(eq(deptSchema.departmentIncidents.id, incidentId));
    } catch (error) {
        console.error("Error scheduling incident follow-up:", error);
    }
}

async function getIncidentById(incidentId: number): Promise<IncidentReport | null> {
    try {
        const [incident] = await postgrestDb
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
                involvedCivilians: deptSchema.departmentIncidents.involvedCivilians,
                evidence: deptSchema.departmentIncidents.evidence,
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
            .where(eq(deptSchema.departmentIncidents.id, incidentId))
            .limit(1);

        if (!incident) return null;

        return {
            id: incident.id,
            departmentId: incident.departmentId,
            reportingMemberId: incident.reportingMemberId,
            incidentNumber: incident.incidentNumber,
            incidentType: incident.incidentType as IncidentReport['incidentType'],
            title: incident.title,
            description: incident.description,
            location: incident.location || undefined,
            dateOccurred: incident.dateOccurred,
            dateReported: incident.dateReported,
            involvedMembers: incident.involvedMembers || [],
            involvedCivilians: incident.involvedCivilians as IncidentReport['involvedCivilians'] || undefined,
            evidence: incident.evidence as IncidentReport['evidence'] || undefined,
            severity: incident.severity as IncidentReport['severity'],
            status: incident.status as IncidentReport['status'],
            reviewedBy: incident.reviewedBy || undefined,
            reviewedAt: incident.reviewedAt || undefined,
            reviewNotes: incident.reviewNotes || undefined,
            followUpRequired: incident.followUpRequired,
            followUpDate: incident.followUpDate || undefined,
            tags: incident.tags || [],
            isActive: incident.isActive,
            createdAt: incident.createdAt,
            updatedAt: incident.updatedAt || undefined,
        };
    } catch (error) {
        console.error("Error getting incident by ID:", error);
        return null;
    }
}

async function checkIncidentUpdatePermissions(incidentId: number, memberId: number): Promise<boolean> {
    try {
        // Get incident details
        const incident = await getIncidentById(incidentId);
        if (!incident) return false;

        // Reporting member can always update their own incidents
        if (incident.reportingMemberId === memberId) return true;

        // Check if member is admin or supervisor
        const [member] = await postgrestDb
            .select({
                rankId: deptSchema.departmentMembers.rankId,
                permissions: deptSchema.departmentRanks.permissions,
            })
            .from(deptSchema.departmentMembers)
            .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
            )
            .where(eq(deptSchema.departmentMembers.id, memberId))
            .limit(1);

        if (!member) return false;

        // Check if member has incident management permissions
        const permissions = member.permissions as any;
        return permissions?.manage_department || permissions?.manage_members || false;
    } catch (error) {
        console.error("Error checking incident update permissions:", error);
        return false;
    }
}

async function checkIncidentReviewPermissions(memberId: number, departmentId: number): Promise<boolean> {
    try {
        const [member] = await postgrestDb
            .select({
                rankId: deptSchema.departmentMembers.rankId,
                permissions: deptSchema.departmentRanks.permissions,
            })
            .from(deptSchema.departmentMembers)
            .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
            )
            .where(
                and(
                    eq(deptSchema.departmentMembers.id, memberId),
                    eq(deptSchema.departmentMembers.departmentId, departmentId),
                    eq(deptSchema.departmentMembers.isActive, true)
                )
            )
            .limit(1);

        if (!member) return false;

        // Check if member has review permissions
        const permissions = member.permissions as any;
        return permissions?.manage_department || permissions?.manage_members || false;
    } catch (error) {
        console.error("Error checking incident review permissions:", error);
        return false;
    }
}

async function isAdmin(memberId: number): Promise<boolean> {
    try {
        const [member] = await postgrestDb
            .select({
                permissions: deptSchema.departmentRanks.permissions,
            })
            .from(deptSchema.departmentMembers)
            .leftJoin(
                deptSchema.departmentRanks,
                eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
            )
            .where(eq(deptSchema.departmentMembers.id, memberId))
            .limit(1);

        if (!member) return false;

        const permissions = member.permissions as any;
        return permissions?.manage_department || false;
    } catch (error) {
        console.error("Error checking admin status:", error);
        return false;
    }
}

function generateIncidentTrendData(
    startDate: Date, 
    endDate: Date, 
    incidents: Array<{ dateOccurred: Date }>
): Array<{ date: string; count: number }> {
    const trendData: Array<{ date: string; count: number }> = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0] || currentDate.toDateString();
        const count = incidents.filter(incident => 
            incident.dateOccurred.toISOString().split('T')[0] === dateStr
        ).length;
        
        trendData.push({ date: dateStr, count });
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return trendData;
}
