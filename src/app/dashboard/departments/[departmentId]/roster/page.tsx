"use client";

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  ArrowLeft, 
  Search,
  Filter,
  Users,
  UserCheck,
  UserX,
  Crown,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Edit,
} from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { formatLocalDate } from "@/lib/utils/date";

type MemberStatus = "in_training" | "pending" | "active" | "inactive" | "leave_of_absence" | "warned_1" | "warned_2" | "warned_3" | "suspended" | "blacklisted";

export default function DepartmentRosterPage() {
  const params = useParams();
  const departmentId = parseInt(params.departmentId as string);

  // Filters state
  // Default to showing all statuses to avoid hiding LOA/similar by default
  const [statusFilter, setStatusFilter] = useState<MemberStatus[]>([]);
  const [rankFilter, setRankFilter] = useState<(number | null)[]>([]);
  const [teamFilter, setTeamFilter] = useState<(number | null)[]>([]);
  const [excludedRankIds, setExcludedRankIds] = useState<number[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Pagination state
  const [page, setPage] = useState(0);
  const limit = 25;

  // Get department info for filters
  const { data: departmentInfo } = api.dept.user.info.getDepartment.useQuery({ departmentId });

  // Get user permissions for editing
  const { data: canManageMembers } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_members'
  });

  // Get timeclock permissions
  const { data: canViewTimeclock } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'view_all_timeclock'
  });

  const { data: canManageTimeclock } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_timeclock'
  });

  // Get roster data
  const { data: rosterData, isLoading, error, refetch } = api.dept.user.info.getDepartmentRoster.useQuery({
    departmentId,
    includeInactive,
    statusFilter: statusFilter.length > 0 ? statusFilter : undefined,
    rankFilter: rankFilter.length > 0 ? rankFilter : undefined,
    excludeRankIds: excludedRankIds.length > 0 ? excludedRankIds : undefined,
    teamFilter: teamFilter.length > 0 ? teamFilter : undefined,
    limit,
    offset: page * limit,
  });

  // Get department stats
  const { data: stats } = api.dept.user.info.getDepartmentStats.useQuery({ departmentId });

  // Get weekly hours for visible members (only if user has timeclock permissions)
  const memberIds = rosterData?.members.map(member => member.id) ?? [];
  const hasTimeclockPermission = (canViewTimeclock?.hasPermission ?? false) || (canManageTimeclock?.hasPermission ?? false);
  const excludedRankNames = excludedRankIds.length > 0
    ? (departmentInfo?.ranks?.filter((rank) => excludedRankIds.includes(rank.id)).map((rank) => rank.name) ?? [])
    : [];
  const excludedRankSummary = excludedRankNames.length === 0
    ? "No ranks excluded"
    : `${excludedRankNames.slice(0, 2).join(', ')}${excludedRankNames.length > 2 ? ` +${excludedRankNames.length - 2} more` : ''}`;
  
  const { data: weeklyHoursData, isLoading: weeklyHoursLoading } = api.dept.user.timeclock.getBatchWeeklyHours.useQuery({
    departmentId,
    memberIds,
    weekOffset: 0, // Current week
  }, {
    enabled: hasTimeclockPermission && memberIds.length > 0,
  });

  const getStatusColor = (status: MemberStatus) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'in_training':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'pending':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'inactive':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'leave_of_absence':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'suspended':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'warned_1':
      case 'warned_2':
      case 'warned_3':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'blacklisted':
        return 'bg-red-200 text-red-900 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatStatus = (status: MemberStatus) => {
    return status.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  // Filter members by search term
  const filteredMembers = rosterData?.members.filter((member) => {
    // Search filter
    if (!searchTerm) return true;

    const searchLower = searchTerm.toLowerCase();

    // Match if ANY of these fields include the search term
    const haystacks = [
      member.callsign,
      member.roleplayName,
      member.discordId,
      member.badgeNumber ?? undefined,
      member.rankName ?? undefined,
      member.teamName ?? undefined,
    ];

    return haystacks.some((v) => v?.toLowerCase().includes(searchLower) ?? false);
  })
  // Sort by rank level (highest rank first, members without ranks at the bottom)
  .sort((a, b) => {
    // If both have ranks, sort by rank level descending
    if (a.rankLevel !== null && b.rankLevel !== null) {
      return b.rankLevel - a.rankLevel;
    }
    // If only a has a rank, a comes first
    if (a.rankLevel !== null && b.rankLevel === null) {
      return -1;
    }
    // If only b has a rank, b comes first
    if (a.rankLevel === null && b.rankLevel !== null) {
      return 1;
    }
    // If neither has a rank, maintain original order (or sort by name)
    return (a.callsign ?? a.roleplayName ?? '').localeCompare(b.callsign ?? b.roleplayName ?? '');
  }) ?? [];

  const totalPages = Math.ceil((rosterData?.totalCount ?? 0) / limit);

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-4">
              You don&apos;t have permission to view the department roster.
            </p>
            <Link href={`/dashboard/departments/${departmentId}`}>
              <Button>
                Back to Department
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href={`/dashboard/departments/${departmentId}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Department Roster</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - {rosterData?.totalCount ?? 0} members
              </p>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        {stats && (
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium">Total Members</p>
                    <p className="text-2xl font-bold">{stats.activeMembers + stats.inTrainingMembers + stats.pendingMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <UserCheck className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium">Active</p>
                    <p className="text-2xl font-bold">{stats.activeMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  <div>
                    <p className="text-sm font-medium">In Training</p>
                    <p className="text-2xl font-bold">{stats.inTrainingMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <UserX className="h-5 w-5 text-orange-500" />
                  <div>
                    <p className="text-sm font-medium">Pending</p>
                    <p className="text-2xl font-bold">{stats.pendingMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters & Search
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search */}
            <div className="flex items-center space-x-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by callsign, name, Discord ID, badge number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md"
              />
            </div>

            {/* Filter Controls */}
            <div className="grid gap-4 md:grid-cols-4">
              {/* Status Filter */}
              <div>
                <label className="text-sm font-medium mb-2 block">Status</label>
                <Select
                  value={statusFilter.length === 1 ? statusFilter[0] : ""}
                  onValueChange={(value) => {
                    if (value === "all") {
                      setStatusFilter([]);
                    } else {
                      setStatusFilter([value as MemberStatus]);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="in_training">In Training</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="leave_of_absence">Leave of Absence</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="warned_1">Warned (Level 1)</SelectItem>
                    <SelectItem value="warned_2">Warned (Level 2)</SelectItem>
                    <SelectItem value="warned_3">Warned (Level 3)</SelectItem>
                    <SelectItem value="blacklisted">Blacklisted</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Rank Filter */}
              <div>
                <label className="text-sm font-medium mb-2 block">Rank</label>
                <Select
                  value={
                    rankFilter.length === 0 
                      ? "" 
                      : rankFilter[0] === null 
                        ? "none" 
                        : rankFilter[0]?.toString()
                  }
                  onValueChange={(value) => {
                    if (value === "all") {
                      setRankFilter([]);
                    } else if (value === "none") {
                      setRankFilter([null as any]);
                    } else {
                      setRankFilter([parseInt(value)]);
                    }
                    setPage(0); // Reset pagination when filter changes
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All ranks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Ranks</SelectItem>
                    <SelectItem value="none">No Rank</SelectItem>
                    {departmentInfo?.ranks?.map((rank) => (
                      <SelectItem key={rank.id} value={rank.id.toString()}>
                        {rank.name} (Level {rank.level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Team Filter */}
              <div>
                <label className="text-sm font-medium mb-2 block">Team</label>
                <Select
                  value={
                    teamFilter.length === 0 
                      ? "" 
                      : teamFilter[0] === null 
                        ? "none" 
                        : teamFilter[0]?.toString()
                  }
                  onValueChange={(value) => {
                    if (value === "all") {
                      setTeamFilter([]);
                    } else if (value === "none") {
                      setTeamFilter([null as any]);
                    } else {
                      setTeamFilter([parseInt(value)]);
                    }
                    setPage(0); // Reset pagination when filter changes
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    <SelectItem value="none">No Team</SelectItem>
                    {departmentInfo?.teams?.map((team) => (
                      <SelectItem key={team.id} value={team.id.toString()}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Include Inactive */}
              <div className="flex items-center space-x-2 mt-6">
                <input
                  type="checkbox"
                  id="include-inactive"
                  checked={includeInactive}
                  onChange={(e) => setIncludeInactive(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="include-inactive" className="text-sm font-medium">
                  Include Inactive
                </label>
              </div>

              {/* Exclude Ranks */}
              {departmentInfo?.ranks && departmentInfo.ranks.length > 0 && (
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-2 block">Exclude Ranks from Count</label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span className="truncate text-left">
                          {excludedRankSummary}
                        </span>
                        {excludedRankIds.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {excludedRankIds.length}
                          </Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64" align="start">
                      <DropdownMenuLabel>Select ranks to exclude</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {departmentInfo.ranks.map((rank) => (
                        <DropdownMenuCheckboxItem
                          key={rank.id}
                          checked={excludedRankIds.includes(rank.id)}
                          onCheckedChange={(checked) => {
                            setExcludedRankIds((prev) => {
                              if (checked === true) {
                                if (prev.includes(rank.id)) return prev;
                                return [...prev, rank.id];
                              }
                              return prev.filter((id) => id !== rank.id);
                            });
                            setPage(0);
                          }}
                        >
                          {rank.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          setExcludedRankIds([]);
                          setPage(0);
                        }}
                      >
                        Clear selection
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Roster Table */}
        <Card>
          <CardHeader>
            <CardTitle>Members ({filteredMembers.length})</CardTitle>
            <CardDescription>
              Department roster with member details and status
              {hasTimeclockPermission && (
                <>
                  <br />
                  Weekly hours reset every Sunday at 12:00 AM server time
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 10 }, (_, i: number) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Members Found</h3>
                <p className="text-muted-foreground">
                  No members match the current filters.
                </p>
              </div>
            ) : (
              <>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Callsign</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Rank</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Badge</TableHead>
                        <TableHead>Hire Date</TableHead>
                        <TableHead>Last Active</TableHead>
                        {hasTimeclockPermission && <TableHead>Weekly Hours</TableHead>}
                        {canManageMembers?.hasPermission && <TableHead>Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMembers.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell className="font-medium">
                            {member.callsign ?? 'No Callsign'}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {member.roleplayName ?? 'No Name'}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {member.discordId}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            {member.rankName ? (
                              <div className="flex items-center gap-2">
                                <Crown className="h-4 w-4 text-yellow-500" />
                                <div>
                                  <p className="font-medium">{member.rankName}</p>
                                  <p className="text-sm text-muted-foreground">
                                    Level {member.rankLevel}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">No Rank</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {member.teamName ?? (
                              <span className="text-muted-foreground">No Team</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(member.status)}>
                              {formatStatus(member.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {member.badgeNumber ?? (
                              <span className="text-muted-foreground">None</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {member.hireDate ? formatLocalDate(member.hireDate) : 'N/A'}
                          </TableCell>
                          <TableCell>
                            {member.lastActiveDate ? formatLocalDate(member.lastActiveDate) : 'N/A'}
                          </TableCell>
                          {hasTimeclockPermission && (
                            <TableCell>
                              {weeklyHoursLoading ? (
                                <div className="flex items-center gap-2">
                                  <Clock className="h-4 w-4 animate-spin" />
                                  <span className="text-sm text-muted-foreground">Loading...</span>
                                </div>
                              ) : weeklyHoursData?.memberHours[member.id] ? (
                                <div className="text-center">
                                  <p className="font-mono font-semibold">
                                    {weeklyHoursData.memberHours[member.id]!.totalHours}h
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {weeklyHoursData.memberHours[member.id]!.entriesCount} shifts
                                  </p>
                                </div>
                              ) : (
                                <div className="text-center text-muted-foreground">
                                  <p className="font-mono">0h</p>
                                  <p className="text-xs">0 shifts</p>
                                </div>
                              )}
                            </TableCell>
                          )}
                          {canManageMembers?.hasPermission && (
                            <TableCell>
                              <Link href={`/dashboard/departments/${departmentId}/members/${member.id}`}>
                                <Button variant="outline" size="sm">
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {page * limit + 1} to {Math.min((page + 1) * limit, rosterData?.totalCount ?? 0)} of {rosterData?.totalCount ?? 0} members
                    </p>
                    
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(page - 1)}
                        disabled={page === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      
                      <span className="text-sm">
                        Page {page + 1} of {totalPages}
                      </span>
                      
                      <Button 
                        variant="outline" 
                        onClick={() => setPage(page + 1)} 
                        disabled={page >= (totalPages - 1)}
                      >
                        Next ({Math.min((totalPages ?? 1), page + 1)})
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 
