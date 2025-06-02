"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  MapPin,
  Users,
  AlertCircle,
  CheckCircle,
  XCircle,
  User,
  CalendarDays
} from "lucide-react";
import { api } from "@/trpc/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { formatLocalDateTime, formatDuration } from "@/lib/utils/date";

// Update Meeting type to match actual API response
type Meeting = {
  id: number;
  title: string;
  description: string | null;
  scheduledAt: Date;
  location: string | null;
  duration: number | null;
  isMandatory: boolean;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  organizedBy: string;
  teamName: string | null;
  attendeeCount?: unknown;
  // Optional properties that may not always be present from API
  teamId?: number | null;
  departmentId?: number;
  departmentName?: string;
  requiredRankLevel?: number | null;
};

type DepartmentMembership = {
  id: number;
  departmentId: number;
  departmentName: string;
  departmentType: "law_enforcement" | "fire_department" | "staff_team" | null;
  callsign: string | null;
  status: "in_training" | "pending" | "active" | "inactive" | "leave_of_absence" | "warned_1" | "warned_2" | "warned_3" | "suspended" | "blacklisted";
  hireDate: Date | null;
  rankName: string | null;
  rankLevel: number | null;
  teamName: string | null;
  isActive: boolean;
};

export default function SchedulePage() {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [viewFilter, setViewFilter] = useState<"upcoming" | "past">("upcoming");

  // Get user's department memberships
  const { data: memberships, isLoading: membershipsLoading } = api.dept.discovery.getMyMemberships.useQuery();

  // Get meetings for selected department
  const { data: meetings, isLoading: meetingsLoading, refetch: refetchMeetings } = api.dept.user.meetings.list.useQuery(
    { 
      departmentId: selectedDepartmentId!,
      includePast: viewFilter === "past",
      limit: 20
    },
    { enabled: !!selectedDepartmentId }
  );

  // Filter active memberships
  const activeMemberships = memberships?.filter(
    (membership: DepartmentMembership) => 
      membership.isActive && membership.status === 'active'
  ) ?? [];

  const getTimeUntilMeeting = (scheduledAt: Date) => {
    const now = new Date();
    const meetingTime = new Date(scheduledAt);
    const diffMs = meetingTime.getTime() - now.getTime();
    
    if (diffMs < 0) return "Past";
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
      return `In ${diffDays} day${diffDays > 1 ? 's' : ''}`;
    } else if (diffHours > 0) {
      return `In ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
    } else {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return `In ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
    }
  };

  const getMeetingStatusColor = (meeting: Meeting) => {
    const now = new Date();
    const meetingTime = new Date(meeting.scheduledAt);
    const endTime = new Date(meetingTime.getTime() + (meeting.duration ?? 60) * 60 * 1000);
    
    if (meeting.status === 'cancelled') {
      return 'bg-red-100 text-red-800 border-red-200';
    } else if (meeting.status === 'completed') {
      return 'bg-gray-100 text-gray-800 border-gray-200';
    } else if (now >= meetingTime && now <= endTime) {
      return 'bg-green-100 text-green-800 border-green-200';
    } else if (now > endTime) {
      return 'bg-gray-100 text-gray-800 border-gray-200';
    } else {
      return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const getMeetingStatusLabel = (meeting: Meeting) => {
    const now = new Date();
    const meetingTime = new Date(meeting.scheduledAt);
    const endTime = new Date(meetingTime.getTime() + (meeting.duration ?? 60) * 60 * 1000);
    
    if (meeting.status === 'cancelled') {
      return 'Cancelled';
    } else if (meeting.status === 'completed') {
      return 'Completed';
    } else if (now >= meetingTime && now <= endTime) {
      return 'In Progress';
    } else if (now > endTime) {
      return 'Ended';
    } else {
      return 'Scheduled';
    }
  };

  const getMeetingIcon = (meeting: Meeting) => {
    const status = getMeetingStatusLabel(meeting);
    switch (status) {
      case 'Cancelled':
        return <XCircle className="h-4 w-4" />;
      case 'Completed':
        return <CheckCircle className="h-4 w-4" />;
      case 'In Progress':
        return <Clock className="h-4 w-4" />;
      default:
        return <Calendar className="h-4 w-4" />;
    }
  };

  if (membershipsLoading) {
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
          <div className="flex gap-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Card key={i}>
                <CardHeader>
                  <div className="flex justify-between">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
            <p className="text-muted-foreground mt-2">
              View upcoming meetings and events for your departments
            </p>
          </div>
        </div>

        {activeMemberships.length === 0 ? (
          <Card className="p-8 text-center">
            <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Active Departments</h3>
            <p className="text-muted-foreground mb-4">
              You need to be an active member of a department to view schedules.
            </p>
            <Link href="/dashboard/departments/browse">
              <Button>
                Browse Departments
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Department</label>
                <Select 
                  value={selectedDepartmentId?.toString() ?? ""} 
                  onValueChange={(value) => setSelectedDepartmentId(Number(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a department" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMemberships.map((membership: DepartmentMembership) => (
                      <SelectItem key={membership.departmentId} value={membership.departmentId.toString()}>
                        <div className="flex items-center gap-2">
                          <span>{membership.departmentName}</span>
                          <Badge variant="outline" className="text-xs">
                            {membership.callsign}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="sm:w-40">
                <label className="text-sm font-medium mb-2 block">View</label>
                <Select 
                  value={viewFilter} 
                  onValueChange={(value: "upcoming" | "past") => setViewFilter(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="past">Past</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Meetings List */}
            {!selectedDepartmentId ? (
              <Card className="p-8 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Select a Department</h3>
                <p className="text-muted-foreground">
                  Choose a department to view its schedule and upcoming meetings.
                </p>
              </Card>
            ) : meetingsLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }, (_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <div className="flex justify-between">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-6 w-20" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : !meetings || meetings.length === 0 ? (
              <Card className="p-8 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  No {viewFilter === "upcoming" ? "Upcoming" : "Past"} Meetings
                </h3>
                <p className="text-muted-foreground">
                  {viewFilter === "upcoming" 
                    ? "There are no scheduled meetings for this department."
                    : "No past meetings found for this department."
                  }
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {selectedDepartmentId && !meetingsLoading && meetings && meetings.length > 0 && (
                  <p className="text-sm text-muted-foreground mb-4">
                    All times are shown in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </p>
                )}
                {(meetings as Meeting[]).map((meeting) => (
                  <Card key={meeting.id} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-muted rounded-lg">
                            {getMeetingIcon(meeting)}
                          </div>
                          <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                              {meeting.title}
                              {meeting.isMandatory && (
                                <Badge variant="destructive" className="text-xs">
                                  Mandatory
                                </Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="flex items-center gap-4 mt-1">
                              <div className="flex items-center gap-1">
                                <Calendar className="h-4 w-4" />
                                <span>{formatLocalDateTime(meeting.scheduledAt)}</span>
                              </div>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDuration(meeting.duration)}
                              </span>
                              {viewFilter === "upcoming" && (
                                <span className="text-xs font-medium">
                                  {getTimeUntilMeeting(meeting.scheduledAt)}
                                </span>
                              )}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge 
                          variant="outline"
                          className={getMeetingStatusColor(meeting)}
                        >
                          {getMeetingStatusLabel(meeting)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {meeting.description && (
                        <p className="text-sm text-muted-foreground">
                          {meeting.description}
                        </p>
                      )}
                      
                      <div className="flex flex-wrap gap-4 text-sm">
                        {meeting.location && (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            <span>{meeting.location}</span>
                          </div>
                        )}
                        
                        {meeting.teamName && (
                          <div className="flex items-center gap-1">
                            <Users className="h-3 w-3 text-muted-foreground" />
                            <span>{meeting.teamName} Team</span>
                          </div>
                        )}
                        
                        {meeting.requiredRankLevel && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3 text-muted-foreground" />
                            <span>Min. Level {meeting.requiredRankLevel}</span>
                          </div>
                        )}
                      </div>

                      {meeting.isMandatory && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            This is a mandatory meeting. Attendance is required for all eligible members.
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 