"use client";

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  ArrowLeft, 
  TrendingUp, 
  Users, 
  Clock,
  AlertTriangle,
  Download,
  BarChart3,
  PieChart,
  Activity
} from "lucide-react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Timeframe = "week" | "month" | "quarter" | "year";
type ReportType = "monthly" | "quarterly" | "annual" | "custom";

export default function DepartmentAnalyticsPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);
  
  const [timeframe, setTimeframe] = useState<Timeframe>("month");
  const [reportType] = useState<ReportType>("monthly");

  // Get department info
  const { data: departmentInfo } = api.dept.discovery.getDepartmentInfo.useQuery({ departmentId });

  // Get department analytics
  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = 
    api.deptMore.analytics.getDepartmentStats.useQuery({
      departmentId,
      timeframe,
    });

  // Permissions for generating reports
  const { data: canManageMembers } = api.dept.user.checkPermission.useQuery({ departmentId, permission: 'manage_members' });
  const { data: canManageDepartment } = api.dept.user.checkPermission.useQuery({ departmentId, permission: 'manage_department' });

  // Generate report mutation
  const generateReportMutation = api.deptMore.analytics.generateReport.useMutation({
    onSuccess: (data) => {
      toast.success("Performance report generated successfully!");
      // Handle report download or display
      console.log("Generated report:", data);
    },
    onError: (error) => {
      toast.error(`Failed to generate report: ${error.message}`);
    },
  });

  const handleGenerateReport = () => {
    generateReportMutation.mutate({
      departmentId,
      reportType,
      includeCharts: true,
    });
  };

  if (analyticsError) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href={`/dashboard/departments/${departmentId}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Department Analytics</h1>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {analyticsError.message ?? "Failed to load analytics data. You may not have permission to view this information."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

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
              <h1 className="text-3xl font-bold tracking-tight">Department Analytics</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Performance metrics and insights
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Select value={timeframe} onValueChange={(value: Timeframe) => setTimeframe(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="quarter">This Quarter</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
            
            {(canManageMembers?.hasPermission || canManageDepartment?.hasPermission) ? (
            <Button 
              onClick={handleGenerateReport}
              disabled={generateReportMutation.isPending}
            >
              <Download className="h-4 w-4 mr-2" />
              {generateReportMutation.isPending ? "Generating..." : "Generate Report"}
            </Button>
            ) : (
              <div className="text-sm text-muted-foreground">You do not have permission to generate reports.</div>
            )}
          </div>
        </div>

        {analyticsLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16 mb-2" />
                  <Skeleton className="h-3 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : analytics ? (
          <>
            {/* Key Metrics */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Members</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.totalMembers || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.memberGrowth > 0 ? '+' : ''}{analytics.memberGrowth || 0}% from last period
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Members</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.activeMembers || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {((analytics.activeMembers || 0) / (analytics.totalMembers || 1) * 100).toFixed(1)}% of total
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.avgResponseTime || 0}m</div>
                  <p className="text-xs text-muted-foreground">
                    Average emergency response
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Performance Score</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.performanceScore || 0}%</div>
                  <p className="text-xs text-muted-foreground">
                    Overall department rating
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Charts and Detailed Analytics */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Activity Trends
                  </CardTitle>
                  <CardDescription>
                    Member activity over the selected timeframe
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    Chart visualization would go here
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-5 w-5" />
                    Member Distribution
                  </CardTitle>
                  <CardDescription>
                    Members by rank and team
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    Chart visualization would go here
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Metrics */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Training Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Completion Rate</span>
                    <span className="font-medium">{analytics.trainingCompletionRate || 0}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Avg Training Time</span>
                    <span className="font-medium">{analytics.avgTrainingTime || 0} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">In Training</span>
                    <span className="font-medium">{analytics.membersInTraining || 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Incident Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Incidents</span>
                    <span className="font-medium">{analytics.totalIncidents || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Resolved</span>
                    <span className="font-medium">{analytics.resolvedIncidents || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Resolution Rate</span>
                    <span className="font-medium">
                      {analytics.totalIncidents ? 
                        ((analytics.resolvedIncidents || 0) / analytics.totalIncidents * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Equipment Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Equipment</span>
                    <span className="font-medium">{analytics.totalEquipment || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">In Use</span>
                    <span className="font-medium">{analytics.equipmentInUse || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Maintenance Due</span>
                    <span className="font-medium">{analytics.equipmentMaintenanceDue || 0}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Analytics Data</h3>
            <p className="text-muted-foreground">
              Analytics data is not available for the selected timeframe.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}