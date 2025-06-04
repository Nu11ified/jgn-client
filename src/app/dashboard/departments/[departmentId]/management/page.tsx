"use client";

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { 
  ArrowLeft, 
  Users,
  UserCheck,
  UserX,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  GraduationCap,
  Settings,
  Edit,
  Calendar,
  Plus,
  MapPin,
  Video,
  Shield,
  Loader2,
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatLocalDateTime, formatLocalDate, formatDuration, localToUTC, utcToLocal, getCurrentLocalDateTime } from "@/lib/utils/date";
import { TRPCError } from "@trpc/server";

type MemberStatus = "in_training" | "pending" | "active" | "inactive" | "leave_of_absence" | "warned_1" | "warned_2" | "warned_3" | "suspended" | "blacklisted";

// Meeting form schema
const createMeetingSchema = z.object({
  title: z.string().min(1, "Meeting title is required").max(256),
  description: z.string().optional(),
  scheduledAt: z.string().min(1, "Date and time is required"),
  location: z.string().optional(),
  duration: z.number().min(1, "Duration must be at least 1 minute"),
  isMandatory: z.boolean(),
  teamId: z.number().optional(),
  discordChannelId: z.string().optional(),
  requiredRankLevel: z.number().optional(),
});

type CreateMeetingFormData = z.infer<typeof createMeetingSchema>;

export default function TrainingManagementPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);

  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [isCreateMeetingOpen, setIsCreateMeetingOpen] = useState(false);
  const [viewPastMeetings, setViewPastMeetings] = useState(false);

  // Get department info
  const { data: departmentInfo } = api.dept.user.info.getDepartment.useQuery({ departmentId });

  // Get user permissions for editing
  const { data: canManageMembers } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_members'
  });

  const { data: canRecruitMembers } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'recruit_members'
  });

  const { data: canScheduleMeetings } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'schedule_meetings'
  });

  const { data: canManageMeetings } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_meetings'
  });

  // Get meetings data
  const { data: meetings, isLoading: meetingsLoading, refetch: refetchMeetings } = api.dept.user.meetings.list.useQuery({
    departmentId,
    includePast: viewPastMeetings,
    limit: 20,
  });

  // Get teams for meeting creation
  const { data: departmentData } = api.dept.user.info.getDepartment.useQuery({ 
    departmentId
  });

  // Extract teams and ranks from department data
  const teams = departmentData?.teams;
  const ranks = departmentData?.ranks;

  // Get training management data
  const { data: trainingData, isLoading, error, refetch } = api.dept.user.info.getTrainingManagement.useQuery({
    departmentId,
    includeCompleted,
  });

  // Get department stats
  const { data: stats } = api.dept.user.info.getDepartmentStats.useQuery({ departmentId });

  // Error handlers
  const handleError = (error: unknown, message: string) => {
    console.error(message, error);
    toast.error(message);
  };

  // Meeting form
  const meetingForm = useForm<CreateMeetingFormData>({
    resolver: zodResolver(createMeetingSchema),
    defaultValues: {
      duration: 60,
      isMandatory: false,
    },
  });

  // Create meeting mutation
  const createMeetingMutation = api.dept.user.meetings.create.useMutation({
    onSuccess: () => {
      toast.success("Meeting scheduled successfully");
      meetingForm.reset();
      setIsCreateMeetingOpen(false);
      void refetchMeetings();
    },
    onError: (error) => {
      toast.error(`Failed to create meeting: ${error.message}`);
    },
  });

  // Bypass training mutation
  const bypassTrainingMutation = api.dept.admin.memberManagement.bypassTraining.useMutation({
    onSuccess: () => {
      toast.success("Training bypassed successfully. Member moved to pending assignment.");
      void refetch(); // Refetch training data to update the UI
    },
    onError: (error) => {
      toast.error(`Failed to bypass training: ${error.message}`);
    },
  });

  // Assign team mutation
  const assignTeamMutation = api.dept.admin.memberManagement.assignTeam.useMutation({
    onSuccess: () => {
      toast.success("Team assigned successfully. Member is now active.");
      void refetch(); // Refetch training data to update the UI
      setIsAssignTeamDialogOpen(false);
      setSelectedMemberForTeam(null);
    },
    onError: (error) => {
      toast.error(`Failed to assign team: ${error.message}`);
    },
  });

  // State for team assignment dialog
  const [isAssignTeamDialogOpen, setIsAssignTeamDialogOpen] = useState(false);
  const [selectedMemberForTeam, setSelectedMemberForTeam] = useState<{id: number, name: string} | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  const handleCreateMeeting = (data: CreateMeetingFormData) => {
    // Convert local datetime to UTC before sending to server
    createMeetingMutation.mutate({
      ...data,
      departmentId,
      scheduledAt: new Date(localToUTC(data.scheduledAt)),
    });
  };

  const handleBypassTraining = (memberId: number, memberName: string) => {
    const confirmed = confirm(
      `Skip training for "${memberName}"?\n\n` +
      `This will move them directly to "Pending Assignment" status ` +
      `where they can be assigned to a team.\n\n` +
      `Are you sure you want to bypass their training?`
    );
    
    if (confirmed) {
      bypassTrainingMutation.mutate({ memberId });
    }
  };

  const handleAssignTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberForTeam || !selectedTeamId) {
      toast.error("Please select a team");
      return;
    }

    const teamName = teams?.find(t => t.id.toString() === selectedTeamId)?.name ?? "Selected Team";
    const confirmed = confirm(
      `Assign "${selectedMemberForTeam.name}" to "${teamName}"?\n\n` +
      `This will:\n` +
      `• Move them from "Pending Assignment" to "Active" status\n` +
      `• Set their primary team to "${teamName}"\n` +
      `• Grant them team access and Discord roles\n\n` +
      `Are you sure?`
    );

    if (confirmed) {
      assignTeamMutation.mutate({ 
        memberId: selectedMemberForTeam.id, 
        teamId: parseInt(selectedTeamId) 
      });
    }
  };

  const formatDateTime = (date: Date | string) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDuration = (minutes: number | null) => {
    if (!minutes) return 'Unknown';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  const getStatusColor = (status: MemberStatus) => {
    switch (status) {
      case "in_training":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "pending":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatStatus = (status: MemberStatus) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-4">
              You don&apos;t have permission to manage training workflow.
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
              <h1 className="text-3xl font-bold">Department Management</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Manage meetings and training workflow
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
                  <UserX className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium">Pending Assignment</p>
                    <p className="text-2xl font-bold">{stats.pendingMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <UserCheck className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium">Active Members</p>
                    <p className="text-2xl font-bold">{stats.activeMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5 text-gray-500" />
                  <div>
                    <p className="text-sm font-medium">Total Members</p>
                    <p className="text-2xl font-bold">{stats.totalMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Meeting Management Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                <CardTitle>Meeting Management</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="view-past-meetings"
                    checked={viewPastMeetings}
                    onCheckedChange={setViewPastMeetings}
                  />
                  <Label htmlFor="view-past-meetings" className="text-sm">
                    Include past meetings
                  </Label>
                </div>
                {canScheduleMeetings?.hasPermission && (
                  <Dialog open={isCreateMeetingOpen} onOpenChange={setIsCreateMeetingOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Schedule Meeting
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Schedule New Meeting</DialogTitle>
                        <DialogDescription>
                          Create a new meeting for your department or team.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={meetingForm.handleSubmit(handleCreateMeeting)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="col-span-2">
                            <Label htmlFor="title">Meeting Title *</Label>
                            <Input
                              id="title"
                              {...meetingForm.register("title")}
                              placeholder="e.g., Weekly Briefing"
                            />
                            {meetingForm.formState.errors.title && (
                              <p className="text-sm text-destructive mt-1">
                                {meetingForm.formState.errors.title.message}
                              </p>
                            )}
                          </div>

                          <div className="col-span-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                              id="description"
                              {...meetingForm.register("description")}
                              placeholder="Meeting agenda or details..."
                              rows={3}
                            />
                          </div>

                          <div>
                            <Label htmlFor="scheduledAt">Date & Time *</Label>
                            <Input
                              id="scheduledAt"
                              type="datetime-local"
                              {...meetingForm.register("scheduledAt")}
                              min={getCurrentLocalDateTime()}
                            />
                            <p className="text-sm text-muted-foreground mt-1">
                              Times are shown in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                            </p>
                            {meetingForm.formState.errors.scheduledAt && (
                              <p className="text-sm text-destructive mt-1">
                                {meetingForm.formState.errors.scheduledAt.message}
                              </p>
                            )}
                          </div>

                          <div>
                            <Label htmlFor="duration">Duration (minutes)</Label>
                            <Input
                              id="duration"
                              type="number"
                              min="1"
                              {...meetingForm.register("duration", { valueAsNumber: true })}
                              placeholder="60"
                            />
                          </div>

                          <div>
                            <Label htmlFor="location">Location</Label>
                            <Input
                              id="location"
                              {...meetingForm.register("location")}
                              placeholder="e.g., Conference Room A, Discord Voice"
                            />
                          </div>

                          <div>
                            <Label htmlFor="discordChannelId">Discord Channel ID</Label>
                            <Input
                              id="discordChannelId"
                              {...meetingForm.register("discordChannelId")}
                              placeholder="Optional Discord channel ID"
                            />
                          </div>

                          <div>
                            <Label htmlFor="teamId">Team (Optional)</Label>
                            <Select 
                              value={meetingForm.watch("teamId")?.toString() ?? "all"} 
                              onValueChange={(value) => 
                                meetingForm.setValue("teamId", value !== "all" ? parseInt(value) : undefined)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="All department (no team)" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All department</SelectItem>
                                {teams?.map((team) => (
                                  <SelectItem key={team.id} value={team.id.toString()}>
                                    {team.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label htmlFor="requiredRankLevel">Minimum Rank Level</Label>
                            <Select 
                              value={meetingForm.watch("requiredRankLevel")?.toString() ?? "all"} 
                              onValueChange={(value) => 
                                meetingForm.setValue("requiredRankLevel", value !== "all" ? parseInt(value) : undefined)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="All ranks" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All ranks</SelectItem>
                                {ranks?.map((rank) => (
                                  <SelectItem key={rank.id} value={rank.level.toString()}>
                                    Level {rank.level}+ ({rank.name})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="col-span-2 flex items-center space-x-2">
                            <Switch
                              id="isMandatory"
                              checked={meetingForm.watch("isMandatory")}
                              onCheckedChange={(checked) => meetingForm.setValue("isMandatory", checked)}
                            />
                            <Label htmlFor="isMandatory">Mandatory attendance</Label>
                          </div>
                        </div>

                        <DialogFooter>
                          <Button 
                            type="button" 
                            variant="outline" 
                            onClick={() => setIsCreateMeetingOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button 
                            type="submit" 
                            disabled={createMeetingMutation.isPending}
                          >
                            {createMeetingMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Scheduling...
                              </>
                            ) : (
                              "Schedule Meeting"
                            )}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
            <CardDescription>
              {canScheduleMeetings?.hasPermission 
                ? "Schedule and manage department meetings" 
                : "View department meetings"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {meetingsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : meetings && meetings.length > 0 ? (
              <div className="space-y-4">
                {meetings.map((meeting) => (
                  <div key={meeting.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-medium">{meeting.title}</h4>
                        {meeting.isMandatory && (
                          <Badge variant="destructive">Mandatory</Badge>
                        )}
                        {meeting.teamName && (
                          <Badge variant="secondary">{meeting.teamName}</Badge>
                        )}
                        <Badge variant={meeting.status === 'scheduled' ? 'default' : 'outline'}>
                          {meeting.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{formatLocalDateTime(meeting.scheduledAt)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>{formatDuration(meeting.duration)}</span>
                          </div>
                          {meeting.location && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              <span>{meeting.location}</span>
                            </div>
                          )}
                        </div>
                        {meeting.description && (
                          <p className="text-muted-foreground">{meeting.description}</p>
                        )}
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4" />
                          <span>{typeof meeting.attendeeCount === 'number' ? meeting.attendeeCount : 0} attendees</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {(canManageMeetings?.hasPermission ?? (meeting.organizedBy === String(/* user's discord id would be here */))) && (
                        <Button variant="outline" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Meetings Scheduled</h3>
                <p className="text-muted-foreground mb-4">
                  {canScheduleMeetings?.hasPermission 
                    ? "Schedule your first meeting to get started." 
                    : "No meetings are currently scheduled."
                  }
                </p>
                {canScheduleMeetings?.hasPermission && (
                  <Button onClick={() => setIsCreateMeetingOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Schedule Meeting
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        {/* Training Management Section */}
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold mb-2">Training Management</h2>
            <p className="text-muted-foreground">
              Manage new recruits and training workflow
            </p>
          </div>

        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              View Options
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="include-completed"
                checked={includeCompleted}
                onChange={(e) => setIncludeCompleted(e.target.checked)}
                className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <label htmlFor="include-completed" className="text-sm font-medium cursor-pointer">
                Include recently activated members
              </label>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, i: number) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-64" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Array.from({ length: 3 }, (_, j: number) => (
                      <Skeleton key={j} className="h-16 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* In Training Members */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  In Training ({trainingData?.members.in_training?.length ?? 0})
                </CardTitle>
                <CardDescription>
                  New recruits currently undergoing training
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trainingData?.members.in_training?.length === 0 ? (
                  <div className="text-center py-8">
                    <GraduationCap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Members in Training</h3>
                    <p className="text-muted-foreground">
                      All new recruits have completed their training.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {trainingData?.members.in_training?.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center space-x-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium">
                                {member.roleplayName ?? 'No Name'}
                              </h4>
                              <Badge className={getStatusColor(member.status)}>
                                {formatStatus(member.status)}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <p>Discord: {member.discordId}</p>
                              <p>Callsign: {member.callsign ?? 'Not assigned'}</p>
                              <p>Hired: {member.hireDate ? formatLocalDate(member.hireDate) : 'Unknown'}</p>
                              {member.notes && (
                                <p>Notes: {member.notes}</p>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {(canManageMembers?.hasPermission ?? canRecruitMembers?.hasPermission) && (
                            <Link href={`/dashboard/departments/${departmentId}/members/${member.id}`}>
                              <Button variant="outline" size="sm">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                          {trainingData?.canBypassTraining && (
                            <Button
                              variant="outline"
                              size="sm"
                                onClick={() => handleBypassTraining(member.id, member.roleplayName ?? 'No Name')}
                                disabled={bypassTrainingMutation.isPending}
                              >
                                {bypassTrainingMutation.isPending ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Processing...
                                  </>
                                ) : (
                                  <>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Skip Training
                                  </>
                                )}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pending Assignment Members */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserX className="h-5 w-5 text-blue-500" />
                  Pending Assignment ({trainingData?.members.pending?.length ?? 0})
                </CardTitle>
                <CardDescription>
                  Members who completed training and need team assignment
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trainingData?.members.pending?.length === 0 ? (
                  <div className="text-center py-8">
                    <UserCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Pending Assignments</h3>
                    <p className="text-muted-foreground">
                      All members have been assigned to teams.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {trainingData?.members.pending?.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center space-x-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium">
                                {member.roleplayName ?? 'No Name'}
                              </h4>
                              <Badge className={getStatusColor(member.status)}>
                                {formatStatus(member.status)}
                              </Badge>
                              {member.rankName && (
                                <Badge variant="outline">
                                  {member.rankName} (Lvl {member.rankLevel})
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <p>Discord: {member.discordId}</p>
                              <p>Callsign: {member.callsign ?? 'Not assigned'}</p>
                              <p>Hired: {member.hireDate ? formatLocalDate(member.hireDate) : 'Unknown'}</p>
                              <p>Last Active: {member.lastActiveDate ? formatLocalDate(member.lastActiveDate) : 'Unknown'}</p>
                              {member.notes && (
                                <p>Notes: {member.notes}</p>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {(canManageMembers?.hasPermission ?? canRecruitMembers?.hasPermission) && (
                            <Link href={`/dashboard/departments/${departmentId}/members/${member.id}`}>
                              <Button variant="outline" size="sm">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                          {trainingData?.canAssignTeams && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                  setIsAssignTeamDialogOpen(true);
                                  setSelectedMemberForTeam({id: member.id, name: member.roleplayName ?? 'No Name'});
                                }}
                                disabled={assignTeamMutation.isPending}
                              >
                                {assignTeamMutation.isPending ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Assigning...
                                  </>
                                ) : (
                                  <>
                              <UserCheck className="h-4 w-4 mr-2" />
                              Assign Team
                                  </>
                                )}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recently Activated Members (if included) */}
            {includeCompleted && trainingData?.members.active && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-green-500" />
                    Recently Activated ({trainingData.members.active.length})
                  </CardTitle>
                  <CardDescription>
                    Members who were recently assigned and activated
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {trainingData.members.active.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">
                        No recently activated members.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {trainingData.members.active.map((member) => (
                        <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                          <div className="flex items-center space-x-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium">
                                  {member.roleplayName ?? 'No Name'}
                                </h4>
                                <Badge className={getStatusColor(member.status)}>
                                  {formatStatus(member.status)}
                                </Badge>
                                {member.rankName && (
                                  <Badge variant="outline">
                                    {member.rankName} (Lvl {member.rankLevel})
                                  </Badge>
                                )}
                                {member.teamName && (
                                  <Badge variant="secondary">
                                    {member.teamName}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground space-y-1">
                                <p>Discord: {member.discordId}</p>
                                <p>Callsign: {member.callsign ?? 'Not assigned'}</p>
                                <p>Hired: {member.hireDate ? formatLocalDate(member.hireDate) : 'Unknown'}</p>
                                <p>Last Active: {member.lastActiveDate ? formatLocalDate(member.lastActiveDate) : 'Unknown'}</p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            {(canManageMembers?.hasPermission ?? canRecruitMembers?.hasPermission) && (
                              <Link href={`/dashboard/departments/${departmentId}/members/${member.id}`}>
                                <Button variant="outline" size="sm">
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </Link>
                            )}
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Common management tasks and links
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Link href={`/dashboard/departments/${departmentId}/roster`}>
                <Button variant="outline" className="w-full justify-start">
                  <Users className="h-4 w-4 mr-2" />
                  View Full Roster
                </Button>
              </Link>
              
              <Link href={`/dashboard/departments/${departmentId}`}>
                <Button variant="outline" className="w-full justify-start">
                  <Settings className="h-4 w-4 mr-2" />
                  Department Overview
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Assignment Dialog */}
      {isAssignTeamDialogOpen && selectedMemberForTeam && (
        <Dialog 
          open={isAssignTeamDialogOpen} 
          onOpenChange={(open) => {
            setIsAssignTeamDialogOpen(open);
            if (!open) {
              setSelectedMemberForTeam(null);
              setSelectedTeamId("");
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Assign Team to {selectedMemberForTeam.name}</DialogTitle>
              <DialogDescription>
                Select a team for {selectedMemberForTeam.name} to join. This will activate them and grant team access.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAssignTeam} className="space-y-4">
              <div>
                <Label htmlFor="teamId">Team *</Label>
                <Select 
                  value={selectedTeamId} 
                  onValueChange={(value) => setSelectedTeamId(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams?.map((team) => (
                      <SelectItem key={team.id} value={team.id.toString()}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setIsAssignTeamDialogOpen(false);
                    setSelectedMemberForTeam(null);
                    setSelectedTeamId("");
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={assignTeamMutation.isPending || !selectedTeamId}
                >
                  {assignTeamMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    "Assign Team"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
} 