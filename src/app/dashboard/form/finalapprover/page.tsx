"use client";

import React from 'react';
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRight, Loader2, Info, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type FormResponseForFinalApprover = RouterOutputs["form"]["listFormResponsesForFinalApprover"]["items"][number];

const FinalApproverDashboardPage = () => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = api.form.listFormResponsesForFinalApprover.useInfiniteQuery(
    {
      limit: 10,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  const allResponses = React.useMemo(() => data?.pages.flatMap(page => page.items) ?? [], [data]);

  if (isLoading && !data) {
    return (
      <div className="container mx-auto py-10 px-4 flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading forms for final approval...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-10 px-4">
        <Alert variant="destructive">
          <AlertTitle>Error Loading Forms</AlertTitle>
          <AlertDescription>
            There was an issue fetching forms: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (allResponses.length === 0) {
    return (
      <div className="container mx-auto py-10 px-4 text-center">
        <Info className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-xl text-muted-foreground">No forms are currently awaiting your final approval.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Forms Awaiting Final Approval</h1>
        <p className="text-muted-foreground mt-1">
          The following form submissions have passed review and are awaiting your final decision.
        </p>
      </div>

      <div className="space-y-6">
        {allResponses.map((response: FormResponseForFinalApprover) => (
          <Card key={response.responseId} className="shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-xl">{response.formTitle ?? 'Untitled Form'}</CardTitle>
                <Badge variant="outline" className="capitalize">
                  {response.responseStatus.replace(/_/g, ' ')}
                </Badge>
              </div>
              {response.formDescription && (
                <CardDescription className="pt-1">{response.formDescription}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Submitted on: {new Date(response.submittedAt).toLocaleDateString()} at {new Date(response.submittedAt).toLocaleTimeString()}
              </p>
              {/* TODO: Could show summary of reviewer decisions here if that data is added to listFormResponsesForFinalApprover */}
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button asChild>
                <Link href={`/dashboard/form/finalapprover/${response.responseId}`}>
                  View & Approve/Deny <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {hasNextPage && (
        <div className="mt-8 flex justify-center">
          <Button
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            variant="outline"
          >
            {isFetchingNextPage ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Load More
          </Button>
        </div>
      )}
    </div>
  );
};

export default FinalApproverDashboardPage;
