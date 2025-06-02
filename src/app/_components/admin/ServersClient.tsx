"use client";

import React, { useRef, useState, useEffect } from 'react';
import { api, type RouterOutputs } from "@/trpc/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableCaption,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Loader2, ServerIcon, Search } from 'lucide-react'; // Changed UserCog to ServerIcon
import { Input } from "@/components/ui/input";
import { useTableControls } from '@/hooks/useTableControls';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Progress } from '@/components/ui/progress';

// Infer element type from procedure output
type ServersOutput = RouterOutputs["admin"]["servers"]["listServers"];
type Server = ServersOutput extends (infer T)[] | undefined ? T : never;

interface ServersClientProps {
  initialServers: Server[] | null;
}

const ESTIMATED_ROW_HEIGHT = 50;
const PAGE_SIZE = 50; // Fetch 50 servers per API call, adjust if needed

export default function ServersClient({ initialServers }: ServersClientProps) {
  const [allFetchedServers, setAllFetchedServers] = useState<Server[]>(initialServers?.filter(server => server.server_id) ?? []);
  const [isFetchingAll, setIsFetchingAll] = useState(true);
  const [fetchingError, setFetchingError] = useState<string | null>(null);
  const [totalServersLoaded, setTotalServersLoaded] = useState(initialServers?.filter(server => server.server_id)?.length ?? 0);

  const trpcUtils = api.useUtils();
  const initialServersRef = useRef(initialServers?.filter(server => server.server_id));

  useEffect(() => {
    let active = true;
    
    async function fetchAllServersLoop() {
      if (!active || !isFetchingAll) return;

      let accumulatedServersInternal: Server[] = [...(initialServersRef.current ?? [])];
      let currentPosition = initialServersRef.current?.length ?? 0;

      if (allFetchedServers.length > (initialServersRef.current?.length ?? 0)) {
        currentPosition = allFetchedServers.length;
        accumulatedServersInternal = [...allFetchedServers];
      }
      
      // Unlike users, we don't have a known total, so we fetch until an empty page is returned.
      // Determine if fetching is needed based on whether the last fetch was a full page.
      const wasLastFetchPotentiallyPartial = initialServersRef.current ? (initialServersRef.current.length < PAGE_SIZE && initialServersRef.current.length > 0) : false;
      const needsFetching = !initialServersRef.current || initialServersRef.current.length === 0 || initialServersRef.current.length === PAGE_SIZE || 
                            (allFetchedServers.length > 0 && allFetchedServers.length % PAGE_SIZE === 0 && !wasLastFetchPotentiallyPartial);

      if (!needsFetching && allFetchedServers.length > 0) {
        if (active) setIsFetchingAll(false);
        if (JSON.stringify(allFetchedServers) !== JSON.stringify(accumulatedServersInternal)) {
             setAllFetchedServers(accumulatedServersInternal);
        }
        return;
      }

      if(!isFetchingAll && active) setIsFetchingAll(true);

      let hasMoreToFetch = true;

      try {
        while (hasMoreToFetch && active) {
          console.log(`Fetching servers: skip=${currentPosition}, limit=${PAGE_SIZE}`);
          const nextPageServers = await trpcUtils.admin.servers.listServers.fetch({ skip: currentPosition, limit: PAGE_SIZE });
          
          if (!active) break;

          if (nextPageServers && nextPageServers.length > 0) {
            const validNextPageServers = nextPageServers.filter(Boolean).filter(server => server.server_id);
            accumulatedServersInternal = [...accumulatedServersInternal, ...validNextPageServers];
            setAllFetchedServers(prev => [...prev.filter(Boolean).filter(server => server.server_id), ...validNextPageServers]); 
            currentPosition += validNextPageServers.length;
            setTotalServersLoaded(currentPosition); // For progress/display
            if (validNextPageServers.length < PAGE_SIZE) {
              hasMoreToFetch = false;
            }
          } else {
            hasMoreToFetch = false;
          }
        }
      } catch (error) {
        console.error("Error fetching all servers:", error);
        if (active) {
          setFetchingError("Failed to load all server data. Some servers may be missing.");
        }
      } finally {
        if (active) {
          setIsFetchingAll(false);
        }
      }
    }

    // Initial check for fetching
    const lastKnownFetchCount = allFetchedServers.length % PAGE_SIZE;
    if (allFetchedServers.length === 0 || (lastKnownFetchCount === 0 && allFetchedServers.length >= (initialServersRef.current?.length ?? 0))) {
        void fetchAllServersLoop();
    } else {
        if(isFetchingAll) setIsFetchingAll(false);
    }

    return () => {
      active = false;
      console.log("ServersClient: Fetch all effect cleanup");
    };
  }, [trpcUtils, allFetchedServers.length, isFetchingAll]);

  const {
    searchTerm,
    setSearchTerm,
    totalItems: totalFilteredItems,
    filteredData: filteredServers, 
  } = useTableControls<Server>({
    data: allFetchedServers, 
    searchKeys: ['server_name', 'server_id'],
  });

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredServers?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10, 
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const isLoadingUiForInitialData = isFetchingAll && allFetchedServers.length === 0 && !fetchingError;

  if (isLoadingUiForInitialData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Preparing server list...</p>
      </div>
    );
  }
  
  // Progress indication while fetching all (more generic than Users, as total isn't known)
  if (isFetchingAll && !isLoadingUiForInitialData) {
    return (
      <Card className="shadow-lg w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <CardTitle className="text-xl">Loading Servers</CardTitle>
          <CardDescription>
            Fetching server data. This may take a moment...
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Progress value={undefined} className="w-full" /> {/* Indeterminate progress */}
          <p className="text-sm text-muted-foreground text-center mt-2">
            Loaded {totalServersLoaded.toLocaleString()} servers so far...
          </p>
          {fetchingError && 
            <p className="text-sm text-destructive text-center mt-2">
              <AlertTriangle className="inline h-4 w-4 mr-1"/> {fetchingError}
            </p>
          }
        </CardContent>
      </Card>
    );
  }
  
  if (!isFetchingAll && fetchingError && allFetchedServers.length === 0) {
     return (
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
          <CardTitle>Error Loading Servers</CardTitle>
          <CardDescription>
            {fetchingError ?? "There was a problem fetching server data. Please try again later."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <ServerIcon className="mr-2 h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">Server Management</CardTitle>
          </div>
        </div>
        <CardDescription>
          Displaying {totalFilteredItems.toLocaleString()} server(s) of {allFetchedServers.length.toLocaleString()} loaded. 
          {isFetchingAll && "(Still loading more...)"}
          {fetchingError && !isFetchingAll && <span className="text-destructive">(Load incomplete)</span>}
        </CardDescription>
        <div className="mt-4 relative flex items-center">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${allFetchedServers.length.toLocaleString()} loaded servers...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm pl-10"
              disabled={isFetchingAll && allFetchedServers.length === 0}
            />
        </div>
         {fetchingError && !isFetchingAll && allFetchedServers.length > 0 && (
          <p className="text-xs text-destructive mt-2">
            <AlertTriangle className="inline h-3 w-3 mr-1"/> {fetchingError}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {(!filteredServers || filteredServers.length === 0) && !isFetchingAll ? (
           <div className="text-center py-8">
            <ServerIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-semibold">No Servers Found</p>
            <p className="text-sm text-muted-foreground">
              {searchTerm ? `Your search for "${searchTerm}" did not match any servers.` : 
                (allFetchedServers.length > 0 ? "No servers match your current search term." : "No servers loaded or found.")}
            </p>
          </div>
        ) : (
          <div ref={parentRef} className="overflow-auto" style={{ height: `calc(100vh - 350px)`, minHeight: `300px`, maxHeight: `600px` }}> 
            <Table>
              <TableCaption>
                Showing {virtualItems.length} of {totalFilteredItems.toLocaleString()} servers (virtualized).
                {isFetchingAll && " Loading more..."}
              </TableCaption>
              <TableHeader 
                style={{ position: 'sticky', top: 0, zIndex: 10, background: 'hsl(var(--card))' }} 
              >
                <TableRow>
                  {/* Adjust widths as needed for server data */}
                  <TableHead style={{ width: '60%' }}>Server Name</TableHead>
                  <TableHead style={{ width: '40%' }}>Server ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody 
                style={{ 
                  height: `${rowVirtualizer.getTotalSize()}px`, 
                  position: 'relative', 
                  width: '100%' 
                }}
              >
                {virtualItems.map((virtualItem) => {
                  const server = filteredServers?.[virtualItem.index];
                  if (!server) return null;

                  return (
                    <TableRow 
                      key={(server.server_id ?? `server-${virtualItem.index}`) + "-" + virtualItem.index} // id should be unique
                      style={{
                        position: 'absolute',
                        top: `${virtualItem.start}px`,
                        left: 0,
                        width: '100%',
                        height: `${virtualItem.size}px`,
                        display: 'flex',
                      }}
                      data-index={virtualItem.index}
                    >
                      <TableCell style={{ width: '60%' }} className="font-medium truncate">{server.server_name ?? 'Unknown Server'}</TableCell>
                      <TableCell style={{ width: '40%' }} className="truncate">{server.server_id ?? 'N/A'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 