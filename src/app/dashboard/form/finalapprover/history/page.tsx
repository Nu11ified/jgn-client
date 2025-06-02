"use client";

import React from "react";
import { api } from "@/trpc/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Eye, ArrowLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns"; // For relative dates

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


export default function FinalApproverFormHistoryPage() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    error,
  } = api.form.listAllOutcomesForFinalApprover.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor }
  );

  if (isLoading) {
    return <div className="container mx-auto p-4">Loading form history...</div>;
  }

  if (error) {
    return (
      <div className="container mx-auto p-4">
        Error loading form history: {error.message}
      </div>
    );
  }

  const allResponses = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/form">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Forms
            </Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Form Outcome History</h1>
        </div>
      </div>

      {allResponses.length === 0 && !isLoading ? (
        <p>No form outcomes found for the forms you are a final approver for.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Form Title</TableHead>
              <TableHead>Submitted By</TableHead>
              <TableHead>Reviewers</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allResponses.map((response) => (
              <TableRow key={response.id}>
                <TableCell className="font-medium">
                  {response.form?.title ?? "N/A"}
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{response.submitterFullName ?? "Unknown"}</p>
                    {response.submitterDiscordId && (
                      <p className="text-xs text-muted-foreground flex items-center mt-0.5">
                        <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.127a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127c-.598.35-1.216.642-1.873.892a.077.077 0 0 0-.041.106c.36.698.772 1.362 1.225 1.994a.076.076 0 0 0 .084.028a19.834 19.834 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                        </svg>
                        {response.submitterDiscordId}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {response.reviewerDecisions && response.reviewerDecisions.length > 0 ? (
                    <div className="space-y-1">
                      <div className="flex gap-1">
                        <Badge variant="outline" className="text-xs">
                          {response.reviewerDecisions.length} {response.reviewerDecisions.length === 1 ? 'review' : 'reviews'}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {response.reviewerDecisions.filter(r => r.decision === 'yes').length} approved
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {response.reviewerDecisions.slice(0, 2).map((review, idx) => (
                          <div key={idx} className="truncate">
                            {review.reviewerFullName ?? review.reviewerName ?? 'Unknown'}
                          </div>
                        ))}
                        {response.reviewerDecisions.length > 2 && (
                          <div className="text-xs text-muted-foreground">
                            +{response.reviewerDecisions.length - 2} more
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No reviews yet</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusBadgeVariant(response.status)}
                         className={`${response.status === 'approved' ? 'bg-green-100 text-green-700' : 
                                     response.status.includes('denied') ? 'bg-red-100 text-red-700' : ''}`}>
                    {response.status.replace(/_/g, " ").toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell>
                  {response.submittedAt
                    ? formatDistanceToNow(new Date(response.submittedAt), { addSuffix: true })
                    : "N/A"}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/dashboard/form/finalapprover/history/${response.id}`}>
                      <Eye className="mr-2 h-4 w-4" /> View Details
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading more..." : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
}

// Consider adding a type for the response item if it becomes complex
// import type { RouterOutputs } from "@/trpc/shared";
// type FormOutcomeItem = RouterOutputs["form"]["listAllOutcomesForFinalApprover"]["items"][number]; 