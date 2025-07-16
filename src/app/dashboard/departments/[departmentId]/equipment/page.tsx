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
  Package,
  Plus,
  Search,
  Filter,
  CheckCircle,
  User
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

type EquipmentCondition = "excellent" | "good" | "fair" | "poor" | "damaged" | "out_of_service";
type AssignableCondition = "excellent" | "good" | "fair" | "poor" | "damaged";

export default function EquipmentManagementPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);

  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Form states
  const [assignForm, setAssignForm] = useState({
    memberId: "",
    equipmentId: "",
    condition: "good" as AssignableCondition,
    notes: "",
  });

  const [returnForm, setReturnForm] = useState({
    returnCondition: "good" as AssignableCondition,
    returnNotes: "",
  });

  // Get department info
  const { data: departmentInfo } = api.dept.discovery.getDepartmentInfo.useQuery({ departmentId });

  // Get department members for assignment
  const { data: membersData } = api.deptMore.search.searchMembers.useQuery({
    departmentId,
    limit: 100, // Get all members for assignment dropdown
    sortBy: "name",
    sortOrder: "asc",
  });
  const members = membersData?.members;

  // Get current user's member info for this department
  const { data: memberships } = api.dept.discovery.getMyMemberships.useQuery();
  const currentUserMember = memberships?.find(m => m.departmentId === departmentId);

  // Assign equipment mutation
  const assignEquipmentMutation = api.deptMore.equipment.assignEquipment.useMutation({
    onSuccess: (data) => {
      console.log("Equipment assigned successfully:", data);
      toast.success("Equipment assigned successfully!");
      setIsAssignDialogOpen(false);
      setAssignForm({
        memberId: "",
        equipmentId: "",
        condition: "good",
        notes: "",
      });
      void refetchEquipment();
    },
    onError: (error) => {
      console.error("Failed to assign equipment:", error);
      toast.error(`Failed to assign equipment: ${error.message}`);
    },
  });

  // Return equipment mutation
  const returnEquipmentMutation = api.deptMore.equipment.returnEquipment.useMutation({
    onSuccess: (data) => {
      console.log("Equipment returned successfully:", data);
      toast.success("Equipment returned successfully!");
      setIsReturnDialogOpen(false);
      setSelectedAssignment(null);
      setReturnForm({
        returnCondition: "good",
        returnNotes: "",
      });
      void refetchEquipment();
    },
    onError: (error) => {
      console.error("Failed to return equipment:", error);
      toast.error(`Failed to return equipment: ${error.message}`);
    },
  });

  const handleAssignEquipment = () => {
    if (!assignForm.memberId || !assignForm.equipmentId) {
      toast.error("Please select both member and equipment");
      return;
    }

    if (!currentUserMember?.id) {
      toast.error("Unable to identify current user. Please refresh and try again.");
      return;
    }

    assignEquipmentMutation.mutate({
      memberId: parseInt(assignForm.memberId),
      equipmentId: parseInt(assignForm.equipmentId),
      condition: assignForm.condition,
      notes: assignForm.notes || undefined,
      assignedDate: new Date(),
    });
  };

  const handleReturnEquipment = () => {
    if (!selectedAssignment) return;

    returnEquipmentMutation.mutate({
      assignmentId: selectedAssignment.id,
      returnCondition: returnForm.returnCondition,
      returnNotes: returnForm.returnNotes || undefined,
    });
  };

  const getConditionColor = (condition: EquipmentCondition) => {
    switch (condition) {
      case "excellent":
        return "bg-green-100 text-green-800 border-green-200";
      case "good":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "fair":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "poor":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "damaged":
        return "bg-red-100 text-red-800 border-red-200";
      case "out_of_service":
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatCondition = (condition: string) => {
    return condition.charAt(0).toUpperCase() + condition.slice(1);
  };

  // Get equipment data from API
  const { data: equipmentData, isLoading: equipmentLoading, refetch: refetchEquipment } = api.deptMore.equipment.getEquipment.useQuery({
    departmentId,
  });

  const equipment = equipmentData || [];

  const filteredEquipment = equipment.filter(item =>
    (item.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.serialNumber || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

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
              <h1 className="text-3xl font-bold tracking-tight">Equipment Management</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Manage department equipment assignments
              </p>
            </div>
          </div>

          <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Assign Equipment
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Assign Equipment</DialogTitle>
                <DialogDescription>
                  Assign equipment to a department member.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="member">Member</Label>
                  <Select
                    value={assignForm.memberId}
                    onValueChange={(value) => setAssignForm(prev => ({ ...prev, memberId: value }))}
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
                  <Label htmlFor="equipment">Equipment</Label>
                  <Select
                    value={assignForm.equipmentId}
                    onValueChange={(value) => setAssignForm(prev => ({ ...prev, equipmentId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select equipment" />
                    </SelectTrigger>
                    <SelectContent>
                      {equipment
                        .filter(eq => eq.status === "available")
                        .map((equipmentItem) => (
                          <SelectItem key={equipmentItem.id} value={equipmentItem.id.toString()}>
                            {equipmentItem.name} ({equipmentItem.serialNumber})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="condition">Condition</Label>
                  <Select
                    value={assignForm.condition}
                    onValueChange={(value: AssignableCondition) => setAssignForm(prev => ({ ...prev, condition: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="excellent">Excellent</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="poor">Poor</SelectItem>
                      <SelectItem value="damaged">Damaged</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    value={assignForm.notes}
                    onChange={(e) => setAssignForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any additional notes about the assignment"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAssignEquipment}
                  disabled={assignEquipmentMutation.isPending}
                >
                  {assignEquipmentMutation.isPending ? "Assigning..." : "Assign Equipment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search and Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search Equipment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search by name, type, or serial number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button variant="outline">
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Equipment List */}
        <div className="grid gap-6">
          {equipmentLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-64" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredEquipment.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Equipment Found</h3>
                <p className="text-muted-foreground">
                  {searchTerm ? "No equipment matches your search criteria." : "No equipment has been added to this department yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredEquipment.map((equipment) => (
              <Card key={equipment.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        {equipment.name}
                      </CardTitle>
                      <CardDescription>
                        {equipment.type} • {equipment.serialNumber}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={getConditionColor(equipment.condition)}
                      >
                        {formatCondition(equipment.condition)}
                      </Badge>
                      <Badge variant={equipment.status === "assigned" ? "default" : "secondary"}>
                        {equipment.status === "assigned" ? "Assigned" : "Available"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {equipment.assignedTo ? (
                      <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div className="flex items-center gap-3">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">Assigned to: {equipment.assignedTo}</p>
                            <p className="text-sm text-muted-foreground">
                              Since: {equipment.assignedDate?.toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedAssignment({ id: equipment.id, name: equipment.name });
                            setIsReturnDialogOpen(true);
                          }}
                        >
                          Return Equipment
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <p className="font-medium text-green-800">Available for assignment</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Return Equipment Dialog */}
        <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Return Equipment</DialogTitle>
              <DialogDescription>
                Process the return of {selectedAssignment?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="returnCondition">Return Condition</Label>
                <Select
                  value={returnForm.returnCondition}
                  onValueChange={(value: AssignableCondition) =>
                    setReturnForm(prev => ({ ...prev, returnCondition: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excellent">Excellent</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="fair">Fair</SelectItem>
                    <SelectItem value="poor">Poor</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="returnNotes">Return Notes (Optional)</Label>
                <Textarea
                  id="returnNotes"
                  value={returnForm.returnNotes}
                  onChange={(e) => setReturnForm(prev => ({ ...prev, returnNotes: e.target.value }))}
                  placeholder="Any notes about the equipment condition or return"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsReturnDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleReturnEquipment}
                disabled={returnEquipmentMutation.isPending}
              >
                {returnEquipmentMutation.isPending ? "Processing..." : "Return Equipment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}