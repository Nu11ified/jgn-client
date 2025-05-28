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
import { ArrowLeft, Loader2, ThumbsUp, ThumbsDown, Info, EyeOff, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type FormResponseWithFullForm = RouterOutputs["form"]["getResponseById"];
type FormQuestionDefinition = FormResponseWithFullForm["form"]["questions"][number];
type AnswerItem = FormResponseWithFullForm["answers"][number];

// This is the page for a reviewer to review a specific submission.
const ReviewSubmissionPage = () => {
  const params = useParams();
  const router = useRouter();
  const responseId = parseInt(params.responseId as string, 10);

  const [reviewComments, setReviewComments] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const { data: responseData, isLoading: isLoadingResponse, error: responseError, refetch } = 
    api.form.getResponseById.useQuery(
      { responseId }, 
      { enabled: !isNaN(responseId) }
    );

  const reviewMutation = api.form.reviewResponse.useMutation({
    onSuccess: (data) => {
      console.log("Review Submitted Successfully", data);
      void refetch(); 
      router.push("/dashboard/form/reviewer");
    },
    onError: (error) => {
      setSubmissionError(error.message);
      console.error("Review Submission Failed", error);
    },
  });

  const handleSubmitReview = (decision: 'yes' | 'no') => {
    if (isNaN(responseId)) {
      setSubmissionError("Invalid response ID.");
      return;
    }
    setSubmissionError(null);
    reviewMutation.mutate({ 
      responseId,
      decision,
      comments: reviewComments 
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
        <p className="text-lg text-muted-foreground">Loading submission for review...</p>
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
              <Link href="/dashboard/form/reviewer"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Review List</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!responseData?.form) {
    return (
      <div className="container mx-auto py-10 px-4 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <p className="text-xl text-muted-foreground">Submission or associated form not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard/form/reviewer"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Review List</Link>
        </Button>
      </div>
    );
  }
  
  const { form, answers: submittedAnswers, status, submittedAt } = responseData;
  const questions = form.questions as FormQuestionDefinition[] | undefined ?? [];

  const isPendingReview = status === 'pending_review';

  return (
    <div className="container mx-auto py-10 px-4 max-w-3xl">
      <Card className="shadow-xl border-border/50">
        <CardHeader className="border-b pb-6">
          <div className="flex justify-between items-center mb-4">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/form/reviewer"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Review List</Link>
            </Button>
            <Badge variant={isPendingReview ? "default" : (status === 'approved' || status === 'pending_approval' ? "default" : "destructive") } className={`capitalize ${isPendingReview ? 'bg-yellow-500 text-white' : (status === 'approved' || status === 'pending_approval' ? 'bg-green-500 text-white' : '')}`}>
                {status.replace(/_/g, ' ').toUpperCase()}
            </Badge>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Review: {form.title}</CardTitle>
          {form.description && <CardDescription className="mt-2 text-lg text-muted-foreground">{form.description}</CardDescription>}
          <p className="text-sm text-muted-foreground mt-2">
            Submitted on: {submittedAt ? new Date(submittedAt).toLocaleDateString() : 'N/A'}
          </p>
        </CardHeader>
        <CardContent className="pt-8 space-y-6">
          {questions.length > 0 ? questions.map((question) => {
            const answer = submittedAnswers.find(a => a.questionId === question.id.toString());
            return (
              <div key={question.id} className="p-4 border rounded-md bg-background/50">
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
        </CardContent>

        {isPendingReview && (
          <CardFooter className="border-t pt-6 flex flex-col space-y-4">
            <div className="w-full">
              <Label htmlFor="reviewComments" className="text-base font-semibold">Your Review Comments (Optional)</Label>
              <Textarea 
                id="reviewComments"
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                placeholder="Provide any feedback or reasoning for your decision..."
                className="mt-2 min-h-[100px]"
                disabled={reviewMutation.isPending}
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
                onClick={() => handleSubmitReview('no')}
                disabled={reviewMutation.isPending}
                className="w-full sm:w-auto"
              >
                {reviewMutation.isPending && reviewMutation.variables?.decision === 'no' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ThumbsDown className="mr-2 h-4 w-4" />}
                Deny
              </Button>
              <Button 
                variant="default"
                onClick={() => handleSubmitReview('yes')}
                disabled={reviewMutation.isPending}
                className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
              >
                {reviewMutation.isPending && reviewMutation.variables?.decision === 'yes' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ThumbsUp className="mr-2 h-4 w-4" />}
                Approve
              </Button>
            </div>
          </CardFooter>
        )}
        {!isPendingReview && responseData && (
             <CardFooter className="border-t pt-6">
                <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Review Status: {status.replace(/_/g, ' ').toUpperCase()}</AlertTitle>
                    <AlertDescription>
                        This submission is no longer pending your review. It might have been actioned by another reviewer or has moved to final approval.
                    </AlertDescription>
                </Alert>
            </CardFooter>
        )}
      </Card>
    </div>
  );
};

export default ReviewSubmissionPage; 