"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { 
  ArrowLeft, 
  Clock, 
  Play,
  Square,
  Timer
} from "lucide-react";
import { api } from "@/trpc/react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

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

type TimeClockEntry = {
  id: number;
  clockInTime: Date;
  clockOutTime: Date | null;
  totalMinutes: number | null;
  status: "clocked_in" | "clocked_out" | "on_break";
  notes: string | null;
};

export default function TimeTrackingPage() {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  // Get user's department memberships
  const { data: memberships, isLoading: membershipsLoading } = api.dept.discovery.getMyMemberships.useQuery();

  // Get time clock status for selected department
  const { data: timeStatus, isLoading: statusLoading, refetch: refetchStatus } = api.dept.user.timeclock.getStatus.useQuery(
    { departmentId: selectedDepartmentId! },
    { enabled: !!selectedDepartmentId }
  );

  // Clock in mutation
  const clockInMutation = api.dept.user.timeclock.clockIn.useMutation({
    onSuccess: () => {
      toast.success("Successfully clocked in!");
      setNotes("");
      void refetchStatus();
    },
    onError: (error) => {
      toast.error(error.message ?? "Failed to clock in");
    },
  });

  // Clock out mutation
  const clockOutMutation = api.dept.user.timeclock.clockOut.useMutation({
    onSuccess: () => {
      toast.success("Successfully clocked out!");
      setNotes("");
      void refetchStatus();
    },
    onError: (error) => {
      toast.error(error.message ?? "Failed to clock out");
    },
  });

  // Filter active memberships
  const activeMemberships = memberships?.filter(
    (membership: DepartmentMembership) => 
      membership.isActive && membership.status === 'active'
  ) ?? [];

  const handleClockIn = () => {
    if (!selectedDepartmentId) return;
    
    clockInMutation.mutate({
      departmentId: selectedDepartmentId,
      notes: notes.trim() || undefined,
    });
  };

  const handleClockOut = () => {
    if (!selectedDepartmentId) return;
    
    clockOutMutation.mutate({
      departmentId: selectedDepartmentId,
      notes: notes.trim() || undefined,
    });
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const getCurrentSessionDuration = () => {
    if (!timeStatus?.currentEntry?.clockInTime) return "0h 0m";
    
    const clockInTime = new Date(timeStatus.currentEntry.clockInTime);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - clockInTime.getTime()) / (1000 * 60));
    
    return formatDuration(diffMinutes);
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
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </CardContent>
            </Card>
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
            <h1 className="text-3xl font-bold tracking-tight">Time Tracking</h1>
            <p className="text-muted-foreground mt-2">
              Clock in and out of your department shifts
            </p>
          </div>
        </div>

        {activeMemberships.length === 0 ? (
          <Card className="p-8 text-center">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Active Departments</h3>
            <p className="text-muted-foreground mb-4">
              You need to be an active member of a department to use time tracking.
            </p>
            <Link href="/dashboard/departments/browse">
              <Button>
                Browse Departments
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Clock In/Out Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Timer className="h-5 w-5" />
                  Time Clock
                </CardTitle>
                <CardDescription>
                  Select a department and clock in or out
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
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

                <div>
                  <label className="text-sm font-medium mb-2 block">Notes (Optional)</label>
                  <Textarea
                    placeholder="Add any notes about your shift..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  {timeStatus?.isClockedIn ? (
                    <Button 
                      onClick={handleClockOut}
                      disabled={!selectedDepartmentId || clockOutMutation.isPending}
                      variant="destructive"
                      className="flex-1"
                    >
                      <Square className="h-4 w-4 mr-2" />
                      {clockOutMutation.isPending ? "Clocking Out..." : "Clock Out"}
                    </Button>
                  ) : (
                    <Button 
                      onClick={handleClockIn}
                      disabled={!selectedDepartmentId || clockInMutation.isPending}
                      className="flex-1"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {clockInMutation.isPending ? "Clocking In..." : "Clock In"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Current Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Current Status
                </CardTitle>
                <CardDescription>
                  Your current time tracking status
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!selectedDepartmentId ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Select a department to view status</p>
                  </div>
                ) : statusLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Status:</span>
                      <Badge 
                        variant={timeStatus?.isClockedIn ? "default" : "secondary"}
                        className={timeStatus?.isClockedIn ? "bg-green-100 text-green-800" : ""}
                      >
                        {timeStatus?.isClockedIn ? "Clocked In" : "Clocked Out"}
                      </Badge>
                    </div>

                    {timeStatus?.isClockedIn && timeStatus.currentEntry && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Clock In Time:</span>
                          <span className="text-sm">
                            {new Date(timeStatus.currentEntry.clockInTime).toLocaleString()}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Duration:</span>
                          <span className="text-sm font-mono">
                            {getCurrentSessionDuration()}
                          </span>
                        </div>

                        {timeStatus.currentEntry.notes && (
                          <div>
                            <span className="text-sm font-medium block mb-1">Notes:</span>
                            <p className="text-sm text-muted-foreground bg-muted p-2 rounded">
                              {timeStatus.currentEntry.notes}
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {!timeStatus?.isClockedIn && (
                      <div className="text-center py-4 text-muted-foreground">
                        <Timer className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Not currently clocked in</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
} 