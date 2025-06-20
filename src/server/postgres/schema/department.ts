import { sql } from "drizzle-orm";
import { index, pgTableCreator, unique } from "drizzle-orm/pg-core";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { type SelectType, type InsertType } from "./drizzle-types";

/**
 * Department Management System Schema
 * For FiveM Community departments: Law Enforcement, Fire Department, Staff Team
 */
export const createDepartmentTable = pgTableCreator((name) => `dept_${name}`);

// Enums for Department Types
export const departmentTypeEnum = z.enum([
  "law_enforcement",
  "fire_department", 
  "staff_team"
]);
export type DepartmentType = z.infer<typeof departmentTypeEnum>;

// Enums for Member Status
export const departmentMemberStatusEnum = z.enum([
  "in_training",
  "pending",
  "active",
  "inactive", 
  "leave_of_absence",
  "warned_1",
  "warned_2", 
  "warned_3",
  "suspended",
  "blacklisted"
]);
export type DepartmentMemberStatus = z.infer<typeof departmentMemberStatusEnum>;

// Enums for Clock Status
export const departmentClockStatusEnum = z.enum([
  "clocked_in",
  "clocked_out",
  "on_break"
]);
export type DepartmentClockStatus = z.infer<typeof departmentClockStatusEnum>;

// Enums for Meeting Status
export const departmentMeetingStatusEnum = z.enum([
  "scheduled",
  "in_progress", 
  "completed",
  "cancelled"
]);
export type DepartmentMeetingStatus = z.infer<typeof departmentMeetingStatusEnum>;

// Enums for Attendance Status
export const departmentAttendanceStatusEnum = z.enum([
  "present",
  "absent",
  "excused", 
  "late"
]);
export type DepartmentAttendanceStatus = z.infer<typeof departmentAttendanceStatusEnum>;

// Zod schema for permissions object
export const departmentPermissionsSchema = z.object({
  // Department-wide permissions
  manage_department: z.boolean().default(false),
  manage_ranks: z.boolean().default(false), 
  manage_teams: z.boolean().default(false),
  manage_members: z.boolean().default(false),
  view_all_members: z.boolean().default(false),
  
  // Member management permissions
  recruit_members: z.boolean().default(false),
  promote_members: z.boolean().default(false),
  demote_members: z.boolean().default(false),
  discipline_members: z.boolean().default(false),
  remove_members: z.boolean().default(false),
  
  // Time tracking permissions
  manage_timeclock: z.boolean().default(false),
  view_all_timeclock: z.boolean().default(false),
  edit_timeclock: z.boolean().default(false),
  
  // Meeting permissions
  schedule_meetings: z.boolean().default(false),
  manage_meetings: z.boolean().default(false),
  take_attendance: z.boolean().default(false),
  view_all_meetings: z.boolean().default(false),
  
  // Team-specific permissions
  manage_team_members: z.boolean().default(false),
  view_team_members: z.boolean().default(true)
});
export type DepartmentPermissions = z.infer<typeof departmentPermissionsSchema>;

// Utility types for rank limit validation
export type RankLimitInfo = {
  rankId: number;
  rankName: string;
  departmentLimit: number | null; // null = unlimited
  teamLimit: number | null; // null = use department limit
  currentCount: number;
  availableSlots: number | null; // null = unlimited
  isAtCapacity: boolean;
};

export type RankLimitValidationResult = {
  canPromote: boolean;
  reason?: string;
  departmentLimit?: number | null;
  teamLimit?: number | null;
  currentCount?: number;
};

// Zod schemas for rank limit management
export const rankLimitSchema = z.object({
  rankId: z.number().int().positive(),
  maxMembers: z.number().int().min(0).optional().nullable(),
});

export const teamRankLimitSchema = z.object({
  teamId: z.number().int().positive(),
  rankId: z.number().int().positive(),
  maxMembers: z.number().int().min(1), // Team limits must be at least 1 (not unlimited)
});

/**
 * Callsign Generation System
 * 
 * The callsign system follows this structure:
 * Format: [RANK_CALLSIGN][DEPARTMENT_PREFIX]-[ID_NUMBER]([TEAM_PREFIX])
 * 
 * Examples:
 * - 1LSPD-425(UNI) (Rank 1 Los Santos Police Department, ID #425, Uniform Patrol)
 * - 2LSPD-156(SW) (Rank 2 Los Santos Police Department, ID #156, SWAT)  
 * - 3SAFD-678(EMS) (Rank 3 San Andreas Fire Department, ID #678, EMS)
 * - 1STAFF-234(ADM) (Rank 1 Staff Team, ID #234, Admin)
 * 
 * Components:
 * - Rank Callsign: Numerical identifier for rank hierarchy (1 = highest rank, increases downward)
 * - Department Prefix: Short department identifier (e.g., "LSPD", "SAFD", "STAFF")
 * - ID Number: Unique 3-digit number (100-999) per department
 * - Team Prefix: Optional team identifier in parentheses (e.g., "UNI", "SW", "DET", "ADM")
 * 
 * ID Numbers:
 * - Range: 100-999 (900 total numbers per department)
 * - Recyclable: When a member leaves, their ID becomes available
 * - Unique per department: Same ID can exist across different departments
 * 
 * Callsign Assignment Process:
 * 1. Member joins department → Get next available ID number (100-999)
 * 2. Member assigned rank → Get rank callsign for hierarchy position
 * 3. Member assigned to primary team → Generate callsign with team prefix in parentheses
 * 4. Member promoted/demoted → Callsign updates with new rank callsign
 * 5. Member changes teams → Callsign updates with new team prefix, same rank and ID
 * 6. Member leaves → ID number becomes available for recycling
 */
export type CallsignComponents = {
  rankCallsign: string; // e.g., "1", "2", "3" - numerical rank hierarchy
  departmentPrefix: string; // e.g., "LSPD", "SAFD", "STAFF"
  idNumber: number; // 100-999
  teamPrefix?: string; // e.g., "UNI", "SW", "DET", "ADM" - optional, shown in parentheses
};

export type GeneratedCallsign = string; // e.g., "1LSPD-425(UNI)"

/**
 * Rank Limit System
 * 
 * The rank limit system allows departments and teams to control how many members 
 * can hold specific ranks, enabling realistic hierarchy management.
 * 
 * Department-Level Limits:
 * - Set in the `departmentRanks.maxMembers` field
 * - Applies to the entire department across all teams
 * - NULL value = unlimited members can hold this rank
 * - Example: Only 1 Chief, 3 Captains, 10 Sergeants department-wide
 * 
 * Team-Level Limits (Override):
 * - Set in the `departmentTeamRankLimits` table
 * - Overrides department limits for specific teams
 * - Must be a positive integer (cannot be unlimited at team level)
 * - Example: SWAT team can only have 1 Captain, even if department allows 3
 * 
 * Validation Logic:
 * 1. Check if team has specific limit for the rank
 *    - If yes: use team limit
 *    - If no: use department limit
 * 2. If department limit is NULL: unlimited (no restriction)
 * 3. Count current members with that rank in the scope (department or team)
 * 4. Allow promotion only if under the limit
 * 
 * Use Cases:
 * - Police Department: 1 Chief, 2 Assistant Chiefs, 5 Captains
 * - SWAT Team: 1 SWAT Captain (overrides department Captain limit for this team)
 * - Fire Department: 1 Fire Chief, 3 Battalion Chiefs, unlimited Firefighters
 * - Staff Team: 1 Head Admin, 3 Senior Admins, unlimited Moderators
 * 
 * Examples:
 * Department Rank: Captain (maxMembers: 5)
 * Team Override: SWAT Captain (maxMembers: 1)
 * Result: Department can have 5 Captains total, but SWAT can only have 1
 */

// Table for Departments
export const departments = createDepartmentTable(
  "departments",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar("name", { length: 256 }).notNull().unique(),
    type: d.varchar("type", { length: 50, enum: departmentTypeEnum.options }).notNull(),
    description: d.text("description"),
    discordGuildId: d.varchar("discord_guild_id", { length: 30 }).notNull(), // Discord Server ID
    discordCategoryId: d.varchar("discord_category_id", { length: 30 }), // Discord Category for channels
    callsignPrefix: d.varchar("callsign_prefix", { length: 10 }).notNull(), // e.g., "LSPD", "SAFD", "STAFF"
    isActive: d.boolean("is_active").default(true).notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("dept_name_idx").on(t.name),
    index("dept_type_idx").on(t.type),
    index("dept_guild_idx").on(t.discordGuildId),
    index("dept_callsign_prefix_idx").on(t.callsignPrefix),
  ]
);

// --- SIMPLIFIED TYPE EXPORTS ---
// Using utilities to reduce redundancy instead of individual exports for each table

// Department types
export type Department = SelectType<typeof departments>;
export type NewDepartment = InsertType<typeof departments>;

// Department Rank types
export type DepartmentRank = SelectType<typeof departmentRanks>;
export type NewDepartmentRank = InsertType<typeof departmentRanks>;

// Department Team types
export type DepartmentTeam = SelectType<typeof departmentTeams>;
export type NewDepartmentTeam = InsertType<typeof departmentTeams>;

// Department Team Rank Limit types
export type DepartmentTeamRankLimit = SelectType<typeof departmentTeamRankLimits>;
export type NewDepartmentTeamRankLimit = InsertType<typeof departmentTeamRankLimits>;

// Department Member types
export type DepartmentMember = SelectType<typeof departmentMembers>;
export type NewDepartmentMember = InsertType<typeof departmentMembers>;

// Department ID Number types
export type DepartmentIdNumber = SelectType<typeof departmentIdNumbers>;
export type NewDepartmentIdNumber = InsertType<typeof departmentIdNumbers>;

// Department Team Membership types
export type DepartmentTeamMembership = SelectType<typeof departmentTeamMemberships>;
export type NewDepartmentTeamMembership = InsertType<typeof departmentTeamMemberships>;

// Department Time Clock Entry types
export type DepartmentTimeClockEntry = SelectType<typeof departmentTimeClockEntries>;
export type NewDepartmentTimeClockEntry = InsertType<typeof departmentTimeClockEntries>;

// Department Meeting types
export type DepartmentMeeting = SelectType<typeof departmentMeetings>;
export type NewDepartmentMeeting = InsertType<typeof departmentMeetings>;

// Department Meeting Attendance types
export type DepartmentMeetingAttendance = SelectType<typeof departmentMeetingAttendance>;
export type NewDepartmentMeetingAttendance = InsertType<typeof departmentMeetingAttendance>;

// Department Promotion History types
export type DepartmentPromotionHistory = SelectType<typeof departmentPromotionHistory>;
export type NewDepartmentPromotionHistory = InsertType<typeof departmentPromotionHistory>;

// Department Disciplinary Action types
export type DepartmentDisciplinaryAction = SelectType<typeof departmentDisciplinaryActions>;
export type NewDepartmentDisciplinaryAction = InsertType<typeof departmentDisciplinaryActions>;

// Department Certification types
export type DepartmentCertification = SelectType<typeof departmentCertifications>;
export type NewDepartmentCertification = InsertType<typeof departmentCertifications>;

// Department Member Certification types
export type DepartmentMemberCertification = SelectType<typeof departmentMemberCertifications>;
export type NewDepartmentMemberCertification = InsertType<typeof departmentMemberCertifications>;

// Table for Ranks within Departments
export const departmentRanks = createDepartmentTable(
  "ranks",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    departmentId: d.integer("department_id").references(() => departments.id, { onDelete: "cascade" }).notNull(),
    name: d.varchar("name", { length: 256 }).notNull(),
    callsign: d.varchar("callsign", { length: 10 }).notNull(), // e.g., "1", "2", "3" - numerical rank hierarchy identifier
    abbreviation: d.varchar("abbreviation", { length: 10 }), // e.g., "SGT", "LT", "CAPT"
    discordRoleId: d.varchar("discord_role_id", { length: 30 }).notNull().unique(), // Discord Role ID for this rank
    level: d.integer("level").notNull(), // Hierarchy level (higher = more senior)
    permissions: d.jsonb("permissions").$type<DepartmentPermissions>().notNull().default(sql`'{
      "manage_department": false,
      "manage_ranks": false,
      "manage_teams": false,
      "manage_members": false,
      "view_all_members": false,
      "recruit_members": false,
      "promote_members": false,
      "demote_members": false,
      "discipline_members": false,
      "remove_members": false,
      "manage_timeclock": false,
      "view_all_timeclock": false,
      "edit_timeclock": false,
      "schedule_meetings": false,
      "manage_meetings": false,
      "take_attendance": false,
      "view_all_meetings": false,
      "manage_team_members": false,
      "view_team_members": true
    }'::jsonb`),
    salary: d.integer("salary").default(0), // Optional salary/pay rate
    maxMembers: d.integer("max_members"), // Maximum number of members that can hold this rank department-wide (null = unlimited)
    isActive: d.boolean("is_active").default(true).notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("rank_dept_idx").on(t.departmentId),
    index("rank_level_idx").on(t.level),
    index("rank_callsign_idx").on(t.callsign),
    index("rank_discord_role_idx").on(t.discordRoleId),
    unique("unique_rank_per_dept").on(t.departmentId, t.name),
    unique("unique_rank_callsign_per_dept").on(t.departmentId, t.callsign),
  ]
);

// Table for Teams within Departments (e.g., SWAT, Detective Division, etc.)
export const departmentTeams = createDepartmentTable(
  "teams",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    departmentId: d.integer("department_id").references(() => departments.id, { onDelete: "cascade" }).notNull(),
    name: d.varchar("name", { length: 256 }).notNull(),
    description: d.text("description"),
    callsignPrefix: d.varchar("callsign_prefix", { length: 10 }), // e.g., "SW", "DET", "UNI" - Optional team prefix
    discordRoleId: d.varchar("discord_role_id", { length: 30 }), // Optional Discord Role for team members
    leaderId: d.text("leader_id"), // Discord User ID of team leader
    isActive: d.boolean("is_active").default(true).notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("team_dept_idx").on(t.departmentId),
    index("team_leader_idx").on(t.leaderId),
    index("team_callsign_prefix_idx").on(t.callsignPrefix),
    unique("unique_team_per_dept").on(t.departmentId, t.name),
  ]
);

// Table for Team-Specific Rank Limits (overrides department-wide limits)
export const departmentTeamRankLimits = createDepartmentTable(
  "team_rank_limits",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    teamId: d.integer("team_id").references(() => departmentTeams.id, { onDelete: "cascade" }).notNull(),
    rankId: d.integer("rank_id").references(() => departmentRanks.id, { onDelete: "cascade" }).notNull(),
    maxMembers: d.integer("max_members").notNull(), // Maximum number of members that can hold this rank within this team (overrides department limit)
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("team_rank_limit_team_idx").on(t.teamId),
    index("team_rank_limit_rank_idx").on(t.rankId),
    unique("unique_team_rank_limit").on(t.teamId, t.rankId),
  ]
);

// Table for Department Members
export const departmentMembers = createDepartmentTable(
  "members",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    discordId: d.text("discord_id").notNull(), // Discord User ID - primary identifier
    departmentId: d.integer("department_id").references(() => departments.id, { onDelete: "cascade" }).notNull(),
    roleplayName: d.varchar("roleplay_name", { length: 100 }), // Custom RP character name
    rankId: d.integer("rank_id").references(() => departmentRanks.id, { onDelete: "set null" }),
    badgeNumber: d.varchar("badge_number", { length: 20 }), // Optional badge/unit number
    departmentIdNumber: d.integer("department_id_number"), // Unique 3-digit number (100-999) - recyclable
    callsign: d.varchar("callsign", { length: 30 }), // Auto-generated: DEPT-TEAM-###
    primaryTeamId: d.integer("primary_team_id").references(() => departmentTeams.id, { onDelete: "set null" }), // Primary team for callsign generation
    status: d.varchar("status", { length: 50, enum: departmentMemberStatusEnum.options }).default("in_training").notNull(),
    hireDate: d.timestamp("hire_date", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    lastActiveDate: d.timestamp("last_active_date", { withTimezone: true }),
    notes: d.text("notes"), // Internal notes about the member
    isActive: d.boolean("is_active").default(true).notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("member_discord_idx").on(t.discordId),
    index("member_dept_idx").on(t.departmentId),
    index("member_rank_idx").on(t.rankId),
    index("member_primary_team_idx").on(t.primaryTeamId),
    index("member_status_idx").on(t.status),
    index("member_badge_idx").on(t.badgeNumber),
    index("member_dept_id_number_idx").on(t.departmentIdNumber),
    index("member_callsign_idx").on(t.callsign),
    index("member_roleplay_name_idx").on(t.roleplayName), // Index for searching by RP name
    unique("unique_member_per_dept").on(t.discordId, t.departmentId),
    unique("unique_dept_id_per_dept").on(t.departmentId, t.departmentIdNumber),
  ]
);

// Table for tracking Department ID Numbers (100-999) - for recycling system
export const departmentIdNumbers = createDepartmentTable(
  "id_numbers",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    departmentId: d.integer("department_id").references(() => departments.id, { onDelete: "cascade" }).notNull(),
    idNumber: d.integer("id_number").notNull(), // The actual 3-digit number (100-999)
    isAvailable: d.boolean("is_available").default(true).notNull(), // Whether this number is available for assignment
    currentMemberId: d.integer("current_member_id").references(() => departmentMembers.id, { onDelete: "set null" }), // Current member using this ID
    lastAssignedTo: d.text("last_assigned_to"), // Discord ID of last person who had this number
    lastAssignedAt: d.timestamp("last_assigned_at", { withTimezone: true }),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("id_number_dept_idx").on(t.departmentId),
    index("id_number_available_idx").on(t.isAvailable),
    index("id_number_current_member_idx").on(t.currentMemberId),
    unique("unique_id_per_dept").on(t.departmentId, t.idNumber),
  ]
);

// Junction table for Team Memberships (many-to-many: members can be in multiple teams)
export const departmentTeamMemberships = createDepartmentTable(
  "team_memberships",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    memberId: d.integer("member_id").references(() => departmentMembers.id, { onDelete: "cascade" }).notNull(),
    teamId: d.integer("team_id").references(() => departmentTeams.id, { onDelete: "cascade" }).notNull(),
    isLeader: d.boolean("is_leader").default(false).notNull(), // Whether this member leads this team
    joinedAt: d
      .timestamp("joined_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    leftAt: d.timestamp("left_at", { withTimezone: true }), // For tracking team history
  }),
  (t) => [
    index("team_member_idx").on(t.memberId),
    index("team_membership_idx").on(t.teamId),
    unique("unique_member_team").on(t.memberId, t.teamId),
  ]
);

// Table for Time Clock Entries
export const departmentTimeClockEntries = createDepartmentTable(
  "time_clock_entries",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    memberId: d.integer("member_id").references(() => departmentMembers.id, { onDelete: "cascade" }).notNull(),
    clockInTime: d.timestamp("clock_in_time", { withTimezone: true }).notNull(),
    clockOutTime: d.timestamp("clock_out_time", { withTimezone: true }),
    breakStartTime: d.timestamp("break_start_time", { withTimezone: true }),
    breakEndTime: d.timestamp("break_end_time", { withTimezone: true }),
    totalMinutes: d.integer("total_minutes"), // Calculated total time worked
    breakMinutes: d.integer("break_minutes").default(0), // Total break time
    status: d.varchar("status", { length: 20, enum: departmentClockStatusEnum.options }).default("clocked_out").notNull(),
    notes: d.text("notes"), // Optional notes about the shift
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("timeclock_member_idx").on(t.memberId),
    index("timeclock_date_idx").on(t.clockInTime),
    index("timeclock_status_idx").on(t.status),
  ]
);

// Table for Meetings
export const departmentMeetings = createDepartmentTable(
  "meetings",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    departmentId: d.integer("department_id").references(() => departments.id, { onDelete: "cascade" }).notNull(),
    teamId: d.integer("team_id").references(() => departmentTeams.id, { onDelete: "set null" }), // Optional: team-specific meeting
    title: d.varchar("title", { length: 256 }).notNull(),
    description: d.text("description"),
    scheduledAt: d.timestamp("scheduled_at", { withTimezone: true }).notNull(),
    duration: d.integer("duration").default(60), // Duration in minutes
    location: d.varchar("location", { length: 256 }), // Physical or virtual location
    discordChannelId: d.varchar("discord_channel_id", { length: 30 }), // Discord voice/text channel
    organizedBy: d.text("organized_by").notNull(), // Discord User ID of organizer
    status: d.varchar("status", { length: 20, enum: departmentMeetingStatusEnum.options }).default("scheduled").notNull(),
    requiredRankLevel: d.integer("required_rank_level"), // Minimum rank level required to attend
    isMandatory: d.boolean("is_mandatory").default(false).notNull(),
    notes: d.text("notes"), // Meeting notes/minutes
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("meeting_dept_idx").on(t.departmentId),
    index("meeting_team_idx").on(t.teamId),
    index("meeting_date_idx").on(t.scheduledAt),
    index("meeting_organizer_idx").on(t.organizedBy),
    index("meeting_status_idx").on(t.status),
  ]
);

// Table for Meeting Attendance
export const departmentMeetingAttendance = createDepartmentTable(
  "meeting_attendance",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    meetingId: d.integer("meeting_id").references(() => departmentMeetings.id, { onDelete: "cascade" }).notNull(),
    memberId: d.integer("member_id").references(() => departmentMembers.id, { onDelete: "cascade" }).notNull(),
    status: d.varchar("status", { length: 20, enum: departmentAttendanceStatusEnum.options }).default("absent").notNull(),
    arrivalTime: d.timestamp("arrival_time", { withTimezone: true }),
    departureTime: d.timestamp("departure_time", { withTimezone: true }),
    excuseReason: d.text("excuse_reason"), // Reason for absence if excused
    notes: d.text("notes"),
    recordedBy: d.text("recorded_by"), // Discord User ID of who recorded attendance
    recordedAt: d
      .timestamp("recorded_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("attendance_meeting_idx").on(t.meetingId),
    index("attendance_member_idx").on(t.memberId),
    index("attendance_status_idx").on(t.status),
    unique("unique_meeting_member").on(t.meetingId, t.memberId),
  ]
);

// Table for Promotion History
export const departmentPromotionHistory = createDepartmentTable(
  "promotion_history",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    memberId: d.integer("member_id").references(() => departmentMembers.id, { onDelete: "cascade" }).notNull(),
    fromRankId: d.integer("from_rank_id").references(() => departmentRanks.id, { onDelete: "set null" }),
    toRankId: d.integer("to_rank_id").references(() => departmentRanks.id, { onDelete: "set null" }),
    promotedBy: d.text("promoted_by").notNull(), // Discord User ID of promoter
    reason: d.text("reason"), // Reason for promotion/demotion
    effectiveDate: d.timestamp("effective_date", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    notes: d.text("notes"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("promotion_member_idx").on(t.memberId),
    index("promotion_from_rank_idx").on(t.fromRankId),
    index("promotion_to_rank_idx").on(t.toRankId),
    index("promotion_date_idx").on(t.effectiveDate),
    index("promotion_promoter_idx").on(t.promotedBy),
  ]
);

// Table for Disciplinary Actions
export const departmentDisciplinaryActions = createDepartmentTable(
  "disciplinary_actions", 
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    memberId: d.integer("member_id").references(() => departmentMembers.id, { onDelete: "cascade" }).notNull(),
    actionType: d.varchar("action_type", { length: 50 }).notNull(), // warning, suspension, demotion, etc.
    reason: d.text("reason").notNull(),
    description: d.text("description"),
    issuedBy: d.text("issued_by").notNull(), // Discord User ID of issuer
    issuedAt: d.timestamp("issued_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    expiresAt: d.timestamp("expires_at", { withTimezone: true }), // For temporary actions
    isActive: d.boolean("is_active").default(true).notNull(),
    appealNotes: d.text("appeal_notes"), // Notes if action was appealed
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("disciplinary_member_idx").on(t.memberId),
    index("disciplinary_type_idx").on(t.actionType),
    index("disciplinary_date_idx").on(t.issuedAt),
    index("disciplinary_issuer_idx").on(t.issuedBy),
    index("disciplinary_active_idx").on(t.isActive),
  ]
);

// Table for Certifications within Departments
export const departmentCertifications = createDepartmentTable(
  "certifications",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    departmentId: d
      .integer("department_id")
      .references(() => departments.id, { onDelete: "cascade" })
      .notNull(),
    name: d.varchar("name", { length: 256 }).notNull(),
    description: d.text("description"),
    abbreviation: d.varchar("abbreviation", { length: 20 }), // e.g., "FTO", "EMT-B"
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp("updated_at", { withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("cert_dept_idx").on(t.departmentId),
    index("cert_name_idx").on(t.name),
    unique("unique_cert_per_dept").on(t.departmentId, t.name),
  ],
);

// Table for Member Certifications (Junction)
export const departmentMemberCertifications = createDepartmentTable(
  "member_certifications",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    memberId: d
      .integer("member_id")
      .references(() => departmentMembers.id, { onDelete: "cascade" })
      .notNull(),
    certificationId: d
      .integer("certification_id")
      .references(() => departmentCertifications.id, { onDelete: "cascade" })
      .notNull(),
    issuedAt: d
      .timestamp("issued_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: d.timestamp("expires_at", { withTimezone: true }),
    issuedBy: d.text("issued_by").notNull(), // Discord User ID of issuer
    notes: d.text("notes"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("member_cert_member_idx").on(t.memberId),
    index("member_cert_cert_idx").on(t.certificationId),
    unique("unique_member_certification").on(t.memberId, t.certificationId),
  ],
);

// --- RELATIONS ---
export const departmentsRelations = relations(departments, ({ many }) => ({
  ranks: many(departmentRanks),
  teams: many(departmentTeams),
  members: many(departmentMembers),
  meetings: many(departmentMeetings),
  idNumbers: many(departmentIdNumbers),
  certifications: many(departmentCertifications),
}));

export const departmentRanksRelations = relations(departmentRanks, ({ one, many }) => ({
  department: one(departments, {
    fields: [departmentRanks.departmentId],
    references: [departments.id],
  }),
  members: many(departmentMembers),
  promotionsFrom: many(departmentPromotionHistory, { relationName: "fromRank" }),
  promotionsTo: many(departmentPromotionHistory, { relationName: "toRank" }),
  teamRankLimits: many(departmentTeamRankLimits),
}));

export const departmentTeamsRelations = relations(departmentTeams, ({ one, many }) => ({
  department: one(departments, {
    fields: [departmentTeams.departmentId],
    references: [departments.id],
  }),
  memberships: many(departmentTeamMemberships),
  meetings: many(departmentMeetings),
  rankLimits: many(departmentTeamRankLimits),
}));

export const departmentMembersRelations = relations(departmentMembers, ({ one, many }) => ({
  department: one(departments, {
    fields: [departmentMembers.departmentId],
    references: [departments.id],
  }),
  rank: one(departmentRanks, {
    fields: [departmentMembers.rankId],
    references: [departmentRanks.id],
  }),
  primaryTeam: one(departmentTeams, {
    fields: [departmentMembers.primaryTeamId],
    references: [departmentTeams.id],
  }),
  assignedIdNumber: one(departmentIdNumbers, {
    fields: [departmentMembers.departmentIdNumber],
    references: [departmentIdNumbers.idNumber],
  }),
  teamMemberships: many(departmentTeamMemberships),
  timeClockEntries: many(departmentTimeClockEntries),
  meetingAttendance: many(departmentMeetingAttendance),
  promotionHistory: many(departmentPromotionHistory),
  disciplinaryActions: many(departmentDisciplinaryActions),
  certifications: many(departmentMemberCertifications),
}));

export const departmentTeamMembershipsRelations = relations(departmentTeamMemberships, ({ one }) => ({
  member: one(departmentMembers, {
    fields: [departmentTeamMemberships.memberId],
    references: [departmentMembers.id],
  }),
  team: one(departmentTeams, {
    fields: [departmentTeamMemberships.teamId],
    references: [departmentTeams.id],
  }),
}));

export const departmentTeamRankLimitsRelations = relations(departmentTeamRankLimits, ({ one }) => ({
  team: one(departmentTeams, {
    fields: [departmentTeamRankLimits.teamId],
    references: [departmentTeams.id],
  }),
  rank: one(departmentRanks, {
    fields: [departmentTeamRankLimits.rankId],
    references: [departmentRanks.id],
  }),
}));

export const departmentTimeClockEntriesRelations = relations(departmentTimeClockEntries, ({ one }) => ({
  member: one(departmentMembers, {
    fields: [departmentTimeClockEntries.memberId],
    references: [departmentMembers.id],
  }),
}));

export const departmentMeetingsRelations = relations(departmentMeetings, ({ one, many }) => ({
  department: one(departments, {
    fields: [departmentMeetings.departmentId],
    references: [departments.id],
  }),
  team: one(departmentTeams, {
    fields: [departmentMeetings.teamId],
    references: [departmentTeams.id],
  }),
  attendance: many(departmentMeetingAttendance),
}));

export const departmentMeetingAttendanceRelations = relations(departmentMeetingAttendance, ({ one }) => ({
  meeting: one(departmentMeetings, {
    fields: [departmentMeetingAttendance.meetingId],
    references: [departmentMeetings.id],
  }),
  member: one(departmentMembers, {
    fields: [departmentMeetingAttendance.memberId],
    references: [departmentMembers.id],
  }),
}));

export const departmentPromotionHistoryRelations = relations(departmentPromotionHistory, ({ one }) => ({
  member: one(departmentMembers, {
    fields: [departmentPromotionHistory.memberId],
    references: [departmentMembers.id],
  }),
  fromRank: one(departmentRanks, {
    fields: [departmentPromotionHistory.fromRankId],
    references: [departmentRanks.id],
    relationName: "fromRank",
  }),
  toRank: one(departmentRanks, {
    fields: [departmentPromotionHistory.toRankId],
    references: [departmentRanks.id],
    relationName: "toRank",
  }),
}));

export const departmentDisciplinaryActionsRelations = relations(departmentDisciplinaryActions, ({ one }) => ({
  member: one(departmentMembers, {
    fields: [departmentDisciplinaryActions.memberId],
    references: [departmentMembers.id],
  }),
}));

export const departmentCertificationsRelations = relations(departmentCertifications, ({ one, many }) => ({
  department: one(departments, {
    fields: [departmentCertifications.departmentId],
    references: [departments.id],
  }),
  memberCertifications: many(departmentMemberCertifications),
}));

export const departmentMemberCertificationsRelations = relations(departmentMemberCertifications, ({ one }) => ({
  member: one(departmentMembers, {
    fields: [departmentMemberCertifications.memberId],
    references: [departmentMembers.id],
  }),
  certification: one(departmentCertifications, {
    fields: [departmentMemberCertifications.certificationId],
    references: [departmentCertifications.id],
  }),
}));

export const departmentIdNumbersRelations = relations(departmentIdNumbers, ({ one }) => ({
  department: one(departments, {
    fields: [departmentIdNumbers.departmentId],
    references: [departments.id],
  }),
  currentMember: one(departmentMembers, {
    fields: [departmentIdNumbers.currentMemberId],
    references: [departmentMembers.id],
  }),
})); 