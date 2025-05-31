"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowRight, 
  Clock, 
  Users, 
  Building, 
  Search,
  Calendar,
  Settings,
  TrendingUp
} from "lucide-react";
import { api } from "@/trpc/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Define the membership type based on the TRPC response
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

export default function UserDepartmentsPage() {
  const { data: memberships, isLoading, error } = api.dept.discovery.getMyMemberships.useQuery();

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-20" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load your department memberships. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

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

  return (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Departments</h1>
          <p className="text-muted-foreground mt-2">
            Manage your department memberships and access department features
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <Link href="/dashboard/departments/browse" className="flex items-center space-x-3 text-sm">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Search className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium">Browse Departments</p>
                  <p className="text-muted-foreground text-xs">Find and join new departments</p>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <Link href="/dashboard/departments/time-tracking" className="flex items-center space-x-3 text-sm">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Clock className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="font-medium">Time Tracking</p>
                  <p className="text-muted-foreground text-xs">Clock in/out and view hours</p>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <Link href="/dashboard/departments/schedule" className="flex items-center space-x-3 text-sm">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Calendar className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <p className="font-medium">Schedule</p>
                  <p className="text-muted-foreground text-xs">View upcoming events</p>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <Link href="/dashboard/departments/performance" className="flex items-center space-x-3 text-sm">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-orange-600" />
                </div>
                <div>
                  <p className="font-medium">Performance</p>
                  <p className="text-muted-foreground text-xs">View your stats</p>
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Department Memberships */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Department Memberships</h2>
          
          {!memberships || memberships.length === 0 ? (
            <Card className="p-8 text-center">
              <Building className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Department Memberships</h3>
              <p className="text-muted-foreground mb-4">
                You haven&apos;t joined any departments yet. Browse available departments to get started.
              </p>
              <Link href="/dashboard/departments/browse">
                <Button>
                  Browse Departments <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {memberships.map((membership: DepartmentMembership) => (
                <Card key={membership.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{membership.departmentName}</CardTitle>
                        <CardDescription className="capitalize">
                          {membership.departmentType?.replace('_', ' ')}
                        </CardDescription>
                      </div>
                      <Badge 
                        variant="outline"
                        className={getStatusColor(membership.status)}
                      >
                        {formatStatus(membership.status)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Callsign:</span>
                        <span className="font-medium">{membership.callsign}</span>
                      </div>
                      
                      {membership.rankName && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Rank:</span>
                          <span className="font-medium">
                            {membership.rankName}
                            {membership.rankLevel && (
                              <span className="text-muted-foreground ml-1">
                                (Level {membership.rankLevel})
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      
                      {membership.teamName && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Team:</span>
                          <span className="font-medium">{membership.teamName}</span>
                        </div>
                      )}
                      
                      {membership.hireDate && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Joined:</span>
                          <span className="font-medium">
                            {new Date(membership.hireDate).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Link 
                        href={`/dashboard/departments/${membership.departmentId}`}
                        className="flex-1"
                      >
                        <Button variant="default" size="sm" className="w-full">
                          View Details
                        </Button>
                      </Link>
                      
                      {membership.isActive && membership.status === 'active' && (
                        <Link 
                          href={`/dashboard/departments/${membership.departmentId}/time-tracking`}
                        >
                          <Button variant="outline" size="sm">
                            <Clock className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 