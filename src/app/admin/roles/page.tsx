import React from 'react';
import RolesClient from '@/app/_components/admin/RolesClient';
import { HydrateClient, api } from '@/trpc/server';
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle } from 'lucide-react';

// Fetch initial data on the server for hydration
async function getInitialData() {
  try {
    const roles = await api.admin.roles.listRoles({ limit: 200 });
    return { roles };
  } catch (error) {
    console.error("Failed to fetch initial data for roles:", error);
    return { roles: null };
  }
}

export default async function RolesPage() {
  const initialData = await getInitialData();

  if (!initialData.roles) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" /> Error</CardTitle>
          <CardDescription>
            Failed to load role data. Please try again later or contact support.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <HydrateClient>
      <RolesClient initialRoles={initialData.roles} />
    </HydrateClient>
  );
} 