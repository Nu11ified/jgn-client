import React from 'react';
import ServersClient from '@/app/_components/admin/ServersClient';
import { HydrateClient, api } from '@/trpc/server';
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertTriangle } from 'lucide-react';

// Fetch initial data on the server for hydration
async function getInitialData() {
  try {
    // Fetch an initial batch. Client will fetch the rest if needed.
    const servers = await api.admin.servers.listServers({ limit: 50 }); // Initial batch size
    return { servers };
  } catch (error) {
    console.error("Failed to fetch initial data for servers:", error);
    // Consistent with UsersPage, return null on error for client to handle full fetch
    return { servers: null }; 
  }
}

export default async function ServersPage() {
  const initialData = await getInitialData();

  // The ServersClient will handle the case where initialData.servers is null
  // and will proceed to fetch all servers client-side.
  // An error message specifically for SSR failure could be shown here if desired,
  // but UsersClient already has robust loading/error states for the full fetch.

  if (!initialData.servers) {
    console.warn("ServersPage: Initial server data fetch failed or returned null. Client will attempt to fetch all.");
    // We still render the client, it will show its own loading/error state
    // This aligns with how UsersPage works when SSR prefetch fails
  }

  return (
    <HydrateClient>
      <ServersClient 
        initialServers={initialData.servers ?? null} // Can be null
      />
    </HydrateClient>
  );
} 