export interface DiscordRole {
  roleId: string;
  serverId: string;
}

export interface RankUpdateResult {
  success: boolean;
  updatedDepartments: Array<{
    departmentId: number;
    newRankId: number | null;
    oldRankId: number | null;
  }>;
  message: string;
}

export interface TeamUpdateResult {
  success: boolean;
  updatedDepartments: Array<{
    departmentId: number;
    newTeamId: number | null;
    oldTeamId: number | null;
  }>;
  message: string;
}

export interface DiscordRoleManagementResult {
  success: boolean;
  message: string;
  removedRoles?: Array<{ type: 'rank' | 'team'; roleId: string; }>;
  addedRoles?: Array<{ type: 'rank' | 'team'; roleId: string; }>;
}

export interface MemberSyncOptions {
  discordId: string;
  departmentId: number;
  memberId: number;
  maxAttempts?: number;
  intervalMs?: number;
}

export interface RoleChangeAction {
  type: 'add' | 'remove';
  roleId: string;
  serverId: string;
  roleType: 'rank' | 'team';
}

export interface SyncMemberRequest {
  discordId: string;
  departmentId: number;
  memberId: number;
  roleChanges?: RoleChangeAction[];
  skipRoleManagement?: boolean;
} 