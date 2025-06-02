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
                  <h3 className="text-lg font-semibold mb-3">
                    Reviewer Decisions 
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({typedResponse.reviewerDecisions.length} {typedResponse.reviewerDecisions.length === 1 ? 'review' : 'reviews'})
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {typedResponse.reviewerDecisions.map((review, index) => (
                      <Card key={`review-${index}`} className={`bg-muted/30 p-4 transition-colors ${
                        review.decision === 'yes' ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-500'
                      }`}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold">
                                {review.reviewerFullName ?? review.reviewerName ?? 'N/A'}
                              </p>
                              <Badge variant={review.decision === 'yes' ? 'default' : 'destructive'} 
                                     className={`${review.decision === 'yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {review.decision === 'yes' ? 'APPROVED' : 'DENIED'}
                              </Badge>
                            </div>
                            {review.reviewerDiscordId && (
                              <p className="text-xs text-muted-foreground mt-1 flex items-center">
                                <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.127a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.216.642-1.873.892a.077.077 0 0 0-.041.106c.36.698.772 1.362 1.225 1.994a.076.076 0 0 0 .084.028a19.834 19.834 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                                </svg>
                                {review.reviewerDiscordId}
                              </p>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(review.reviewedAt), { addSuffix: true })}
                          </p>
                        </div>
                        {review.comments && (
                          <div className="mt-2 bg-background/50 rounded-md p-3 border">
                            <p className="text-sm text-muted-foreground">
                              {review.comments}
                            </p>
                          </div>
                        )}
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