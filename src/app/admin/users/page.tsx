import React from 'react';
import UsersClient from '@/app/_components/admin/UsersClient';
import { HydrateClient, api } from '@/trpc/server';
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle } from 'lucide-react';

// Fetch initial data on the server for hydration
async function getInitialData() {
  try {
    // TODO: Consider if we need to fetch other related data for user management, 
    // e.g., roles or permissions, if those become relevant for the UsersClient.
    const users = await api.admin.users.listUsers({ limit: 200 }); // Changed limit to 200
    return { users };
  } catch (error) {
    console.error("Failed to fetch initial data for users:", error);
    return { users: null };
  }
}

export default async function UsersPage() {
  const initialData = await getInitialData();

  if (!initialData.users) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" /> Error</CardTitle>
          <CardDescription>
            Failed to load user data. Please try again later or contact support.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <HydrateClient>
      <UsersClient 
        initialUsers={initialData.users}
      />
    </HydrateClient>
  );
} 