import { mysqlTable, bigint, varchar, char, boolean, timestamp, int, text, primaryKey, uniqueIndex } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

export const users = mysqlTable("users", {
    discordId: bigint("discord_id", { mode: "bigint" }).primaryKey().unique().notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    tsUid: char("ts_uid", { length: 28 }), // Assuming ascii and ascii_bin are handled by db collation
    apiKey: varchar("api_key", { length: 36 }).unique().notNull().default("(UUID())"), // UUID default might need a different approach in Drizzle/MySQL
    isModerator: boolean("is_moderator").default(false).notNull(),
    isAdmin: boolean("is_admin").default(false).notNull(),
    lastSynced: timestamp("last_synced").defaultNow().onUpdateNow(),
});

export const servers = mysqlTable("servers", {
    serverId: bigint("server_id", { mode: "bigint" }).primaryKey().unique().notNull(),
    serverName: varchar("server_name", { length: 255 }).notNull(),
});

export const userServerMembership = mysqlTable("user_server_membership", {
    id: int("id").primaryKey().autoincrement(),
    userDiscordId: bigint("user_discord_id", { mode: "bigint" }).notNull().references(() => users.discordId, { onDelete: "cascade" }),
    serverId: bigint("server_id", { mode: "bigint" }).notNull().references(() => servers.serverId, { onDelete: "cascade" }),
    isBanned: boolean("is_banned").default(false),
    joinedAt: timestamp("joined_at"),
    leftAt: timestamp("left_at"),
}, (table) => ({
    uniqueUserServer: uniqueIndex("unique_user_server_idx").on(table.userDiscordId, table.serverId),
}));

export const roles = mysqlTable("roles", {
    roleId: bigint("role_id", { mode: "bigint" }).primaryKey().unique().notNull(),
    roleName: varchar("role_name", { length: 255 }).notNull(),
    serverId: bigint("server_id", { mode: "bigint" }).notNull().references(() => servers.serverId, { onDelete: "cascade" }),
});

export const userServerRoles = mysqlTable("user_server_roles", {
    id: int("id").primaryKey().autoincrement(),
    userDiscordId: bigint("user_discord_id", { mode: "bigint" }).notNull().references(() => users.discordId, { onDelete: "cascade" }),
    serverId: bigint("server_id", { mode: "bigint" }).notNull().references(() => servers.serverId, { onDelete: "cascade" }),
    roleId: bigint("role_id", { mode: "bigint" }).notNull().references(() => roles.roleId, { onDelete: "cascade" }),
}, (table) => ({
    uniqueUserServerRole: uniqueIndex("unique_user_server_role_idx").on(table.userDiscordId, table.serverId, table.roleId),
}));

export const banHistory = mysqlTable("ban_history", {
    id: int("id").primaryKey().autoincrement(),
    userDiscordId: bigint("user_discord_id", { mode: "bigint" }).notNull().references(() => users.discordId, { onDelete: "cascade" }),
    serverId: bigint("server_id", { mode: "bigint" }).notNull().references(() => servers.serverId, { onDelete: "cascade" }),
    bannedAt: timestamp("banned_at").defaultNow(),
    bannedByUserId: bigint("banned_by_user_id", { mode: "bigint" }), // Self-reference or reference to users table? SQL implies users.
    reason: text("reason"),
});

export const teamspeakServerGroups = mysqlTable("teamspeak_server_groups", {
    sgid: int("sgid").primaryKey().unique().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
});

export const userTeamspeakServerGroups = mysqlTable("user_teamspeak_server_groups", {
    id: int("id").primaryKey().autoincrement(),
    userDiscordId: bigint("user_discord_id", { mode: "bigint" }).notNull().references(() => users.discordId, { onDelete: "cascade" }),
    sgid: int("sgid").notNull().references(() => teamspeakServerGroups.sgid, { onDelete: "cascade" }),
}, (table) => ({
    uniqueUserSgid: uniqueIndex("unique_user_sgid_idx").on(table.userDiscordId, table.sgid),
}));

export const discordRoleToTeamspeakGroupMapping = mysqlTable("discord_role_to_teamspeak_group_mapping", {
    discordRoleId: bigint("discord_role_id", { mode: "bigint" }).primaryKey().unique().notNull().references(() => roles.roleId, { onDelete: "cascade" }),
    teamspeakSgid: int("teamspeak_sgid").notNull().references(() => teamspeakServerGroups.sgid, { onDelete: "cascade" }),
});

// Relations (optional but good for ORM features)

export const usersRelations = relations(users, ({ many }) => ({
    userServerMemberships: many(userServerMembership),
    userServerRoles: many(userServerRoles),
    banHistoryEntries: many(banHistory, { relationName: "bannedUser" }),
    moderatedBans: many(banHistory, { relationName: "banningModerator"}), // Assuming bannedByUserId refers to users.discordId
    userTeamspeakServerGroups: many(userTeamspeakServerGroups),
}));

export const serversRelations = relations(servers, ({ many }) => ({
    userServerMemberships: many(userServerMembership),
    roles: many(roles),
    userServerRoles: many(userServerRoles),
    banHistoryEntries: many(banHistory),
}));

export const userServerMembershipRelations = relations(userServerMembership, ({ one }) => ({
    user: one(users, {
        fields: [userServerMembership.userDiscordId],
        references: [users.discordId],
    }),
    server: one(servers, {
        fields: [userServerMembership.serverId],
        references: [servers.serverId],
    }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
    server: one(servers, {
        fields: [roles.serverId],
        references: [servers.serverId],
    }),
    userServerRoles: many(userServerRoles),
    discordRoleToTeamspeakGroupMapping: one(discordRoleToTeamspeakGroupMapping, {
        fields: [roles.roleId],
        references: [discordRoleToTeamspeakGroupMapping.discordRoleId],
    }),
}));

export const userServerRolesRelations = relations(userServerRoles, ({ one }) => ({
    user: one(users, {
        fields: [userServerRoles.userDiscordId],
        references: [users.discordId],
    }),
    server: one(servers, {
        fields: [userServerRoles.serverId],
        references: [servers.serverId],
    }),
    role: one(roles, {
        fields: [userServerRoles.roleId],
        references: [roles.roleId],
    }),
}));

export const banHistoryRelations = relations(banHistory, ({ one }) => ({
    user: one(users, {
        fields: [banHistory.userDiscordId],
        references: [users.discordId],
        relationName: "bannedUser",
    }),
    server: one(servers, {
        fields: [banHistory.serverId],
        references: [servers.serverId],
    }),
    bannedByUser: one(users, { // Assuming bannedByUserId refers to users.discordId
        fields: [banHistory.bannedByUserId],
        references: [users.discordId],
        relationName: "banningModerator",
    }),
}));

export const teamspeakServerGroupsRelations = relations(teamspeakServerGroups, ({ many }) => ({
    userTeamspeakServerGroups: many(userTeamspeakServerGroups),
    discordRoleToTeamspeakGroupMappings: many(discordRoleToTeamspeakGroupMapping),
}));

export const userTeamspeakServerGroupsRelations = relations(userTeamspeakServerGroups, ({ one }) => ({
    user: one(users, {
        fields: [userTeamspeakServerGroups.userDiscordId],
        references: [users.discordId],
    }),
    teamspeakServerGroup: one(teamspeakServerGroups, {
        fields: [userTeamspeakServerGroups.sgid],
        references: [teamspeakServerGroups.sgid],
    }),
}));

export const discordRoleToTeamspeakGroupMappingRelations = relations(discordRoleToTeamspeakGroupMapping, ({ one }) => ({
    discordRole: one(roles, {
        fields: [discordRoleToTeamspeakGroupMapping.discordRoleId],
        references: [roles.roleId],
    }),
    teamspeakServerGroup: one(teamspeakServerGroups, {
        fields: [discordRoleToTeamspeakGroupMapping.teamspeakSgid],
        references: [teamspeakServerGroups.sgid],
    }),
}));
