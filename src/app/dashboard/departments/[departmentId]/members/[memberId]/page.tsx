"use client";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  Edit,
  Save,
  X,
  User,
  Crown,
  Users,
  Calendar,
  Clock,
  FileText,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Ban,
  UserX,
  Settings,
  Timer,
  History,
  Play,
  Square,
  Award,
  BarChart3,
  Activity,
  Star
} from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { formatLocalDateTime, formatLocalDate, formatDuration } from "@/lib/utils/date";

type MemberStatus = "in_training" | "pending" | "active" | "inactive" | "leave_of_absence" | "warned_1" | "warned_2" | "warned_3" | "suspended" | "blacklisted";

type PromotionHistory = {
  id: number;
  promotedBy: string;
  reason: string | null;
  effectiveDate: Date;
  notes: string | null;
};

type DisciplinaryAction = {
  id: number;
  actionType: string;
  reason: string;
  description: string | null;
  issuedAt: Date;
  issuedBy: string;
  expiresAt: Date | null;
  isActive: boolean;
};

export default function MemberDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const departmentId = parseInt(params.departmentId as string);
  const memberId = parseInt(params.memberId as string);

  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<{
    roleplayName?: string;
    badgeNumber?: string;
    notes?: string;
    status?: MemberStatus;
    rankId?: number;
    primaryTeamId?: number;
  }>({});

  // Add state for disciplinary actions
  const [disciplineAction, setDisciplineAction] = useState<{
    isOpen: boolean;
    type: 'warn' | 'suspend' | null;
    reason: string;
  }>({
    isOpen: false,
    type: null,
    reason: '',
  });

  // Add state for notes editing
  const [notesState, setNotesState] = useState<{
    isEditing: boolean;
    value: string;
  }>({
    isEditing: false,
    value: '',
  });

  // Get member details using the memberIdFilter
  const { data: rosterData, isLoading: memberLoading, refetch: refetchMember } = api.dept.user.info.getDepartmentRoster.useQuery({
    departmentId,
    includeInactive: true,
    memberIdFilter: memberId,
    limit: 1,
  });

  // Find the specific member from roster data
  const memberData = rosterData?.members[0];

  // Get department info for dropdowns
  const { data: departmentInfo } = api.dept.user.info.getDepartment.useQuery({ departmentId });

  // Get user permissions
  const { data: permissions } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_members'
  });

  const { data: promotePermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'promote_members'
  });

  const { data: demotePermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'demote_members'
  });

  const { data: disciplinePermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'discipline_members'
  });

  const { data: timeclockViewPermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'view_all_timeclock'
  });

  const { data: timeclockManagePermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_timeclock'
  });

  const { data: timeclockEditPermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'edit_timeclock'
  });

  // Get current user's information to check rank hierarchy and prevent self-editing
  const { data: currentUserInfo } = api.dept.user.info.getDepartmentRoster.useQuery({
    departmentId,
    includeInactive: false,
    memberIdFilter: undefined, // Get current user
    limit: 1,
  });

  // Get current user's Discord ID to identify themselves
  const { data: currentUser } = api.user.getMe.useQuery();

  // Get member's current week hours
  const { data: weeklyHours } = api.dept.user.timeclock.getWeeklyHours.useQuery({
    departmentId,
    memberId,
  }, {
    enabled: !!(timeclockViewPermission?.hasPermission ?? false) || !!(timeclockManagePermission?.hasPermission ?? false) && !!memberData
  });

  // Get member's time history
  const { data: timeHistory, isLoading: timeHistoryLoading } = api.dept.user.timeclock.getHistory.useQuery({
    departmentId,
    memberId,
    limit: 10, // Show last 10 entries
  }, {
    enabled: !!(timeclockViewPermission?.hasPermission ?? false) || !!(timeclockManagePermission?.hasPermission ?? false) && !!memberData
  });

  // Get member's promotion history for performance view
  const { data: promotions, isLoading: promotionsLoading } = api.dept.user.promotions.getHistory.useQuery(
    { memberId, limit: 20 },
    { enabled: !!memberData && !!(permissions?.hasPermission ?? false) }
  );

  // Get member's disciplinary actions for performance view
  const { data: disciplinaryActions, isLoading: disciplinaryLoading } = api.dept.user.discipline.getByMember.useQuery(
    { 
      memberId,
      includeExpired: true,
      limit: 20
    },
    { enabled: !!memberData && !!(permissions?.hasPermission ?? false) }
  );

  // Mutations
  const updateMemberMutation = api.dept.admin.members.update.useMutation({
    onSuccess: () => {
      toast.success("Member updated successfully");
      setIsEditing(false);
      setEditData({});
      void refetchMember();
    },
    onError: (error) => {
      toast.error(`Failed to update member: ${error.message}`);
    },
  });

  const promoteMutation = api.dept.user.promotions.promote.useMutation({
    onSuccess: (result) => {
      toast.success(result.message || "Member promoted successfully");
      void refetchMember();
    },
    onError: (error) => {
      toast.error(`Failed to promote member: ${error.message}`);
    },
  });

  const demoteMutation = api.dept.user.promotions.demote.useMutation({
    onSuccess: (result) => {
      toast.success(result.message || "Member demoted successfully");
      void refetchMember();
    },
    onError: (error) => {
      toast.error(`Failed to demote member: ${error.message}`);
    },
  });

  // Add disciplinary action mutation
  const disciplineIssueMutation = api.dept.user.discipline.issue.useMutation({
    onSuccess: () => {
      toast.success("Disciplinary action issued successfully");
      void refetchMember();
      // Refetch disciplinary actions if they are being displayed
      if (permissions?.hasPermission ?? false) {
        // We need to manually trigger a refetch since we're not using a separate refetch function
        // The disciplinary actions query will automatically refetch when the component re-renders
      }
    },
    onError: (error) => {
      toast.error(`Failed to issue disciplinary action: ${error.message}`);
    },
  });

  // Add dismiss disciplinary action mutation
  const disciplineDismissMutation = api.dept.user.discipline.dismiss.useMutation({
    onSuccess: () => {
      toast.success("Disciplinary action dismissed successfully");
      void refetchMember();
    },
    onError: (error) => {
      toast.error(`Failed to dismiss disciplinary action: ${error.message}`);
    },
  });

  // Add notes update mutation
  const updateNotesMutation = api.dept.admin.members.update.useMutation({
    onSuccess: () => {
      toast.success("Notes updated successfully");
      void refetchMember();
    },
    onError: (error) => {
      toast.error(`Failed to update notes: ${error.message}`);
    },
  });

  const handlePromote = (toRankId: number, reason?: string) => {
    if (!memberData) return;
    
    promoteMutation.mutate({
      memberId: memberData.id,
      toRankId,
      reason: reason ?? "Promotion",
      notes: reason ?? "Promotion via member management",
    });
  };

  const handleDemote = (toRankId: number, reason?: string) => {
    if (!memberData) return;
    
    demoteMutation.mutate({
      memberId: memberData.id,
      toRankId,
      reason: reason ?? "Demotion",
      notes: reason ?? "Demotion via member management",
    });
  };

  const handleDiscipline = (action: 'warn' | 'suspend', reason?: string) => {
    if (!memberData) return;
    
    const actionTypeMap = {
      'warn': 'warning',
      'suspend': 'suspension',
    };
    
    // Issue disciplinary action only; backend will update status
    disciplineIssueMutation.mutate({
      memberId: memberData.id,
      actionType: actionTypeMap[action],
      reason: reason ?? `${action === 'warn' ? 'Warning' : 'Suspension'} issued via member management`,
      description: `${action === 'warn' ? 'Warning' : 'Suspension'} issued by management for: ${reason ?? 'No specific reason provided'}`,
      expiresAt: action === 'suspend' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : undefined, // 30 days for suspension
    });
  };

  const handleNotesUpdate = (newNotes: string) => {
    if (!memberData) return;
    
    updateNotesMutation.mutate({
      id: memberId,
      notes: newNotes,
    });
  };

  // New handlers for disciplinary actions with confirmation
  const openDisciplineDialog = (type: 'warn' | 'suspend') => {
    setDisciplineAction({
      isOpen: true,
      type,
      reason: '',
    });
  };

  const closeDisciplineDialog = () => {
    setDisciplineAction({
      isOpen: false,
      type: null,
      reason: '',
    });
  };

  const confirmDisciplineAction = () => {
    if (!disciplineAction.type || !memberData) return;
    
    const actionTypeMap = {
      'warn': 'warning',
      'suspend': 'suspension',
    };
    
    // Issue disciplinary action only; backend will update status
    disciplineIssueMutation.mutate({
      memberId: memberData.id,
      actionType: actionTypeMap[disciplineAction.type],
      reason: disciplineAction.reason || `${disciplineAction.type === 'warn' ? 'Warning' : 'Suspension'} issued via member management`,
      description: `${disciplineAction.type === 'warn' ? 'Warning' : 'Suspension'} issued by management for: ${disciplineAction.reason || 'No specific reason provided'}`,
      expiresAt: disciplineAction.type === 'suspend' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : undefined, // 30 days for suspension
    });
    // Close dialog
    closeDisciplineDialog();
  };

  const startEditingNotes = () => {
    setNotesState({
      isEditing: true,
      value: memberData?.notes ?? '',
    });
  };

  const cancelEditingNotes = () => {
    setNotesState({
      isEditing: false,
      value: '',
    });
  };

  const saveNotes = () => {
    handleNotesUpdate(notesState.value);
    setNotesState({
      isEditing: false,
      value: '',
    });
  };

  // Simplified permissions - let backend handle authorization
  const canEdit = permissions?.hasPermission;
  const canPromote = promotePermission?.hasPermission;
  const canDemote = demotePermission?.hasPermission;
  const canDiscipline = disciplinePermission?.hasPermission;
  const canViewTimeclock = (timeclockViewPermission?.hasPermission ?? false) || (timeclockManagePermission?.hasPermission ?? false);
  const canEditTimeclock = (timeclockEditPermission?.hasPermission ?? false) || (timeclockManagePermission?.hasPermission ?? false);

  const getStatusColor = (status: MemberStatus) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
      case 'in_training':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800';
      case 'pending':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/20 dark:text-gray-400 dark:border-gray-700';
      case 'leave_of_absence':
        return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800';
      case 'suspended':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
      case 'warned_1':
      case 'warned_2':
      case 'warned_3':
        return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800';
      case 'blacklisted':
        return 'bg-red-200 text-red-900 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/20 dark:text-gray-400 dark:border-gray-700';
    }
  };

  const formatStatus = (status: MemberStatus) => {
    return status.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const getDaysInDepartment = (hireDate: Date | string | null) => {
    if (!hireDate) return 0;
    const now = new Date();
    const hire = new Date(hireDate);
    const diffTime = Math.abs(now.getTime() - hire.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getActionTypeColor = (actionType: string) => {
    switch (actionType.toLowerCase()) {
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800';
      case 'suspension':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
      case 'commendation':
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
      case 'note':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/20 dark:text-gray-400 dark:border-gray-700';
    }
  };

  const handleSaveEdit = () => {
    if (!memberData) return;

    updateMemberMutation.mutate({
      id: memberId,
      ...editData,
    });
  };

  if (memberLoading) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="flex items-center space-x-4">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-8 w-48" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!memberData) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Member Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The requested member could not be found or you don&apos;t have permission to view them.
            </p>
            <Link href={`/dashboard/departments/${departmentId}/roster`}>
              <Button>
                Back to Roster
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Check if user is trying to edit themselves
  const isEditingSelf = currentUser?.discordId === memberData?.discordId;
  
  // Get current user's rank information from the roster
  const currentUserMember = currentUserInfo?.members?.find(m => m.discordId === currentUser?.discordId);
  const currentUserRankLevel = currentUserMember?.rankLevel ?? 0;
  const targetMemberRankLevel = memberData?.rankLevel ?? 0;

  return (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href={`/dashboard/departments/${departmentId}/roster`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Roster
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">
                {memberData?.roleplayName ?? 'No Name'}
              </h1>
              <p className="text-muted-foreground">
                {memberData?.callsign ?? 'No Callsign'} • {departmentInfo?.name ?? 'Unknown Department'}
              </p>
            </div>
          </div>
          
          {canEdit && (
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <>
                  <Button 
                    onClick={handleSaveEdit}
                    disabled={updateMemberMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setIsEditing(false);
                      setEditData({});
                    }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </>
              ) : (
                <Button 
                  onClick={() => {
                    setIsEditing(true);
                    setEditData({
                      roleplayName: memberData?.roleplayName ?? '',
                      badgeNumber: memberData?.badgeNumber ?? '',
                      notes: memberData?.notes ?? '',
                      status: memberData?.status,
                      rankId: memberData?.rankId ?? undefined,
                      primaryTeamId: memberData?.primaryTeamId ?? undefined,
                    });
                  }}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Member
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Member Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Member Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Basic Info */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Roleplay Name</label>
                  {isEditing ? (
                    <Input
                      value={editData.roleplayName}
                      onChange={(e) => setEditData(prev => ({ ...prev, roleplayName: e.target.value }))}
                      placeholder="Enter roleplay name"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {memberData.roleplayName ?? 'Not set'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium">Discord ID</label>
                  <p className="text-sm text-muted-foreground">{memberData?.discordId ?? 'Unknown'}</p>
                </div>

                <div>
                  <label className="text-sm font-medium">Badge Number</label>
                  {isEditing ? (
                    <Input
                      value={editData.badgeNumber}
                      onChange={(e) => setEditData(prev => ({ ...prev, badgeNumber: e.target.value }))}
                      placeholder="Enter badge number"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {memberData.badgeNumber ?? 'Not assigned'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium">Status</label>
                  {isEditing && canDiscipline ? (
                    <Select
                      value={editData.status}
                      onValueChange={(value: MemberStatus) => setEditData(prev => ({ ...prev, status: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="in_training">In Training</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="leave_of_absence">Leave of Absence</SelectItem>
                        <SelectItem value="warned_1">Warned (Level 1)</SelectItem>
                        <SelectItem value="warned_2">Warned (Level 2)</SelectItem>
                        <SelectItem value="warned_3">Warned (Level 3)</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="blacklisted">Blacklisted</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : memberData.status ? (
                    <Badge className={getStatusColor(memberData.status)}>
                      {formatStatus(memberData.status)}
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/20 dark:text-gray-400 dark:border-gray-700">
                      Unknown
                    </Badge>
                  )}
                </div>
              </div>

              <Separator />

              {/* Rank and Team */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Rank</label>
                  {isEditing && (canPromote || canDemote) ? (
                    <Select
                      value={editData.rankId?.toString() ?? '_none_'}
                      onValueChange={(value) => setEditData(prev => ({ ...prev, rankId: value !== '_none_' ? parseInt(value) : undefined }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select rank" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">No Rank</SelectItem>
                        {departmentInfo?.ranks?.map((rank) => (
                          <SelectItem key={rank.id} value={rank.id.toString()}>
                            {rank.name} (Level {rank.level})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : memberData.rankName ? (
                    <div className="flex items-center gap-2">
                      <Crown className="h-4 w-4 text-yellow-500" />
                      <div>
                        <p className="font-medium">{memberData.rankName}</p>
                        <p className="text-sm text-muted-foreground">
                          Level {memberData.rankLevel}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No Rank</p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium">Primary Team</label>
                  {isEditing ? (
                    <Select
                      value={editData.primaryTeamId?.toString() ?? '_none_'}
                      onValueChange={(value) => setEditData(prev => ({ ...prev, primaryTeamId: value !== '_none_' ? parseInt(value) : undefined }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select team" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">No Team</SelectItem>
                        {departmentInfo?.teams?.map((team) => (
                          <SelectItem key={team.id} value={team.id.toString()}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {memberData.teamName ?? 'No Team'}
                    </p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Dates */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Hire Date</p>
                    <p className="text-sm text-muted-foreground">
                      {memberData.hireDate ? formatLocalDate(memberData.hireDate) : 'Not set'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Last Active</p>
                    <p className="text-sm text-muted-foreground">
                      {memberData.lastActiveDate ? formatLocalDate(memberData.lastActiveDate) : 'Unknown'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Time Tracking & Actions */}
          <div className="space-y-6">
            {/* Time Tracking Information */}
            {canViewTimeclock && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Timer className="h-5 w-5" />
                    Time Tracking
                  </CardTitle>
                  <CardDescription>
                    Current week hours and recent activity
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Weekly Hours Summary */}
                  {weeklyHours && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">This Week:</span>
                        <div className="text-right">
                          <p className="font-mono text-lg font-bold">
                            {weeklyHours.totalHours}h
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {weeklyHours.entriesCount} shifts
                          </p>
                        </div>
                      </div>
                      <Separator />
                    </div>
                  )}

                  {/* Recent Time Entries */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium">Recent Activity</h4>
                      <Link href={`/dashboard/departments/${departmentId}/members/${memberId}/time-history`}>
                        <Button variant="ghost" size="sm">
                          <History className="h-4 w-4 mr-2" />
                          View All
                        </Button>
                      </Link>
                    </div>
                    
                    {timeHistoryLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    ) : timeHistory?.entries && timeHistory.entries.length > 0 ? (
                      <div className="space-y-2">
                        {timeHistory.entries.slice(0, 5).map((entry) => (
                          <div key={entry.id} className="flex items-center justify-between p-2 rounded border">
                            <div>
                              <p className="text-sm font-medium">
                                {formatLocalDate(entry.clockInTime)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatLocalDateTime(entry.clockInTime)} - {entry.clockOutTime ? formatLocalDateTime(entry.clockOutTime) : 'Active'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-mono">
                                {entry.totalMinutes ? formatDuration(entry.totalMinutes) : 'In Progress'}
                              </p>
                              <Badge variant={entry.status === 'clocked_in' ? 'default' : 'secondary'} className="text-xs">
                                {entry.status.replace('_', ' ')}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No time entries found
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Performance Section */}
            {(permissions?.hasPermission ?? false) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Performance Metrics
                  </CardTitle>
                  <CardDescription>
                    Career progression and performance records
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Performance Overview Cards */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Current Status</span>
                      </div>
                      <Badge className={getStatusColor(memberData?.status ?? 'inactive')}>
                        {formatStatus(memberData?.status ?? 'inactive')}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Current Rank</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {memberData?.rankName ?? 'N/A'}
                        </p>
                        {memberData?.rankLevel && (
                          <p className="text-xs text-muted-foreground">
                            Level {memberData.rankLevel}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Days in Department</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">
                          {getDaysInDepartment(memberData?.hireDate ?? null)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Since {memberData?.hireDate ? formatLocalDate(memberData.hireDate) : 'N/A'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Promotions</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">
                          {promotions?.length ?? 0}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Career advancements
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Performance Details Tabs */}
                  <div>
                    <Tabs defaultValue="overview" className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="promotions">Promotions</TabsTrigger>
                        <TabsTrigger value="disciplinary">Records</TabsTrigger>
                      </TabsList>

                      <TabsContent value="overview" className="space-y-4 mt-6">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-3">
                            <h4 className="font-medium text-sm">Department Information</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Callsign:</span>
                                <span className="font-medium">{memberData?.callsign ?? 'Not assigned'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Badge Number:</span>
                                <span className="font-medium">{memberData?.badgeNumber ?? 'Not assigned'}</span>
                              </div>
                              {memberData?.teamName && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Team:</span>
                                  <span className="font-medium">{memberData.teamName}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-3">
                            <h4 className="font-medium text-sm">Career Summary</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Hire Date:</span>
                                <span className="font-medium">
                                  {memberData?.hireDate ? formatLocalDate(memberData.hireDate) : 'N/A'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Total Promotions:</span>
                                <span className="font-medium">{promotions?.length ?? 0}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Active Records:</span>
                                <span className="font-medium">
                                  {disciplinaryActions?.filter(a => a.isActive).length ?? 0}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="promotions" className="space-y-4 mt-6">
                        {promotionsLoading ? (
                          <div className="space-y-2">
                            {Array.from({ length: 3 }, (_, i) => (
                              <Skeleton key={i} className="h-16 w-full" />
                            ))}
                          </div>
                        ) : !promotions || promotions.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Award className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No promotion history found</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {promotions.map((promotion) => (
                              <div key={promotion.id} className="flex items-center gap-3 p-4 bg-muted rounded-lg">
                                <div className="p-2 bg-green-100 rounded-lg">
                                  <TrendingUp className="h-4 w-4 text-green-600" />
                                </div>
                                <div className="flex-1">
                                  <div className="font-medium">
                                    Promotion Record #{promotion.id}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {formatLocalDateTime(promotion.effectiveDate)} • By {promotion.promotedBy}
                                  </div>
                                  {promotion.reason && (
                                    <div className="text-sm text-muted-foreground mt-1">
                                      Reason: {promotion.reason}
                                    </div>
                                  )}
                                  {promotion.notes && (
                                    <div className="text-sm text-muted-foreground mt-1">
                                      Notes: {promotion.notes}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="disciplinary" className="space-y-4 mt-6">
                        {disciplinaryLoading ? (
                          <div className="space-y-2">
                            {Array.from({ length: 3 }, (_, i) => (
                              <Skeleton key={i} className="h-16 w-full" />
                            ))}
                          </div>
                        ) : !disciplinaryActions || disciplinaryActions.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50 text-green-500" />
                            <p>No disciplinary records found</p>
                            <p className="text-xs mt-1">Keep up the good work!</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {disciplinaryActions.map((action: DisciplinaryAction) => (
                              <div key={action.id} className="p-4 bg-muted rounded-lg">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 bg-yellow-100 rounded-lg">
                                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-medium">{action.actionType}</span>
                                      <Badge 
                                        variant="outline"
                                        className={getActionTypeColor(action.actionType)}
                                      >
                                        {action.isActive ? 'Active' : 'Expired'}
                                      </Badge>
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                      {formatLocalDateTime(action.issuedAt)} • By {action.issuedBy}
                                    </div>
                                    <div className="text-sm mt-2">
                                      <strong>Reason:</strong> {action.reason}
                                    </div>
                                    {action.description && (
                                      <div className="text-sm text-muted-foreground mt-1">
                                        {action.description}
                                      </div>
                                    )}
                                    {action.expiresAt && (
                                      <div className="text-xs text-muted-foreground mt-2">
                                        Expires: {formatLocalDateTime(action.expiresAt)}
                                      </div>
                                    )}
                                  </div>
                                  {/* Add dismiss button for active disciplinary actions */}
                                  {action.isActive && canDiscipline && (
                                    <div className="flex flex-col gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                                        onClick={() => {
                                          if (window.confirm(`Are you sure you want to dismiss this ${action.actionType.toLowerCase()}? This action cannot be undone.`)) {
                                            disciplineDismissMutation.mutate({
                                              actionId: action.id,
                                              reason: "Dismissed via member management"
                                            });
                                          }
                                        }}
                                        disabled={disciplineDismissMutation.isPending}
                                      >
                                        <X className="h-3 w-3 mr-1" />
                                        {disciplineDismissMutation.isPending ? "Dismissing..." : "Dismiss"}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes and Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Notes & Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Notes */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">Notes</label>
                    {!isEditing && !notesState.isEditing && canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={startEditingNotes}
                        className="h-8 px-2"
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                  </div>
                  {isEditing ? (
                    <Textarea
                      value={editData.notes}
                      onChange={(e) => setEditData(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Add notes about this member..."
                      rows={4}
                    />
                  ) : notesState.isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={notesState.value}
                        onChange={(e) => setNotesState(prev => ({ ...prev, value: e.target.value }))}
                        placeholder="Add notes about this member..."
                        rows={4}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={saveNotes}
                          disabled={updateNotesMutation.isPending}
                        >
                          <Save className="h-3 w-3 mr-1" />
                          {updateNotesMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={cancelEditingNotes}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground min-h-[100px] p-2 border rounded whitespace-pre-wrap">
                      {memberData.notes ?? 'No notes'}
                    </p>
                  )}
                </div>

                {/* Quick Actions */}
                {!isEditing && (
                  <div className="space-y-3">
                    <Separator />
                    <div>
                      <h4 className="text-sm font-medium mb-3">Quick Actions</h4>
                      
                      <div className="grid gap-2">
                        {canPromote && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="justify-start"
                            disabled={promoteMutation.isPending}
                            onClick={() => {
                              if (!memberData.rankId) {
                                // Member has no rank, promote to lowest rank
                                const lowestRank = departmentInfo?.ranks
                                  ?.sort((a, b) => a.level - b.level)[0]; // Get lowest level rank
                                
                                if (lowestRank) {
                                  handlePromote(lowestRank.id, 'Initial rank assignment');
                                } else {
                                  toast.error("No ranks available in this department");
                                }
                                return;
                              }

                              const currentRankLevel = memberData.rankLevel ?? 0;
                              // Sort ranks by level and find the next higher rank
                              const higherRanks = departmentInfo?.ranks
                                ?.filter(rank => rank.level > currentRankLevel)
                                ?.sort((a, b) => a.level - b.level); // Sort ascending to get lowest higher rank first
                              
                              if (higherRanks && higherRanks.length > 0) {
                                const nextRank = higherRanks[0]; // Get the next rank (lowest higher rank)
                                if (nextRank) {
                                  handlePromote(nextRank.id, 'Quick promotion');
                                }
                              } else {
                                toast.info("No higher rank available for promotion");
                              }
                            }}
                          >
                            <TrendingUp className="h-4 w-4 mr-2" />
                            {promoteMutation.isPending ? "Promoting..." : (memberData.rankId ? "Promote" : "Assign Rank")}
                          </Button>
                        )}

                        {canDemote && memberData.rankId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="justify-start"
                            disabled={demoteMutation.isPending}
                            onClick={() => {
                              const currentRankLevel = memberData.rankLevel ?? 0;
                              // Sort ranks by level and find the next lower rank
                              const lowerRanks = departmentInfo?.ranks
                                ?.filter(rank => rank.level < currentRankLevel)
                                ?.sort((a, b) => b.level - a.level); // Sort descending to get highest lower rank first
                              
                              if (lowerRanks && lowerRanks.length > 0) {
                                const prevRank = lowerRanks[0]; // Get the previous rank (highest lower rank)
                                if (prevRank) {
                                  handleDemote(prevRank.id, 'Quick demotion');
                                }
                              } else {
                                toast.info("No lower rank available for demotion");
                              }
                            }}
                          >
                            <TrendingDown className="h-4 w-4 mr-2" />
                            {demoteMutation.isPending ? "Demoting..." : "Demote"}
                          </Button>
                        )}

                        {canDemote && memberData.rankId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="justify-start text-gray-600 hover:text-gray-700"
                            disabled={updateMemberMutation.isPending}
                            onClick={() => {
                              updateMemberMutation.mutate({
                                id: memberId,
                                rankId: null,
                              });
                              toast.success("Rank removed from member");
                            }}
                          >
                            <UserX className="h-4 w-4 mr-2" />
                            Remove Rank
                          </Button>
                        )}

                        {canDiscipline && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="justify-start text-orange-600 hover:text-orange-700"
                              onClick={() => openDisciplineDialog('warn')}
                              disabled={disciplineIssueMutation.isPending || updateMemberMutation.isPending}
                            >
                              <AlertTriangle className="h-4 w-4 mr-2" />
                              {disciplineIssueMutation.isPending || updateMemberMutation.isPending ? "Processing..." : "Issue Warning"}
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              className="justify-start text-red-600 hover:text-red-700"
                              onClick={() => openDisciplineDialog('suspend')}
                              disabled={disciplineIssueMutation.isPending || updateMemberMutation.isPending}
                            >
                              <Ban className="h-4 w-4 mr-2" />
                              {disciplineIssueMutation.isPending || updateMemberMutation.isPending ? "Processing..." : "Suspend"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Back to Management */}
        <div className="flex justify-center">
          <Link href={`/dashboard/departments/${departmentId}/management`}>
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              Back to Management
            </Button>
          </Link>
        </div>

        {/* Discipline Action Dialog */}
        <Dialog open={disciplineAction.isOpen} onOpenChange={closeDisciplineDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {disciplineAction.type === 'warn' ? 'Issue Warning' : 'Suspend Member'}
              </DialogTitle>
              <DialogDescription>
                {disciplineAction.type === 'warn' 
                  ? `Issue a warning to ${memberData?.roleplayName ?? 'this member'}. This action will be recorded in their disciplinary history.`
                  : `Suspend ${memberData?.roleplayName ?? 'this member'} from active duty. This action will be recorded in their disciplinary history and will expire in 30 days.`
                }
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Reason</label>
                <Textarea
                  value={disciplineAction.reason}
                  onChange={(e) => setDisciplineAction(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder={`Enter reason for ${disciplineAction.type === 'warn' ? 'warning' : 'suspension'}...`}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeDisciplineDialog}>
                Cancel
              </Button>
              <Button
                onClick={confirmDisciplineAction}
                disabled={disciplineIssueMutation.isPending || updateMemberMutation.isPending}
                variant={disciplineAction.type === 'warn' ? 'default' : 'destructive'}
              >
                {disciplineIssueMutation.isPending || updateMemberMutation.isPending ? (
                  "Processing..."
                ) : (
                  `Issue ${disciplineAction.type === 'warn' ? 'Warning' : 'Suspension'}`
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
} 