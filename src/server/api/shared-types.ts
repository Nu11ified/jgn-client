import { z } from "zod";

// Centralized Zod inference types to reduce repetition
// These are commonly used across admin routes and other parts of the application

// Admin API Types (from OpenAPI specs)
export const ZodUserInDB = z.object({
  id: z.string().optional(),
  username: z.string(),
  discriminator: z.string().optional(),
  avatar: z.string().nullable().optional(),
  bot: z.boolean().optional(),
  system: z.boolean().optional(),
  mfa_enabled: z.boolean().optional(),
  banner: z.string().nullable().optional(),
  accent_color: z.number().nullable().optional(),
  locale: z.string().optional(),
  verified: z.boolean().optional(),
  email: z.string().nullable().optional(),
  flags: z.number().optional(),
  premium_type: z.number().optional(),
  public_flags: z.number().optional(),
  avatar_decoration: z.string().nullable().optional(),
  ts_uid: z.string().nullable().optional(),
  is_admin: z.boolean().optional(),
  is_moderator: z.boolean().optional(),
  discord_id: z.string().optional(),
  api_key: z.string().optional(),
  last_synced: z.string().optional(),
});

export const ZodServerInDB = z.object({
  server_id: z.string().optional(),
  server_name: z.string().optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  splash: z.string().nullable().optional(),
  discovery_splash: z.string().nullable().optional(),
  features: z.array(z.string()).optional(),
  emojis: z.array(z.unknown()).optional(),
  stickers: z.array(z.unknown()).optional(),
  banner: z.string().nullable().optional(),
  owner_id: z.string().optional(),
  application_id: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  afk_channel_id: z.string().nullable().optional(),
  afk_timeout: z.number().optional(),
  rtc_region: z.string().nullable().optional(),
  video_quality_mode: z.number().optional(),
  verification_level: z.number().optional(),
  default_message_notifications: z.number().optional(),
  explicit_content_filter: z.number().optional(),
  mfa_level: z.number().optional(),
  vanity_url_code: z.string().nullable().optional(),
  premium_tier: z.number().optional(),
  premium_subscription_count: z.number().optional(),
  preferred_locale: z.string().optional(),
  rules_channel_id: z.string().nullable().optional(),
  safety_alerts_channel_id: z.string().nullable().optional(),
  max_presences: z.number().nullable().optional(),
  max_members: z.number().optional(),
  max_stage_video_channel_users: z.number().optional(),
  max_video_channel_users: z.number().optional(),
  approximate_member_count: z.number().optional(),
  approximate_presence_count: z.number().optional(),
  nsfw_level: z.number().optional(),
  premium_progress_bar_enabled: z.boolean().optional(),
  hub_type: z.string().nullable().optional(),
});

export const ZodUserServerMembershipInDB = z.object({
  user_id: z.string(),
  server_id: z.string(),
  nick: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  roles: z.array(z.string()).optional(),
  joined_at: z.string().optional(),
  premium_since: z.string().nullable().optional(),
  deaf: z.boolean().optional(),
  mute: z.boolean().optional(),
  flags: z.number().optional(),
  pending: z.boolean().optional(),
  permissions: z.string().optional(),
  communication_disabled_until: z.string().nullable().optional(),
});

export const ZodRoleInDB = z.object({
  role_id: z.string().optional(),
  server_id: z.string().optional(),
  role_name: z.string().optional(),
  color: z.number().optional(),
  hoist: z.boolean().optional(),
  icon: z.string().nullable().optional(),
  unicode_emoji: z.string().nullable().optional(),
  position: z.number().optional(),
  permissions: z.string().optional(),
  managed: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  tags: z.record(z.unknown()).optional(),
  flags: z.number().optional(),
});

export const ZodUserServerRoleInDB = z.object({
  user_id: z.string(),
  server_id: z.string(),
  role_id: z.string(),
});

export const ZodBanHistoryInDB = z.object({
  id: z.number().optional(),
  user_discord_id: z.string().optional(),
  server_id: z.string().optional(),
  reason: z.string().nullable().optional(),
  banned_at: z.string().optional(),
  banned_by_user_id: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  user_id: z.string().optional(),
  banned_by: z.string().nullable().optional(),
});

export const ZodTeamSpeakServerGroupInDB = z.object({
  name: z.string().optional(),
  sgid: z.number().optional(),
  id: z.number().optional(),
  server_id: z.string().optional(),
  group_id: z.number().optional(),
  type: z.number().optional(),
  icon_id: z.number().nullable().optional(),
  savedb: z.boolean().optional(),
  sortid: z.number().optional(),
  namemode: z.number().optional(),
  n_modifyp: z.number().optional(),
  n_member_addp: z.number().optional(),
  n_member_removep: z.number().optional(),
});

export const ZodUserTeamSpeakServerGroupInDB = z.object({
  id: z.number(),
  user_id: z.string(),
  server_id: z.string(),
  group_id: z.number(),
  assigned_at: z.string(),
});

export const ZodDiscordRoleToTeamSpeakGroupMappingInDB = z.object({
  discord_role_id: z.string().optional(),
  teamspeak_sgid: z.number().optional(),
  id: z.number().optional(),
  teamspeak_group_id: z.number().optional(),
  server_id: z.string().optional(),
});

// Simplified type aliases
export type UserInDB = z.infer<typeof ZodUserInDB>;
export type ServerInDB = z.infer<typeof ZodServerInDB>;
export type UserServerMembershipInDB = z.infer<typeof ZodUserServerMembershipInDB>;
export type RoleInDB = z.infer<typeof ZodRoleInDB>;
export type UserServerRoleInDB = z.infer<typeof ZodUserServerRoleInDB>;
export type BanHistoryInDB = z.infer<typeof ZodBanHistoryInDB>;
export type TeamSpeakServerGroupInDB = z.infer<typeof ZodTeamSpeakServerGroupInDB>;
export type UserTeamSpeakServerGroupInDB = z.infer<typeof ZodUserTeamSpeakServerGroupInDB>;
export type DiscordRoleToTeamSpeakGroupMappingInDB = z.infer<typeof ZodDiscordRoleToTeamSpeakGroupMappingInDB>;

// Form Response Augmented Types (with user details)
export interface AugmentedReviewerDecision {
  userId?: string;
  reviewerName?: string;
  decision: string;
  comments?: string;
  reviewedAt: string;
  reviewerFullName?: string;
  reviewerDiscordId?: string;
}

export interface AugmentedFormResponse {
  submitterFullName?: string;
  submitterDiscordId?: string;
  finalApproverFullName?: string;
  finalApproverDiscordId?: string;
  reviewerDecisions?: AugmentedReviewerDecision[] | null;
} 