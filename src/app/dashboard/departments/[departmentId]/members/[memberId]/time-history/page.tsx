"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  Edit,
  Save,
  X,
  Clock,
  Calendar,
  Timer,
  AlertTriangle,
  History,
  User
} from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { formatLocalDateTime, formatLocalDate, formatDuration, utcToLocal } from "@/lib/utils/date";

type TimeEntry = {
  id: number;
  clockInTime: Date;
  clockOutTime: Date | null;
  totalMinutes: number | null;
  breakMinutes: number | null;
  status: "clocked_in" | "clocked_out" | "on_break";
  notes: string | null;
};

export default function MemberTimeHistoryPage() {
  const params = useParams();
  const router = useRouter();
  const departmentId = parseInt(params.departmentId as string);
  const memberId = parseInt(params.memberId as string);

  const [editEntry, setEditEntry] = useState<{
    isOpen: boolean;
    entryId: number | null;
    clockInTime: string;
    clockOutTime: string;
    notes: string;
  }>({
    isOpen: false,
    entryId: null,
    clockInTime: '',
    clockOutTime: '',
    notes: '',
  });

  const [dateFilter, setDateFilter] = useState<{
    startDate: string;
    endDate: string;
  }>(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    return {
      startDate: thirtyDaysAgo.toISOString().split('T')[0]!,
      endDate: today.toISOString().split('T')[0]!,
    };
  });

  // Force reset dates on component mount to ensure correct values
  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    setDateFilter({
      startDate: thirtyDaysAgo.toISOString().split('T')[0]!,
      endDate: today.toISOString().split('T')[0]!,
    });
  }, []);

  // Get member details
  const { data: rosterData, isLoading: memberLoading } = api.dept.user.info.getDepartmentRoster.useQuery({
    departmentId,
    includeInactive: true,
    memberIdFilter: memberId,
    limit: 1,
  });

  const memberData = rosterData?.members[0];

  // Get time history
  const { data: timeHistory, isLoading: historyLoading, refetch: refetchHistory, error: historyError } = api.dept.user.timeclock.getHistory.useQuery({
    departmentId,
    memberId,
    startDate: new Date(dateFilter.startDate + 'T00:00:00'),
    endDate: new Date(dateFilter.endDate + 'T23:59:59'),
    limit: 100,
  }, {
    enabled: !!memberData,
    retry: false
  });

  // Get user permissions
  const { data: editPermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'edit_timeclock'
  });

  const { data: managePermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'manage_timeclock'
  });

  const { data: viewPermission } = api.dept.user.checkPermission.useQuery({ 
    departmentId,
    permission: 'view_all_timeclock'
  });

  // Update entry mutation
  const updateEntryMutation = api.dept.user.timeclock.editEntry.useMutation({
    onSuccess: () => {
      toast.success("Time entry updated successfully");
      setEditEntry({
        isOpen: false,
        entryId: null,
        clockInTime: '',
        clockOutTime: '',
        notes: '',
      });
      void refetchHistory();
    },
    onError: (error) => {
      toast.error(`Failed to update time entry: ${error.message}`);
    },
  });

  const canEdit = (editPermission?.hasPermission ?? false) || (managePermission?.hasPermission ?? false);
  const canView = (viewPermission?.hasPermission ?? false) || (managePermission?.hasPermission ?? false);

  const openEditDialog = (entry: TimeEntry) => {
    setEditEntry({
      isOpen: true,
      entryId: entry.id,
      clockInTime: utcToLocal(entry.clockInTime),
      clockOutTime: entry.clockOutTime ? utcToLocal(entry.clockOutTime) : '',
      notes: entry.notes ?? '',
    });
  };

  const closeEditDialog = () => {
    setEditEntry({
      isOpen: false,
      entryId: null,
      clockInTime: '',
      clockOutTime: '',
      notes: '',
    });
  };

  const handleSaveEdit = () => {
    if (!editEntry.entryId) return;

    updateEntryMutation.mutate({
      entryId: editEntry.entryId,
      clockInTime: new Date(editEntry.clockInTime),
      clockOutTime: editEntry.clockOutTime ? new Date(editEntry.clockOutTime) : undefined,
      notes: editEntry.notes || undefined,
    });
  };

  const applyDateFilter = () => {
    void refetchHistory();
  };

  if (memberLoading) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="flex items-center space-x-4">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-8 w-48" />
          </div>
          <Skeleton className="h-96 w-full" />
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

  if (!canView) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-4">
              You don&apos;t have permission to view time tracking data for other members.
            </p>
            <Link href={`/dashboard/departments/${departmentId}/members/${memberId}`}>
              <Button>
                Back to Member Details
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
            <Link href={`/dashboard/departments/${departmentId}/members/${memberId}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Member
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Time History</h1>
              <p className="text-muted-foreground">
                {memberData?.roleplayName ?? 'Unknown Member'} • {memberData?.callsign ?? 'No Callsign'}
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Date Filter
            </CardTitle>
            <CardDescription>
              Filter time entries by date range
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={utcToLocal(dateFilter.startDate).split('T')[0]}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, startDate: e.target.value }))}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={utcToLocal(dateFilter.endDate).split('T')[0]}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, endDate: e.target.value }))}
                />
              </div>
              <Button onClick={applyDateFilter} disabled={historyLoading}>
                Apply Filter
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Time Entries */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Time Entries
            </CardTitle>
            <CardDescription>
              {timeHistory?.entries.length ?? 0} entries found
              {canEdit && " • Click on entries to edit"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !timeHistory?.entries || timeHistory.entries.length === 0 ? (
              <div className="text-center py-12">
                <Timer className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Time Entries</h3>
                <p className="text-muted-foreground">
                  No time entries found for the selected date range.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {timeHistory.entries.map((entry: TimeEntry) => (
                  <div
                    key={entry.id}
                    className={`p-4 border rounded-lg transition-colors ${
                      canEdit ? 'hover:bg-muted cursor-pointer' : ''
                    }`}
                    onClick={() => canEdit && openEditDialog(entry)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {formatLocalDate(entry.clockInTime)}
                          </span>
                          <Badge variant={entry.status === 'clocked_in' ? 'default' : 'secondary'}>
                            {entry.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <span>In: {formatLocalDateTime(entry.clockInTime)}</span>
                          {entry.clockOutTime && (
                            <span> • Out: {formatLocalDateTime(entry.clockOutTime)}</span>
                          )}
                        </div>
                        {entry.notes && (
                          <p className="text-sm text-muted-foreground italic">
                            &quot;{entry.notes}&quot;
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg">
                          {entry.totalMinutes ? formatDuration(entry.totalMinutes) : 'In Progress'}
                        </div>
                        {canEdit && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Click to edit
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit Entry Dialog */}
        <Dialog open={editEntry.isOpen} onOpenChange={closeEditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Time Entry</DialogTitle>
              <DialogDescription>
                Modify the clock in/out times and notes for this entry.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="clockInTime">Clock In Time</Label>
                <Input
                  id="clockInTime"
                  type="datetime-local"
                  value={editEntry.clockInTime}
                  onChange={(e) => setEditEntry(prev => ({ ...prev, clockInTime: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="clockOutTime">Clock Out Time</Label>
                <Input
                  id="clockOutTime"
                  type="datetime-local"
                  value={editEntry.clockOutTime}
                  onChange={(e) => setEditEntry(prev => ({ ...prev, clockOutTime: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  placeholder="Add notes about this shift..."
                  value={editEntry.notes}
                  onChange={(e) => setEditEntry(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeEditDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={updateEntryMutation.isPending}
              >
                {updateEntryMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
} 