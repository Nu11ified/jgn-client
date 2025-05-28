"use client";

import React, { useState } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Inbox, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import Link from 'next/link';
import FormStatusTracker from './FormStatusTracker'; // Will create this next
import { cn } from '@/lib/utils';

type UserSubmission = RouterOutputs["form"]["listUserSubmissions"]["items"][number];
// We need more detailed form info for the status tracker than listUserSubmissions provides.
// We'll fetch it when a submission is expanded, or adjust listUserSubmissions if that becomes a bottleneck.

const getStatusBadgeVariant = (status: UserSubmission["status"]): "default" | "destructive" | "outline" | "secondary" => {
  switch (status) {
    case "approved": return "default"; 
    case "denied_by_review":
    case "denied_by_approval": return "destructive";
    case "pending_review":
    case "pending_approval": return "secondary"; 
    case "draft": return "outline";
    case "submitted": return "default"; // Using default (often blueish or distinct) for submitted
    default: return "secondary";
  }
};

// Ensure all statuses from formResponseStatusEnum are covered
const statusMessages: Record<UserSubmission["status"], string> = {
  draft: "Draft - Not yet submitted. You can continue editing.",
  submitted: "Submitted - Your form has been received and is awaiting processing.", // Added submitted
  pending_review: "Pending Review - Awaiting reviewer action.",
  pending_approval: "Pending Final Approval - Awaiting final decision.",
  approved: "Approved - Your submission has been accepted!",
  denied_by_review: "Denied by Review - Your submission was not approved by reviewers.",
  denied_by_approval: "Denied by Approval - Your submission was not approved by the final approver.",
};

export default function UserFilledForms() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = 
    api.form.listUserSubmissions.useInfiniteQuery(
      { limit: 10 }, 
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        refetchOnWindowFocus: false,
      }
    );

  const [expandedSubmissionId, setExpandedSubmissionId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg">Loading your submissions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-lg mx-auto border-destructive">
        <CardHeader className="text-center space-y-3">
          <AlertTriangle className="mx-auto h-16 w-16 text-destructive" />
          <CardTitle className="text-2xl">Error Loading Submissions</CardTitle>
          <CardDescription className="text-base text-destructive">
            {error.message ?? "An unexpected error occurred. Please try again later."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pt-6">
          {/* refetch from useInfiniteQuery doesn't take arguments like this */}
          <Button onClick={() => void refetch()} size="lg">Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  const allSubmissions = data?.pages.flatMap(page => page.items) ?? [];

  if (allSubmissions.length === 0) {
    return (
      <Card className="w-full text-center py-12 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <Inbox className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
          <CardTitle className="text-2xl">No Submissions Yet</CardTitle>
          <CardDescription className="mt-2 text-muted-foreground">
            You haven&apos;t submitted any forms. 
            <Link href="/dashboard/form" className="text-primary hover:underline">Fill one out now!</Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const groupedSubmissions = {
    drafts: allSubmissions.filter(s => s.status === 'draft'),
    inProgress: allSubmissions.filter(s => s.status === 'submitted' || s.status === 'pending_review' || s.status === 'pending_approval'),
    accepted: allSubmissions.filter(s => s.status === 'approved'),
    denied: allSubmissions.filter(s => s.status === 'denied_by_review' || s.status === 'denied_by_approval'),
  };

  const renderSubmissionGroup = (title: string, submissions: UserSubmission[], groupKey: string) => {
    if (submissions.length === 0) return null;
    return (
      <section key={groupKey} aria-labelledby={`group-title-${groupKey}`}>
        <h2 id={`group-title-${groupKey}`} className="text-xl font-semibold tracking-tight text-foreground mb-4 capitalize">
          {title} ({submissions.length})
        </h2>
        <div className="space-y-4">
          {submissions.map(submission => (
            <Card key={submission.id} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-card">
              <CardHeader 
                className="flex flex-row items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedSubmissionId(expandedSubmissionId === submission.id ? null : submission.id)}
              >
                <div className="flex-grow">
                  <CardTitle className="text-md font-medium">
                    {submission.form?.title ?? `Form ID: ${submission.formId}`}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-1">
                    Last Updated: {new Date(submission.updatedAt ?? submission.submittedAt).toLocaleDateString()} ({new Date(submission.updatedAt ?? submission.submittedAt).toLocaleTimeString()})
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge variant={getStatusBadgeVariant(submission.status)} className="text-xs capitalize whitespace-nowrap">
                        {submission.status.replace(/_/g, ' ')}
                    </Badge>
                    {expandedSubmissionId === submission.id ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </div>
              </CardHeader>
              {expandedSubmissionId === submission.id && (
                <CardContent className="p-4 border-t bg-background/50">
                  <p className="text-sm text-muted-foreground mb-3 italic">{statusMessages[submission.status]}</p>
                  <FormStatusTracker responseId={submission.id} />
                  <div className="mt-4 flex gap-2">
                    {submission.status === 'draft' && (
                       <Button asChild size="sm" variant="default">
                          {/* Pass responseId for drafts to allow loading specific draft answers */}
                          <Link href={`/dashboard/form/${submission.formId}?responseId=${submission.id}`}>Continue Editing</Link>
                      </Button>
                    )}
                    {/* For non-drafts, link to a read-only submission detail page */}
                    {submission.status !== 'draft' && (
                        <Button asChild size="sm" variant="outline">
                            <Link href={`/dashboard/form/submission/${submission.id}`}>View Submission Details</Link>
                        </Button>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      {renderSubmissionGroup("Drafts", groupedSubmissions.drafts, "drafts")}
      {renderSubmissionGroup("In Progress", groupedSubmissions.inProgress, "inProgress")}
      {renderSubmissionGroup("Accepted", groupedSubmissions.accepted, "accepted")}
      {renderSubmissionGroup("Denied", groupedSubmissions.denied, "denied")}

      {hasNextPage && (
        <div className="flex justify-center mt-8">
          <Button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} variant="outline">
            {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load More Submissions
          </Button>
        </div>
      )}
    </div>
  );
} 