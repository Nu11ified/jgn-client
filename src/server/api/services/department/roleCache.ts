import { and, eq, isNotNull } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";
import { getServerIdFromRoleId } from "./discordRoleManager";
import { ROLE_CACHE_TTLS } from "./constants";

type RankRoleEntry = { rankId: number; discordRoleId: string; serverId: string | null };
type TeamRoleEntry = { teamId: number; discordRoleId: string; serverId: string | null };

type DepartmentRoleMap = {
  rankRoles: RankRoleEntry[];
  teamRoles: TeamRoleEntry[];
  byRankId: Map<number, { discordRoleId: string | null; serverId: string | null }>;
  byTeamId: Map<number, { discordRoleId: string | null; serverId: string | null }>;
  fetchedAt: number;
};

const deptRoleCache = new Map<number, DepartmentRoleMap>();

export const invalidateDepartmentRoleMap = (departmentId: number): void => {
  deptRoleCache.delete(departmentId);
};

export const getDepartmentRoleMap = async (departmentId: number): Promise<DepartmentRoleMap> => {
  const now = Date.now();
  const cached = deptRoleCache.get(departmentId);
  if (cached && now - cached.fetchedAt < ROLE_CACHE_TTLS.DEPARTMENT_ROLE_MAP_MS) {
    return cached;
  }

  // Load ranks
  const ranks = await postgrestDb
    .select({ id: deptSchema.departmentRanks.id, discordRoleId: deptSchema.departmentRanks.discordRoleId })
    .from(deptSchema.departmentRanks)
    .where(
      and(
        eq(deptSchema.departmentRanks.departmentId, departmentId),
        eq(deptSchema.departmentRanks.isActive, true)
      )
    );

  // Load teams
  const teams = await postgrestDb
    .select({ id: deptSchema.departmentTeams.id, discordRoleId: deptSchema.departmentTeams.discordRoleId })
    .from(deptSchema.departmentTeams)
    .where(
      and(
        eq(deptSchema.departmentTeams.departmentId, departmentId),
        eq(deptSchema.departmentTeams.isActive, true)
      )
    );

  // Resolve server IDs in parallel for all roles that have a discordRoleId
  const rankServerIds = await Promise.all(
    ranks.map(r => (r.discordRoleId ? getServerIdFromRoleId(r.discordRoleId) : Promise.resolve(null)))
  );
  const teamServerIds = await Promise.all(
    teams.map(t => (t.discordRoleId ? getServerIdFromRoleId(t.discordRoleId) : Promise.resolve(null)))
  );

  const rankRoles: RankRoleEntry[] = ranks.map((r, idx) => ({
    rankId: r.id,
    discordRoleId: r.discordRoleId ?? "",
    serverId: r.discordRoleId ? rankServerIds[idx] : null,
  }));

  const teamRoles: TeamRoleEntry[] = teams.map((t, idx) => ({
    teamId: t.id,
    discordRoleId: t.discordRoleId ?? "",
    serverId: t.discordRoleId ? teamServerIds[idx] : null,
  }));

  const byRankId = new Map<number, { discordRoleId: string | null; serverId: string | null }>();
  rankRoles.forEach(rr => byRankId.set(rr.rankId, { discordRoleId: rr.discordRoleId || null, serverId: rr.serverId }));

  const byTeamId = new Map<number, { discordRoleId: string | null; serverId: string | null }>();
  teamRoles.forEach(tr => byTeamId.set(tr.teamId, { discordRoleId: tr.discordRoleId || null, serverId: tr.serverId }));

  const map: DepartmentRoleMap = {
    rankRoles,
    teamRoles,
    byRankId,
    byTeamId,
    fetchedAt: now,
  };

  deptRoleCache.set(departmentId, map);
  return map;
};


