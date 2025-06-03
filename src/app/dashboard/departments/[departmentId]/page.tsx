"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  Clock, 
  Building,
  Shield,
  Flame,
  Settings,
  Calendar,
  MapPin,
  TrendingUp,
  Eye,
  Edit,
  User,
  Users,
  UserCog
} from "lucide-react";
import { api } from "@/trpc/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// Define types that match the actual API responses
type DepartmentRank = {
  id: number;
  name: string;
  level: number;
  memberCount?: number;
};

type DepartmentTeam = {
  id: number;
  name: string;
  description: string | null;
  memberCount?: number;
};

type ExistingMembership = {
  status: string;
  rankName: string | null;
};

type DepartmentInfo = {
  id: number;
  name: string;
  type: string;
  description: string | null;
  callsignPrefix: string;
  isActive: boolean;
  ranks: DepartmentRank[];
  teams: DepartmentTeam[];
  existingMembership?: ExistingMembership | null;
};

export default function DepartmentDetailPage() {
  const params = useParams();
  const departmentId = Number(params.departmentId);
  const [isRoleplayNameDialogOpen, setIsRoleplayNameDialogOpen] = useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [roleplayName, setRoleplayName] = useState("");
  const [joinRoleplayName, setJoinRoleplayName] = useState("");
  const [joinNotes, setJoinNotes] = useState("");

  // Get department information from discovery router
  const { data: departmentInfo, isLoading: deptLoading, error: deptError } = api.dept.discovery.getDepartmentInfo.useQuery(
    { departmentId },
    { enabled: !!departmentId }
  );

  // Get user's own membership
  const { data: memberships } = api.dept.discovery.getMyMemberships.useQuery();
  const userMembership = memberships?.find(m => m.departmentId === departmentId);

  // Fetch department stats for accurate member count
  const { data: stats } = api.dept.user.info.getDepartmentStats.useQuery({ departmentId });

  // Check permissions for navigation
  const { data: canViewRoster } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'view_all_members'
  }, { enabled: !!userMembership?.isActive });

  // Get both permissions
  const { data: canManageMembers } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_members'
  });

  const { data: canRecruitMembers } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'recruit_members'
  });

  // Join department mutation
  const joinDepartmentMutation = api.dept.discovery.joinDepartment.useMutation({
    onSuccess: () => {
      toast.success("Successfully joined department! You are now in training status.");
      setIsJoinDialogOpen(false);
      setJoinRoleplayName("");
      setJoinNotes("");
      // Refresh data
      void api.useUtils().dept.discovery.getMyMemberships.invalidate();
      void api.useUtils().dept.discovery.getDepartmentInfo.invalidate();
    },
    onError: (error) => {
      toast.error(error.message ?? "Failed to join department");
    },
  });

  // Update roleplay name mutation
  const updateRoleplayNameMutation = api.dept.user.info.updateMyRoleplayName.useMutation({
    onSuccess: () => {
      toast.success("Roleplay name updated successfully!");
      setIsRoleplayNameDialogOpen(false);
      setRoleplayName("");
      // Refresh memberships to get updated data
      void api.useUtils().dept.discovery.getMyMemberships.invalidate();
    },
    onError: (error) => {
      toast.error(error.message ?? "Failed to update roleplay name");
    },
  });

  const handleJoinDepartment = () => {
    joinDepartmentMutation.mutate({
      departmentId,
      roleplayName: joinRoleplayName.trim() || undefined,
      notes: joinNotes.trim() || undefined,
    });
  };

  const handleUpdateRoleplayName = () => {
    if (!roleplayName.trim()) {
      toast.error("Please enter a roleplay name");
      return;
    }

    updateRoleplayNameMutation.mutate({
      departmentId,
      roleplayName: roleplayName.trim(),
    });
  };

  const getDepartmentIcon = (type: string) => {
    switch (type) {
      case 'law_enforcement':
        return <Shield className="h-6 w-6 text-blue-600" />;
      case 'fire_department':
        return <Flame className="h-6 w-6 text-red-600" />;
      case 'staff_team':
        return <Settings className="h-6 w-6 text-purple-600" />;
      default:
        return <Building className="h-6 w-6 text-gray-600" />;
    }
  };

  const getDepartmentTypeLabel = (type: string) => {
    switch (type) {
      case 'law_enforcement':
        return 'Law Enforcement';
      case 'fire_department':
        return 'Fire Department';
      case 'staff_team':
        return 'Staff Team';
      default:
        return type;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'in_training':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'pending':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'inactive':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'suspended':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatStatus = (status: string) => {
    return status.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  if (deptLoading) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10" />
            <div>
              <Skeleton className="h-8 w-64 mb-2" />
              <Skeleton className="h-4 w-96" />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (deptError || !departmentInfo) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/dashboard/departments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Department Details</h1>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertDescription>
            {deptError?.message ?? "Failed to load department information. You may not have access to this department."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Type the departmentInfo properly
  const typedDepartmentInfo = departmentInfo as DepartmentInfo;

  return (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/dashboard/departments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            {getDepartmentIcon(typedDepartmentInfo.type ?? '')}
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{typedDepartmentInfo.name}</h1>
              <p className="text-muted-foreground mt-1">
                {getDepartmentTypeLabel(typedDepartmentInfo.type ?? '')} • {typedDepartmentInfo.callsignPrefix}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Department Overview */}
            <Card>
              <CardHeader>
                <CardTitle>Department Overview</CardTitle>
                <CardDescription>
                  Learn more about this department
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {typedDepartmentInfo.description ? (
                  <p className="text-sm leading-relaxed">{typedDepartmentInfo.description}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No description available for this department.
                  </p>
                )}
                
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span>Type: {getDepartmentTypeLabel(typedDepartmentInfo.type ?? '')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>Prefix: {typedDepartmentInfo.callsignPrefix}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Department Structure */}
            <Card>
              <CardHeader>
                <CardTitle>Department Structure</CardTitle>
                <CardDescription>
                  Ranks and teams in this department
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Ranks */}
                <div>
                  <h4 className="font-medium mb-3">Ranks</h4>
                  <div className="space-y-2">
                    {typedDepartmentInfo.ranks && Array.isArray(typedDepartmentInfo.ranks) ? 
                      typedDepartmentInfo.ranks
                        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
                        .map((rank) => (
                          <div key={rank.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{rank.name}</span>
                              <Badge variant="outline" className="text-xs">
                                Level {rank.level ?? 0}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {rank.memberCount ?? 0} members
                            </div>
                          </div>
                        )) : (
                          <p className="text-sm text-muted-foreground">No ranks available</p>
                        )}
                  </div>
                </div>

                {/* Teams */}
                {typedDepartmentInfo.teams && Array.isArray(typedDepartmentInfo.teams) && typedDepartmentInfo.teams.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3">Teams</h4>
                    <div className="space-y-2">
                      {typedDepartmentInfo.teams.map((team) => (
                        <div key={team.id} className="p-3 bg-muted rounded-lg">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{team.name}</span>
                            <div className="text-sm text-muted-foreground">
                              {team.memberCount ?? 0} members
                            </div>
                          </div>
                          {team.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {team.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Your Membership Status */}
            {userMembership ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your Membership</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Callsign:</span>
                      <span className="font-medium">{userMembership.callsign}</span>
                    </div>
                    
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">RP Name:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {userMembership.roleplayName ?? "Not set"}
                        </span>
                        <Dialog open={isRoleplayNameDialogOpen} onOpenChange={setIsRoleplayNameDialogOpen}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => setRoleplayName(userMembership.roleplayName ?? "")}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                              <DialogTitle>Update Roleplay Name</DialogTitle>
                              <DialogDescription>
                                Set your character name for this department. This is how you&apos;ll be identified in roleplay scenarios.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                              <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="roleplay-name" className="text-right">
                                  Name
                                </Label>
                                <Input
                                  id="roleplay-name"
                                  value={roleplayName}
                                  onChange={(e) => setRoleplayName(e.target.value)}
                                  className="col-span-3"
                                  placeholder="Enter your roleplay character name"
                                  maxLength={100}
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button 
                                variant="outline" 
                                onClick={() => setIsRoleplayNameDialogOpen(false)}
                              >
                                Cancel
                              </Button>
                              <Button 
                                onClick={handleUpdateRoleplayName}
                                disabled={updateRoleplayNameMutation.isPending}
                              >
                                {updateRoleplayNameMutation.isPending ? "Updating..." : "Update"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge 
                        variant="outline"
                        className={getStatusColor(userMembership.status)}
                      >
                        {formatStatus(userMembership.status)}
                      </Badge>
                    </div>
                    
                    {userMembership.rankName && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Rank:</span>
                        <span className="font-medium">
                          {userMembership.rankName}
                          {userMembership.rankLevel && (
                            <span className="text-muted-foreground ml-1">
                              (Level {userMembership.rankLevel})
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    
                    {userMembership.teamName && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Team:</span>
                        <span className="font-medium">{userMembership.teamName}</span>
                      </div>
                    )}
                    
                    {userMembership.hireDate && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Joined:</span>
                        <span className="font-medium">
                          {new Date(userMembership.hireDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : typedDepartmentInfo.existingMembership ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your Application</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge 
                        variant="outline"
                        className={getStatusColor(typedDepartmentInfo.existingMembership.status)}
                      >
                        {formatStatus(typedDepartmentInfo.existingMembership.status)}
                      </Badge>
                    </div>
                    {typedDepartmentInfo.existingMembership.rankName && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Rank:</span>
                        <span className="font-medium">{typedDepartmentInfo.existingMembership.rankName}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {userMembership?.isActive && userMembership.status === 'active' ? (
                  <>
                    <Link href="/dashboard/departments/time-tracking">
                      <Button variant="outline" size="sm" className="w-full justify-start">
                        <Clock className="h-4 w-4 mr-2" />
                        Time Tracking
                      </Button>
                    </Link>
                    
                    <Link href="/dashboard/departments/schedule">
                      <Button variant="outline" size="sm" className="w-full justify-start">
                        <Calendar className="h-4 w-4 mr-2" />
                        Schedule
                      </Button>
                    </Link>
                    
                    <Link href="/dashboard/departments/performance">
                      <Button variant="outline" size="sm" className="w-full justify-start">
                        <TrendingUp className="h-4 w-4 mr-2" />
                        Performance
                      </Button>
                    </Link>
                    
                    {/* Department Navigation */}
                    {canViewRoster?.hasPermission && (
                      <Link href={`/dashboard/departments/${departmentId}/roster`}>
                        <Button variant="outline" size="sm" className="w-full justify-start">
                          <Users className="h-4 w-4 mr-2" />
                          Department Roster
                        </Button>
                      </Link>
                    )}
                    
                    {(canManageMembers?.hasPermission ?? canRecruitMembers?.hasPermission) && (
                      <Link href={`/dashboard/departments/${departmentId}/management`}>
                        <Button variant="outline" size="sm" className="w-full justify-start">
                          <UserCog className="h-4 w-4 mr-2" />
                          Training Management
                        </Button>
                      </Link>
                    )}
                  </>
                ) : userMembership?.isActive ? (
                  <>
                    {/* Show navigation options for active users with limited other actions */}
                    {canViewRoster?.hasPermission && (
                      <Link href={`/dashboard/departments/${departmentId}/roster`}>
                        <Button variant="outline" size="sm" className="w-full justify-start">
                          <Users className="h-4 w-4 mr-2" />
                          Department Roster
                        </Button>
                      </Link>
                    )}
                    
                    {(canManageMembers?.hasPermission ?? canRecruitMembers?.hasPermission) && (
                      <Link href={`/dashboard/departments/${departmentId}/management`}>
                        <Button variant="outline" size="sm" className="w-full justify-start">
                          <UserCog className="h-4 w-4 mr-2" />
                          Training Management
                        </Button>
                      </Link>
                    )}
                    
                    {!canViewRoster?.hasPermission && !(canManageMembers?.hasPermission ?? canRecruitMembers?.hasPermission) && (
                      <div className="text-center py-4 text-muted-foreground">
                        <p className="text-sm">
                          Contact department leadership for more options
                        </p>
                      </div>
                    )}
                  </>
                ) : !userMembership && !typedDepartmentInfo.existingMembership ? (
                  <Dialog open={isJoinDialogOpen} onOpenChange={setIsJoinDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="w-full justify-start">
                        <User className="h-4 w-4 mr-2" />
                        Join Department
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle>Join {typedDepartmentInfo.name}</DialogTitle>
                        <DialogDescription>
                          Apply to join this department. You&apos;ll start in training status and need to complete training before becoming active.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="join-roleplay-name">
                            Roleplay Character Name (Optional)
                          </Label>
                          <Input
                            id="join-roleplay-name"
                            value={joinRoleplayName}
                            onChange={(e) => setJoinRoleplayName(e.target.value)}
                            placeholder="Enter your character name for this department"
                            maxLength={100}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="join-notes">
                            Additional Notes (Optional)
                          </Label>
                          <Textarea
                            id="join-notes"
                            value={joinNotes}
                            onChange={(e) => setJoinNotes(e.target.value)}
                            placeholder="Any additional information or questions"
                            maxLength={500}
                            rows={3}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          variant="outline" 
                          onClick={() => setIsJoinDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button 
                          onClick={handleJoinDepartment}
                          disabled={joinDepartmentMutation.isPending}
                        >
                          {joinDepartmentMutation.isPending ? "Joining..." : "Join Department"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <p className="text-sm">
                      {typedDepartmentInfo.existingMembership ? 
                        "Your application is being processed" : 
                        "Contact department leadership for more information"
                      }
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Department Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Department Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Ranks:</span>
                  <span className="font-medium">{typedDepartmentInfo.ranks?.length ?? 0}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Teams:</span>
                  <span className="font-medium">{typedDepartmentInfo.teams?.length ?? 0}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Members:</span>
                  <span className="font-medium">
                    {stats?.totalMembers ?? 0}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
} 