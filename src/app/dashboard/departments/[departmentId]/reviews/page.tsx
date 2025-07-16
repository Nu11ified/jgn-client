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
  Star,
  Plus,
  Search,
  User,
  Calendar,
  TrendingUp,
  Award,
  Target,
  CheckCircle
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
import { Checkbox } from "@/components/ui/checkbox";

type RecommendedAction = "promotion" | "training" | "mentoring" | "disciplinary" | "no_action";

type PerformanceReview = {
  id: number;
  memberName: string;
  memberCallsign: string;
  reviewerName: string;
  reviewPeriodStart: Date;
  reviewPeriodEnd: Date;
  overallRating: number;
  strengths: string;
  areasForImprovement: string;
  goals: string;
  recommendedActions: RecommendedAction[];
  createdAt: Date;
};

export default function PerformanceReviewsPage() {
  const params = useParams<{ departmentId: string }>();
  const departmentId = parseInt(params.departmentId);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Form state
  const [reviewForm, setReviewForm] = useState({
    memberId: "",
    reviewPeriodStart: "",
    reviewPeriodEnd: "",
    overallRating: 3,
    strengths: "",
    areasForImprovement: "",
    goals: "",
    recommendedActions: [] as RecommendedAction[],
  });

  // Get department info
  const { data: departmentInfo } = api.dept.discovery.getDepartmentInfo.useQuery({ departmentId });

  // Get department members for review selection
  const { data: membersData } = api.deptMore.search.searchMembers.useQuery({
    departmentId,
    limit: 100, // Get all members for review selection
    sortBy: "name",
    sortOrder: "asc",
  });
  const members = membersData?.members;

  // Get current user's member info for this department
  const { data: memberships } = api.dept.discovery.getMyMemberships.useQuery();
  const currentUserMember = memberships?.find(m => m.departmentId === departmentId);

  // Get performance reviews
  const { data: reviews, isLoading: reviewsLoading, refetch: refetchReviews } =
    api.deptMore.reviews.getReviews.useQuery({
      departmentId,
    });

  // Conduct performance review mutation
  const conductReviewMutation = api.deptMore.reviews.conductReview.useMutation({
    onSuccess: (data) => {
      console.log("Review submitted successfully:", data);
      toast.success("Performance review completed successfully!");
      setIsCreateDialogOpen(false);
      setReviewForm({
        memberId: "",
        reviewPeriodStart: "",
        reviewPeriodEnd: "",
        overallRating: 3,
        strengths: "",
        areasForImprovement: "",
        goals: "",
        recommendedActions: [],
      });
      void refetchReviews();
    },
    onError: (error) => {
      console.error("Review submission failed:", error);
      toast.error(`Failed to conduct performance review: ${error.message}`);
    },
  });

  const handleConductReview = () => {
    if (!reviewForm.memberId || !reviewForm.reviewPeriodStart || !reviewForm.reviewPeriodEnd) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (!reviewForm.strengths.trim() || !reviewForm.areasForImprovement.trim() || !reviewForm.goals.trim()) {
      toast.error("Please provide strengths, areas for improvement, and goals");
      return;
    }

    if (!currentUserMember?.id) {
      toast.error("Unable to identify current user. Please refresh and try again.");
      return;
    }

    console.log("Submitting review with data:", {
      memberId: parseInt(reviewForm.memberId),
      reviewerId: currentUserMember.id,
      reviewPeriodStart: new Date(reviewForm.reviewPeriodStart),
      reviewPeriodEnd: new Date(reviewForm.reviewPeriodEnd),
      overallRating: reviewForm.overallRating,
      strengths: reviewForm.strengths,
      areasForImprovement: reviewForm.areasForImprovement,
      goals: reviewForm.goals,
      recommendedActions: reviewForm.recommendedActions,
    });

    conductReviewMutation.mutate({
      memberId: parseInt(reviewForm.memberId),
      reviewerId: currentUserMember.id,
      reviewPeriodStart: new Date(reviewForm.reviewPeriodStart),
      reviewPeriodEnd: new Date(reviewForm.reviewPeriodEnd),
      overallRating: reviewForm.overallRating,
      strengths: reviewForm.strengths,
      areasForImprovement: reviewForm.areasForImprovement,
      goals: reviewForm.goals,
      recommendedActions: reviewForm.recommendedActions,
    });
  };

  const handleActionToggle = (action: RecommendedAction, checked: boolean) => {
    setReviewForm(prev => ({
      ...prev,
      recommendedActions: checked
        ? [...prev.recommendedActions, action]
        : prev.recommendedActions.filter(a => a !== action)
    }));
  };

  const getRatingColor = (rating: number) => {
    if (rating >= 4.5) return "text-green-600";
    if (rating >= 3.5) return "text-blue-600";
    if (rating >= 2.5) return "text-yellow-600";
    return "text-red-600";
  };

  const formatAction = (action: string) => {
    return action.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  // Use real reviews data from API
  const reviewsData = reviews || [] as PerformanceReview[];

  const filteredReviews = reviewsData.filter(review =>
    (review.memberName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (review.memberCallsign || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (review.reviewerName || '').toLowerCase().includes(searchTerm.toLowerCase())
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
              <h1 className="text-3xl font-bold tracking-tight">Performance Reviews</h1>
              <p className="text-muted-foreground">
                {departmentInfo?.name} - Conduct and manage member performance evaluations
              </p>
            </div>
          </div>

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Conduct Review
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Conduct Performance Review</DialogTitle>
                <DialogDescription>
                  Evaluate a member's performance and provide feedback for their development.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 max-h-96 overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="member">Member *</Label>
                    <Select
                      value={reviewForm.memberId}
                      onValueChange={(value) => setReviewForm(prev => ({ ...prev, memberId: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select member to review" />
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
                    <Label htmlFor="overallRating">Overall Rating (1-5) *</Label>
                    <Select
                      value={reviewForm.overallRating.toString()}
                      onValueChange={(value) => setReviewForm(prev => ({ ...prev, overallRating: parseInt(value) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 - Needs Improvement</SelectItem>
                        <SelectItem value="2">2 - Below Expectations</SelectItem>
                        <SelectItem value="3">3 - Meets Expectations</SelectItem>
                        <SelectItem value="4">4 - Exceeds Expectations</SelectItem>
                        <SelectItem value="5">5 - Outstanding</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="reviewPeriodStart">Review Period Start *</Label>
                    <Input
                      id="reviewPeriodStart"
                      type="date"
                      value={reviewForm.reviewPeriodStart}
                      onChange={(e) => setReviewForm(prev => ({ ...prev, reviewPeriodStart: e.target.value }))}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="reviewPeriodEnd">Review Period End *</Label>
                    <Input
                      id="reviewPeriodEnd"
                      type="date"
                      value={reviewForm.reviewPeriodEnd}
                      onChange={(e) => setReviewForm(prev => ({ ...prev, reviewPeriodEnd: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="strengths">Strengths *</Label>
                  <Textarea
                    id="strengths"
                    value={reviewForm.strengths}
                    onChange={(e) => setReviewForm(prev => ({ ...prev, strengths: e.target.value }))}
                    placeholder="What does this member do well? Highlight their key strengths and achievements."
                    rows={3}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="areasForImprovement">Areas for Improvement *</Label>
                  <Textarea
                    id="areasForImprovement"
                    value={reviewForm.areasForImprovement}
                    onChange={(e) => setReviewForm(prev => ({ ...prev, areasForImprovement: e.target.value }))}
                    placeholder="What areas could this member improve in? Be constructive and specific."
                    rows={3}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="goals">Goals for Next Period *</Label>
                  <Textarea
                    id="goals"
                    value={reviewForm.goals}
                    onChange={(e) => setReviewForm(prev => ({ ...prev, goals: e.target.value }))}
                    placeholder="What goals should this member work towards in the next review period?"
                    rows={3}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Recommended Actions</Label>
                  <div className="space-y-2">
                    {(["promotion", "training", "mentoring", "disciplinary", "no_action"] as RecommendedAction[]).map((action) => (
                      <div key={action} className="flex items-center space-x-2">
                        <Checkbox
                          id={action}
                          checked={reviewForm.recommendedActions.includes(action)}
                          onCheckedChange={(checked) => handleActionToggle(action, checked as boolean)}
                        />
                        <Label htmlFor={action} className="text-sm font-normal">
                          {formatAction(action)}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleConductReview}
                  disabled={conductReviewMutation.isPending}
                >
                  {conductReviewMutation.isPending ? "Submitting..." : "Submit Review"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search Reviews
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Search by member name, callsign, or reviewer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Performance Reviews List */}
        <div className="space-y-6">
          {reviewsLoading ? (
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
          ) : filteredReviews.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Star className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Performance Reviews Found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchTerm
                    ? "No reviews match your search criteria."
                    : "No performance reviews have been conducted yet."
                  }
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Conduct First Review
                </Button>
              </CardContent>
            </Card>
          ) : (
            filteredReviews.map((review) => (
              <Card key={review.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        {review.memberName} ({review.memberCallsign})
                      </CardTitle>
                      <CardDescription>
                        Reviewed by {review.reviewerName} • {review.reviewPeriodStart.toLocaleDateString()} - {review.reviewPeriodEnd.toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Star className={`h-4 w-4 ${getRatingColor(review.overallRating)}`} />
                        <span className={`font-medium ${getRatingColor(review.overallRating)}`}>
                          {review.overallRating}/5
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <h4 className="font-medium text-green-700 mb-2 flex items-center gap-1">
                          <Award className="h-4 w-4" />
                          Strengths
                        </h4>
                        <p className="text-sm text-muted-foreground">{review.strengths}</p>
                      </div>

                      <div>
                        <h4 className="font-medium text-orange-700 mb-2 flex items-center gap-1">
                          <TrendingUp className="h-4 w-4" />
                          Areas for Improvement
                        </h4>
                        <p className="text-sm text-muted-foreground">{review.areasForImprovement}</p>
                      </div>

                      <div>
                        <h4 className="font-medium text-blue-700 mb-2 flex items-center gap-1">
                          <Target className="h-4 w-4" />
                          Goals
                        </h4>
                        <p className="text-sm text-muted-foreground">{review.goals}</p>
                      </div>
                    </div>

                    {review.recommendedActions.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2 flex items-center gap-1">
                          <CheckCircle className="h-4 w-4" />
                          Recommended Actions
                        </h4>
                        <div className="flex gap-2 flex-wrap">
                          {review.recommendedActions.map((action) => (
                            <Badge key={action} variant="secondary">
                              {formatAction(action)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-4 border-t">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>Reviewed on {review.createdAt.toLocaleDateString()}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          View Full Review
                        </Button>
                        <Button variant="outline" size="sm">
                          Follow Up
                        </Button>
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