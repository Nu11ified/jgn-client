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
  TrendingUp, 
  Calendar,
  Award,
  Target,
  BarChart3,
  Activity,
  Star,
  AlertTriangle,
  CheckCircle
} from "lucide-react";
import { api } from "@/trpc/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

export default function PerformancePage() {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);

  // Get user's department memberships
  const { data: memberships, isLoading: membershipsLoading } = api.dept.discovery.getMyMemberships.useQuery();

  // Get promotion history for selected department - need to find the member ID first
  const selectedMembership = memberships?.find(m => m.departmentId === selectedDepartmentId);
  
  const { data: promotions, isLoading: promotionsLoading } = api.dept.user.promotions.getHistory.useQuery(
    { memberId: selectedMembership?.id ?? 0, limit: 20 },
    { enabled: !!selectedMembership?.id }
  );

  // Get disciplinary actions for selected department
  const { data: disciplinaryActions, isLoading: disciplinaryLoading } = api.dept.user.discipline.getByMember.useQuery(
    { 
      memberId: selectedMembership?.id ?? 0,
      includeExpired: true,
      limit: 20
    },
    { enabled: !!selectedMembership?.id }
  );

  // Filter active memberships
  const activeMemberships = memberships?.filter(
    (membership: DepartmentMembership) => 
      membership.isActive && membership.status === 'active'
  ) ?? [];

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDateTime = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
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

  const getDaysInDepartment = (hireDate: Date | null) => {
    if (!hireDate) return 0;
    const now = new Date();
    const hire = new Date(hireDate);
    const diffTime = Math.abs(now.getTime() - hire.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getActionTypeColor = (actionType: string) => {
    switch (actionType.toLowerCase()) {
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'suspension':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'commendation':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'note':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
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
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
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
            <h1 className="text-3xl font-bold tracking-tight">Performance</h1>
            <p className="text-muted-foreground mt-2">
              View your performance metrics and career progression
            </p>
          </div>
        </div>

        {activeMemberships.length === 0 ? (
          <Card className="p-8 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Active Departments</h3>
            <p className="text-muted-foreground mb-4">
              You need to be an active member of a department to view performance metrics.
            </p>
            <Link href="/dashboard/departments/browse">
              <Button>
                Browse Departments
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Department Selection */}
            <div className="max-w-md">
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

            {!selectedDepartmentId ? (
              <Card className="p-8 text-center">
                <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Select a Department</h3>
                <p className="text-muted-foreground">
                  Choose a department to view your performance metrics and career progression.
                </p>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Performance Overview Cards */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Current Status</CardTitle>
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <Badge 
                        variant="outline"
                        className={getStatusColor(selectedMembership?.status ?? '')}
                      >
                        {formatStatus(selectedMembership?.status ?? '')}
                      </Badge>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Current Rank</CardTitle>
                      <Star className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {selectedMembership?.rankName ?? 'N/A'}
                      </div>
                      {selectedMembership?.rankLevel && (
                        <p className="text-xs text-muted-foreground">
                          Level {selectedMembership.rankLevel}
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Days in Department</CardTitle>
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {getDaysInDepartment(selectedMembership?.hireDate ?? null)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Since {selectedMembership?.hireDate ? formatDate(selectedMembership.hireDate) : 'N/A'}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Promotions</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {promotions?.length ?? 0}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Career advancements
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Detailed Information Tabs */}
                <Card>
                  <CardHeader>
                    <CardTitle>Career Details</CardTitle>
                    <CardDescription>
                      Detailed view of your career progression and records
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="promotions" className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="promotions">Promotions</TabsTrigger>
                        <TabsTrigger value="disciplinary">Records</TabsTrigger>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                      </TabsList>

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
                              <div key={promotion.id} className="flex items-center justify-between p-4 bg-muted rounded-lg">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 bg-green-100 rounded-lg">
                                    <TrendingUp className="h-4 w-4 text-green-600" />
                                  </div>
                                  <div>
                                    <div className="font-medium">
                                      Promotion Record #{promotion.id}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                      {formatDateTime(promotion.effectiveDate)} • By {promotion.promotedBy}
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
                                <div className="flex items-start justify-between">
                                  <div className="flex items-start gap-3">
                                    <div className="p-2 bg-yellow-100 rounded-lg">
                                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{action.actionType}</span>
                                        <Badge 
                                          variant="outline"
                                          className={getActionTypeColor(action.actionType)}
                                        >
                                          {action.isActive ? 'Active' : 'Expired'}
                                        </Badge>
                                      </div>
                                      <div className="text-sm text-muted-foreground mt-1">
                                        {formatDateTime(action.issuedAt)} • By {action.issuedBy}
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
                                          Expires: {formatDateTime(action.expiresAt)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="overview" className="space-y-4 mt-6">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-lg">Department Information</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Department:</span>
                                <span className="font-medium">{selectedMembership?.departmentName}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Callsign:</span>
                                <span className="font-medium">{selectedMembership?.callsign}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Type:</span>
                                <span className="font-medium capitalize">
                                  {selectedMembership?.departmentType?.replace('_', ' ')}
                                </span>
                              </div>
                              {selectedMembership?.teamName && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">Team:</span>
                                  <span className="font-medium">{selectedMembership.teamName}</span>
                                </div>
                              )}
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <CardTitle className="text-lg">Career Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Hire Date:</span>
                                <span className="font-medium">
                                  {selectedMembership?.hireDate ? formatDate(selectedMembership.hireDate) : 'N/A'}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Total Promotions:</span>
                                <span className="font-medium">{promotions?.length ?? 0}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Active Records:</span>
                                <span className="font-medium">
                                  {disciplinaryActions?.filter(a => a.isActive).length ?? 0}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Current Status:</span>
                                <Badge 
                                  variant="outline"
                                  className={getStatusColor(selectedMembership?.status ?? '')}
                                >
                                  {formatStatus(selectedMembership?.status ?? '')}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 