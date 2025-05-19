import React from 'react';
import BanHistoryClient from '@/app/_components/admin/BanHistoryClient';
import { HydrateClient, api } from '@/trpc/server';
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle } from 'lucide-react';

// Fetch initial data on the server for hydration
async function getInitialData() {
  try {
    const banHistory = await api.admin.banHistory.listBanHistory({ limit: 200 });
    return { banHistory };
  } catch (error) {
    console.error("Failed to fetch initial data for ban history:", error);
    return { banHistory: null };
  }
}

export default async function BanHistoryPage() {
  const initialData = await getInitialData();

  if (!initialData.banHistory) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" /> Error</CardTitle>
          <CardDescription>
            Failed to load ban history data. Please try again later or contact support.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <HydrateClient>
      <BanHistoryClient initialBanHistory={initialData.banHistory} />
    </HydrateClient>
  );
} 