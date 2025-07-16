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
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Megaphone,
  Plus,
  Search,
  Calendar,
  AlertTriangle,
  Info,
  CheckCircle,
  Clock,
  Users
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

type AnnouncementPriority = "low" | "normal" | "high" | "urgent";
type TargetAudience = "all_members" | "active_only" | "specific_ranks" | "specific_teams";

// Define the announcement type to match your API response
type Announcement = {
  id: number;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  targetAudience: TargetAudience;
  authorName: string;
  createdAt: Date;
  expiresAt?: Date | null;
  requiresAcknowledgment: boolean;
  acknowledgedCount?: number;
  totalTargets?: number;
};

export default function CommunicationsPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  // Form state
  const [announcementForm, setAnnouncementForm] = useState({
    title: "",
    content: "",
    priority: "normal" as AnnouncementPriority,
    targetAudience: "all_members" as TargetAudience,
    targetRankIds: [] as number[],
    targetTeamIds: [] as number[],
    expiresAt: "",
    requiresAcknowledgment: false,
  });

  // Get department info
  const { data: departmentInfo } = api.dept.discovery.getDepartmentInfo.useQuery({ departmentId });

  // Get department ranks and teams for targeting
  const { data: departmentData } = api.dept.user.info.getDepartment.useQuery({ departmentId });

  // Get current user's member info for this department
  const { data: memberships } = api.dept.discovery.getMyMemberships.useQuery();
  const currentUserMember = memberships?.find(m => m.departmentId === departmentId);

  // Get announcements
  const { data: announcements, isLoading: announcementsLoading, refetch: refetchAnnouncements } =
    api.deptMore.communication.getAnnouncements.useQuery({
      departmentId,
      activeOnly,
      limit: 20,
    });

  // Send announcement mutation
  const sendAnnouncementMutation = api.deptMore.communication.sendAnnouncement.useMutation({
    onSuccess: (data) => {
      console.log("Announcement sent successfully:", data);
      toast.success("Announcement sent successfully!");
      setIsCreateDialogOpen(false);
      setAnnouncementForm({
        title: "",
        content: "",
        priority: "normal",
        targetAudience: "all_members",
        targetRankIds: [],
        targetTeamIds: [],
        expiresAt: "",
        requiresAcknowledgment: false,
      });
      void refetchAnnouncements();
    },
    onError: (error) => {
      console.error("Failed to send announcement:", error);
      toast.error(`Failed to send announcement: ${error.message}`);
    },
  });

  const handleSendAnnouncement = () => {
    if (!announcementForm.title.trim() || !announcementForm.content.trim()) {
      toast.error("Please fill in title and content");
      return;
    }

    if (!currentUserMember?.id) {
      toast.error("Unable to identify current user. Please refresh and try again.");
      return;
    }

    console.log("Sending announcement with data:", {
      departmentId,
      title: announcementForm.title,
      content: announcementForm.content,
      priority: announcementForm.priority,
      targetAudience: announcementForm.targetAudience,
      targetRankIds: announcementForm.targetRankIds.length > 0 ? announcementForm.targetRankIds : undefined,
      targetTeamIds: announcementForm.targetTeamIds.length > 0 ? announcementForm.targetTeamIds : undefined,
      expiresAt: announcementForm.expiresAt ? new Date(announcementForm.expiresAt) : undefined,
      requiresAcknowledgment: announcementForm.requiresAcknowledgment,
    });

    sendAnnouncementMutation.mutate({
      departmentId,
      title: announcementForm.title,
      content: announcementForm.content,
      priority: announcementForm.priority,
      targetAudience: announcementForm.targetAudience,
      targetRankIds: announcementForm.targetRankIds.length > 0 ? announcementForm.targetRankIds : undefined,
      targetTeamIds: announcementForm.targetTeamIds.length > 0 ? announcementForm.targetTeamIds : undefined,
      expiresAt: announcementForm.expiresAt ? new Date(announcementForm.expiresAt) : undefined,
      requiresAcknowledgment: announcementForm.requiresAcknowledgment,
    });
  };

  const getPriorityColor = (priority: AnnouncementPriority) => {
    switch (priority) {
      case "low":
        return "bg-gray-100 text-gray-800 border-gray-200";
      case "normal":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "urgent":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getPriorityIcon = (priority: AnnouncementPriority) => {
    switch (priority) {
      case "urgent":
        return <AlertTriangle className="h-4 w-4" />;
      case "high":
        return <AlertTriangle className="h-4 w-4" />;
      case "normal":
        return <Info className="h-4 w-4" />;
      case "low":
        return <Info className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const formatAudience = (audience: string) => {
    return audience.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const formatPriority = (priority: string) => {
    return priority.charAt(0).toUpperCase() + priority.slice(1);
  };

  // Use real announcements data from API
const announcementsData = announcements || [] as Announcement[];

  const filteredAnnouncements = announcementsData.filter(announcement =>
    (announcement.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (announcement.content || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (announcement.authorName || '').toLowerCase().includes(searchTerm.toLowerCase())
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
              <h1 className="text-3xl font-bold tracking-tight">Department Communications</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Send announcements and manage communications
              </p>
            </div>
          </div>

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Send Announcement
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Send Department Announcement</DialogTitle>
                <DialogDescription>
                  Create and send an announcement to department members.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 max-h-96 overflow-y-auto">
                <div className="grid gap-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={announcementForm.title}
                    onChange={(e) => setAnnouncementForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Announcement title"
                    maxLength={200}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="content">Content *</Label>
                  <Textarea
                    id="content"
                    value={announcementForm.content}
                    onChange={(e) => setAnnouncementForm(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Announcement content"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select
                      value={announcementForm.priority}
                      onValueChange={(value: AnnouncementPriority) =>
                        setAnnouncementForm(prev => ({ ...prev, priority: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="targetAudience">Target Audience</Label>
                    <Select
                      value={announcementForm.targetAudience}
                      onValueChange={(value: TargetAudience) =>
                        setAnnouncementForm(prev => ({ ...prev, targetAudience: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all_members">All Members</SelectItem>
                        <SelectItem value="active_only">Active Only</SelectItem>
                        <SelectItem value="specific_ranks">Specific Ranks</SelectItem>
                        <SelectItem value="specific_teams">Specific Teams</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {announcementForm.targetAudience === "specific_ranks" && (
                  <div className="grid gap-2">
                    <Label>Target Ranks</Label>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {departmentData?.ranks?.map((rank) => (
                        <div key={rank.id} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`rank-${rank.id}`}
                            checked={announcementForm.targetRankIds.includes(rank.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAnnouncementForm(prev => ({
                                  ...prev,
                                  targetRankIds: [...prev.targetRankIds, rank.id]
                                }));
                              } else {
                                setAnnouncementForm(prev => ({
                                  ...prev,
                                  targetRankIds: prev.targetRankIds.filter(id => id !== rank.id)
                                }));
                              }
                            }}
                            className="h-4 w-4"
                          />
                          <Label htmlFor={`rank-${rank.id}`} className="text-sm">
                            {rank.name} (Level {rank.level})
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {announcementForm.targetAudience === "specific_teams" && (
                  <div className="grid gap-2">
                    <Label>Target Teams</Label>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {departmentData?.teams?.map((team) => (
                        <div key={team.id} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`team-${team.id}`}
                            checked={announcementForm.targetTeamIds.includes(team.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAnnouncementForm(prev => ({
                                  ...prev,
                                  targetTeamIds: [...prev.targetTeamIds, team.id]
                                }));
                              } else {
                                setAnnouncementForm(prev => ({
                                  ...prev,
                                  targetTeamIds: prev.targetTeamIds.filter(id => id !== team.id)
                                }));
                              }
                            }}
                            className="h-4 w-4"
                          />
                          <Label htmlFor={`team-${team.id}`} className="text-sm">
                            {team.name}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="expiresAt">Expires At (Optional)</Label>
                  <Input
                    id="expiresAt"
                    type="datetime-local"
                    value={announcementForm.expiresAt}
                    onChange={(e) => setAnnouncementForm(prev => ({ ...prev, expiresAt: e.target.value }))}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="requiresAcknowledgment"
                    checked={announcementForm.requiresAcknowledgment}
                    onCheckedChange={(checked) =>
                      setAnnouncementForm(prev => ({ ...prev, requiresAcknowledgment: checked }))
                    }
                  />
                  <Label htmlFor="requiresAcknowledgment">
                    Require acknowledgment from recipients
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSendAnnouncement}
                  disabled={sendAnnouncementMutation.isPending}
                >
                  {sendAnnouncementMutation.isPending ? "Sending..." : "Send Announcement"}
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
              Search Announcements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-center">
              <div className="flex-1">
                <Input
                  placeholder="Search by title, content, or author..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="active-only"
                  checked={activeOnly}
                  onCheckedChange={setActiveOnly}
                />
                <Label htmlFor="active-only" className="text-sm">
                  Active only
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Announcements List */}
        <div className="space-y-6">
          {announcementsLoading ? (
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
          ) : filteredAnnouncements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Megaphone className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Announcements Found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchTerm
                    ? "No announcements match your search criteria."
                    : "No announcements have been sent yet."
                  }
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Send First Announcement
                </Button>
              </CardContent>
            </Card>
          ) : (
            filteredAnnouncements.map((announcement) => (
              <Card key={announcement.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {getPriorityIcon(announcement.priority)}
                        {announcement.title}
                      </CardTitle>
                      <CardDescription>
                        By {announcement.authorName} • {formatAudience(announcement.targetAudience)}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={getPriorityColor(announcement.priority)}
                      >
                        {formatPriority(announcement.priority)}
                      </Badge>
                      {announcement.expiresAt && announcement.expiresAt > new Date() && (
                        <Badge variant="outline">
                          <Clock className="h-3 w-3 mr-1" />
                          Expires {announcement.expiresAt.toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm leading-relaxed">{announcement.content}</p>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>{announcement.createdAt.toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4" />
                          <span>{announcement.totalTargets} recipients</span>
                        </div>
                        {announcement.requiresAcknowledgment && (
                          <div className="flex items-center gap-1">
                            <CheckCircle className="h-4 w-4" />
                            <span>
                              {announcement.acknowledgedCount}/{announcement.totalTargets} acknowledged
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                        {announcement.requiresAcknowledgment && (
                          <Button variant="outline" size="sm">
                            View Acknowledgments
                          </Button>
                        )}
                      </div>
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