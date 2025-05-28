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
              <TableHead>Status</TableHead>
              <TableHead>Submitted At</TableHead>
              <TableHead>Last Updated</TableHead>
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
                  {response.submitterFullName ?? response.userId ?? "Unknown Submitter"}
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusBadgeVariant(response.status)}>
                    {response.status.replace(/_/g, " ").toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell>
                  {response.submittedAt
                    ? formatDistanceToNow(new Date(response.submittedAt), { addSuffix: true })
                    : "N/A"}
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