"use client";

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  Search,
  Users,
  Loader2,
  Target,
  Edit
} from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MemberStatus = "in_training" | "pending" | "active" | "inactive" | "leave_of_absence" | "warned_1" | "warned_2" | "warned_3" | "suspended" | "blacklisted";
type SortBy = "name" | "rank" | "hire_date" | "status" | "callsign";
type SortOrder = "asc" | "desc";

export default function AdvancedOperationsPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);

  const [isBulkUpdateDialogOpen, setIsBulkUpdateDialogOpen] = useState(false);
  const [isBulkPromoteDialogOpen, setIsBulkPromoteDialogOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);

  // Search form state
  const [searchForm, setSearchForm] = useState({
    searchTerm: "",
    status: [] as MemberStatus[],
    rankIds: [] as number[],
    teamIds: [] as number[],
    hireDateFrom: "",
    hireDateTo: "",
    sortBy: "name" as SortBy,
    sortOrder: "asc" as SortOrder,
    limit: 50,
    offset: 0,
  });

  // Bulk update form state
  const [bulkUpdateForm, setBulkUpdateForm] = useState({
    status: "" as MemberStatus | "",
    rankId: "",
    primaryTeamId: "",
    notes: "",
    reason: "",
  });

  // Bulk promote form state
  const [bulkPromoteForm, setBulkPromoteForm] = useState({
    newRankId: "",
    reason: "",
    effectiveDate: new Date().toISOString().split('T')[0],
  });

  // Get department info
  const { data: departmentInfo } = api.dept.discovery.getDepartmentInfo.useQuery({ departmentId });

  // Get department data for ranks and teams
  const { data: departmentData } = api.dept.user.info.getDepartment.useQuery({ departmentId });

  // Permissions
  const { data: canManageMembers } = api.dept.user.checkPermission.useQuery({ departmentId, permission: 'manage_members' });

  // Advanced search query
  const { data: searchResults, isLoading: searchLoading, refetch: refetchSearch } =
    api.deptMore.search.searchMembers.useQuery({
      departmentId,
      searchTerm: searchForm.searchTerm || undefined,
      status: searchForm.status.length > 0 ? searchForm.status : undefined,
      rankIds: searchForm.rankIds.length > 0 ? searchForm.rankIds : undefined,
      teamIds: searchForm.teamIds.length > 0 ? searchForm.teamIds : undefined,
      hireDateFrom: searchForm.hireDateFrom ? new Date(searchForm.hireDateFrom) : undefined,
      hireDateTo: searchForm.hireDateTo ? new Date(searchForm.hireDateTo) : undefined,
      sortBy: searchForm.sortBy,
      sortOrder: searchForm.sortOrder,
      limit: searchForm.limit,
      offset: searchForm.offset,
    });

  // Bulk update mutation
  const bulkUpdateMutation = api.deptMore.bulk.updateMembers.useMutation({
    onSuccess: (result) => {
      toast.success(`Successfully updated ${selectedMembers.length} members`);
      setIsBulkUpdateDialogOpen(false);
      setSelectedMembers([]);
      setBulkUpdateForm({
        status: "",
        rankId: "",
        primaryTeamId: "",
        notes: "",
        reason: "",
      });
      void refetchSearch();
    },
    onError: (error) => {
      toast.error(`Failed to update members: ${error.message}`);
    },
  });

  // Bulk promote mutation
  const bulkPromoteMutation = api.deptMore.bulk.promoteMembers.useMutation({
    onSuccess: (result) => {
      toast.success(`Successfully promoted ${selectedMembers.length} members`);
      setIsBulkPromoteDialogOpen(false);
      setSelectedMembers([]);
      setBulkPromoteForm({
        newRankId: "",
        reason: "",
        effectiveDate: new Date().toISOString().split('T')[0],
      });
      void refetchSearch();
    },
    onError: (error) => {
      toast.error(`Failed to promote members: ${error.message}`);
    },
  });

  const handleSearch = () => {
    void refetchSearch();
  };

  const handleBulkUpdate = () => {
    if (selectedMembers.length === 0) {
      toast.error("Please select members to update");
      return;
    }

    if (!bulkUpdateForm.reason.trim()) {
      toast.error("Please provide a reason for the bulk update");
      return;
    }

    const updates: any = {};
    if (bulkUpdateForm.status) updates.status = bulkUpdateForm.status;
    if (bulkUpdateForm.rankId) updates.rankId = parseInt(bulkUpdateForm.rankId);
    if (bulkUpdateForm.primaryTeamId) updates.primaryTeamId = parseInt(bulkUpdateForm.primaryTeamId);
    if (bulkUpdateForm.notes.trim()) updates.notes = bulkUpdateForm.notes;

    if (Object.keys(updates).length === 0) {
      toast.error("Please select at least one field to update");
      return;
    }

    bulkUpdateMutation.mutate({
      memberIds: selectedMembers,
      updates,
      reason: bulkUpdateForm.reason,
    });
  };

  const handleBulkPromote = () => {
    if (selectedMembers.length === 0) {
      toast.error("Please select members to promote");
      return;
    }

    if (!bulkPromoteForm.newRankId || !bulkPromoteForm.reason.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    bulkPromoteMutation.mutate({
      memberIds: selectedMembers,
      newRankId: parseInt(bulkPromoteForm.newRankId),
      reason: bulkPromoteForm.reason,
      effectiveDate: new Date(bulkPromoteForm.effectiveDate!),
    });
  };

  const handleMemberSelect = (memberId: number, checked: boolean) => {
    if (checked) {
      setSelectedMembers(prev => [...prev, memberId]);
    } else {
      setSelectedMembers(prev => prev.filter(id => id !== memberId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && searchResults?.members) {
      setSelectedMembers(searchResults.members.map(m => m.id));
    } else {
      setSelectedMembers([]);
    }
  };

  const getStatusColor = (status: MemberStatus) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      case "in_training":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "pending":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "inactive":
        return "bg-gray-100 text-gray-800 border-gray-200";
      case "suspended":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatStatus = (status: string) => {
    return status.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={`/dashboard/departments/${departmentId}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Advanced Operations</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Advanced search and bulk operations
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {selectedMembers.length > 0 && (
              <>
                <Dialog open={isBulkUpdateDialogOpen} onOpenChange={setIsBulkUpdateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" disabled={!(canManageMembers?.hasPermission ?? false)} title={!(canManageMembers?.hasPermission ?? false) ? 'Requires manage members permission' : undefined}>
                      <Edit className="h-4 w-4 mr-2" />
                      Bulk Update ({selectedMembers.length})
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Bulk Update Members</DialogTitle>
                      <DialogDescription>
                        Update {selectedMembers.length} selected members at once.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="bulkStatus">Status</Label>
                          <Select
                            value={bulkUpdateForm.status}
                            onValueChange={(value: MemberStatus | "") =>
                              setBulkUpdateForm(prev => ({ ...prev, status: value }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="No change" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">No change</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                              <SelectItem value="suspended">Suspended</SelectItem>
                              <SelectItem value="leave_of_absence">Leave of Absence</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-2">
                          <Label htmlFor="bulkRank">Rank</Label>
                          <Select
                            value={bulkUpdateForm.rankId}
                            onValueChange={(value) => setBulkUpdateForm(prev => ({ ...prev, rankId: value }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="No change" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">No change</SelectItem>
                              {departmentData?.ranks?.map((rank) => (
                                <SelectItem key={rank.id} value={rank.id.toString()}>
                                  {rank.name} (Level {rank.level})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="bulkTeam">Primary Team</Label>
                        <Select
                          value={bulkUpdateForm.primaryTeamId}
                          onValueChange={(value) => setBulkUpdateForm(prev => ({ ...prev, primaryTeamId: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="No change" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">No change</SelectItem>
                            {departmentData?.teams?.map((team) => (
                              <SelectItem key={team.id} value={team.id.toString()}>
                                {team.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="bulkNotes">Notes</Label>
                        <Textarea
                          id="bulkNotes"
                          value={bulkUpdateForm.notes}
                          onChange={(e) => setBulkUpdateForm(prev => ({ ...prev, notes: e.target.value }))}
                          placeholder="Additional notes (optional)"
                          rows={2}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="bulkReason">Reason *</Label>
                        <Textarea
                          id="bulkReason"
                          value={bulkUpdateForm.reason}
                          onChange={(e) => setBulkUpdateForm(prev => ({ ...prev, reason: e.target.value }))}
                          placeholder="Reason for this bulk update (required)"
                          rows={2}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsBulkUpdateDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={handleBulkUpdate}
                        disabled={bulkUpdateMutation.isPending}
                      >
                        {bulkUpdateMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          `Update ${selectedMembers.length} Members`
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={isBulkPromoteDialogOpen} onOpenChange={setIsBulkPromoteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button disabled={!(canManageMembers?.hasPermission ?? false)} title={!(canManageMembers?.hasPermission ?? false) ? 'Requires manage members permission' : undefined}>
                      <Target className="h-4 w-4 mr-2" />
                      Bulk Promote ({selectedMembers.length})
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>Bulk Promote Members</DialogTitle>
                      <DialogDescription>
                        Promote {selectedMembers.length} selected members to a new rank.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="promoteRank">New Rank *</Label>
                        <Select
                          value={bulkPromoteForm.newRankId}
                          onValueChange={(value) => setBulkPromoteForm(prev => ({ ...prev, newRankId: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select new rank" />
                          </SelectTrigger>
                          <SelectContent>
                            {departmentData?.ranks?.map((rank) => (
                              <SelectItem key={rank.id} value={rank.id.toString()}>
                                {rank.name} (Level {rank.level})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="promoteDate">Effective Date *</Label>
                        <Input
                          id="promoteDate"
                          type="date"
                          value={bulkPromoteForm.effectiveDate}
                          onChange={(e) => setBulkPromoteForm(prev => ({ ...prev, effectiveDate: e.target.value }))}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="promoteReason">Reason *</Label>
                        <Textarea
                          id="promoteReason"
                          value={bulkPromoteForm.reason}
                          onChange={(e) => setBulkPromoteForm(prev => ({ ...prev, reason: e.target.value }))}
                          placeholder="Reason for these promotions (required)"
                          rows={3}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsBulkPromoteDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={handleBulkPromote}
                        disabled={bulkPromoteMutation.isPending}
                      >
                        {bulkPromoteMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Promoting...
                          </>
                        ) : (
                          `Promote ${selectedMembers.length} Members`
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>

        {/* Advanced Search */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Advanced Member Search
            </CardTitle>
            <CardDescription>
              Search and filter department members with advanced criteria
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="searchTerm">Search Term</Label>
                <Input
                  id="searchTerm"
                  value={searchForm.searchTerm}
                  onChange={(e) => setSearchForm(prev => ({ ...prev, searchTerm: e.target.value }))}
                  placeholder="Name, callsign, badge number..."
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sortBy">Sort By</Label>
                <Select
                  value={searchForm.sortBy}
                  onValueChange={(value: SortBy) => setSearchForm(prev => ({ ...prev, sortBy: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="rank">Rank</SelectItem>
                    <SelectItem value="hire_date">Hire Date</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                    <SelectItem value="callsign">Callsign</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sortOrder">Sort Order</Label>
                <Select
                  value={searchForm.sortOrder}
                  onValueChange={(value: SortOrder) => setSearchForm(prev => ({ ...prev, sortOrder: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="hireDateFrom">Hire Date From</Label>
                <Input
                  id="hireDateFrom"
                  type="date"
                  value={searchForm.hireDateFrom}
                  onChange={(e) => setSearchForm(prev => ({ ...prev, hireDateFrom: e.target.value }))}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="hireDateTo">Hire Date To</Label>
                <Input
                  id="hireDateTo"
                  type="date"
                  value={searchForm.hireDateTo}
                  onChange={(e) => setSearchForm(prev => ({ ...prev, hireDateTo: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSearch} disabled={searchLoading}>
                {searchLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Search Members
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Search Results */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Search Results</CardTitle>
              {searchResults?.members && searchResults.members.length > 0 && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="select-all"
                    checked={selectedMembers.length === searchResults.members.length}
                    onCheckedChange={handleSelectAll}
                  />
                  <Label htmlFor="select-all" className="text-sm">
                    Select All ({searchResults.members.length})
                  </Label>
                </div>
              )}
            </div>
            <CardDescription>
              {searchResults ? `Found ${searchResults.total} members` : "Use the search form above to find members"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {searchLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="flex items-center space-x-4 p-4 border rounded-lg">
                    <Skeleton className="h-4 w-4" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-6 w-20" />
                  </div>
                ))}
              </div>
            ) : searchResults?.members && searchResults.members.length > 0 ? (
              <div className="space-y-4">
                {searchResults.members.map((member) => (
                  <div key={member.id} className="flex items-center space-x-4 p-4 border rounded-lg">
                    <Checkbox
                      id={`member-${member.id}`}
                      checked={selectedMembers.includes(member.id)}
                      onCheckedChange={(checked) => handleMemberSelect(member.id, checked as boolean)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">
                          {member.roleplayName || member.discordId}
                        </h4>
                        <Badge variant="outline">
                          {member.callsign}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={getStatusColor(member.status as MemberStatus)}
                        >
                          {formatStatus(member.status)}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {member.rank?.name && `${member.rank.name} • `}
                        {member.team?.name && `${member.team.name} • `}
                        Joined: {member.hireDate ? new Date(member.hireDate).toLocaleDateString() : 'Unknown'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Members Found</h3>
                <p className="text-muted-foreground">
                  {searchForm.searchTerm || searchForm.status.length > 0 || searchForm.rankIds.length > 0
                    ? "No members match your search criteria."
                    : "Use the search form above to find department members."
                  }
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}