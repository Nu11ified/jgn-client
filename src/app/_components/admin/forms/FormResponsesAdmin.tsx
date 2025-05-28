"use client";

import React, { useState, useEffect } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Inbox, Eye } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { skipToken } from '@tanstack/react-query';

// Assuming FormResponseStatus is exported from your schema or a known set of string literals
// Example: type FormResponseStatus = "pending_review" | "pending_approval" | "approved" | "denied_by_review" | "denied_by_approval" | "draft";
// We can get this from RouterOutputs too if available or define based on formResponseStatusEnum

// Base types from TRPC outputs
type BaseFormResponseItem = RouterOutputs["form"]["listResponsesForForm"]["items"][number];
type BaseReviewerDecision = BaseFormResponseItem["reviewerDecisions"] extends (infer U)[] | null ? U : never;

// Augmented types for frontend use
type AugmentedReviewerDecision = BaseReviewerDecision & {
    reviewerFullName?: string;
    reviewerDiscordId?: string;
};

type FormResponseItem = Omit<BaseFormResponseItem, "reviewerDecisions"> & {
  submitterFullName?: string;
  submitterDiscordId?: string;
  reviewerDecisions?: AugmentedReviewerDecision[] | null; // Keep null to match original possibility
  finalApproverFullName?: string;
  finalApproverDiscordId?: string;
};

type FormQuestionDefinition = RouterOutputs["form"]["getFormById"]["questions"][number];
type FormListItem = RouterOutputs["form"]["listForms"]["items"][number];

// Helper to format dates (optional, but nice for UI)
const formatDate = (date: Date | string | undefined | null) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

// Helper to make status badges look nicer
const getStatusVariant = (status: FormResponseItem["status"]): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case 'approved':
      return 'default'; // Greenish in default themes
    case 'denied_by_review':
    case 'denied_by_approval':
      return 'destructive';
    case 'pending_review':
    case 'pending_approval':
      return 'secondary'; // Yellowish/Orange
    case 'draft':
      return 'outline';
    default:
      return 'outline';
  }
};

export default function FormResponsesAdmin() {
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [viewingResponse, setViewingResponse] = useState<FormResponseItem | null>(null);
  const [formQuestions, setFormQuestions] = useState<FormQuestionDefinition[]>([]);

  const formsQuery = api.form.listForms.useQuery({});
  const responsesQuery = api.form.listResponsesForForm.useQuery(
    { formId: selectedFormId! },
    { enabled: selectedFormId !== null }
  );
  
  const formDetailsForAnswersQuery = api.form.getFormById.useQuery(
    viewingResponse ? { id: viewingResponse.formId } : skipToken,
    { enabled: !!viewingResponse }
  );

  // Use useEffect to update formQuestions when formDetailsForAnswersQuery.data changes
  useEffect(() => {
    if (formDetailsForAnswersQuery.data?.questions) {
      setFormQuestions(formDetailsForAnswersQuery.data.questions);
    }
  }, [formDetailsForAnswersQuery.data]);

  const handleFormChange = (formIdString: string) => {
    const formId = parseInt(formIdString, 10);
    setSelectedFormId(isNaN(formId) ? null : formId);
    setViewingResponse(null);
  };

  const openResponseDetailsDialog = (response: FormResponseItem) => {
    setViewingResponse(response);
  };

  const renderAnswer = (answerItem: BaseFormResponseItem['answers'][number], question?: FormQuestionDefinition) => {
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
        displayValue = typeof answerItem.answer === 'boolean' ? (answerItem.answer ? 'True' : 'False') : displayValue;
        break;
      case 'multiple_choice':
        displayValue = Array.isArray(answerItem.answer) && answerItem.answer.length > 0 
          ? answerItem.answer.join(', ') 
          : (Array.isArray(answerItem.answer) ? displayValue : <span className="text-destructive">Invalid answer format</span>);
        break;
      case 'short_answer':
      case 'long_answer':
        displayValue = typeof answerItem.answer === 'string' && answerItem.answer.trim() !== '' 
          ? answerItem.answer 
          : displayValue;
        break;
      default:
        displayValue = <span className="text-destructive">Unknown question type</span>;
    }
    return (
      <div key={question.id} className="py-3 border-b last:border-b-0">
        <Label htmlFor={`answer-${question.id}`} className="text-sm font-semibold text-muted-foreground">{question.text}</Label>
        <p id={`answer-${question.id}`} className="mt-1 text-sm whitespace-pre-wrap">{displayValue}</p>
      </div>
    );
  };

  if (formsQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
        <p>Loading forms...</p>
      </div>
    );
  }

  if (formsQuery.isError) {
    return (
      <Card className="w-full max-w-lg mx-auto border-destructive">
        <CardHeader className="text-center space-y-2">
          <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
          <CardTitle className="text-xl">Error Loading Forms</CardTitle>
          <CardDescription className="text-destructive">{formsQuery.error?.message ?? "An unexpected error occurred."}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pt-4">
          <Button onClick={() => formsQuery.refetch()}>Try Again</Button>
        </CardContent>
      </Card>
    );
  }
  
  const forms = formsQuery.data?.items ?? [];
  const responses = responsesQuery.data?.items as FormResponseItem[] ?? [];

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Filter Responses</CardTitle>
          {/* <CardDescription>Select a form to view its submitted responses.</CardDescription> */}
        </CardHeader>
        <CardContent>
          <div> {/* Removed mb-4 as CardContent has padding */} 
            <Label htmlFor="form-select" className="mb-1.5 block text-sm font-medium">Select Form</Label>
            <Select onValueChange={handleFormChange} value={selectedFormId?.toString() ?? ""}>
              <SelectTrigger id="form-select" className="w-full sm:w-auto min-w-[250px]">
                <SelectValue placeholder="Choose a form..." />
              </SelectTrigger>
              <SelectContent>
                {forms.length === 0 ? (
                    <SelectItem value="__NO_FORMS__" disabled>No forms available</SelectItem>
                ) : (
                    forms.map((form) => (
                        <SelectItem key={form.id} value={form.id.toString()}>
                            {form.title}
                        </SelectItem>
                    ))
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedFormId && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Responses: {forms.find(f => f.id === selectedFormId)?.title ?? 'Selected Form'}</CardTitle>
            {/* Future: Add status filter dropdown here */}
          </CardHeader>
          <CardContent>
            {responsesQuery.isLoading && (
                <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                    <p>Loading responses...</p>
                </div>
            )}
            {responsesQuery.isError && (
              <div className="text-center py-6 space-y-2">
                <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">Error loading responses</p>
                <p className="text-sm text-muted-foreground">{responsesQuery.error?.message}</p>
                <Button variant="outline" size="sm" onClick={() => responsesQuery.refetch()} className="mt-2">Retry</Button>
              </div>
            )}
            {responsesQuery.isSuccess && responses.length === 0 && (
              <div className="text-center py-10 border border-dashed rounded-lg min-h-[200px] flex flex-col justify-center items-center">
                <Inbox className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                <h3 className="text-lg font-medium">No Responses Found</h3>
                <p className="mt-1 text-sm text-muted-foreground">This form doesn&apos;t have any submitted responses yet.</p>
              </div>
            )}
            {responsesQuery.isSuccess && responses.length > 0 && (
              <ScrollArea className="max-h-[600px] border rounded-md">
                <Table className="relative">
                  <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-[200px]">Submitted By</TableHead>
                      <TableHead className="w-[200px]">Submitted At</TableHead>
                      <TableHead className="w-[180px]">Status</TableHead>
                      <TableHead className="text-right w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {responses.map((response) => (
                      <TableRow key={response.id} className="hover:bg-muted/50 transition-colors">
                        <TableCell className="font-medium py-3">
                          {response.submitterFullName ?? `User ID: ${response.userId}`}
                          {response.submitterDiscordId && <span className="block text-xs text-muted-foreground">Discord: {response.submitterDiscordId}</span>}
                        </TableCell>
                        <TableCell className="text-sm py-3">{formatDate(response.submittedAt)}</TableCell>
                        <TableCell className="py-3">
                          <Badge variant={getStatusVariant(response.status)} className="capitalize text-xs font-medium">
                            {response.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right py-3">
                          <Button variant="outline" size="sm" onClick={() => openResponseDetailsDialog(response)} className="flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5" /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!viewingResponse} onOpenChange={(isOpen) => !isOpen && setViewingResponse(null)}>
        <DialogContent className="max-w-2xl sm:max-w-3xl md:max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader className="pt-6 px-6">
            <DialogTitle className="text-2xl">Response Details</DialogTitle>
            <DialogDescription>
              Submitted by: {viewingResponse?.submitterFullName ?? (viewingResponse?.userId ? `User ID: ${viewingResponse.userId}`: 'N/A')}
              {viewingResponse?.submitterDiscordId && ` (Discord: ${viewingResponse.submitterDiscordId})`}
              {' '}on {formatDate(viewingResponse?.submittedAt)}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-grow p-6 border-t border-b">
            {formDetailsForAnswersQuery.isLoading && (
                <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                    <p>Loading question details...</p>
                </div>
            )}
            {formDetailsForAnswersQuery.isError && <p className="text-destructive p-4 text-center">Error loading question details: {formDetailsForAnswersQuery.error.message}</p>}
            {viewingResponse && formDetailsForAnswersQuery.isSuccess && formQuestions.length > 0 && (
                <div className="space-y-4">
                    {viewingResponse.answers.map(answerItem => {
                        const question = formQuestions.find(q => q.id.toString() === answerItem.questionId);
                        return renderAnswer(answerItem, question);
                    })}
                </div>
            )}
            {viewingResponse && formDetailsForAnswersQuery.isSuccess && formQuestions.length === 0 && !formDetailsForAnswersQuery.isLoading && (
                <p className="text-muted-foreground p-4 text-center">Could not load questions for this form to display answers.</p>
            )}

            {/* Reviewer Decisions Section */}
            {viewingResponse?.reviewerDecisions && viewingResponse.reviewerDecisions.length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="text-lg font-semibold mb-3 text-muted-foreground">Reviewer Decisions</h3>
                <div className="space-y-3">
                  {viewingResponse.reviewerDecisions.map((review, index) => (
                    <Card key={`review-${index}`} className="bg-muted/30 p-3 shadow-sm">
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-xs text-foreground">
                          {/* Reviewer ID: <span className="font-medium">{review.userId}</span> */}
                          {/* <br /> */}
                          Reviewer Name: <span className="font-medium">{review.reviewerFullName ?? review.reviewerName ?? 'N/A'}</span>
                          {review.reviewerDiscordId && <span className="block text-xs text-muted-foreground">Discord: {review.reviewerDiscordId}</span>}
                        </p>
                        <Badge variant={review.decision === 'yes' ? 'default' : 'destructive'} 
                               className={`capitalize text-xs ${review.decision === 'yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                           {review.decision}
                        </Badge>
                      </div>
                      {review.comments && (
                        <p className="text-xs text-muted-foreground italic mt-1 border-l-2 pl-2 py-0.5">
                          Comment: {review.comments}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">Reviewed on: {formatDate(review.reviewedAt)}</p>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Final Approval Section */}
            {viewingResponse?.finalApproverId && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="text-lg font-semibold mb-3 text-muted-foreground">Final Approval Decision</h3>
                <Card className="bg-muted/30 p-3 shadow-sm">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-xs text-foreground">
                      {/* Approver ID: <span className="font-medium">{viewingResponse.finalApproverId}</span> */}
                      {/* <br /> */}
                      Approver Name: <span className="font-medium">{viewingResponse.finalApproverFullName ?? 'N/A'}</span>
                      {viewingResponse.finalApproverDiscordId && <span className="block text-xs text-muted-foreground">Discord: {viewingResponse.finalApproverDiscordId}</span>}
                    </p>
                    <Badge variant={viewingResponse.finalApprovalDecision ? 'default' : 'destructive'} 
                           className={`capitalize text-xs ${viewingResponse.finalApprovalDecision ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                       {viewingResponse.finalApprovalDecision ? 'Approved' : 'Denied'}
                    </Badge>
                  </div>
                  {viewingResponse.finalApprovalComments && (
                     <p className="text-xs text-muted-foreground italic mt-1 border-l-2 pl-2 py-0.5">
                      Comment: {viewingResponse.finalApprovalComments}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Decision Date: {formatDate(viewingResponse.finalApprovedAt)}</p>
                </Card>
              </div>
            )}

          </ScrollArea>
          <DialogFooter className="px-6 py-4 border-t bg-background">
            <DialogClose asChild>
              <Button type="button" variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 