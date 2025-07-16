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
  Plus,
  Search,
  FileText,
  Calendar,
  User,
  MapPin,
  Clock
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

type IncidentType = "arrest" | "citation" | "investigation" | "emergency_response" | "training" | "other";
type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected";

type IncidentReport = {
  id: number;
  title: string;
  description: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  location?: string;
  dateOccurred: Date;
  reportingMember: string;
  involvedMembers: any[];
};

export default function IncidentReportsPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">("all");

  // Form state
  const [incidentForm, setIncidentForm] = useState({
    incidentType: "other" as IncidentType,
    title: "",
    description: "",
    location: "",
    dateOccurred: "",
    severity: "medium" as IncidentSeverity,
    status: "draft" as IncidentStatus,
    involvedMembers: [] as number[],
  });

  // Get department info
  const { data: departmentInfo } = api.dept.discovery.getDepartmentInfo.useQuery({ departmentId });

  // Get department members for incident involvement
  const { data: membersData } = api.deptMore.search.searchMembers.useQuery({
    departmentId,
    limit: 100, // Get all members for incident involvement
    sortBy: "name",
    sortOrder: "asc",
  });
  const members = membersData?.members;

  // Get current user's member info for this department
  const { data: memberships } = api.dept.discovery.getMyMemberships.useQuery();
  const currentUserMember = memberships?.find(m => m.departmentId === departmentId);

  // Get incident reports
  const { data: incidentReports, isLoading: reportsLoading, refetch: refetchReports } =
    api.deptMore.incidents.getReports.useQuery({
      departmentId,
      status: statusFilter !== "all" ? statusFilter : undefined,
      limit: 50,
      offset: 0,
    });

  // Create incident report mutation
  const createIncidentMutation = api.deptMore.incidents.createReport.useMutation({
    onSuccess: (data) => {
      console.log("Incident report created successfully:", data);
      toast.success("Incident report created successfully!");
      setIsCreateDialogOpen(false);
      setIncidentForm({
        incidentType: "other",
        title: "",
        description: "",
        location: "",
        dateOccurred: "",
        severity: "medium",
        status: "draft",
        involvedMembers: [],
      });
      void refetchReports();
    },
    onError: (error) => {
      console.error("Failed to create incident report:", error);
      toast.error(`Failed to create incident report: ${error.message}`);
    },
  });

  const handleCreateIncident = () => {
    if (!incidentForm.title.trim() || !incidentForm.description.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (!incidentForm.dateOccurred) {
      toast.error("Please select the date when the incident occurred");
      return;
    }

    if (!currentUserMember?.id) {
      toast.error("Unable to identify current user. Please refresh and try again.");
      return;
    }

    createIncidentMutation.mutate({
      departmentId,
      reportingMemberId: currentUserMember.id,
      incidentType: incidentForm.incidentType,
      title: incidentForm.title,
      description: incidentForm.description,
      location: incidentForm.location || undefined,
      dateOccurred: new Date(incidentForm.dateOccurred),
      involvedMembers: incidentForm.involvedMembers.length > 0 ? incidentForm.involvedMembers : undefined,
      severity: incidentForm.severity,
      status: incidentForm.status === "draft" || incidentForm.status === "submitted" ? incidentForm.status : "draft",
    });
  };

  const getSeverityColor = (severity: IncidentSeverity) => {
    switch (severity) {
      case "low":
        return "bg-green-100 text-green-800 border-green-200";
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getStatusColor = (status: IncidentStatus) => {
    switch (status) {
      case "draft":
        return "bg-gray-100 text-gray-800 border-gray-200";
      case "submitted":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "under_review":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "approved":
        return "bg-green-100 text-green-800 border-green-200";
      case "rejected":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatIncidentType = (type: string) => {
    return type.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const formatStatus = (status: string) => {
    return status.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  // Use real incident reports data from API
  const incidentsData = incidentReports?.reports || [] as IncidentReport[];

  const filteredIncidents = incidentsData.filter(incident => {
    const matchesSearch = (incident.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (incident.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (incident.location || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || incident.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

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
              <h1 className="text-3xl font-bold tracking-tight">Incident Reports</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Create and manage incident reports
              </p>
            </div>
          </div>

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Report
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Incident Report</DialogTitle>
                <DialogDescription>
                  Document a new incident or event for department records.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 max-h-96 overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="incidentType">Incident Type *</Label>
                    <Select
                      value={incidentForm.incidentType}
                      onValueChange={(value: IncidentType) =>
                        setIncidentForm(prev => ({ ...prev, incidentType: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="arrest">Arrest</SelectItem>
                        <SelectItem value="citation">Citation</SelectItem>
                        <SelectItem value="investigation">Investigation</SelectItem>
                        <SelectItem value="emergency_response">Emergency Response</SelectItem>
                        <SelectItem value="training">Training</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="severity">Severity</Label>
                    <Select
                      value={incidentForm.severity}
                      onValueChange={(value: IncidentSeverity) =>
                        setIncidentForm(prev => ({ ...prev, severity: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="title">Incident Title *</Label>
                  <Input
                    id="title"
                    value={incidentForm.title}
                    onChange={(e) => setIncidentForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Brief description of the incident"
                    maxLength={200}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    value={incidentForm.description}
                    onChange={(e) => setIncidentForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Detailed description of what happened"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={incidentForm.location}
                      onChange={(e) => setIncidentForm(prev => ({ ...prev, location: e.target.value }))}
                      placeholder="Where did this occur?"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="dateOccurred">Date & Time Occurred *</Label>
                    <Input
                      id="dateOccurred"
                      type="datetime-local"
                      value={incidentForm.dateOccurred}
                      onChange={(e) => setIncidentForm(prev => ({ ...prev, dateOccurred: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={incidentForm.status}
                    onValueChange={(value: IncidentStatus) =>
                      setIncidentForm(prev => ({ ...prev, status: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="submitted">Submit for Review</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateIncident}
                  disabled={createIncidentMutation.isPending}
                >
                  {createIncidentMutation.isPending ? "Creating..." : "Create Report"}
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
              Search & Filter Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search by title, description, or location..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={(value: IncidentStatus | "all") => setStatusFilter(value)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Incident Reports List */}
        <div className="space-y-6">
          {reportsLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-64" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredIncidents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Incident Reports Found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchTerm || statusFilter !== "all"
                    ? "No reports match your search criteria."
                    : "No incident reports have been created yet."
                  }
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Report
                </Button>
              </CardContent>
            </Card>
          ) : (
            filteredIncidents.map((incident) => (
              <Card key={incident.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        {incident.title}
                      </CardTitle>
                      <CardDescription>
                        {formatIncidentType(incident.incidentType)} • Reported by {incident.reportingMember}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={getSeverityColor(incident.severity)}
                      >
                        {incident.severity.toUpperCase()}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={getStatusColor(incident.status as IncidentStatus)}
                      >
                        {formatStatus(incident.status as IncidentStatus)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm">{incident.description}</p>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{incident.dateOccurred.toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>{incident.dateOccurred.toLocaleTimeString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span>{incident.location}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>{incident.involvedMembers.length} involved</span>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm">
                        View Details
                      </Button>
                      {incident.status === "draft" && (
                        <Button variant="outline" size="sm">
                          Edit Report
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}