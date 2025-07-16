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
import {
  ArrowLeft,
  Calendar,
  Plus,
  Clock,
  User,
  MapPin,
  ChevronLeft,
  ChevronRight
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

type ShiftType = "patrol" | "training" | "administrative" | "special_ops" | "court_duty";

type Shift = {
  id: number;
  memberId: number;
  memberName: string;
  memberCallsign: string;
  startTime: Date;
  endTime: Date;
  shiftType: ShiftType;
  notes?: string;
};

export default function ShiftSchedulingPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "month">("week");

  // Form state
  const [shiftForm, setShiftForm] = useState({
    memberId: "",
    startTime: "",
    endTime: "",
    shiftType: "patrol" as ShiftType,
    notes: "",
  });

  // Get department info
  const { data: departmentInfo } = api.dept.discovery.getDepartmentInfo.useQuery({ departmentId });

  // Get department members for shift assignment
  const { data: membersData } = api.deptMore.search.searchMembers.useQuery({
    departmentId,
    limit: 100, // Get all members for shift assignment
    sortBy: "name",
    sortOrder: "asc",
  });
  const members = membersData?.members;

  // Get current user's member info for this department
  const { data: memberships } = api.dept.discovery.getMyMemberships.useQuery();
  const currentUserMember = memberships?.find(m => m.departmentId === departmentId);

  // Calculate date range for shifts query
  const startDate = new Date(currentDate);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Start of week
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (viewMode === "week" ? 6 : 30)); // End of week/month

  // Get shifts
  const { data: shifts, isLoading: shiftsLoading, refetch: refetchShifts } =
    api.deptMore.scheduling.getShifts.useQuery({
      departmentId,
      startDate,
      endDate,
    });

  // Schedule shift mutation
  const scheduleShiftMutation = api.deptMore.scheduling.scheduleShift.useMutation({
    onSuccess: (data) => {
      console.log("Shift scheduled successfully:", data);
      toast.success("Shift scheduled successfully!");
      setIsCreateDialogOpen(false);
      setShiftForm({
        memberId: "",
        startTime: "",
        endTime: "",
        shiftType: "patrol",
        notes: "",
      });
      void refetchShifts();
    },
    onError: (error) => {
      console.error("Failed to schedule shift:", error);
      toast.error(`Failed to schedule shift: ${error.message}`);
    },
  });

  const handleScheduleShift = () => {
    if (!shiftForm.memberId || !shiftForm.startTime || !shiftForm.endTime) {
      toast.error("Please fill in all required fields");
      return;
    }

    const startTime = new Date(shiftForm.startTime);
    const endTime = new Date(shiftForm.endTime);

    if (endTime <= startTime) {
      toast.error("End time must be after start time");
      return;
    }

    if (!currentUserMember?.id) {
      toast.error("Unable to identify current user. Please refresh and try again.");
      return;
    }

    scheduleShiftMutation.mutate({
      departmentId,
      memberId: parseInt(shiftForm.memberId),
      startTime,
      endTime,
      shiftType: shiftForm.shiftType,
      notes: shiftForm.notes || undefined,
    });
  };

  const getShiftTypeColor = (type: ShiftType) => {
    switch (type) {
      case "patrol":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "training":
        return "bg-green-100 text-green-800 border-green-200";
      case "administrative":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "special_ops":
        return "bg-red-100 text-red-800 border-red-200";
      case "court_duty":
        return "bg-orange-100 text-orange-800 border-orange-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatShiftType = (type: string) => {
    return type.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const navigateDate = (direction: "prev" | "next") => {
    const newDate = new Date(currentDate);
    if (viewMode === "week") {
      newDate.setDate(newDate.getDate() + (direction === "next" ? 7 : -7));
    } else {
      newDate.setMonth(newDate.getMonth() + (direction === "next" ? 1 : -1));
    }
    setCurrentDate(newDate);
  };

  const formatDateRange = () => {
    if (viewMode === "week") {
      const weekStart = new Date(currentDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      return `${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}`;
    } else {
      return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  };

  // Use real shifts data from API
  const shiftsData = shifts || [] as Shift[];

  const getCurrentDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
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
              <h1 className="text-3xl font-bold tracking-tight">Shift Scheduling</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Manage member shift schedules
              </p>
            </div>
          </div>

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Schedule Shift
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Schedule New Shift</DialogTitle>
                <DialogDescription>
                  Assign a shift to a department member.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="member">Member *</Label>
                  <Select
                    value={shiftForm.memberId}
                    onValueChange={(value) => setShiftForm(prev => ({ ...prev, memberId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select member" />
                    </SelectTrigger>
                    <SelectContent>
                      {members?.map((member) => (
                        <SelectItem key={member.id} value={member.id.toString()}>
                          {member.roleplayName || member.discordId} ({member.callsign})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="shiftType">Shift Type *</Label>
                  <Select
                    value={shiftForm.shiftType}
                    onValueChange={(value: ShiftType) => setShiftForm(prev => ({ ...prev, shiftType: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patrol">Patrol</SelectItem>
                      <SelectItem value="training">Training</SelectItem>
                      <SelectItem value="administrative">Administrative</SelectItem>
                      <SelectItem value="special_ops">Special Operations</SelectItem>
                      <SelectItem value="court_duty">Court Duty</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="startTime">Start Time *</Label>
                    <Input
                      id="startTime"
                      type="datetime-local"
                      value={shiftForm.startTime}
                      onChange={(e) => setShiftForm(prev => ({ ...prev, startTime: e.target.value }))}
                      min={getCurrentDateTime()}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="endTime">End Time *</Label>
                    <Input
                      id="endTime"
                      type="datetime-local"
                      value={shiftForm.endTime}
                      onChange={(e) => setShiftForm(prev => ({ ...prev, endTime: e.target.value }))}
                      min={shiftForm.startTime || getCurrentDateTime()}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    value={shiftForm.notes}
                    onChange={(e) => setShiftForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Additional details about the shift"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleScheduleShift}
                  disabled={scheduleShiftMutation.isPending}
                >
                  {scheduleShiftMutation.isPending ? "Scheduling..." : "Schedule Shift"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Calendar Controls */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateDate("prev")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <h3 className="text-lg font-semibold min-w-64 text-center">
                    {formatDateRange()}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateDate("next")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentDate(new Date())}
                >
                  Today
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Select value={viewMode} onValueChange={(value: "week" | "month") => setViewMode(value)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">Week View</SelectItem>
                    <SelectItem value="month">Month View</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Shifts Display */}
        <div className="space-y-6">
          {shiftsLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-6 w-20" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : shiftsData.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Shifts Scheduled</h3>
                <p className="text-muted-foreground mb-4">
                  No shifts are scheduled for the selected time period.
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Schedule First Shift
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {shiftsData
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .map((shift) => (
                  <Card key={shift.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">
                                {shift.memberName} ({shift.memberCallsign})
                              </p>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  <span>
                                    {shift.startTime.toLocaleString()} - {shift.endTime.toLocaleString()}
                                  </span>
                                </div>
                                {shift.notes && (
                                  <div className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    <span>{shift.notes}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={getShiftTypeColor(shift.shiftType)}
                          >
                            {formatShiftType(shift.shiftType)}
                          </Badge>
                          <Button variant="outline" size="sm">
                            Edit
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </div>

        {/* Shift Statistics */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Shifts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{shiftsData.length}</div>
              <p className="text-xs text-muted-foreground">
                In selected period
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Coverage Hours</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {shiftsData.reduce((total, shift) => {
                  const hours = (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / (1000 * 60 * 60);
                  return total + hours;
                }, 0).toFixed(0)}h
              </div>
              <p className="text-xs text-muted-foreground">
                Total scheduled hours
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Active Members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Set(shiftsData.map(s => s.memberName || s.memberId)).size}
              </div>
              <p className="text-xs text-muted-foreground">
                Members with shifts
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}