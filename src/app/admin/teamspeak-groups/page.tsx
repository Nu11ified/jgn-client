import React from 'react';
import TeamSpeakGroupsClient from '@/app/_components/admin/TeamSpeakGroupsClient';
import { HydrateClient, api } from '@/trpc/server';
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle } from 'lucide-react';

// Fetch initial data on the server for hydration
async function getInitialData() {
  try {
    const groups = await api.admin.teamSpeakGroups.listTsGroups({ limit: 200 });
    return { groups };
  } catch (error) {
    console.error("Failed to fetch initial data for TeamSpeak groups:", error);
    return { groups: null };
  }
}

export default async function TeamSpeakGroupsPage() {
  const initialData = await getInitialData();

  if (!initialData.groups) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" /> Error</CardTitle>
          <CardDescription>
            Failed to load TeamSpeak group data. Please try again later or contact support.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <HydrateClient>
      <TeamSpeakGroupsClient initialGroups={initialData.groups} />
    </HydrateClient>
  );
} 