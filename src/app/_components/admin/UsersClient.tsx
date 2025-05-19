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
import { AlertTriangle, Loader2, UserCog, Search } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTableControls } from '@/hooks/useTableControls';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Progress } from '@/components/ui/progress';

// Infer element type from procedure output
type UsersOutput = RouterOutputs["admin"]["users"]["listUsers"];
type User = UsersOutput extends (infer T)[] | undefined ? T : never;

interface UsersClientProps {
  initialUsers: User[] | null;
}

const ESTIMATED_ROW_HEIGHT = 50;
const PAGE_SIZE = 100;
const TOTAL_EXPECTED_USERS = 9678;

export default function UsersClient({ initialUsers }: UsersClientProps) {
  const [allFetchedUsers, setAllFetchedUsers] = useState<User[]>(initialUsers ?? []);
  const [isFetchingAll, setIsFetchingAll] = useState(true);
  const [fetchingError, setFetchingError] = useState<string | null>(null);
  const [currentSkipForProgress, setCurrentSkipForProgress] = useState(initialUsers?.length ?? 0);
  
  const trpcUtils = api.useUtils();
  const initialUsersRef = useRef(initialUsers);

  useEffect(() => {
    let active = true;
    
    async function fetchAllLoop() {
      if (!active || !isFetchingAll) return;

      let accumulatedUsersInternal: User[] = [...(initialUsersRef.current ?? [])];
      let currentPosition = initialUsersRef.current?.length ?? 0;

      if (allFetchedUsers.length > (initialUsersRef.current?.length ?? 0)) {
        currentPosition = allFetchedUsers.length;
        accumulatedUsersInternal = [...allFetchedUsers];
      }
      
      const needsFetching = accumulatedUsersInternal.length < TOTAL_EXPECTED_USERS || 
                            (accumulatedUsersInternal.length === 0 && TOTAL_EXPECTED_USERS > 0);

      if (!needsFetching) {
        if (active) setIsFetchingAll(false);
        if (JSON.stringify(allFetchedUsers) !== JSON.stringify(accumulatedUsersInternal)) {
            setAllFetchedUsers(accumulatedUsersInternal);
        }
        return;
      }

      if(!isFetchingAll && active) setIsFetchingAll(true); 

      let hasMoreToFetch = true;

      try {
        while (hasMoreToFetch && active) {
          console.log(`Fetching users: skip=${currentPosition}, limit=${PAGE_SIZE}`);
          const nextPageUsers = await trpcUtils.admin.users.listUsers.fetch({ skip: currentPosition, limit: PAGE_SIZE });
          
          if (!active) break;

          if (nextPageUsers && nextPageUsers.length > 0) {
            const validNextPageUsers = nextPageUsers.filter(Boolean);
            accumulatedUsersInternal = [...accumulatedUsersInternal, ...validNextPageUsers];
            setAllFetchedUsers(prev => [...prev.filter(Boolean), ...validNextPageUsers]); 
            currentPosition += validNextPageUsers.length;
            setCurrentSkipForProgress(currentPosition);
            if (validNextPageUsers.length < PAGE_SIZE) {
              hasMoreToFetch = false;
            }
          } else {
            hasMoreToFetch = false;
          }
          if (accumulatedUsersInternal.length >= TOTAL_EXPECTED_USERS) {
            hasMoreToFetch = false;
          }
          if (currentPosition > TOTAL_EXPECTED_USERS + (PAGE_SIZE * 5)) { 
            console.warn("Fetched significantly more users than expected, stopping.");
            hasMoreToFetch = false;
            if(active) setFetchingError("Fetched more data than expected. Display may be incomplete.");
          }
        }
      } catch (error) {
        console.error("Error fetching all users:", error);
        if (active) {
          setFetchingError("Failed to load all user data. Some users may be missing.");
        }
      } finally {
        if (active) {
          setIsFetchingAll(false);
        }
      }
    }
    
    if (allFetchedUsers.length < TOTAL_EXPECTED_USERS || (allFetchedUsers.length === 0 && TOTAL_EXPECTED_USERS > 0)) {
        void fetchAllLoop();
    } else {
        if(isFetchingAll) setIsFetchingAll(false);
    }

    return () => {
      active = false;
      console.log("UserClient: Fetch all effect cleanup");
    };
  }, [trpcUtils, allFetchedUsers.length, isFetchingAll]);

  const {
    searchTerm,
    setSearchTerm,
    totalItems: totalFilteredItems,
    filteredData: filteredUsers,
  } = useTableControls<User>({
    data: allFetchedUsers,
    searchKeys: ['username', 'discord_id', 'ts_uid'],
  });

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredUsers?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const isLoadingUiForInitialData = isFetchingAll && allFetchedUsers.length < PAGE_SIZE && allFetchedUsers.length < TOTAL_EXPECTED_USERS;

  if (isLoadingUiForInitialData && !fetchingError) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Preparing user list...</p>
      </div>
    );
  }
  
  if (isFetchingAll && allFetchedUsers.length < TOTAL_EXPECTED_USERS && !isLoadingUiForInitialData) {
    const progressValue = Math.min(100, Math.floor((currentSkipForProgress / TOTAL_EXPECTED_USERS) * 100));
    return (
      <Card className="shadow-lg w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <CardTitle className="text-xl">Loading All Users</CardTitle>
          <CardDescription>
            Fetching {TOTAL_EXPECTED_USERS.toLocaleString()} records. This may take a moment...
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Progress value={progressValue} className="w-full" />
          <p className="text-sm text-muted-foreground text-center mt-2">
            Loaded {currentSkipForProgress.toLocaleString()} of {TOTAL_EXPECTED_USERS.toLocaleString()} users ({progressValue}%).
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
  
  if (!isFetchingAll && fetchingError && allFetchedUsers.length === 0) {
     return (
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
          <CardTitle>Error Loading Users</CardTitle>
          <CardDescription>
            {fetchingError ?? "There was a problem fetching user data. Please try again later."}
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
            <UserCog className="mr-2 h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">User Management</CardTitle>
          </div>
        </div>
        <CardDescription>
          Displaying {totalFilteredItems.toLocaleString()} user(s) of {allFetchedUsers.length.toLocaleString()} loaded. 
          {isFetchingAll && allFetchedUsers.length < TOTAL_EXPECTED_USERS && "(Still loading more...)"}
          {fetchingError && !isFetchingAll && <span className="text-destructive">(Load incomplete)</span>}
        </CardDescription>
        <div className="mt-4 relative flex items-center">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${allFetchedUsers.length.toLocaleString()} loaded users...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm pl-10"
              disabled={isFetchingAll && allFetchedUsers.length < PAGE_SIZE}
            />
        </div>
         {fetchingError && !isFetchingAll && allFetchedUsers.length > 0 && (
          <p className="text-xs text-destructive mt-2">
            <AlertTriangle className="inline h-3 w-3 mr-1"/> {fetchingError}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {(!filteredUsers || filteredUsers.length === 0) && !isFetchingAll ? (
           <div className="text-center py-8">
            <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-semibold">No Users Found</p>
            <p className="text-sm text-muted-foreground">
              {searchTerm ? `Your search for "${searchTerm}" did not match any users.` : 
                (allFetchedUsers.length > 0 ? "No users match your current search term." : "No users loaded or found.")}
            </p>
          </div>
        ) : (
          <div ref={parentRef} className="overflow-auto" style={{ height: `calc(100vh - 350px)`, minHeight: `300px`, maxHeight: `600px` }}> 
            <Table>
              <TableCaption>
                Showing {virtualItems.length} of {totalFilteredItems.toLocaleString()} users (virtualized).
                {isFetchingAll && allFetchedUsers.length < TOTAL_EXPECTED_USERS && " Loading more..."}
              </TableCaption>
              <TableHeader 
                style={{ 
                  position: 'sticky', 
                  top: 0, 
                  zIndex: 10, // Base z-index for the header row
                  background: 'hsl(var(--card))' 
                }} 
              >
                <TableRow>
                  <TableHead 
                    style={{ 
                      width: '20%', 
                      position: 'sticky', 
                      left: 0, 
                      zIndex: 12, // Highest z-index for the top-left sticky cell
                      background: 'hsl(var(--card))' // Match header background
                    }}
                  >
                    Username
                  </TableHead>
                  <TableHead style={{ width: '25%' }}>Discord ID</TableHead>
                  <TableHead style={{ width: '15%' }}>TeamSpeak UID</TableHead>
                  <TableHead style={{ width: '10%' }}>Status</TableHead>
                  <TableHead style={{ width: '30%' }}>Last Synced</TableHead>
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
                  const user = filteredUsers?.[virtualItem.index];
                  if (!user) return null;

                  return (
                    <TableRow 
                      key={user.discord_id + "-" + virtualItem.index} 
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
                      <TableCell 
                        style={{ 
                          width: '20%', 
                          position: 'sticky', 
                          left: 0, 
                          zIndex: 11, // z-index for sticky body cells (below header, above other body cells)
                          background: 'hsl(var(--card))' // Match row/card background
                        }} 
                        className="font-medium truncate"
                      >
                        {user.username}
                      </TableCell>
                      <TableCell style={{ width: '25%' }} className="truncate">{user.discord_id}</TableCell>
                      <TableCell style={{ width: '15%' }} className="truncate">{user.ts_uid ?? 'N/A'}</TableCell>
                      <TableCell style={{ width: '10%' }}>
                        {user.is_admin && <Badge variant="destructive" className="mr-1">Admin</Badge>}
                        {user.is_moderator && <Badge variant="secondary">Moderator</Badge>}
                        {!user.is_admin && !user.is_moderator && <Badge variant="outline">User</Badge>}
                      </TableCell>
                      <TableCell style={{ width: '30%' }} className="truncate">{new Date(user.last_synced).toLocaleString()}</TableCell>
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