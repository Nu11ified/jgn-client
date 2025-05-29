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
import { AlertTriangle, Loader2, Users } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { useTableControls } from '@/hooks/useTableControls';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Progress } from '@/components/ui/progress';

// Infer element type from procedure output
type TsGroupsOutput = RouterOutputs["admin"]["teamSpeakGroups"]["listTsGroups"];
type TsGroup = TsGroupsOutput extends (infer T)[] | undefined ? T : never;

interface TeamSpeakGroupsClientProps {
  initialGroups: TsGroup[] | null;
}

const ESTIMATED_ROW_HEIGHT = 50;
const PAGE_SIZE = 100;

export default function TeamSpeakGroupsClient({ initialGroups }: TeamSpeakGroupsClientProps) {
  const [allFetchedGroups, setAllFetchedGroups] = useState<TsGroup[]>(initialGroups ?? []);
  const [isFetchingAll, setIsFetchingAll] = useState(true);
  const [fetchingError, setFetchingError] = useState<string | null>(null);
  const [totalGroupsLoaded, setTotalGroupsLoaded] = useState(initialGroups?.length ?? 0);

  const trpcUtils = api.useUtils();
  const initialGroupsRef = useRef(initialGroups);

  useEffect(() => {
    let active = true;
    async function fetchAllGroupsLoop() {
      if (!active || !isFetchingAll) return;
      let accumulatedGroupsInternal: TsGroup[] = [...(initialGroupsRef.current ?? [])];
      let currentPosition = initialGroupsRef.current?.length ?? 0;
      if (allFetchedGroups.length > (initialGroupsRef.current?.length ?? 0)) {
        currentPosition = allFetchedGroups.length;
        accumulatedGroupsInternal = [...allFetchedGroups];
      }
      const wasLastFetchPotentiallyPartial = initialGroupsRef.current ? (initialGroupsRef.current.length < PAGE_SIZE && initialGroupsRef.current.length > 0) : false;
      const needsFetching = !initialGroupsRef.current || initialGroupsRef.current.length === 0 || initialGroupsRef.current.length === PAGE_SIZE || 
                            (allFetchedGroups.length > 0 && allFetchedGroups.length % PAGE_SIZE === 0 && !wasLastFetchPotentiallyPartial);
      if (!needsFetching && allFetchedGroups.length > 0) {
        if (active) setIsFetchingAll(false);
        if (JSON.stringify(allFetchedGroups) !== JSON.stringify(accumulatedGroupsInternal)) {
             setAllFetchedGroups(accumulatedGroupsInternal);
        }
        return;
      }
      if(!isFetchingAll && active) setIsFetchingAll(true);
      let hasMoreToFetch = true;
      try {
        while (hasMoreToFetch && active) {
          const nextPageGroups = await trpcUtils.admin.teamSpeakGroups.listTsGroups.fetch({ skip: currentPosition, limit: PAGE_SIZE });
          if (!active) break;
          if (nextPageGroups && nextPageGroups.length > 0) {
            const validNextPageGroups = nextPageGroups.filter(Boolean);
            accumulatedGroupsInternal = [...accumulatedGroupsInternal, ...validNextPageGroups];
            setAllFetchedGroups(prev => [...prev.filter(Boolean), ...validNextPageGroups]); 
            currentPosition += validNextPageGroups.length;
            setTotalGroupsLoaded(currentPosition);
            if (validNextPageGroups.length < PAGE_SIZE) {
              hasMoreToFetch = false;
            }
          } else {
            hasMoreToFetch = false;
          }
        }
      } catch (error) {
        console.error("Error fetching all TeamSpeak groups:", error);
        if (active) {
          setFetchingError("Failed to load all TeamSpeak group data. Some groups may be missing.");
        }
      } finally {
        if (active) {
          setIsFetchingAll(false);
        }
      }
    }
    const lastKnownFetchCount = allFetchedGroups.length % PAGE_SIZE;
    if (allFetchedGroups.length === 0 || (lastKnownFetchCount === 0 && allFetchedGroups.length >= (initialGroupsRef.current?.length ?? 0))) {
        void fetchAllGroupsLoop();
    } else {
        if(isFetchingAll) setIsFetchingAll(false);
    }
    return () => {
      active = false;
    };
  }, [trpcUtils, allFetchedGroups.length, isFetchingAll]);

  const {
    searchTerm,
    setSearchTerm,
    totalItems: totalFilteredItems,
    filteredData: filteredGroups, 
  } = useTableControls<TsGroup>({
    data: allFetchedGroups, 
    searchKeys: ['name', 'sgid'],
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredGroups?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
    measureElement: typeof window !== 'undefined' 
      ? (element) => element?.getBoundingClientRect().height || ESTIMATED_ROW_HEIGHT
      : undefined,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems?.[0]?.start ?? 0 : 0;
  const paddingBottom = virtualItems.length > 0 
    ? totalHeight - (virtualItems?.[virtualItems.length - 1]?.end ?? 0)
    : 0;
  const isLoadingUiForInitialData = isFetchingAll && allFetchedGroups.length === 0 && !fetchingError;
  if (isLoadingUiForInitialData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Preparing TeamSpeak group list...</p>
      </div>
    );
  }
  if (isFetchingAll && !isLoadingUiForInitialData) {
    return (
      <Card className="shadow-lg w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <CardTitle className="text-xl">Loading TeamSpeak Groups</CardTitle>
          <CardDescription>
            Fetching TeamSpeak group data. This may take a moment...
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Progress value={undefined} className="w-full" />
          <p className="text-sm text-muted-foreground text-center mt-2">
            Loaded {totalGroupsLoaded.toLocaleString()} groups so far...
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
  if (!isFetchingAll && fetchingError && allFetchedGroups.length === 0) {
     return (
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
          <CardTitle>Error Loading TeamSpeak Groups</CardTitle>
          <CardDescription>
            {fetchingError ?? "There was a problem fetching TeamSpeak group data. Please try again later."}
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
            <Users className="mr-2 h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">TeamSpeak Groups</CardTitle>
          </div>
        </div>
        <CardDescription>
          View all TeamSpeak server groups in the system. Use the search bar to filter by name or SGID.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <Input
            placeholder="Search groups by name or SGID..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
          <span className="text-xs text-muted-foreground ml-2">
            Showing {filteredGroups.length.toLocaleString()} of {allFetchedGroups.length.toLocaleString()} groups
          </span>
        </div>
        <div ref={parentRef} className="h-[500px] overflow-auto border rounded-md">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>Group Name</TableHead>
                <TableHead>SGID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {virtualItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                    No groups found.
                  </TableCell>
                </TableRow>
              )}
              {paddingTop > 0 && (
                <tr>
                  <td style={{ height: `${paddingTop}px` }} />
                </tr>
              )}
              {virtualItems.map(virtualRow => {
                const group = filteredGroups[virtualRow.index];
                if (!group) return null;
                return (
                  <TableRow 
                    key={group.sgid}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                  >
                    <TableCell>{group.name}</TableCell>
                    <TableCell>{group.sgid}</TableCell>
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