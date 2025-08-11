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
import { AlertTriangle, Loader2, Shield } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { useTableControls } from '@/hooks/useTableControls';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Progress } from '@/components/ui/progress';

// Infer element type from procedure output
type RolesOutput = RouterOutputs["admin"]["roles"]["listRoles"];
type Role = RolesOutput extends (infer T)[] | undefined ? T : never;

interface RolesClientProps {
  initialRoles: Role[] | null;
}

const ESTIMATED_ROW_HEIGHT = 50;
const PAGE_SIZE = 100;

export default function RolesClient({ initialRoles }: RolesClientProps) {
  const [allFetchedRoles, setAllFetchedRoles] = useState<Role[]>(initialRoles?.filter(role => role.role_id) ?? []);
  const [isFetchingAll, setIsFetchingAll] = useState(true);
  const [fetchingError, setFetchingError] = useState<string | null>(null);
  const [totalRolesLoaded, setTotalRolesLoaded] = useState(initialRoles?.filter(role => role.role_id)?.length ?? 0);

  const trpcUtils = api.useUtils();
  const initialRolesRef = useRef(initialRoles?.filter(role => role.role_id));

  useEffect(() => {
    let active = true;
    async function fetchAllRolesLoop() {
      if (!active || !isFetchingAll) return;
      let accumulatedRolesInternal: Role[] = [...(initialRolesRef.current ?? [])];
      let currentPosition = initialRolesRef.current?.length ?? 0;
      if (allFetchedRoles.length > (initialRolesRef.current?.length ?? 0)) {
        currentPosition = allFetchedRoles.length;
        accumulatedRolesInternal = [...allFetchedRoles];
      }
      const wasLastFetchPotentiallyPartial = initialRolesRef.current ? (initialRolesRef.current.length < PAGE_SIZE && initialRolesRef.current.length > 0) : false;
      const needsFetching = !initialRolesRef.current || initialRolesRef.current.length === 0 || initialRolesRef.current.length === PAGE_SIZE || 
                            (allFetchedRoles.length > 0 && allFetchedRoles.length % PAGE_SIZE === 0 && !wasLastFetchPotentiallyPartial);
      if (!needsFetching && allFetchedRoles.length > 0) {
        if (active) setIsFetchingAll(false);
        if (JSON.stringify(allFetchedRoles) !== JSON.stringify(accumulatedRolesInternal)) {
             setAllFetchedRoles(accumulatedRolesInternal);
        }
        return;
      }
      if(!isFetchingAll && active) setIsFetchingAll(true);
      let hasMoreToFetch = true;
      try {
        while (hasMoreToFetch && active) {
          const nextPageRoles = await trpcUtils.admin.roles.listRoles.fetch({ skip: currentPosition, limit: PAGE_SIZE });
          if (!active) break;
          if (nextPageRoles && nextPageRoles.length > 0) {
            const validNextPageRoles = nextPageRoles.filter(Boolean).filter(role => role.role_id);
            accumulatedRolesInternal = [...accumulatedRolesInternal, ...validNextPageRoles];
            setAllFetchedRoles(prev => [...prev.filter(Boolean).filter(role => role.role_id), ...validNextPageRoles]);
            currentPosition += validNextPageRoles.length;
            setTotalRolesLoaded(currentPosition);
            if (validNextPageRoles.length < PAGE_SIZE) {
              hasMoreToFetch = false;
            }
          } else {
            hasMoreToFetch = false;
          }
        }
      } catch (error) {
        console.error("Error fetching all roles:", error);
        if (active) {
          setFetchingError("Failed to load all role data. Some roles may be missing.");
        }
      } finally {
        if (active) {
          setIsFetchingAll(false);
        }
      }
    }
    const lastKnownFetchCount = allFetchedRoles.length % PAGE_SIZE;
    if (allFetchedRoles.length === 0 || (lastKnownFetchCount === 0 && allFetchedRoles.length >= (initialRolesRef.current?.length ?? 0))) {
        void fetchAllRolesLoop();
    } else {
        if(isFetchingAll) setIsFetchingAll(false);
    }
    return () => {
      active = false;
    };
  }, [trpcUtils, allFetchedRoles.length, isFetchingAll]);

  const {
    searchTerm,
    setSearchTerm,
    totalItems: totalFilteredItems,
    filteredData: filteredRoles, 
  } = useTableControls<Role>({
    data: allFetchedRoles, 
    searchKeys: ['role_name', 'role_id', 'server_id'],
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredRoles?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
    measureElement: typeof window !== 'undefined' 
      ? (element) => element?.getBoundingClientRect().height || ESTIMATED_ROW_HEIGHT
      : undefined,
    getItemKey: (index) => {
      const r = filteredRoles?.[index];
      return r?.role_id ?? index;
    },
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems?.[0]?.start ?? 0 : 0;
  const paddingBottom = virtualItems.length > 0 
    ? totalHeight - (virtualItems?.[virtualItems.length - 1]?.end ?? 0)
    : 0;
  const isLoadingUiForInitialData = isFetchingAll && allFetchedRoles.length === 0 && !fetchingError;
  if (isLoadingUiForInitialData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Preparing role list...</p>
      </div>
    );
  }
  if (isFetchingAll && !isLoadingUiForInitialData) {
    return (
      <Card className="shadow-lg w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <CardTitle className="text-xl">Loading Roles</CardTitle>
          <CardDescription>
            Fetching role data. This may take a moment...
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Progress value={undefined} className="w-full" />
          <p className="text-sm text-muted-foreground text-center mt-2">
            Loaded {totalRolesLoaded.toLocaleString()} roles so far...
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
  if (!isFetchingAll && fetchingError && allFetchedRoles.length === 0) {
     return (
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
          <CardTitle>Error Loading Roles</CardTitle>
          <CardDescription>
            {fetchingError ?? "There was a problem fetching role data. Please try again later."}
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
            <Shield className="mr-2 h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">Role Management</CardTitle>
          </div>
        </div>
        <CardDescription>
          View all Discord roles in the system. Use the search bar to filter by name, ID, or server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <Input
            placeholder="Search roles by name, ID, or server..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
          <span className="text-xs text-muted-foreground ml-2">
            Showing {filteredRoles.length.toLocaleString()} of {allFetchedRoles.length.toLocaleString()} roles
          </span>
        </div>
        <div ref={parentRef} className="h-[500px] overflow-auto border rounded-md">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>Role Name</TableHead>
                <TableHead>Role ID</TableHead>
                <TableHead>Server ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {virtualItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No roles found.
                  </TableCell>
                </TableRow>
              )}
              {paddingTop > 0 && (
                <tr>
                  <td style={{ height: `${paddingTop}px` }} />
                </tr>
              )}
              {virtualItems.map(virtualRow => {
                const role = filteredRoles[virtualRow.index];
                if (!role) return null;
                return (
                  <TableRow 
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                  >
                    <TableCell>{role.role_name ?? 'Unknown Role'}</TableCell>
                    <TableCell>{role.role_id ?? 'N/A'}</TableCell>
                    <TableCell>{role.server_id ?? 'N/A'}</TableCell>
                  </TableRow>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td style={{ height: `${paddingBottom}px` }} />
                </tr>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
} 