"use client";

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type RouterOutputs } from '@/trpc/react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Loader2, ThumbsUp, ThumbsDown, Info, EyeOff, AlertTriangle, CheckCircle, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type FormResponseWithFullForm = RouterOutputs["form"]["getResponseById"];
type FormQuestionDefinition = FormResponseWithFullForm["form"]["questions"][number];
type AnswerItem = FormResponseWithFullForm["answers"][number];
type ReviewerDecisionEntry = NonNullable<FormResponseWithFullForm["reviewerDecisions"]>[number];

const FinalApprovalSubmissionPage = () => {
  const params = useParams();
  const router = useRouter();
  const responseId = parseInt(params.responseId as string, 10);

  const [approvalComments, setApprovalComments] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const { data: responseData, isLoading: isLoadingResponse, error: responseError, refetch } = 
    api.form.getResponseById.useQuery(
      { responseId }, 
      { enabled: !isNaN(responseId) }
    );
  
  const approvalMutation = api.form.approveResponse.useMutation({
    onSuccess: (data) => {
      console.log("Final Decision Submitted Successfully", data);
      void refetch(); 
      router.push("/dashboard/form/finalapprover");
    },
    onError: (error) => {
      setSubmissionError(error.message);
      console.error("Final Decision Submission Failed", error);
    },
  });

  const handleSubmitApproval = (decision: boolean) => {
    if (isNaN(responseId)) {
      setSubmissionError("Invalid response ID.");
      return;
    }
    setSubmissionError(null);
    approvalMutation.mutate({ 
      responseId,
      decision,
      comments: approvalComments 
    });
  };

  const renderAnswerValue = (answer: AnswerItem, question: FormQuestionDefinition) => {
    let displayValue: React.ReactNode = <span className="text-sm text-muted-foreground italic">Not answered</span>;
    const actualAnswer = answer.answer;
    try {
        switch (question.type) {
        case 'true_false':
            displayValue = typeof actualAnswer === 'boolean' ? (actualAnswer ? 'True' : 'False') : 
                           (String(actualAnswer).toLowerCase() === 'true' ? 'True' : (String(actualAnswer).toLowerCase() === 'false' ? 'False' : displayValue));
            break;
        case 'multiple_choice':
            let mcAnswer: string[] = [];
            if (Array.isArray(actualAnswer)) {
                mcAnswer = actualAnswer.map(String);
            } else if (typeof actualAnswer === 'string') {
                try { 
                    const parsed = JSON.parse(actualAnswer) as string[];
                    if (Array.isArray(parsed)) mcAnswer = parsed.map(String); 
                } catch { /* ignore */ }
            }
            displayValue = mcAnswer.length > 0 ? mcAnswer.join(', ') : displayValue;
            break;
        case 'short_answer':
        case 'long_answer':
            displayValue = (actualAnswer !== null && actualAnswer !== undefined && String(actualAnswer).trim() !== '') 
            ? String(actualAnswer) 
            : displayValue;
            break;
        default:
            displayValue = <span className="text-destructive text-sm">Unknown question type</span>;
        }
    } catch (e) {
        console.error("Error rendering answer:", e);
        displayValue = <span className="text-destructive text-sm">Error displaying answer</span>;
    }
    return displayValue;
  };

  if (isLoadingResponse) {
    return (
      <div className="container mx-auto py-10 px-4 flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading submission for final approval...</p>
      </div>
    );
  }

  if (responseError) {
    return (
      <div className="container mx-auto py-10 px-4 text-center">
        <Card className="max-w-md mx-auto shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl text-destructive flex items-center justify-center">
              {responseError.data?.code === 'FORBIDDEN' ? <EyeOff className="h-8 w-8 mr-2" /> : <AlertTriangle className="h-8 w-8 mr-2" />}
              {responseError.data?.code === 'FORBIDDEN' ? "Access Denied" : "Error Loading Submission"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-6">
              {responseError.message}
            </p>
            <Button asChild variant="outline">
              <Link href="/dashboard/form/finalapprover"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Approval List</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!responseData || !responseData.form) {
    return (
      <div className="container mx-auto py-10 px-4 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <p className="text-xl text-muted-foreground">Submission or associated form not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard/form/finalapprover"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Approval List</Link>
        </Button>
      </div>
    );
  }
  
  const { form, answers: submittedAnswers, status, submittedAt, reviewerDecisions } = responseData;
  const questions = form.questions as FormQuestionDefinition[] | undefined ?? [];
  const isPendingFinalApproval = status === 'pending_approval';

  return (
    <div className="container mx-auto py-10 px-4 max-w-3xl">
      <Card className="shadow-xl border-border/50">
        <CardHeader className="border-b pb-6">
          <div className="flex justify-between items-center mb-4">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/form/finalapprover"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Approval List</Link>
            </Button>
            <Badge variant={isPendingFinalApproval ? "default" : (status === 'approved' ? "default" : "destructive")} 
                   className={`capitalize ${isPendingFinalApproval ? 'bg-blue-500 text-white' : (status === 'approved' ? 'bg-green-500 text-white' : '')}`}>
                {status.replace(/_/g, ' ').toUpperCase()}
            </Badge>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Final Approval: {form.title}</CardTitle>
          {form.description && <CardDescription className="mt-2 text-lg text-muted-foreground">{form.description}</CardDescription>}
          <p className="text-sm text-muted-foreground mt-2">
            Submitted on: {submittedAt ? new Date(submittedAt).toLocaleDateString() : 'N/A'}
          </p>
        </CardHeader>
        <CardContent className="pt-8 space-y-6">
          {questions.length > 0 ? questions.map((question) => {
            const answer = submittedAnswers.find(a => a.questionId === question.id.toString());
            return (
              <div key={question.id} className="p-4 border rounded-md bg-background/50 mb-6">
                <Label htmlFor={`q-${question.id}`} className="text-base font-semibold block mb-1.5">{question.text}</Label>
                <div id={`q-${question.id}`} className="text-sm prose prose-sm max-w-none dark:prose-invert prose-p:my-1">
                  {answer ? renderAnswerValue(answer, question) : <span className="text-muted-foreground italic">No answer provided</span>}
                </div>
              </div>
            );
          }) : (
            <div className="text-center py-10 text-muted-foreground">
              <Info className="mx-auto h-12 w-12 mb-3" />
              <p className="text-lg">This form submission has no questions or answers.</p>
            </div>
          )}

          {reviewerDecisions && reviewerDecisions.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <h3 className="text-xl font-semibold mb-4">Reviewer Decisions</h3>
              <div className="space-y-4">
                {reviewerDecisions.map((review, index) => (
                  <Card key={index} className="bg-muted/50">
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-md">
                          Reviewer {review.userId.substring(0,8)}... {/* Show partial ID or fetch reviewer name */}
                        </CardTitle>
                        <Badge variant={review.decision === 'yes' ? 'default' : 'destructive'} 
                               className={`capitalize ${review.decision === 'yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                           {review.decision}
                        </Badge>
                      </div>
                    </CardHeader>
                    {review.comments && (
                      <CardContent>
                        <p className="text-sm text-muted-foreground italic flex items-start">
                            <MessageSquare className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" /> 
                            <span>{review.comments}</span>
                        </p>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        {isPendingFinalApproval && (
          <CardFooter className="border-t pt-6 flex flex-col space-y-4">
            <div className="w-full">
              <Label htmlFor="approvalComments" className="text-base font-semibold">Your Final Comments (Optional)</Label>
              <Textarea 
                id="approvalComments"
                value={approvalComments}
                onChange={(e) => setApprovalComments(e.target.value)}
                placeholder="Provide any final feedback or reasoning..."
                className="mt-2 min-h-[100px]"
                disabled={approvalMutation.isPending}
              />
            </div>
            {submissionError && (
                <Alert variant="destructive" className="w-full">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{submissionError}</AlertDescription>
                </Alert>
            )}
            <div className="w-full flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
              <Button 
                variant="destructive" 
                onClick={() => handleSubmitApproval(false)}
                disabled={approvalMutation.isPending}
                className="w-full sm:w-auto"
              >
                {approvalMutation.isPending && approvalMutation.variables?.decision === false ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ThumbsDown className="mr-2 h-4 w-4" />}
                Deny Submission
              </Button>
              <Button 
                variant="default"
                onClick={() => handleSubmitApproval(true)}
                disabled={approvalMutation.isPending}
                className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
              >
                {approvalMutation.isPending && approvalMutation.variables?.decision === true ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ThumbsUp className="mr-2 h-4 w-4" />}
                Approve Submission
              </Button>
            </div>
          </CardFooter>
        )}
        {!isPendingFinalApproval && responseData && (
             <CardFooter className="border-t pt-6">
                <Alert>
                    {status === 'approved' ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Info className="h-4 w-4" />}
                    <AlertTitle>Decision Status: {status.replace(/_/g, ' ').toUpperCase()}</AlertTitle>
                    <AlertDescription>
                        This submission has already been {status === 'approved' ? 'approved' : status === 'denied_by_approval' ? 'denied' : 'processed'}.
                    </AlertDescription>
                </Alert>
            </CardFooter>
        )}
      </Card>
    </div>
  );
};

export default FinalApprovalSubmissionPage; 