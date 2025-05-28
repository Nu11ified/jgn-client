"use client";

import React from 'react';
import UserFormDisplay from '@/app/_components/dashboard/forms/UserFormDisplay';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function FormDisplayPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const formIdString = params.formId as string;
  const responseIdString = searchParams.get('responseId'); // For editing drafts

  if (!formIdString) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading form...</p>
      </div>
    );
  }

  const formId = parseInt(formIdString, 10);
  const responseId = responseIdString ? parseInt(responseIdString, 10) : undefined;

  if (isNaN(formId)) {
    return <div className="container mx-auto py-8 text-destructive">Invalid Form ID.</div>;
  }
  if (responseIdString && isNaN(responseId!)) {
     return <div className="container mx-auto py-8 text-destructive">Invalid Response ID for draft.</div>;
  }

  return <UserFormDisplay formId={formId} responseIdToEdit={responseId} />;
} 