"use client";

import React from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, User, ShieldCheck, Hourglass, ThumbsUp, ThumbsDown, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type FormResponseWithFullForm = RouterOutputs["form"]["getResponseById"]; // This includes the full form details

interface FormStatusTrackerProps {
  responseId: number;
}

const iconSize = "h-6 w-6";
const stepConnectorClass = "flex-1 h-1 bg-border group-data-[completed=true]:bg-green-500 group-data-[denied=true]:bg-destructive transition-colors duration-500";
const stepClass = "flex flex-col items-center gap-1 group";

export default function FormStatusTracker({ responseId }: FormStatusTrackerProps) {
  const { data: responseData, isLoading, error } = api.form.getResponseById.useQuery(
    { responseId }, 
    { refetchOnWindowFocus: false, retry: 1 }
  );

  if (isLoading) {
    return <div className="flex items-center justify-center py-4"><Loader2 className={`${iconSize} animate-spin text-muted-foreground`} /> <span className="ml-2 text-sm text-muted-foreground">Loading status...</span></div>;
  }
  if (error) {
    return (
      <div className="flex items-center text-destructive text-sm py-4">
        <AlertTriangle className={`${iconSize} mr-2`} /> Error loading submission details: {error.message}
      </div>
    );
  }
  if (!responseData?.form) {
    return <div className="text-muted-foreground text-sm py-4">Submission or form data not found.</div>;
  }

  const { form, ...response } = responseData;
  const { reviewerRoleIds, finalApproverRoleIds, requiredReviewers = 0, requiresFinalApproval = false } = form;
  const { reviewerDecisions, status, finalApprovalDecision, finalApproverId } = response;

  const safeReviewerRoleIds = reviewerRoleIds ?? [];
  const safeReviewerDecisions = reviewerDecisions ?? [];
  const safeFinalApproverId = finalApproverId ?? 'N/A';

  const reviewSteps: { title: string; icon: React.ReactNode; completed: boolean; denied: boolean; info?: string }[] = [];

  // Submission Step
  reviewSteps.push({
    title: "Submitted",
    icon: <CheckCircle2 className={cn(iconSize, "text-green-500")} />,
    completed: true, // If we are here, it's submitted
    denied: false,
    info: `Submitted on ${new Date(response.submittedAt).toLocaleDateString()}`
  });

  // Reviewer Steps (if required)
  if (requiredReviewers > 0) {
    const actualReviewers = Math.max(requiredReviewers, safeReviewerRoleIds.length > 0 ? safeReviewerRoleIds.length : requiredReviewers); // Heuristic if roles are more than required number
    
    for (let i = 0; i < actualReviewers; i++) {
      const decision = safeReviewerDecisions[i];
      const stepStatus: { completed: boolean; denied: boolean; icon: React.ReactNode; info: string; title: string } = {
        title: `Reviewer ${i + 1}`,
        completed: false,
        denied: false,
        icon: <Hourglass className={cn(iconSize, "text-muted-foreground")} />,
        info: "Pending"
      };

      if (decision) {
        if (decision.decision === 'yes') {
          stepStatus.completed = true;
          stepStatus.icon = <ThumbsUp className={cn(iconSize, "text-green-500")} />;
          stepStatus.info = `Approved on ${new Date(decision.reviewedAt).toLocaleDateString()}`;
          if(decision.comments) stepStatus.info += ` - Comments: ${decision.comments}`;
        } else {
          stepStatus.denied = true;
          stepStatus.icon = <ThumbsDown className={cn(iconSize, "text-destructive")} />;
          stepStatus.info = `Denied on ${new Date(decision.reviewedAt).toLocaleDateString()}`;
           if(decision.comments) stepStatus.info += ` - Comments: ${decision.comments}`;
        }
      } else if (status === 'denied_by_review' || status === 'denied_by_approval') {
        // If overall denied, and this reviewer hasn't voted, mark as implicitly not completed/NA for further progress
        stepStatus.icon = <MinusCircle className={cn(iconSize, "text-muted-foreground")} />;
        stepStatus.info = "Skipped (overall denied)";
      } else if (status === 'approved' && !requiresFinalApproval) {
        // If overall approved without final step, and this reviewer slot is beyond actual decisions, assume approved
        if (i >= safeReviewerDecisions.length) { // For placeholder slots beyond actual decisions
            stepStatus.completed = true;
            stepStatus.icon = <CheckCircle2 className={cn(iconSize, "text-green-500")} />;
            stepStatus.info = "Approved (met requirement)";
        }
      } else if (status === 'pending_approval' && i >= safeReviewerDecisions.length) {
        // All prior reviews must have been yes, this is just a placeholder
         stepStatus.completed = true;
         stepStatus.icon = <CheckCircle2 className={cn(iconSize, "text-green-500")} />;
         stepStatus.info = "Approved (met requirement)";
      }
      reviewSteps.push(stepStatus);
    }
  }

  // Final Approval Step (if required)
  if (requiresFinalApproval) {
    const finalStepStatus: { completed: boolean; denied: boolean; icon: React.ReactNode; info: string } = {
      completed: false,
      denied: false,
      icon: <Hourglass className={cn(iconSize, "text-muted-foreground")} />,
      info: "Pending"
    };

    if (status === 'approved') {
      finalStepStatus.completed = true;
      finalStepStatus.icon = <ShieldCheck className={cn(iconSize, "text-green-500")} />;
      finalStepStatus.info = `Approved by ${safeFinalApproverId} on ${response.finalApprovedAt ? new Date(response.finalApprovedAt).toLocaleDateString() : 'N/A'}`;
      if(response.finalApprovalComments) finalStepStatus.info += ` - Comments: ${response.finalApprovalComments}`;
    } else if (status === 'denied_by_approval') {
      finalStepStatus.denied = true;
      finalStepStatus.icon = <XCircle className={cn(iconSize, "text-destructive")} />;
      finalStepStatus.info = `Denied by ${safeFinalApproverId} on ${response.finalApprovedAt ? new Date(response.finalApprovedAt).toLocaleDateString() : 'N/A'}`;
      if(response.finalApprovalComments) finalStepStatus.info += ` - Comments: ${response.finalApprovalComments}`;
    } else if (status === 'pending_approval') {
      // Stays as pending
    } else if (status === 'denied_by_review') {
        finalStepStatus.icon = <MinusCircle className={cn(iconSize, "text-muted-foreground")} />;
        finalStepStatus.info = "Skipped (denied by review)";
    }
    
    reviewSteps.push({
      title: "Final Approval",
      ...finalStepStatus,
    });
  }
  
  // Overall Outcome Step (implicit)
  const lastStep = reviewSteps[reviewSteps.length - 1];
  if (status === 'approved' && (!requiresFinalApproval && requiredReviewers === 0)) {
    // Auto-approved if no reviewers and no final approval
    if(lastStep?.title !== "Approved") { // Avoid duplicating auto-approval message
        reviewSteps.push({
            title: "Approved",
            icon: <CheckCircle2 className={cn(iconSize, "text-green-500")} />,
            completed: true,
            denied: false,
            info: "Automatically approved as per form rules."
        });
    }
  } else if (status === 'approved' && lastStep?.title !== "Final Approval" && lastStep?.title !== "Approved") {
     reviewSteps.push({
        title: "Outcome: Approved",
        icon: <CheckCircle2 className={cn(iconSize, "text-green-500")} />,
        completed: true,
        denied: false,
        info: "Submission has been approved."
    });
  } else if (status === 'denied_by_review' || status === 'denied_by_approval') {
     reviewSteps.push({
        title: `Outcome: ${status.replace(/_/g, ' ')}`,
        icon: <XCircle className={cn(iconSize, "text-destructive")} />,
        completed: false, // Not completed in a positive sense
        denied: true,
        info: "Submission was not approved."
    });
  }


  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-start w-full py-2 select-none">
        {reviewSteps.map((step, index) => (
          <React.Fragment key={step.title + index}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={stepClass} data-completed={step.completed} data-denied={step.denied}>
                  {step.icon}
                  <p className={cn(
                    "text-xs text-center font-medium text-muted-foreground whitespace-nowrap",
                    step.completed && "text-green-600",
                    step.denied && "text-destructive"
                  )}>
                    {step.title}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-sm">{step.info ?? step.title}</p>
              </TooltipContent>
            </Tooltip>
            {index < reviewSteps.length - 1 && (
              <div 
                className={stepConnectorClass} 
                data-completed={step.completed && !step.denied}
                data-denied={step.denied}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </TooltipProvider>
  );
} 