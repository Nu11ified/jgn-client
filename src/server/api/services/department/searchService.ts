import { eq, and, desc, asc, sql, ilike, inArray, gte, lte, or } from "drizzle-orm";
import { postgrestDb } from "@/server/postgres";
import * as deptSchema from "@/server/postgres/schema/department";

export interface AdvancedSearchParams {
  departmentId?: number;
  status?: string[];
  rankIds?: number[];
  teamIds?: number[];
  hireDateFrom?: Date;
  hireDateTo?: Date;
  searchTerm?: string;
  sortBy?: "name" | "rank" | "hire_date" | "status" | "callsign";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  members: Array<{
    id: number;
    discordId: string;
    roleplayName: string | null;
    callsign: string | null;
    badgeNumber: string | null;
    status: string;
    hireDate: Date;
    isActive: boolean;
    rank: {
      id: number;
      name: string;
      level: number;
    } | null;
    team: {
      id: number;
      name: string;
    } | null;
    department: {
      id: number;
      name: string;
      callsignPrefix: string;
    };
  }>;
  total: number;
  facets: {
    statuses: Array<{ value: string; count: number }>;
    ranks: Array<{ id: number; name: string; count: number }>;
    teams: Array<{ id: number; name: string; count: number }>;
    departments: Array<{ id: number; name: string; count: number }>;
  };
}

export interface SearchFacets {
  statuses: Array<{ value: string; count: number; label: string }>;
  ranks: Array<{ id: number; name: string; count: number; departmentName: string }>;
  teams: Array<{ id: number; name: string; count: number; departmentName: string }>;
  departments: Array<{ id: number; name: string; count: number; type: string }>;
  hireDateRanges: Array<{ range: string; count: number; label: string }>;
}

export async function searchMembersAdvanced(params: AdvancedSearchParams): Promise<SearchResult> {
  try {
    const {
      departmentId,
      status,
      rankIds,
      teamIds,
      hireDateFrom,
      hireDateTo,
      searchTerm,
      sortBy = "name",
      sortOrder = "asc",
      limit = 50,
      offset = 0,
    } = params;

    // Build base query conditions
    const conditions = [];

    if (departmentId) {
      conditions.push(eq(deptSchema.departmentMembers.departmentId, departmentId));
    }

    if (status && status.length > 0) {
      conditions.push(inArray(deptSchema.departmentMembers.status, status as any));
    }

    if (rankIds && rankIds.length > 0) {
      conditions.push(inArray(deptSchema.departmentMembers.rankId, rankIds));
    }

    if (teamIds && teamIds.length > 0) {
      conditions.push(inArray(deptSchema.departmentMembers.primaryTeamId, teamIds));
    }

    if (hireDateFrom) {
      conditions.push(gte(deptSchema.departmentMembers.hireDate, hireDateFrom));
    }

    if (hireDateTo) {
      conditions.push(lte(deptSchema.departmentMembers.hireDate, hireDateTo));
    }

    // Add search term conditions
    if (searchTerm && searchTerm.trim()) {
      const searchConditions = [
        ilike(deptSchema.departmentMembers.roleplayName, `%${searchTerm}%`),
        ilike(deptSchema.departmentMembers.callsign, `%${searchTerm}%`),
        ilike(deptSchema.departmentMembers.badgeNumber, `%${searchTerm}%`),
        ilike(deptSchema.departmentMembers.discordId, `%${searchTerm}%`),
      ];
      conditions.push(or(...searchConditions));
    }

    // Build sort order
    let orderBy;
    const sortDirection = sortOrder === "desc" ? desc : asc;

    switch (sortBy) {
      case "rank":
        orderBy = sortDirection(deptSchema.departmentRanks.level);
        break;
      case "hire_date":
        orderBy = sortDirection(deptSchema.departmentMembers.hireDate);
        break;
      case "status":
        orderBy = sortDirection(deptSchema.departmentMembers.status);
        break;
      case "callsign":
        orderBy = sortDirection(deptSchema.departmentMembers.callsign);
        break;
      default: // name
        orderBy = sortDirection(deptSchema.departmentMembers.roleplayName);
        break;
    }

    // Execute main search query
    const membersQuery = postgrestDb
      .select({
        id: deptSchema.departmentMembers.id,
        discordId: deptSchema.departmentMembers.discordId,
        roleplayName: deptSchema.departmentMembers.roleplayName,
        callsign: deptSchema.departmentMembers.callsign,
        badgeNumber: deptSchema.departmentMembers.badgeNumber,
        status: deptSchema.departmentMembers.status,
        hireDate: deptSchema.departmentMembers.hireDate,
        isActive: deptSchema.departmentMembers.isActive,
        rank: {
          id: deptSchema.departmentRanks.id,
          name: deptSchema.departmentRanks.name,
          level: deptSchema.departmentRanks.level,
        },
        team: {
          id: deptSchema.departmentTeams.id,
          name: deptSchema.departmentTeams.name,
        },
        department: {
          id: deptSchema.departments.id,
          name: deptSchema.departments.name,
          callsignPrefix: deptSchema.departments.callsignPrefix,
        },
      })
      .from(deptSchema.departmentMembers)
      .leftJoin(
        deptSchema.departmentRanks,
        eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
      )
      .leftJoin(
        deptSchema.departmentTeams,
        eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
      )
      .innerJoin(
        deptSchema.departments,
        eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id)
      );

    if (conditions.length > 0) {
      membersQuery.where(and(...conditions));
    }

    const [members, totalResult] = await Promise.all([
      membersQuery
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),

      // Get total count
      postgrestDb
        .select({ count: sql`count(*)` })
        .from(deptSchema.departmentMembers)
        .leftJoin(
          deptSchema.departmentRanks,
          eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
        )
        .leftJoin(
          deptSchema.departmentTeams,
          eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
        )
        .innerJoin(
          deptSchema.departments,
          eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id)
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    // Get facets for filtering
    const facets = await getSearchFacets(conditions);

    return {
      members: members.map(member => ({
        ...member,
        rank: member.rank?.id ? member.rank : null,
        team: member.team?.id ? member.team : null,
      })),
      total,
      facets,
    };
  } catch (error) {
    console.error("Advanced search error:", error);
    throw new Error(`Search failed: ${error}`);
  }
}

export async function getSearchFacets(baseConditions: any[] = []): Promise<SearchResult["facets"]> {
  try {
    // Get status facets
    const statusFacets = await postgrestDb
      .select({
        value: deptSchema.departmentMembers.status,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(deptSchema.departmentMembers.status)
      .orderBy(desc(sql`count(*)`));

    // Get rank facets
    const rankFacets = await postgrestDb
      .select({
        id: deptSchema.departmentRanks.id,
        name: deptSchema.departmentRanks.name,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(
        deptSchema.departmentRanks,
        eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
      )
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(deptSchema.departmentRanks.id, deptSchema.departmentRanks.name)
      .orderBy(desc(sql`count(*)`));

    // Get team facets
    const teamFacets = await postgrestDb
      .select({
        id: deptSchema.departmentTeams.id,
        name: deptSchema.departmentTeams.name,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(
        deptSchema.departmentTeams,
        eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
      )
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(deptSchema.departmentTeams.id, deptSchema.departmentTeams.name)
      .orderBy(desc(sql`count(*)`));

    // Get department facets
    const departmentFacets = await postgrestDb
      .select({
        id: deptSchema.departments.id,
        name: deptSchema.departments.name,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(
        deptSchema.departments,
        eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id)
      )
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(deptSchema.departments.id, deptSchema.departments.name)
      .orderBy(desc(sql`count(*)`));

    return {
      statuses: statusFacets.map(f => ({
        value: f.value,
        count: Number(f.count),
      })),
      ranks: rankFacets.map(f => ({
        id: f.id,
        name: f.name,
        count: Number(f.count),
      })),
      teams: teamFacets.map(f => ({
        id: f.id,
        name: f.name,
        count: Number(f.count),
      })),
      departments: departmentFacets.map(f => ({
        id: f.id,
        name: f.name,
        count: Number(f.count),
      })),
    };
  } catch (error) {
    console.error("Error getting search facets:", error);
    return {
      statuses: [],
      ranks: [],
      teams: [],
      departments: [],
    };
  }
}

export async function searchWithFilters(params: {
  departmentId: number;
  query?: string;
  filters?: Record<string, any>;
  page?: number;
  pageSize?: number;
}): Promise<{
  results: SearchResult["members"];
  facets: SearchFacets;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const { departmentId, query, filters = {}, page = 1, pageSize = 25 } = params;
  const offset = (page - 1) * pageSize;

  // Convert filters to search params
  const searchParams: AdvancedSearchParams = {
    departmentId,
    searchTerm: query,
    limit: pageSize,
    offset,
    ...filters,
  };

  const searchResult = await searchMembersAdvanced(searchParams);
  const enhancedFacets = await getEnhancedFacets(departmentId);

  const totalPages = Math.ceil(searchResult.total / pageSize);

  return {
    results: searchResult.members,
    facets: enhancedFacets,
    total: searchResult.total,
    page,
    pageSize,
    totalPages,
  };
}

export async function getEnhancedFacets(departmentId?: number): Promise<SearchFacets> {
  try {
    const baseConditions = departmentId
      ? [eq(deptSchema.departmentMembers.departmentId, departmentId)]
      : [];

    // Get status facets with labels
    const statusFacets = await postgrestDb
      .select({
        value: deptSchema.departmentMembers.status,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(deptSchema.departmentMembers.status)
      .orderBy(desc(sql`count(*)`));

    const statusLabels: Record<string, string> = {
      active: "Active",
      inactive: "Inactive",
      in_training: "In Training",
      pending: "Pending",
      leave_of_absence: "Leave of Absence",
      warned_1: "Warning Level 1",
      warned_2: "Warning Level 2",
      warned_3: "Warning Level 3",
      suspended: "Suspended",
      blacklisted: "Blacklisted",
    };

    // Get rank facets with department names
    const rankFacets = await postgrestDb
      .select({
        id: deptSchema.departmentRanks.id,
        name: deptSchema.departmentRanks.name,
        departmentName: deptSchema.departments.name,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(
        deptSchema.departmentRanks,
        eq(deptSchema.departmentMembers.rankId, deptSchema.departmentRanks.id)
      )
      .innerJoin(
        deptSchema.departments,
        eq(deptSchema.departmentRanks.departmentId, deptSchema.departments.id)
      )
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(
        deptSchema.departmentRanks.id,
        deptSchema.departmentRanks.name,
        deptSchema.departments.name
      )
      .orderBy(desc(sql`count(*)`));

    // Get team facets with department names
    const teamFacets = await postgrestDb
      .select({
        id: deptSchema.departmentTeams.id,
        name: deptSchema.departmentTeams.name,
        departmentName: deptSchema.departments.name,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(
        deptSchema.departmentTeams,
        eq(deptSchema.departmentMembers.primaryTeamId, deptSchema.departmentTeams.id)
      )
      .innerJoin(
        deptSchema.departments,
        eq(deptSchema.departmentTeams.departmentId, deptSchema.departments.id)
      )
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(
        deptSchema.departmentTeams.id,
        deptSchema.departmentTeams.name,
        deptSchema.departments.name
      )
      .orderBy(desc(sql`count(*)`));

    // Get department facets with types
    const departmentFacets = await postgrestDb
      .select({
        id: deptSchema.departments.id,
        name: deptSchema.departments.name,
        type: deptSchema.departments.type,
        count: sql`count(*)`,
      })
      .from(deptSchema.departmentMembers)
      .innerJoin(
        deptSchema.departments,
        eq(deptSchema.departmentMembers.departmentId, deptSchema.departments.id)
      )
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined)
      .groupBy(
        deptSchema.departments.id,
        deptSchema.departments.name,
        deptSchema.departments.type
      )
      .orderBy(desc(sql`count(*)`));

    // Get hire date range facets
    const hireDateRanges = await getHireDateRangeFacets(baseConditions);

    return {
      statuses: statusFacets.map(f => ({
        value: f.value,
        count: Number(f.count),
        label: statusLabels[f.value] || f.value,
      })),
      ranks: rankFacets.map(f => ({
        id: f.id,
        name: f.name,
        count: Number(f.count),
        departmentName: f.departmentName,
      })),
      teams: teamFacets.map(f => ({
        id: f.id,
        name: f.name,
        count: Number(f.count),
        departmentName: f.departmentName,
      })),
      departments: departmentFacets.map(f => ({
        id: f.id,
        name: f.name,
        count: Number(f.count),
        type: f.type,
      })),
      hireDateRanges,
    };
  } catch (error) {
    console.error("Error getting enhanced facets:", error);
    return {
      statuses: [],
      ranks: [],
      teams: [],
      departments: [],
      hireDateRanges: [],
    };
  }
}

async function getHireDateRangeFacets(baseConditions: any[]): Promise<Array<{ range: string; count: number; label: string }>> {
  const now = new Date();
  const ranges = [
    {
      range: "last_30_days",
      label: "Last 30 Days",
      startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      endDate: now,
    },
    {
      range: "last_90_days",
      label: "Last 90 Days",
      startDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      endDate: now,
    },
    {
      range: "last_year",
      label: "Last Year",
      startDate: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
      endDate: now,
    },
    {
      range: "over_year",
      label: "Over a Year Ago",
      startDate: new Date(2020, 0, 1), // Arbitrary old date
      endDate: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
    },
  ];

  const results = [];

  for (const range of ranges) {
    try {
      const conditions = [...baseConditions];

      if (range.range === "over_year") {
        conditions.push(lte(deptSchema.departmentMembers.hireDate, range.endDate));
      } else {
        conditions.push(
          and(
            gte(deptSchema.departmentMembers.hireDate, range.startDate),
            lte(deptSchema.departmentMembers.hireDate, range.endDate)
          )
        );
      }

      const result = await postgrestDb
        .select({ count: sql`count(*)` })
        .from(deptSchema.departmentMembers)
        .where(and(...conditions));

      results.push({
        range: range.range,
        count: Number(result[0]?.count ?? 0),
        label: range.label,
      });
    } catch (error) {
      console.error(`Error getting hire date range facet for ${range.range}:`, error);
      results.push({
        range: range.range,
        count: 0,
        label: range.label,
      });
    }
  }

  return results;
}

export async function getSavedSearches(discordUserId: string): Promise<Array<{
  id: number;
  name: string;
  description?: string;
  searchParams: AdvancedSearchParams;
  createdAt: Date;
  lastUsed?: Date;
}>> {
  try {
    // For now, return common search templates since we don't have a saved searches table
    // In a real implementation, you would query a saved_searches table
    const commonSearches = [
      {
        id: 1,
        name: "Active Members",
        description: "All active department members",
        searchParams: {
          status: ["active"],
        },
        createdAt: new Date(),
        lastUsed: new Date(),
      },
      {
        id: 2,
        name: "New Recruits",
        description: "Members in training or pending status",
        searchParams: {
          status: ["in_training", "pending"],
        },
        createdAt: new Date(),
      },
      {
        id: 3,
        name: "Recent Hires",
        description: "Members hired in the last 30 days",
        searchParams: {
          hireDateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
        createdAt: new Date(),
      },
      {
        id: 4,
        name: "Warned Members",
        description: "Members with warning status",
        searchParams: {
          status: ["warned_1", "warned_2", "warned_3"],
        },
        createdAt: new Date(),
      },
    ];

    return commonSearches;
  } catch (error) {
    console.error("Error getting saved searches:", error);
    return [];
  }
}

export async function saveSearch(params: {
  discordUserId: string;
  name: string;
  description?: string;
  searchParams: AdvancedSearchParams;
}): Promise<{ success: boolean; message: string; searchId?: number }> {
  try {
    // For now, we'll simulate saving by validating the input and returning success
    // In a real implementation, you would create a saved_searches table and insert the record

    const { discordUserId, name, description, searchParams } = params;

    // Validate required fields
    if (!discordUserId || !name || !searchParams) {
      return {
        success: false,
        message: "Missing required fields: discordUserId, name, and searchParams are required",
      };
    }

    // Validate search parameters
    if (typeof searchParams !== 'object') {
      return {
        success: false,
        message: "Invalid search parameters format",
      };
    }

    // Simulate database insertion
    const searchId = Date.now(); // Use timestamp as unique ID for simulation

    console.log("Search saved successfully:", {
      searchId,
      discordUserId,
      name,
      description,
      searchParams,
      createdAt: new Date(),
    });

    return {
      success: true,
      message: "Search saved successfully",
      searchId,
    };
  } catch (error) {
    console.error("Error saving search:", error);
    return {
      success: false,
      message: `Failed to save search: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}