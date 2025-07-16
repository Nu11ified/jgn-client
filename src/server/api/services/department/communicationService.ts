import { eq, and, desc, asc, sql, gte, lte, inArray, isNull } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface DepartmentAnnouncement {
  id: number;
  departmentId: number;
  authorId: number;
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  targetAudience: "all_members" | "active_only" | "specific_ranks" | "specific_teams";
  targetRankIds?: number[];
  targetTeamIds?: number[];
  publishedAt: Date;
  expiresAt?: Date;
  requiresAcknowledgment: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface AnnouncementAcknowledgment {
  id: number;
  announcementId: number;
  memberId: number;
  acknowledgedAt: Date;
  createdAt: Date;
}

export interface CommunicationStats {
  totalAnnouncements: number;
  activeAnnouncements: number;
  urgentAnnouncements: number;
  acknowledgmentRate: number;
  recentActivity: Array<{
    type: "announcement" | "acknowledgment";
    title: string;
    memberName?: string;
    timestamp: Date;
  }>;
}

export async function sendDepartmentAnnouncement(params: {
  departmentId: number;
  authorId: number;
  title: string;
  content: string;
  priority?: "low" | "normal" | "high" | "urgent";
  targetAudience: "all_members" | "active_only" | "specific_ranks" | "specific_teams";
  targetRankIds?: number[];
  targetTeamIds?: number[];
  expiresAt?: Date;
  requiresAcknowledgment?: boolean;
}): Promise<{ success: boolean; message: string; announcementId?: number }> {
  try {
    const {
      departmentId,
      authorId,
      title,
      content,
      priority = "normal",
      targetAudience,
      targetRankIds,
      targetTeamIds,
      expiresAt,
      requiresAcknowledgment = false,
    } = params;

    // Validate author exists and has permissions
    const author = await postgrestDb
      .select({
        id: deptSchema.departmentMembers.id,
        isActive: deptSchema.departmentMembers.isActive,
        departmentId: deptSchema.departmentMembers.departmentId,
        rankId: deptSchema.departmentMembers.rankId,
      })
      .from(deptSchema.departmentMembers)
      .where(eq(deptSchema.departmentMembers.id, authorId))
      .limit(1);

    if (author.length === 0) {
      return {
        success: false,
        message: "Author not found",
      };
    }

    if (!author[0]!.isActive) {
      return {
        success: false,
        message: "Author is not active",
      };
    }

    if (author[0]!.departmentId !== departmentId) {
      return {
        success: false,
        message: "Author is not in the specified department",
      };
    }

    // Check if author has permission to send announcements
    const hasPermission = await checkAnnouncementPermissions(authorId, priority);
    if (!hasPermission) {
      return {
        success: false,
        message: "Insufficient permissions to send announcements",
      };
    }

    // Validate target audience parameters
    if (targetAudience === "specific_ranks" && (!targetRankIds || targetRankIds.length === 0)) {
      return {
        success: false,
        message: "Target rank IDs required when targeting specific ranks",
      };
    }

    if (targetAudience === "specific_teams" && (!targetTeamIds || targetTeamIds.length === 0)) {
      return {
        success: false,
        message: "Target team IDs required when targeting specific teams",
      };
    }

    // Validate target ranks/teams exist in the department
    if (targetRankIds && targetRankIds.length > 0) {
      const validRanks = await postgrestDb
        .select({ id: deptSchema.departmentRanks.id })
        .from(deptSchema.departmentRanks)
        .where(
          and(
            inArray(deptSchema.departmentRanks.id, targetRankIds),
            eq(deptSchema.departmentRanks.departmentId, departmentId),
            eq(deptSchema.departmentRanks.isActive, true)
          )
        );

      if (validRanks.length !== targetRankIds.length) {
        return {
          success: false,
          message: "One or more target ranks are invalid or not in the department",
        };
      }
    }

    if (targetTeamIds && targetTeamIds.length > 0) {
      const validTeams = await postgrestDb
        .select({ id: deptSchema.departmentTeams.id })
        .from(deptSchema.departmentTeams)
        .where(
          and(
            inArray(deptSchema.departmentTeams.id, targetTeamIds),
            eq(deptSchema.departmentTeams.departmentId, departmentId),
            eq(deptSchema.departmentTeams.isActive, true)
          )
        );

      if (validTeams.length !== targetTeamIds.length) {
        return {
          success: false,
          message: "One or more target teams are invalid or not in the department",
        };
      }
    }

    // Create announcement in database
    const [newAnnouncement] = await postgrestDb
      .insert(deptSchema.departmentAnnouncements)
      .values({
        departmentId,
        authorId,
        title,
        content,
        priority,
        targetAudience,
        targetRankIds,
        targetTeamIds,
        publishedAt: new Date(),
        expiresAt,
        requiresAcknowledgment,
        isActive: true,
      })
      .returning({
        id: deptSchema.departmentAnnouncements.id
      });

    if (!newAnnouncement) {
      return {
        success: false,
        message: "Failed to create announcement",
      };
    }

    const announcementId = newAnnouncement.id;

    // Get target members and send notifications
    const targetMembers = await getTargetMembers(departmentId, targetAudience, targetRankIds, targetTeamIds);
    await sendAnnouncementNotifications(announcementId, targetMembers, priority);

    // Log the announcement activity
    await logCommunicationActivity("announcement", announcementId, authorId, title);

    return {
      success: true,
      message: `Announcement sent successfully to ${targetMembers.length} members`,
      announcementId,
    };
  } catch (error) {
    console.error("Error sending department announcement:", error);
    return {
      success: false,
      message: `Failed to send announcement: ${error}`,
    };
  }
}

export async function acknowledgeAnnouncement(
  announcementId: number,
  memberId: number
): Promise<{ success: boolean; message: string }> {
  try {
    // Validate announcement exists and requires acknowledgment
    const announcement = await getAnnouncementById(announcementId);
    if (!announcement) {
      return {
        success: false,
        message: "Announcement not found",
      };
    }

    if (!announcement.requiresAcknowledgment) {
      return {
        success: false,
        message: "This announcement does not require acknowledgment",
      };
    }

    if (!announcement.isActive) {
      return {
        success: false,
        message: "Announcement is no longer active",
      };
    }

    // Check if announcement has expired
    if (announcement.expiresAt && announcement.expiresAt < new Date()) {
      return {
        success: false,
        message: "Announcement has expired",
      };
    }

    // Check if member is in target audience
    const isTargeted = await isMemberTargeted(announcementId, memberId);
    if (!isTargeted) {
      return {
        success: false,
        message: "You are not in the target audience for this announcement",
      };
    }

    // Check if already acknowledged
    const existingAck = await getExistingAcknowledgment(announcementId, memberId);
    if (existingAck) {
      return {
        success: false,
        message: "Announcement already acknowledged",
      };
    }

    // Create acknowledgment record in database
    const [newAcknowledgment] = await postgrestDb
      .insert(deptSchema.departmentAnnouncementAcknowledgments)
      .values({
        announcementId,
        memberId,
        acknowledgedAt: new Date(),
      })
      .returning({
        id: deptSchema.departmentAnnouncementAcknowledgments.id
      });

    if (!newAcknowledgment) {
      return {
        success: false,
        message: "Failed to create acknowledgment",
      };
    }

    // Log the acknowledgment activity
    await logCommunicationActivity("acknowledgment", announcementId, memberId, announcement.title);

    return {
      success: true,
      message: "Announcement acknowledged successfully",
    };
  } catch (error) {
    console.error("Error acknowledging announcement:", error);
    return {
      success: false,
      message: `Failed to acknowledge announcement: ${error}`,
    };
  }
}

export async function getAnnouncementsForMember(
  memberId: number,
  includeExpired: boolean = false,
  limit: number = 20
): Promise<Array<DepartmentAnnouncement & { isAcknowledged?: boolean }>> {
  try {
    // Get member's department and details
    const member = await postgrestDb
      .select({
        id: deptSchema.departmentMembers.id,
        departmentId: deptSchema.departmentMembers.departmentId,
        rankId: deptSchema.departmentMembers.rankId,
        primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
        isActive: deptSchema.departmentMembers.isActive,
      })
      .from(deptSchema.departmentMembers)
      .where(eq(deptSchema.departmentMembers.id, memberId))
      .limit(1);

    if (member.length === 0) {
      return [];
    }

    const memberData = member[0]!;

    // Build conditions for announcements
    const conditions = [
      eq(deptSchema.departmentAnnouncements.departmentId, memberData.departmentId),
      eq(deptSchema.departmentAnnouncements.isActive, true),
    ];

    // Add expiration filter if needed
    if (!includeExpired) {
      conditions.push(
        sql`(${deptSchema.departmentAnnouncements.expiresAt} IS NULL OR ${deptSchema.departmentAnnouncements.expiresAt} > NOW())`
      );
    }

    // Get announcements that target this member
    const announcementResults = await postgrestDb
      .select({
        id: deptSchema.departmentAnnouncements.id,
        departmentId: deptSchema.departmentAnnouncements.departmentId,
        authorId: deptSchema.departmentAnnouncements.authorId,
        title: deptSchema.departmentAnnouncements.title,
        content: deptSchema.departmentAnnouncements.content,
        priority: deptSchema.departmentAnnouncements.priority,
        targetAudience: deptSchema.departmentAnnouncements.targetAudience,
        targetRankIds: deptSchema.departmentAnnouncements.targetRankIds,
        targetTeamIds: deptSchema.departmentAnnouncements.targetTeamIds,
        publishedAt: deptSchema.departmentAnnouncements.publishedAt,
        expiresAt: deptSchema.departmentAnnouncements.expiresAt,
        requiresAcknowledgment: deptSchema.departmentAnnouncements.requiresAcknowledgment,
        isActive: deptSchema.departmentAnnouncements.isActive,
        createdAt: deptSchema.departmentAnnouncements.createdAt,
        updatedAt: deptSchema.departmentAnnouncements.updatedAt,
      })
      .from(deptSchema.departmentAnnouncements)
      .where(and(...conditions))
      .orderBy(desc(deptSchema.departmentAnnouncements.publishedAt))
      .limit(limit);

    // Filter announcements based on target audience
    const filteredAnnouncements = announcementResults.filter(announcement => {
      switch (announcement.targetAudience) {
        case "all_members":
          return true;
        case "active_only":
          return memberData.isActive;
        case "specific_ranks":
          return memberData.rankId && announcement.targetRankIds?.includes(memberData.rankId);
        case "specific_teams":
          return memberData.primaryTeamId && announcement.targetTeamIds?.includes(memberData.primaryTeamId);
        default:
          return false;
      }
    });

    // Get acknowledgment status for each announcement
    const announcementIds = filteredAnnouncements.map(a => a.id);
    const acknowledgments = announcementIds.length > 0 ? await postgrestDb
      .select({
        announcementId: deptSchema.departmentAnnouncementAcknowledgments.announcementId,
      })
      .from(deptSchema.departmentAnnouncementAcknowledgments)
      .where(
        and(
          inArray(deptSchema.departmentAnnouncementAcknowledgments.announcementId, announcementIds),
          eq(deptSchema.departmentAnnouncementAcknowledgments.memberId, memberId)
        )
      ) : [];

    const acknowledgedIds = new Set(acknowledgments.map(a => a.announcementId));

    // Map to final format
    const announcements: Array<DepartmentAnnouncement & { isAcknowledged?: boolean }> = filteredAnnouncements.map(announcement => ({
      id: announcement.id,
      departmentId: announcement.departmentId,
      authorId: announcement.authorId,
      title: announcement.title,
      content: announcement.content,
      priority: announcement.priority as DepartmentAnnouncement['priority'],
      targetAudience: announcement.targetAudience as DepartmentAnnouncement['targetAudience'],
      targetRankIds: announcement.targetRankIds || undefined,
      targetTeamIds: announcement.targetTeamIds || undefined,
      publishedAt: announcement.publishedAt,
      expiresAt: announcement.expiresAt || undefined,
      requiresAcknowledgment: announcement.requiresAcknowledgment,
      isActive: announcement.isActive,
      createdAt: announcement.createdAt,
      updatedAt: announcement.updatedAt || undefined,
      isAcknowledged: acknowledgedIds.has(announcement.id),
    }));

    return announcements;
  } catch (error) {
    console.error("Error getting announcements for member:", error);
    return [];
  }
}

export async function getCommunicationStats(departmentId: number): Promise<CommunicationStats> {
  try {
    // Get total announcements count
    const [totalResult] = await postgrestDb
      .select({ count: sql<number>`count(*)` })
      .from(deptSchema.departmentAnnouncements)
      .where(eq(deptSchema.departmentAnnouncements.departmentId, departmentId));

    const totalAnnouncements = totalResult?.count || 0;

    // Get active announcements count
    const [activeResult] = await postgrestDb
      .select({ count: sql<number>`count(*)` })
      .from(deptSchema.departmentAnnouncements)
      .where(
        and(
          eq(deptSchema.departmentAnnouncements.departmentId, departmentId),
          eq(deptSchema.departmentAnnouncements.isActive, true),
          sql`(${deptSchema.departmentAnnouncements.expiresAt} IS NULL OR ${deptSchema.departmentAnnouncements.expiresAt} > NOW())`
        )
      );

    const activeAnnouncements = activeResult?.count || 0;

    // Get urgent announcements count
    const [urgentResult] = await postgrestDb
      .select({ count: sql<number>`count(*)` })
      .from(deptSchema.departmentAnnouncements)
      .where(
        and(
          eq(deptSchema.departmentAnnouncements.departmentId, departmentId),
          eq(deptSchema.departmentAnnouncements.isActive, true),
          eq(deptSchema.departmentAnnouncements.priority, "urgent"),
          sql`(${deptSchema.departmentAnnouncements.expiresAt} IS NULL OR ${deptSchema.departmentAnnouncements.expiresAt} > NOW())`
        )
      );

    const urgentAnnouncements = urgentResult?.count || 0;

    // Calculate acknowledgment rate
    const announcementsRequiringAck = await postgrestDb
      .select({
        id: deptSchema.departmentAnnouncements.id,
        publishedAt: deptSchema.departmentAnnouncements.publishedAt,
      })
      .from(deptSchema.departmentAnnouncements)
      .where(
        and(
          eq(deptSchema.departmentAnnouncements.departmentId, departmentId),
          eq(deptSchema.departmentAnnouncements.requiresAcknowledgment, true),
          eq(deptSchema.departmentAnnouncements.isActive, true),
          gte(deptSchema.departmentAnnouncements.publishedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // Last 30 days
        )
      );

    let acknowledgmentRate = 0;
    if (announcementsRequiringAck.length > 0) {
      const announcementIds = announcementsRequiringAck.map(a => a.id);
      const [ackResult] = await postgrestDb
        .select({ count: sql<number>`count(*)` })
        .from(deptSchema.departmentAnnouncementAcknowledgments)
        .where(inArray(deptSchema.departmentAnnouncementAcknowledgments.announcementId, announcementIds));

      const totalAcks = ackResult?.count || 0;
      const expectedAcks = announcementsRequiringAck.length * await getActiveMemberCount(departmentId);
      acknowledgmentRate = expectedAcks > 0 ? (totalAcks / expectedAcks) * 100 : 0;
    }

    // Get recent activity
    const recentAnnouncements = await postgrestDb
      .select({
        id: deptSchema.departmentAnnouncements.id,
        title: deptSchema.departmentAnnouncements.title,
        publishedAt: deptSchema.departmentAnnouncements.publishedAt,
      })
      .from(deptSchema.departmentAnnouncements)
      .where(
        and(
          eq(deptSchema.departmentAnnouncements.departmentId, departmentId),
          gte(deptSchema.departmentAnnouncements.publishedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // Last 7 days
        )
      )
      .orderBy(desc(deptSchema.departmentAnnouncements.publishedAt))
      .limit(5);

    const recentAcks = await postgrestDb
      .select({
        announcementTitle: deptSchema.departmentAnnouncements.title,
        memberName: deptSchema.departmentMembers.roleplayName,
        acknowledgedAt: deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt,
      })
      .from(deptSchema.departmentAnnouncementAcknowledgments)
      .innerJoin(
        deptSchema.departmentAnnouncements,
        eq(deptSchema.departmentAnnouncementAcknowledgments.announcementId, deptSchema.departmentAnnouncements.id)
      )
      .innerJoin(
        deptSchema.departmentMembers,
        eq(deptSchema.departmentAnnouncementAcknowledgments.memberId, deptSchema.departmentMembers.id)
      )
      .where(
        and(
          eq(deptSchema.departmentAnnouncements.departmentId, departmentId),
          gte(deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        )
      )
      .orderBy(desc(deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt))
      .limit(5);

    // Combine and sort recent activity
    const recentActivity: CommunicationStats['recentActivity'] = [
      ...recentAnnouncements.map(a => ({
        type: "announcement" as const,
        title: a.title,
        timestamp: a.publishedAt,
      })),
      ...recentAcks.map(a => ({
        type: "acknowledgment" as const,
        title: a.announcementTitle,
        memberName: a.memberName || undefined,
        timestamp: a.acknowledgedAt,
      })),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10);

    return {
      totalAnnouncements,
      activeAnnouncements,
      urgentAnnouncements,
      acknowledgmentRate: Math.round(acknowledgmentRate * 10) / 10,
      recentActivity,
    };
  } catch (error) {
    console.error("Error getting communication stats:", error);
    throw error;
  }
}

export async function getAnnouncementAcknowledgments(
  announcementId: number
): Promise<Array<{
  memberId: number;
  memberName: string;
  acknowledgedAt: Date;
  timeTaken: number; // hours from publication to acknowledgment
}>> {
  try {
    // Get announcement publication date
    const [announcement] = await postgrestDb
      .select({
        publishedAt: deptSchema.departmentAnnouncements.publishedAt,
      })
      .from(deptSchema.departmentAnnouncements)
      .where(eq(deptSchema.departmentAnnouncements.id, announcementId))
      .limit(1);

    if (!announcement) {
      return [];
    }

    // Get acknowledgments with member details
    const acknowledgments = await postgrestDb
      .select({
        memberId: deptSchema.departmentAnnouncementAcknowledgments.memberId,
        acknowledgedAt: deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt,
        memberName: deptSchema.departmentMembers.roleplayName,
      })
      .from(deptSchema.departmentAnnouncementAcknowledgments)
      .innerJoin(
        deptSchema.departmentMembers,
        eq(deptSchema.departmentAnnouncementAcknowledgments.memberId, deptSchema.departmentMembers.id)
      )
      .where(eq(deptSchema.departmentAnnouncementAcknowledgments.announcementId, announcementId))
      .orderBy(asc(deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt));

    return acknowledgments.map(ack => {
      const timeTaken = (ack.acknowledgedAt.getTime() - announcement.publishedAt.getTime()) / (1000 * 60 * 60);
      return {
        memberId: ack.memberId,
        memberName: ack.memberName || "Unknown Member",
        acknowledgedAt: ack.acknowledgedAt,
        timeTaken: Math.round(timeTaken * 10) / 10,
      };
    });
  } catch (error) {
    console.error("Error getting announcement acknowledgments:", error);
    return [];
  }
}

// Helper functions

async function checkAnnouncementPermissions(memberId: number, priority: string): Promise<boolean> {
  // Get member's rank and permissions
  const member = await postgrestDb
    .select({
      rankId: deptSchema.departmentMembers.rankId,
    })
    .from(deptSchema.departmentMembers)
    .where(eq(deptSchema.departmentMembers.id, memberId))
    .limit(1);

  if (member.length === 0) return false;

  const rankId = member[0]!.rankId;
  if (!rankId) return false;

  // Get rank permissions
  const rank = await postgrestDb
    .select({
      permissions: deptSchema.departmentRanks.permissions,
      level: deptSchema.departmentRanks.level,
    })
    .from(deptSchema.departmentRanks)
    .where(eq(deptSchema.departmentRanks.id, rankId))
    .limit(1);

  if (rank.length === 0) return false;

  const permissions = rank[0]!.permissions;
  const level = rank[0]!.level;

  // Check basic announcement permission
  if (!permissions.manage_members && !permissions.manage_department) {
    return false;
  }

  // High/urgent priority announcements require higher rank
  if ((priority === "high" || priority === "urgent") && level < 3) {
    return false;
  }

  return true;
}

async function getTargetMembers(
  departmentId: number,
  targetAudience: string,
  targetRankIds?: number[],
  targetTeamIds?: number[]
): Promise<number[]> {
  let conditions = [eq(deptSchema.departmentMembers.departmentId, departmentId)];

  switch (targetAudience) {
    case "active_only":
      conditions.push(eq(deptSchema.departmentMembers.isActive, true));
      break;
    case "specific_ranks":
      conditions.push(eq(deptSchema.departmentMembers.isActive, true));
      if (targetRankIds && targetRankIds.length > 0) {
        conditions.push(inArray(deptSchema.departmentMembers.rankId, targetRankIds));
      }
      break;
    case "specific_teams":
      conditions.push(eq(deptSchema.departmentMembers.isActive, true));
      if (targetTeamIds && targetTeamIds.length > 0) {
        conditions.push(inArray(deptSchema.departmentMembers.primaryTeamId, targetTeamIds));
      }
      break;
    default: // all_members
      // No additional conditions
      break;
  }

  const members = await postgrestDb
    .select({ id: deptSchema.departmentMembers.id })
    .from(deptSchema.departmentMembers)
    .where(and(...conditions));

  return members.map(m => m.id);
}

async function sendAnnouncementNotifications(
  announcementId: number,
  targetMembers: number[],
  priority: string
): Promise<void> {
  // Placeholder - would send actual notifications (Discord, email, etc.)
  console.log(`Sending ${priority} announcement ${announcementId} to ${targetMembers.length} members`);

  // For urgent announcements, might send immediate notifications
  if (priority === "urgent") {
    console.log("Sending urgent notifications via Discord/SMS");
  }
}

async function logCommunicationActivity(
  type: "announcement" | "acknowledgment",
  announcementId: number,
  memberId: number,
  title: string
): Promise<void> {
  // Placeholder - would log to activity/audit table
  console.log(`Logging ${type} activity:`, {
    type,
    announcementId,
    memberId,
    title,
    timestamp: new Date(),
  });
}

async function getAnnouncementById(announcementId: number): Promise<DepartmentAnnouncement | null> {
  try {
    const [announcement] = await postgrestDb
      .select({
        id: deptSchema.departmentAnnouncements.id,
        departmentId: deptSchema.departmentAnnouncements.departmentId,
        authorId: deptSchema.departmentAnnouncements.authorId,
        title: deptSchema.departmentAnnouncements.title,
        content: deptSchema.departmentAnnouncements.content,
        priority: deptSchema.departmentAnnouncements.priority,
        targetAudience: deptSchema.departmentAnnouncements.targetAudience,
        targetRankIds: deptSchema.departmentAnnouncements.targetRankIds,
        targetTeamIds: deptSchema.departmentAnnouncements.targetTeamIds,
        publishedAt: deptSchema.departmentAnnouncements.publishedAt,
        expiresAt: deptSchema.departmentAnnouncements.expiresAt,
        requiresAcknowledgment: deptSchema.departmentAnnouncements.requiresAcknowledgment,
        isActive: deptSchema.departmentAnnouncements.isActive,
        createdAt: deptSchema.departmentAnnouncements.createdAt,
        updatedAt: deptSchema.departmentAnnouncements.updatedAt,
      })
      .from(deptSchema.departmentAnnouncements)
      .where(eq(deptSchema.departmentAnnouncements.id, announcementId))
      .limit(1);

    if (!announcement) return null;

    return {
      id: announcement.id,
      departmentId: announcement.departmentId,
      authorId: announcement.authorId,
      title: announcement.title,
      content: announcement.content,
      priority: announcement.priority as DepartmentAnnouncement['priority'],
      targetAudience: announcement.targetAudience as DepartmentAnnouncement['targetAudience'],
      targetRankIds: announcement.targetRankIds || undefined,
      targetTeamIds: announcement.targetTeamIds || undefined,
      publishedAt: announcement.publishedAt,
      expiresAt: announcement.expiresAt || undefined,
      requiresAcknowledgment: announcement.requiresAcknowledgment,
      isActive: announcement.isActive,
      createdAt: announcement.createdAt,
      updatedAt: announcement.updatedAt || undefined,
    };
  } catch (error) {
    console.error("Error getting announcement by ID:", error);
    return null;
  }
}

async function isMemberTargeted(announcementId: number, memberId: number): Promise<boolean> {
  try {
    // Get announcement details
    const announcement = await getAnnouncementById(announcementId);
    if (!announcement) return false;

    // Get member details
    const [member] = await postgrestDb
      .select({
        id: deptSchema.departmentMembers.id,
        departmentId: deptSchema.departmentMembers.departmentId,
        rankId: deptSchema.departmentMembers.rankId,
        primaryTeamId: deptSchema.departmentMembers.primaryTeamId,
        isActive: deptSchema.departmentMembers.isActive,
      })
      .from(deptSchema.departmentMembers)
      .where(eq(deptSchema.departmentMembers.id, memberId))
      .limit(1);

    if (!member) return false;

    // Check if member is in the same department
    if (member.departmentId !== announcement.departmentId) return false;

    // Check target audience
    switch (announcement.targetAudience) {
      case "all_members":
        return true;
      case "active_only":
        return member.isActive;
      case "specific_ranks":
        return member.rankId && announcement.targetRankIds?.includes(member.rankId) || false;
      case "specific_teams":
        return member.primaryTeamId && announcement.targetTeamIds?.includes(member.primaryTeamId) || false;
      default:
        return false;
    }
  } catch (error) {
    console.error("Error checking if member is targeted:", error);
    return false;
  }
}

async function getExistingAcknowledgment(
  announcementId: number,
  memberId: number
): Promise<AnnouncementAcknowledgment | null> {
  try {
    const [acknowledgment] = await postgrestDb
      .select({
        id: deptSchema.departmentAnnouncementAcknowledgments.id,
        announcementId: deptSchema.departmentAnnouncementAcknowledgments.announcementId,
        memberId: deptSchema.departmentAnnouncementAcknowledgments.memberId,
        acknowledgedAt: deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt,
        createdAt: deptSchema.departmentAnnouncementAcknowledgments.createdAt,
      })
      .from(deptSchema.departmentAnnouncementAcknowledgments)
      .where(
        and(
          eq(deptSchema.departmentAnnouncementAcknowledgments.announcementId, announcementId),
          eq(deptSchema.departmentAnnouncementAcknowledgments.memberId, memberId)
        )
      )
      .limit(1);

    if (!acknowledgment) return null;

    return {
      id: acknowledgment.id,
      announcementId: acknowledgment.announcementId,
      memberId: acknowledgment.memberId,
      acknowledgedAt: acknowledgment.acknowledgedAt,
      createdAt: acknowledgment.createdAt,
    };
  } catch (error) {
    console.error("Error getting existing acknowledgment:", error);
    return null;
  }
}

async function getActiveMemberCount(departmentId: number): Promise<number> {
  try {
    const [result] = await postgrestDb
      .select({ count: sql<number>`count(*)` })
      .from(deptSchema.departmentMembers)
      .where(
        and(
          eq(deptSchema.departmentMembers.departmentId, departmentId),
          eq(deptSchema.departmentMembers.isActive, true)
        )
      );

    return result?.count || 0;
  } catch (error) {
    console.error("Error getting active member count:", error);
    return 0;
  }
}

// Additional utility functions for communication management

export async function searchAnnouncements(params: {
  departmentId: number;
  searchTerm?: string;
  priority?: string;
  targetAudience?: string;
  authorId?: number;
  dateFrom?: Date;
  dateTo?: Date;
  requiresAcknowledgment?: boolean;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{
  announcements: DepartmentAnnouncement[];
  total: number;
}> {
    try {
      const {
        departmentId,
        searchTerm,
        priority,
        targetAudience,
        authorId,
        dateFrom,
        dateTo,
        requiresAcknowledgment,
        isActive,
        limit = 50,
        offset = 0,
      } = params;

      // Build where conditions
      const conditions = [
        eq(deptSchema.departmentAnnouncements.departmentId, departmentId),
      ];

      if (searchTerm && typeof searchTerm === "string" && searchTerm.trim() !== "") {
        const term = `%${searchTerm.trim()}%`;
        conditions.push(
          sql`(${deptSchema.departmentAnnouncements.title} ILIKE ${term} OR ${deptSchema.departmentAnnouncements.content} ILIKE ${term})`
        );
      }

      if (priority) {
        conditions.push(eq(deptSchema.departmentAnnouncements.priority, priority as any));
      }

      if (targetAudience) {
        conditions.push(eq(deptSchema.departmentAnnouncements.targetAudience, targetAudience as any));
      }

      if (authorId) {
        conditions.push(eq(deptSchema.departmentAnnouncements.authorId, authorId));
      }

      if (dateFrom) {
        conditions.push(gte(deptSchema.departmentAnnouncements.publishedAt, dateFrom));
      }

      if (dateTo) {
        conditions.push(lte(deptSchema.departmentAnnouncements.publishedAt, dateTo));
      }

      if (requiresAcknowledgment !== undefined) {
        conditions.push(eq(deptSchema.departmentAnnouncements.requiresAcknowledgment, requiresAcknowledgment));
      }

      if (isActive !== undefined) {
        conditions.push(eq(deptSchema.departmentAnnouncements.isActive, isActive));
      }

      // Get total count
      const [totalResult] = await postgrestDb
        .select({ count: sql<number>`count(*)` })
        .from(deptSchema.departmentAnnouncements)
        .where(and(...conditions));

      const total = totalResult?.count || 0;

      // Get announcements with pagination
      const announcementResults = await postgrestDb
        .select({
          id: deptSchema.departmentAnnouncements.id,
          departmentId: deptSchema.departmentAnnouncements.departmentId,
          authorId: deptSchema.departmentAnnouncements.authorId,
          title: deptSchema.departmentAnnouncements.title,
          content: deptSchema.departmentAnnouncements.content,
          priority: deptSchema.departmentAnnouncements.priority,
          targetAudience: deptSchema.departmentAnnouncements.targetAudience,
          targetRankIds: deptSchema.departmentAnnouncements.targetRankIds,
          targetTeamIds: deptSchema.departmentAnnouncements.targetTeamIds,
          publishedAt: deptSchema.departmentAnnouncements.publishedAt,
          expiresAt: deptSchema.departmentAnnouncements.expiresAt,
          requiresAcknowledgment: deptSchema.departmentAnnouncements.requiresAcknowledgment,
          isActive: deptSchema.departmentAnnouncements.isActive,
          createdAt: deptSchema.departmentAnnouncements.createdAt,
          updatedAt: deptSchema.departmentAnnouncements.updatedAt,
        })
        .from(deptSchema.departmentAnnouncements)
        .where(and(...conditions))
        .orderBy(desc(deptSchema.departmentAnnouncements.publishedAt))
        .limit(limit)
        .offset(offset);

      const announcements: DepartmentAnnouncement[] = announcementResults.map(announcement => ({
        id: announcement.id,
        departmentId: announcement.departmentId,
        authorId: announcement.authorId,
        title: announcement.title,
        content: announcement.content,
        priority: announcement.priority as DepartmentAnnouncement['priority'],
        targetAudience: announcement.targetAudience as DepartmentAnnouncement['targetAudience'],
        targetRankIds: announcement.targetRankIds || undefined,
        targetTeamIds: announcement.targetTeamIds || undefined,
        publishedAt: announcement.publishedAt,
        expiresAt: announcement.expiresAt || undefined,
        requiresAcknowledgment: announcement.requiresAcknowledgment,
        isActive: announcement.isActive,
        createdAt: announcement.createdAt,
        updatedAt: announcement.updatedAt || undefined,
      }));

      return {
        announcements,
        total,
      };
    } catch (error) {
      console.error("Error searching announcements:", error);
      return {
        announcements: [],
        total: 0,
      };
    }
  }

export async function updateAnnouncement(
  announcementId: number,
  updates: Partial<DepartmentAnnouncement>,
  updatedBy: number
): Promise<{ success: boolean; message: string }> {
  try {
    // Validate announcement exists
    const announcement = await getAnnouncementById(announcementId);
    if (!announcement) {
      return {
        success: false,
        message: "Announcement not found",
      };
    }

    // Check permissions - only author or admins can update
    const canUpdate = await checkUpdatePermissions(announcementId, updatedBy);
    if (!canUpdate) {
      return {
        success: false,
        message: "Insufficient permissions to update this announcement",
      };
    }

    // Prepare update data
    const updateData: any = {};

    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.targetAudience !== undefined) updateData.targetAudience = updates.targetAudience;
    if (updates.targetRankIds !== undefined) updateData.targetRankIds = updates.targetRankIds;
    if (updates.targetTeamIds !== undefined) updateData.targetTeamIds = updates.targetTeamIds;
    if (updates.expiresAt !== undefined) updateData.expiresAt = updates.expiresAt;
    if (updates.requiresAcknowledgment !== undefined) updateData.requiresAcknowledgment = updates.requiresAcknowledgment;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    // Update announcement in database
    const result = await postgrestDb
      .update(deptSchema.departmentAnnouncements)
      .set(updateData)
      .where(eq(deptSchema.departmentAnnouncements.id, announcementId))
      .returning({ id: deptSchema.departmentAnnouncements.id });

    if (result.length === 0) {
      return {
        success: false,
        message: "Failed to update announcement",
      };
    }

    return {
      success: true,
      message: "Announcement updated successfully",
    };
  } catch (error) {
    console.error("Error updating announcement:", error);
    return {
      success: false,
      message: `Failed to update announcement: ${error}`,
    };
  }
}

export async function deleteAnnouncement(
  announcementId: number,
  deletedBy: number
): Promise<{ success: boolean; message: string }> {
  try {
    // Validate announcement exists
    const announcement = await getAnnouncementById(announcementId);
    if (!announcement) {
      return {
        success: false,
        message: "Announcement not found",
      };
    }

    // Check permissions - only author or admins can delete
    const canDelete = await checkUpdatePermissions(announcementId, deletedBy);
    if (!canDelete) {
      return {
        success: false,
        message: "Insufficient permissions to delete this announcement",
      };
    }

    // Soft delete by setting isActive to false
    const result = await postgrestDb
      .update(deptSchema.departmentAnnouncements)
      .set({ isActive: false })
      .where(eq(deptSchema.departmentAnnouncements.id, announcementId))
      .returning({ id: deptSchema.departmentAnnouncements.id });

    if (result.length === 0) {
      return {
        success: false,
        message: "Failed to delete announcement",
      };
    }

    return {
      success: true,
      message: "Announcement deleted successfully",
    };
  } catch (error) {
    console.error("Error deleting announcement:", error);
    return {
      success: false,
      message: `Failed to delete announcement: ${error}`,
    };
  }
}

export async function getAnnouncementStats(
  announcementId: number
): Promise<{
  totalTargeted: number;
  totalAcknowledged: number;
  acknowledgmentRate: number;
  averageResponseTime: number; // hours
  pendingMembers: Array<{
    memberId: number;
    memberName: string;
    daysSincePublished: number;
  }>;
}> {
  try {
    const announcement = await getAnnouncementById(announcementId);
    if (!announcement) {
      throw new Error("Announcement not found");
    }

    // Get target members
    const targetMembers = await getTargetMembers(
      announcement.departmentId,
      announcement.targetAudience,
      announcement.targetRankIds,
      announcement.targetTeamIds
    );

    const totalTargeted = targetMembers.length;

    // Get acknowledgments
    const acknowledgments = await postgrestDb
      .select({
        memberId: deptSchema.departmentAnnouncementAcknowledgments.memberId,
        acknowledgedAt: deptSchema.departmentAnnouncementAcknowledgments.acknowledgedAt,
      })
      .from(deptSchema.departmentAnnouncementAcknowledgments)
      .where(eq(deptSchema.departmentAnnouncementAcknowledgments.announcementId, announcementId));

    const totalAcknowledged = acknowledgments.length;
    const acknowledgmentRate = totalTargeted > 0 ? (totalAcknowledged / totalTargeted) * 100 : 0;

    // Calculate average response time
    let averageResponseTime = 0;
    if (acknowledgments.length > 0) {
      const totalResponseTime = acknowledgments.reduce((sum, ack) => {
        const responseTime = (ack.acknowledgedAt.getTime() - announcement.publishedAt.getTime()) / (1000 * 60 * 60);
        return sum + responseTime;
      }, 0);
      averageResponseTime = totalResponseTime / acknowledgments.length;
    }

    // Get pending members (if requires acknowledgment)
    let pendingMembers: Array<{
      memberId: number;
      memberName: string;
      daysSincePublished: number;
    }> = [];

    if (announcement.requiresAcknowledgment) {
      const acknowledgedMemberIds = new Set(acknowledgments.map(a => a.memberId));
      const pendingMemberIds = targetMembers.filter(id => !acknowledgedMemberIds.has(id));

      if (pendingMemberIds.length > 0) {
        const pendingMemberDetails = await postgrestDb
          .select({
            id: deptSchema.departmentMembers.id,
            roleplayName: deptSchema.departmentMembers.roleplayName,
          })
          .from(deptSchema.departmentMembers)
          .where(inArray(deptSchema.departmentMembers.id, pendingMemberIds));

        const daysSincePublished = Math.floor(
          (Date.now() - announcement.publishedAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        pendingMembers = pendingMemberDetails.map(member => ({
          memberId: member.id,
          memberName: member.roleplayName || "Unknown Member",
          daysSincePublished,
        }));
      }
    }

    return {
      totalTargeted,
      totalAcknowledged,
      acknowledgmentRate: Math.round(acknowledgmentRate * 10) / 10,
      averageResponseTime: Math.round(averageResponseTime * 10) / 10,
      pendingMembers,
    };
  } catch (error) {
    console.error("Error getting announcement stats:", error);
    throw error;
  }
}

async function checkUpdatePermissions(announcementId: number, memberId: number): Promise<boolean> {
  try {
    // Get announcement details
    const announcement = await getAnnouncementById(announcementId);
    if (!announcement) return false;

    // Check if member is the author
    if (announcement.authorId === memberId) return true;

    // Check if member has admin permissions
    const member = await postgrestDb
      .select({
        rankId: deptSchema.departmentMembers.rankId,
      })
      .from(deptSchema.departmentMembers)
      .where(eq(deptSchema.departmentMembers.id, memberId))
      .limit(1);

    if (member.length === 0) return false;

    const rankId = member[0]!.rankId;
    if (!rankId) return false;

    // Get rank permissions
    const rank = await postgrestDb
      .select({
        permissions: deptSchema.departmentRanks.permissions,
      })
      .from(deptSchema.departmentRanks)
      .where(eq(deptSchema.departmentRanks.id, rankId))
      .limit(1);

    if (rank.length === 0) return false;

    const permissions = rank[0]!.permissions;

    // Check if member has department management permissions
    return permissions.manage_department || permissions.manage_members;
  } catch (error) {
    console.error("Error checking update permissions:", error);
    return false;
  }
}