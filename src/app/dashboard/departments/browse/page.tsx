"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft, 
  Users, 
  Building, 
  Search,
  Shield,
  Flame,
  Settings,
  Eye
} from "lucide-react";
import { api } from "@/trpc/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

type DepartmentType = "law_enforcement" | "fire_department" | "staff_team";

type AvailableDepartment = {
  id: number;
  name: string;
  type: DepartmentType;
  description: string | null;
  callsignPrefix: string;
  memberCount: unknown;
  isAlreadyMember: unknown;
};

export default function BrowseDepartmentsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<DepartmentType | "all">("all");

  const { data: departments, isLoading, error } = api.dept.discovery.listAvailableDepartments.useQuery({
    type: selectedType === "all" ? undefined : selectedType,
    includeAlreadyJoined: false,
  });

  const getDepartmentIcon = (type: DepartmentType) => {
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

  const getDepartmentTypeLabel = (type: DepartmentType) => {
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

  const getDepartmentTypeColor = (type: DepartmentType) => {
    switch (type) {
      case 'law_enforcement':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'fire_department':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'staff_team':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Filter departments based on search term
  const filteredDepartments = departments?.filter(dept =>
    dept.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    dept.description?.toLowerCase().includes(searchTerm.toLowerCase())
  ) ?? [];

  if (isLoading) {
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
            <Skeleton className="h-10 w-48" />
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
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
        <div className="flex items-center gap-4 mb-6">
          <Link href="/dashboard/departments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Browse Departments</h1>
            <p className="text-muted-foreground mt-2">
              Discover and join departments that match your interests
            </p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load available departments. Please try again later.
          </AlertDescription>
        </Alert>
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
            <h1 className="text-3xl font-bold tracking-tight">Browse Departments</h1>
            <p className="text-muted-foreground mt-2">
              Discover and join departments that match your interests
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search departments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedType} onValueChange={(value) => setSelectedType(value as DepartmentType | "all")}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="law_enforcement">Law Enforcement</SelectItem>
              <SelectItem value="fire_department">Fire Department</SelectItem>
              <SelectItem value="staff_team">Staff Team</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              Available Departments ({filteredDepartments.length})
            </h2>
          </div>
          
          {filteredDepartments.length === 0 ? (
            <Card className="p-8 text-center">
              <Building className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Departments Found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm || selectedType !== "all" 
                  ? "Try adjusting your search criteria or filters."
                  : "There are no available departments to join at this time."
                }
              </p>
              {(searchTerm || selectedType !== "all") && (
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedType("all");
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredDepartments.map((department: AvailableDepartment) => (
                <Card key={department.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {getDepartmentIcon(department.type)}
                        <div>
                          <CardTitle className="text-lg">{department.name}</CardTitle>
                          <CardDescription>
                            {department.callsignPrefix}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge 
                        variant="outline"
                        className={getDepartmentTypeColor(department.type)}
                      >
                        {getDepartmentTypeLabel(department.type)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {department.description && (
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {department.description}
                      </p>
                    )}
                    
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{Number(department.memberCount) || 0} members</span>
                    </div>

                    <div className="flex gap-2">
                      <Link 
                        href={`/dashboard/departments/browse/${department.id}`}
                        className="flex-1"
                      >
                        <Button variant="outline" size="sm" className="w-full">
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </Button>
                      </Link>
                      
                      {!Boolean(department.isAlreadyMember) && (
                        <Link 
                          href={`/dashboard/departments/browse/${department.id}/join`}
                        >
                          <Button size="sm">
                            Join
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