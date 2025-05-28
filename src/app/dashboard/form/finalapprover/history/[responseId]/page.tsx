"use client";

import React from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import type { FormQuestion, FormAnswer, ReviewerDecisionObject } from "@/server/postgres/schema/form";

// Helper to format dates
const formatDate = (date: Date | string | undefined | null) => {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

// Helper to determine badge color based on status
const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" | null | undefined => {
  switch (status) {
    case "pending_review":
    case "pending_approval":
      return "secondary";
    case "approved":
      return "default";
    case "denied_by_review":
    case "denied_by_approval":
      return "destructive";
    case "draft":
      return "secondary";
    default:
      return "outline";
  }
};

type AugmentedReviewerDecision = ReviewerDecisionObject & {
  reviewerFullName?: string;
  reviewerDiscordId?: string;
};

type FormResponseWithDetails = RouterOutputs["form"]["getResponseById"] & {
  reviewerDecisions?: AugmentedReviewerDecision[];
};

const renderAnswer = (answerItem: FormAnswer, question: FormQuestion | undefined) => {
  if (!question) {
    return (
      <div key={`answer-${answerItem.questionId}-notfound`} className="py-3 border-b last:border-b-0">
        <p className="font-medium text-sm text-muted-foreground">Question (ID: {answerItem.questionId}) not found.</p>
      </div>
    );
  }

  let displayValue: React.ReactNode = <span className="text-muted-foreground italic">Not answered</span>;
  switch (question.type) {
    case 'true_false':
      if (answerItem.type === 'true_false') {
        displayValue = answerItem.answer ? 'True' : 'False';
      }
      break;
    case 'multiple_choice':
      if (answerItem.type === 'multiple_choice') {
        displayValue = answerItem.answer.length > 0 
          ? answerItem.answer.join(', ') 
          : displayValue;
      }
      break;
    case 'short_answer':
    case 'long_answer':
      if (answerItem.type === question.type && answerItem.answer.trim() !== '') {
        displayValue = answerItem.answer;
      }
      break;
  }

  return (
    <div key={question.id} className="py-3 border-b last:border-b-0">
      <Label htmlFor={`answer-${question.id}`} className="text-sm font-semibold text-muted-foreground">{question.text}</Label>
      <p id={`answer-${question.id}`} className="mt-1 text-sm whitespace-pre-wrap">{displayValue}</p>
    </div>
  );
};

interface PageProps {
  params: Promise<{ responseId: string }>;
}

export default function FormResponseDetailsPage({ params }: PageProps) {
  // Use React.use() to handle the params promise
  const resolvedParams = React.use(params);
  const responseId = parseInt(resolvedParams.responseId, 10);
  
  const { data: response, isLoading, error } = api.form.getResponseById.useQuery(
    { responseId },
    { enabled: !isNaN(responseId) }
  );

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
          <p>Loading response details...</p>
        </div>
      </div>
    );
  }

  if (error || !response) {
    return (
      <div className="container mx-auto p-4">
        <Card className="w-full max-w-lg mx-auto border-destructive">
          <CardHeader className="text-center space-y-2">
            <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
            <CardTitle className="text-xl">Error Loading Response</CardTitle>
            <CardDescription className="text-destructive">{error?.message ?? "Response not found."}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pt-4">
            <Button asChild variant="outline">
              <Link href="/dashboard/form/finalapprover/history">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to History
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const typedResponse = response as FormResponseWithDetails;

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/form/finalapprover/history">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to History
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{typedResponse.form?.title}</CardTitle>
              <CardDescription>
                Submitted by {typedResponse.submitterFullName ?? typedResponse.userId} 
                {typedResponse.submitterDiscordId && ` (Discord: ${typedResponse.submitterDiscordId})`}
                <br />
                {formatDistanceToNow(new Date(typedResponse.submittedAt), { addSuffix: true })}
              </CardDescription>
            </div>
            <Badge variant={getStatusBadgeVariant(typedResponse.status)}>
              {typedResponse.status.replace(/_/g, " ").toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-400px)] pr-4">
            <div className="space-y-6">
              {/* Form Answers */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Responses</h3>
                {typedResponse.answers.map(answer => {
                  const question = typedResponse.form?.questions.find(q => q.id === answer.questionId);
                  return renderAnswer(answer, question);
                })}
              </div>

              {/* Reviewer Decisions */}
              {typedResponse.reviewerDecisions && typedResponse.reviewerDecisions.length > 0 && (
                <div className="pt-6 border-t">
                  <h3 className="text-lg font-semibold mb-3">Reviewer Decisions</h3>
                  <div className="space-y-3">
                    {typedResponse.reviewerDecisions.map((review, index) => (
                      <Card key={`review-${index}`} className="bg-muted/30 p-3">
                        <div className="flex justify-between items-center mb-1">
                          <div>
                            <p className="text-sm font-medium">
                              {review.reviewerFullName ?? review.reviewerName ?? 'N/A'}
                            </p>
                            {review.reviewerDiscordId && (
                              <p className="text-xs text-muted-foreground">
                                Discord: {review.reviewerDiscordId}
                              </p>
                            )}
                          </div>
                          <Badge variant={review.decision === 'yes' ? 'default' : 'destructive'}>
                            {review.decision.toUpperCase()}
                          </Badge>
                        </div>
                        {review.comments && (
                          <div className="mt-2 border-l-2 pl-2">
                            <p className="text-sm text-muted-foreground">
                              <span className="font-medium">Comments:</span> {review.comments}
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          Reviewed {formatDistanceToNow(new Date(review.reviewedAt), { addSuffix: true })}
                        </p>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Final Approval */}
              {typedResponse.finalApproverId && (
                <div className="pt-6 border-t">
                  <h3 className="text-lg font-semibold mb-3">Final Approval</h3>
                  <Card className="bg-muted/30 p-3">
                    <div className="flex justify-between items-center mb-1">
                      <div>
                        <p className="text-sm font-medium">
                          {typedResponse.finalApproverFullName ?? 'N/A'}
                        </p>
                        {typedResponse.finalApproverDiscordId && (
                          <p className="text-xs text-muted-foreground">
                            Discord: {typedResponse.finalApproverDiscordId}
                          </p>
                        )}
                      </div>
                      <Badge variant={typedResponse.finalApprovalDecision ? 'default' : 'destructive'}>
                        {typedResponse.finalApprovalDecision ? 'APPROVED' : 'DENIED'}
                      </Badge>
                    </div>
                    {typedResponse.finalApprovalComments && (
                      <div className="mt-2 border-l-2 pl-2">
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">Comments:</span> {typedResponse.finalApprovalComments}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Decision made {formatDistanceToNow(new Date(typedResponse.finalApprovedAt!), { addSuffix: true })}
                    </p>
                  </Card>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
} 