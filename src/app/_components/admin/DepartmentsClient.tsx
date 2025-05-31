"use client";

import React, { useState, useMemo } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Loader2, Plus, Edit, Trash2, Search, Filter } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { useTableControls } from '@/hooks/useTableControls';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CreateDepartmentForm } from "@/app/_components/admin/forms/CreateDepartmentForm";
import Link from "next/link";

// Infer department type from the router output
type DepartmentsOutput = RouterOutputs["dept"]["admin"]["departments"]["list"];
type Department = DepartmentsOutput[0];

// Filter types
type DepartmentTypeFilter = 'all' | 'law_enforcement' | 'fire_department' | 'staff_team';
type ActiveStatusFilter = 'all' | 'active' | 'inactive';

interface DepartmentsClientProps {
  initialDepartments: Department[];
}

const DEPARTMENT_TYPE_LABELS = {
  law_enforcement: "Law Enforcement",
  fire_department: "Fire Department", 
  staff_team: "Staff Team"
} as const;

export default function DepartmentsClient({ initialDepartments }: DepartmentsClientProps) {
  const [departments, setDepartments] = useState<Department[]>(initialDepartments);
  const [typeFilter, setTypeFilter] = useState<DepartmentTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ActiveStatusFilter>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const trpcUtils = api.useUtils();

  // Table controls with search functionality
  const {
    searchTerm,
    setSearchTerm,
    totalItems: totalFilteredItems,
    filteredData: initialFilteredDepartments,
  } = useTableControls<Department>({
    data: departments,
    searchKeys: ['name', 'description', 'callsignPrefix'],
  });

  // Apply additional filters
  const filteredDepartments = useMemo(() => {
    let filtered = initialFilteredDepartments;

    // Apply type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter(dept => dept.type === typeFilter);
    }

    // Apply status filter  
    if (statusFilter !== 'all') {
      filtered = filtered.filter(dept => 
        statusFilter === 'active' ? dept.isActive : !dept.isActive
      );
    }

    return filtered;
  }, [initialFilteredDepartments, typeFilter, statusFilter]);

  // Delete mutation
  const deleteDepartmentMutation = api.dept.admin.departments.delete.useMutation({
    onMutate: async ({ id }) => {
      await trpcUtils.dept.admin.departments.list.cancel();
      
      // Optimistically remove the department
      setDepartments(prev => prev.filter(dept => dept.id !== id));
      
      return { previousDepartments: departments };
    },
    onError: (err, variables, context) => {
      // Revert on error
      if (context?.previousDepartments) {
        setDepartments(context.previousDepartments);
      }
      toast.error(`Failed to delete department: ${err.message}`);
    },
    onSuccess: () => {
      toast.success("Department deleted successfully");
      void trpcUtils.dept.admin.departments.list.invalidate();
    }
  });

  const handleDeleteDepartment = async (departmentId: number) => {
    if (confirm("Are you sure you want to delete this department? This action cannot be undone.")) {
      await deleteDepartmentMutation.mutateAsync({ id: departmentId });
    }
  };

  const handleCreateSuccess = (newDepartment: Department) => {
    setDepartments(prev => [...prev, newDepartment]);
    setIsCreateDialogOpen(false);
    toast.success("Department created successfully");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl font-bold">Department Management</CardTitle>
              <CardDescription>
                Manage departments, their settings, and organizational structure
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Department
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Department</DialogTitle>
                  <DialogDescription>
                    Create a new department with basic information and settings.
                  </DialogDescription>
                </DialogHeader>
                <CreateDepartmentForm onSuccess={handleCreateSuccess} />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search and Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search departments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={(value: DepartmentTypeFilter) => setTypeFilter(value)}>
                <SelectTrigger className="w-[200px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="law_enforcement">Law Enforcement</SelectItem>
                  <SelectItem value="fire_department">Fire Department</SelectItem>
                  <SelectItem value="staff_team">Staff Team</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value: ActiveStatusFilter) => setStatusFilter(value)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Results Summary */}
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">
              Showing {filteredDepartments.length} of {totalFilteredItems} departments
            </p>
          </div>

          {/* Departments Table */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Callsign Prefix</TableHead>
                  <TableHead>Discord Guild</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDepartments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="flex flex-col items-center gap-2">
                        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
                        <p className="text-muted-foreground">No departments found</p>
                        {searchTerm && (
                          <p className="text-sm text-muted-foreground">
                            Try adjusting your search or filters
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDepartments.map((department) => (
                    <TableRow key={department.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{department.name}</p>
                          {department.description && (
                            <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {department.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {DEPARTMENT_TYPE_LABELS[department.type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="px-2 py-1 bg-muted rounded text-sm">
                          {department.callsignPrefix}
                        </code>
                      </TableCell>
                      <TableCell>
                        <code className="text-sm">{department.discordGuildId}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={department.isActive ? "default" : "secondary"}>
                          {department.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {department.createdAt ? new Date(department.createdAt).toLocaleDateString() : 'N/A'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/departments/${department.id}`}>
                            <Button variant="outline" size="sm">
                              <Edit className="h-3 w-3" />
                            </Button>
                          </Link>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleDeleteDepartment(department.id)}
                            disabled={deleteDepartmentMutation.isPending}
                          >
                            {deleteDepartmentMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 