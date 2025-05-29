import React from 'react';
import RoleMappingsClient from '@/app/_components/admin/RoleMappingsClient';
import { HydrateClient, api } from '@/trpc/server';
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle } from 'lucide-react';

// Fetch initial data on the server for hydration
async function getInitialData() {
  const [roleMappings, discordRoles, tsGroups] = await Promise.all([
    api.admin.roleMappings.listRoleMappings({ limit: 50 }), // Adjust limit as needed
    api.admin.roles.listRoles({ limit: 1000 }), // Fetch all roles at once
    api.admin.teamSpeakGroups.listTsGroups({ limit: 200 }), // Fetch all TS groups for dropdown
  ]).catch(error => {
    console.error("Failed to fetch initial data for role mappings:", error);
    return [null, null, null];
  });
  return { roleMappings, discordRoles, tsGroups };
}

export default async function RoleMappingsPage() {
  const initialData = await getInitialData();

  if (!initialData.roleMappings || !initialData.discordRoles || !initialData.tsGroups) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" /> Error</CardTitle>
          <CardDescription>
            Failed to load essential data for managing role mappings. Please try again later or contact support.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <HydrateClient>
      <RoleMappingsClient 
        initialRoleMappings={initialData.roleMappings}
        initialDiscordRoles={initialData.discordRoles}
        initialTsGroups={initialData.tsGroups}
      />
    </HydrateClient>
  );
} 