"use client";

import React from 'react';
import { useParams } from 'next/navigation';
import { api, type RouterOutputs } from '@/trpc/react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertTriangle, EyeOff, Info } from 'lucide-react';

// Assuming types similar to those in FormResponsesAdmin or derived from router outputs
// type FormResponseWithFullForm = RouterOutputs["form"]["getResponseById"]; // This includes .form
// Correctly define FormQuestionDefinition based on the nested structure if form is part of FormResponseWithFullForm
// type FormQuestionDefinition = FormResponseWithFullForm["form"]["questions"][number];
// type AnswerItem = FormResponseWithFullForm["answers"][number]; // from response.answers
type CurrentUserRoles = RouterOutputs["form"]["getCurrentUserServerRoles"];


// Base types from TRPC outputs for getResponseById
type BaseFormResponseByIdOutput = RouterOutputs["form"]["getResponseById"];

// Infer the type of a single reviewer decision from the getResponseById output
// This assumes 'reviewerDecisions' exists on the type and has a similar structure.
type BaseReviewerDecisionFromById = BaseFormResponseByIdOutput extends { reviewerDecisions?: (infer R)[] | null } ? R : never;

// Augmented types for frontend use
type AugmentedReviewerDecisionForPage = BaseReviewerDecisionFromById & {
    reviewerFullName?: string;
    reviewerDiscordId?: string;
};

// This is the augmented type for the entire response object from getResponseById
type FormResponseWithFullForm = Omit<BaseFormResponseByIdOutput, "reviewerDecisions"> & {
  // userId on BaseFormResponseByIdOutput is the submitter's ID
  submitterFullName?: string;
  submitterDiscordId?: string;
  reviewerDecisions?: AugmentedReviewerDecisionForPage[] | null;
  finalApproverFullName?: string; // Assuming finalApproverId is on BaseFormResponseByIdOutput
  finalApproverDiscordId?: string;
  // Ensure 'form' and 'answers' are correctly typed if Omit affects them, though usually it's fine.
  // RouterOutputs["form"]["getResponseById"] already defines 'form' and 'answers'.
};

// Ensure FormQuestionDefinition and AnswerItem correctly derive from the (potentially augmented) FormResponseWithFullForm
// If BaseFormResponseByIdOutput already contains 'form' and 'answers' correctly, these might not need explicit re-definition
// based on the augmented type, unless augmentation changes their structure.
// Let's assume 'form' and 'answers' come directly from BaseFormResponseByIdOutput and are not affected by Omit here.
type FormQuestionDefinition = BaseFormResponseByIdOutput["form"]["questions"][number]; 
type AnswerItem = BaseFormResponseByIdOutput["answers"][number];


// Helper to determine if a user has admin-like global roles
// This is a simplified version; a real implementation might check specific role IDs or names from a config
const userHasGlobalAccess = (userRoles: CurrentUserRoles | undefined): boolean => {
  if (!userRoles) return false;
  const adminRoleNames = ["Admin", "Super Admin"]; // Example admin role names
  return userRoles.some(role => role.roleName && adminRoleNames.includes(role.roleName));
};

// Helper to check if user has form-specific roles (reviewer, approver)
const userHasFormSpecificAccess = (
    userRoles: CurrentUserRoles | undefined, 
    form: FormResponseWithFullForm["form"] | undefined
): boolean => {
    if (!userRoles || !form) return false;
    const userRoleIds = userRoles.map(r => r.roleId);
    
    const isReviewer = form.reviewerRoleIds?.some(roleId => userRoleIds.includes(roleId)) ?? false;
    const isFinalApprover = form.finalApproverRoleIds?.some(roleId => userRoleIds.includes(roleId)) ?? false;
    
    return isReviewer || isFinalApprover;
}

export default function SubmissionDetailsPage() {
  const params = useParams();
  const responseId = parseInt(params.responseId as string, 10);

  const { data: currentUser, isLoading: isLoadingUser } = api.form.getCurrentUserServerRoles.useQuery(undefined, {
    retry: false, // Don't retry if it fails initially, let response query handle auth
  });

  const { 
    data: responseData, 
    isLoading: isLoadingResponse, 
    error: responseError,
    refetch 
  } = api.form.getResponseById.useQuery(
    { responseId },
    { 
      enabled: !isNaN(responseId),
      retry: (failureCount, error) => {
        // Do not retry on FORBIDDEN if user roles are loaded (we'll use roles to decide further action)
        if (error.data?.code === 'FORBIDDEN' && !isLoadingUser) return false; 
        return failureCount < 2;
      }
    }
  );

  React.useEffect(() => {
    if (responseError?.data?.code === 'FORBIDDEN' && !isLoadingUser && currentUser) {
      // If initial fetch was forbidden, AND user has global admin rights, try refetching.
      // This assumes the backend's getResponseById might allow access for admins directly.
      if (userHasGlobalAccess(currentUser)) {
        void refetch();
      }
    }
  }, [currentUser, responseError, isLoadingUser, refetch]);

  const isLoadingInitialData = isLoadingResponse || isLoadingUser;

  // Determine canView status
  let canView = false;
  if (responseData) { // If response data is available, user has access (owner or backend allowed role)
      canView = true;
  } else if (responseError?.data?.code === 'FORBIDDEN' && !isLoadingUser && currentUser) {
      // Response not loaded due to FORBIDDEN, check current user's roles against form (if it were loaded)
      // This relies on the assumption that if `userHasGlobalAccess` is true, the refetch might succeed.
      // For form-specific roles, it's harder without `responseData.form`. 
      // The backend should ideally handle this: if a reviewer tries to access, `getResponseById` should succeed.
      if (userHasGlobalAccess(currentUser)) {
          // We assume the refetch triggered in useEffect might grant access.
          // If responseData is still null after refetch, then access is truly denied.
          // This logic is more about *intent* to view if admin, actual view depends on refetch success.
      } 
      // No explicit `canView = true` here for roles if responseData is null, as backend is the source of truth.
  }
  
  // After all loading and potential refetch, if responseData is present, access is granted.
  if (responseData) canView = true;

  if (isLoadingInitialData && !responseData && !responseError) { // Show loading only if no data/error yet
    return (
      <div className="container mx-auto py-10 px-4 flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading submission details...</p>
      </div>
    );
  }

  // If, after loading attempts, user cannot view (and it was a permission error)
  if (!canView && responseError?.data?.code === 'FORBIDDEN') {
    return (
      <div className="container mx-auto py-10 px-4 text-center">
        <Card className="max-w-md mx-auto shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl text-destructive flex items-center justify-center">
              <EyeOff className="h-8 w-8 mr-2" /> Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-6">
              You do not have permission to view this submission.
              {(!isLoadingUser && !currentUser) 
                ? " Please ensure you are logged in."
                : " If you believe this is an error, contact an administrator."}
            </p>
            <Button asChild variant="outline">
              <Link href="/dashboard/form"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Forms</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  // Handle other errors or form not found (if not a permission issue but data is missing)
  if (!responseData?.form) { // This implies either an error not handled above, or data genuinely not found
     return (
      <div className="container mx-auto py-10 px-4 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <p className="text-xl text-muted-foreground">
            {responseError ? `Error: ${responseError.message}` : "Submission or associated form not found."}
        </p>
         <Button asChild variant="outline" className="mt-4">
            <Link href="/dashboard/form"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Forms</Link>
        </Button>
      </div>
    );
  }

  const { form, answers: submittedAnswers, status, submittedAt } = responseData;
  const questions = form.questions as FormQuestionDefinition[] | undefined ?? [];

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
                    if (Array.isArray(parsed)) {
                        mcAnswer = parsed.map(String); 
                    }
                } catch { /* ignore parse error, keep empty */ }
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

  return (
    <div className="container mx-auto py-10 px-4 max-w-3xl">
      <Card className="shadow-xl border-border/50">
        <CardHeader className="border-b pb-6">
          <div className="flex justify-between items-center mb-4">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/form?tab=filled"><ArrowLeft className="mr-2 h-4 w-4" /> Back to My Submissions</Link>
            </Button>
             <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                status === 'approved' ? 'bg-green-100 text-green-700' :
                status === 'pending_review' || status === 'pending_approval' ? 'bg-yellow-100 text-yellow-700' :
                status === 'denied_by_review' || status === 'denied_by_approval' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700'
              }`}>{status.replace(/_/g, ' ').toUpperCase()}</span>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">{form.title}</CardTitle>
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
                <p className="text-lg">This form submission appears to have no questions or answers.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 