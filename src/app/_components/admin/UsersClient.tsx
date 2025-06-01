"use client";

import React, { useRef, useState, useEffect, useMemo } from 'react';
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
import { AlertTriangle, Loader2, UserCog, Search, Filter } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { useTableControls } from '@/hooks/useTableControls';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Define the correct User type based on the actual API response
interface AdminUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  banner?: string | null;
  accent_color?: number | null;
  locale?: string;
  verified?: boolean;
  email?: string | null;
  flags?: number;
  premium_type?: number;
  public_flags?: number;
  avatar_decoration?: string | null;
  ts_uid?: string | null;
  // Admin-specific properties
  is_admin: boolean;
  is_moderator: boolean;
  discord_id: string;
  api_key: string;
  last_synced: string;
}

// Use AdminUser as our User type
type User = AdminUser;

// Add these types at the top with other types
type RoleFilter = 'all' | 'admin' | 'moderator' | 'user';
type HasTsUidFilter = 'all' | 'yes' | 'no';

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
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [hasTsUidFilter, setHasTsUidFilter] = useState<HasTsUidFilter>('all');
  
  const trpcUtils = api.useUtils();
  const initialUsersRef = useRef(initialUsers);

  // Update the useTableControls hook usage
  const {
    searchTerm,
    setSearchTerm,
    totalItems: totalFilteredItems,
    filteredData: initialFilteredUsers,
  } = useTableControls<User>({
    data: allFetchedUsers,
    searchKeys: ['username', 'id', 'ts_uid'],
  });

  // Add additional filtering
  const filteredUsers = useMemo(() => {
    let filtered = initialFilteredUsers;

    // Apply role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter(user => {
        switch (roleFilter) {
          case 'admin':
            return user.is_admin;
          case 'moderator':
            return user.is_moderator;
          case 'user':
            return !user.is_admin && !user.is_moderator;
          default:
            return true;
        }
      });
    }

    // Apply TeamSpeak UID filter
    if (hasTsUidFilter !== 'all') {
      filtered = filtered.filter(user => {
        if (hasTsUidFilter === 'yes') {
          return !!user.ts_uid;
        } else {
          return !user.ts_uid;
        }
      });
    }

    return filtered;
  }, [initialFilteredUsers, roleFilter, hasTsUidFilter]);

  // Update the mutation to properly refresh the data
  const updateUserMutation = api.admin.users.updateUser.useMutation({
    onMutate: async ({ discord_id, is_admin, is_moderator }) => {
      await trpcUtils.admin.users.listUsers.cancel();
      
      // Update the local state directly
      setAllFetchedUsers(prev => 
        prev.map(user => {
          if (user.discord_id === discord_id) {
            return {
              ...user,
              is_admin: is_admin ?? user.is_admin,
              is_moderator: is_moderator ?? user.is_moderator
            };
          }
          return user;
        })
      );

      return { previousUsers: allFetchedUsers };
    },
    onError: (err, newData, context) => {
      // Revert the changes on error
      if (context?.previousUsers) {
        setAllFetchedUsers(context.previousUsers);
      }
      toast.error(`Failed to update user role: ${err.message}`);
    },
    onSuccess: () => {
      toast.success("User role updated successfully");
      // Refetch to ensure we're in sync with the server
      void trpcUtils.admin.users.listUsers.invalidate();
    }
  });

  const handleRoleUpdate = async (user: User, newRole: 'admin' | 'moderator' | 'user') => {
    try {
      await updateUserMutation.mutateAsync({
        discord_id: user.discord_id,
        is_admin: newRole === 'admin',
        is_moderator: newRole === 'moderator'
      });
    } catch (error) {
      // Error is now handled in the mutation's onError callback
      console.error('Error updating user role:', error);
    }
  };

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
            const validNextPageUsers = (nextPageUsers as User[]).filter(Boolean);
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
  }, [trpcUtils, allFetchedUsers.length, isFetchingAll, allFetchedUsers]);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredUsers?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const isLoadingUiForInitialData = isFetchingAll && allFetchedUsers.length < PAGE_SIZE && allFetchedUsers.length < TOTAL_EXPECTED_USERS;

  // Modify the existing table row to add a role management button
  const renderTableRow = (user: User, virtualItem: VirtualItem) => (
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
          width: '25%', 
          position: 'sticky', 
          left: 0, 
          zIndex: 11,
          background: 'hsl(var(--card))'
        }} 
        className="font-medium truncate"
      >
        {user.username}
      </TableCell>
      <TableCell style={{ width: '25%' }} className="truncate">{user.discord_id}</TableCell>
      <TableCell style={{ width: '20%' }} className="truncate">{user.ts_uid ?? 'N/A'}</TableCell>
      <TableCell style={{ width: '15%' }}>
        <div className="flex items-center gap-2">
          {user.is_admin && <Badge variant="destructive">Admin</Badge>}
          {user.is_moderator && <Badge variant="secondary">Moderator</Badge>}
          {!user.is_admin && !user.is_moderator && <Badge variant="outline">User</Badge>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <UserCog className="h-4 w-4" />
                Change
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => handleRoleUpdate(user, 'admin')}
                className={user.is_admin ? "bg-muted" : ""}
              >
                Admin
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRoleUpdate(user, 'moderator')}
                className={user.is_moderator ? "bg-muted" : ""}
              >
                Moderator
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRoleUpdate(user, 'user')}
                className={!user.is_admin && !user.is_moderator ? "bg-muted" : ""}
              >
                User
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
      <TableCell style={{ width: '15%' }} className="truncate">
        {user.last_synced && !isNaN(Date.parse(user.last_synced))
          ? new Date(user.last_synced).toLocaleString()
          : 'Invalid date'}
      </TableCell>
    </TableRow>
  );

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
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="relative flex items-center flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${allFetchedUsers.length.toLocaleString()} loaded users...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                disabled={isFetchingAll && allFetchedUsers.length < PAGE_SIZE}
              />
            </div>
            <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as RoleFilter)}>
              <SelectTrigger className="w-[180px]">
                <div className="flex items-center">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Filter by role" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admins</SelectItem>
                <SelectItem value="moderator">Moderators</SelectItem>
                <SelectItem value="user">Users</SelectItem>
              </SelectContent>
            </Select>
            <Select value={hasTsUidFilter} onValueChange={(value) => setHasTsUidFilter(value as HasTsUidFilter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by TS UID" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                <SelectItem value="yes">Has TS UID</SelectItem>
                <SelectItem value="no">No TS UID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fetchingError && !isFetchingAll && allFetchedUsers.length > 0 && (
            <p className="text-xs text-destructive">
              <AlertTriangle className="inline h-3 w-3 mr-1"/> {fetchingError}
            </p>
          )}
        </div>
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
                  zIndex: 10,
                  background: 'hsl(var(--card))' 
                }} 
              >
                <TableRow>
                  <TableHead style={{ width: '25%' }}>Username</TableHead>
                  <TableHead style={{ width: '25%' }}>Discord ID</TableHead>
                  <TableHead style={{ width: '20%' }}>TeamSpeak UID</TableHead>
                  <TableHead style={{ width: '15%' }}>Status</TableHead>
                  <TableHead style={{ width: '15%' }}>Last Synced</TableHead>
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
                  return renderTableRow(user, virtualItem);
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 