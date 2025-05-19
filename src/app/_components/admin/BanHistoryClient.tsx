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
import { AlertTriangle, Loader2, Ban } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { useTableControls } from '@/hooks/useTableControls';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Progress } from '@/components/ui/progress';

// Infer element type from procedure output
type BanHistoryOutput = RouterOutputs["admin"]["banHistory"]["listBanHistory"];
type BanEntry = BanHistoryOutput extends (infer T)[] | undefined ? T : never;

interface BanHistoryClientProps {
  initialBanHistory: BanEntry[] | null;
}

const ESTIMATED_ROW_HEIGHT = 50;
const PAGE_SIZE = 100;

export default function BanHistoryClient({ initialBanHistory }: BanHistoryClientProps) {
  const [allFetchedBanHistory, setAllFetchedBanHistory] = useState<BanEntry[]>(initialBanHistory ?? []);
  const [isFetchingAll, setIsFetchingAll] = useState(true);
  const [fetchingError, setFetchingError] = useState<string | null>(null);
  const [totalBanHistoryLoaded, setTotalBanHistoryLoaded] = useState(initialBanHistory?.length ?? 0);

  const trpcUtils = api.useUtils();
  const initialBanHistoryRef = useRef(initialBanHistory);

  useEffect(() => {
    let active = true;
    async function fetchAllBanHistoryLoop() {
      if (!active || !isFetchingAll) return;
      let accumulatedBanHistoryInternal: BanEntry[] = [...(initialBanHistoryRef.current ?? [])];
      let currentPosition = initialBanHistoryRef.current?.length ?? 0;
      if (allFetchedBanHistory.length > (initialBanHistoryRef.current?.length ?? 0)) {
        currentPosition = allFetchedBanHistory.length;
        accumulatedBanHistoryInternal = [...allFetchedBanHistory];
      }
      const wasLastFetchPotentiallyPartial = initialBanHistoryRef.current ? (initialBanHistoryRef.current.length < PAGE_SIZE && initialBanHistoryRef.current.length > 0) : false;
      const needsFetching = !initialBanHistoryRef.current || initialBanHistoryRef.current.length === 0 || initialBanHistoryRef.current.length === PAGE_SIZE || 
                            (allFetchedBanHistory.length > 0 && allFetchedBanHistory.length % PAGE_SIZE === 0 && !wasLastFetchPotentiallyPartial);
      if (!needsFetching && allFetchedBanHistory.length > 0) {
        if (active) setIsFetchingAll(false);
        if (JSON.stringify(allFetchedBanHistory) !== JSON.stringify(accumulatedBanHistoryInternal)) {
             setAllFetchedBanHistory(accumulatedBanHistoryInternal);
        }
        return;
      }
      if(!isFetchingAll && active) setIsFetchingAll(true);
      let hasMoreToFetch = true;
      try {
        while (hasMoreToFetch && active) {
          const nextPageBanHistory = await trpcUtils.admin.banHistory.listBanHistory.fetch({ skip: currentPosition, limit: PAGE_SIZE });
          if (!active) break;
          if (nextPageBanHistory && nextPageBanHistory.length > 0) {
            const validNextPageBanHistory = nextPageBanHistory.filter(Boolean);
            accumulatedBanHistoryInternal = [...accumulatedBanHistoryInternal, ...validNextPageBanHistory];
            setAllFetchedBanHistory(prev => [...prev.filter(Boolean), ...validNextPageBanHistory]); 
            currentPosition += validNextPageBanHistory.length;
            setTotalBanHistoryLoaded(currentPosition);
            if (validNextPageBanHistory.length < PAGE_SIZE) {
              hasMoreToFetch = false;
            }
          } else {
            hasMoreToFetch = false;
          }
        }
      } catch (error) {
        console.error("Error fetching all ban history:", error);
        if (active) {
          setFetchingError("Failed to load all ban history data. Some entries may be missing.");
        }
      } finally {
        if (active) {
          setIsFetchingAll(false);
        }
      }
    }
    const lastKnownFetchCount = allFetchedBanHistory.length % PAGE_SIZE;
    if (allFetchedBanHistory.length === 0 || (lastKnownFetchCount === 0 && allFetchedBanHistory.length >= (initialBanHistoryRef.current?.length ?? 0))) {
        void fetchAllBanHistoryLoop();
    } else {
        if(isFetchingAll) setIsFetchingAll(false);
    }
    return () => {
      active = false;
    };
  }, [trpcUtils, allFetchedBanHistory.length, isFetchingAll]);

  const {
    searchTerm,
    setSearchTerm,
    totalItems: totalFilteredItems,
    filteredData: filteredBanHistory, 
  } = useTableControls<BanEntry>({
    data: allFetchedBanHistory, 
    searchKeys: ['user_discord_id', 'server_id', 'banned_by_user_id', 'reason'],
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredBanHistory?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10, 
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const isLoadingUiForInitialData = isFetchingAll && allFetchedBanHistory.length === 0 && !fetchingError;
  if (isLoadingUiForInitialData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Preparing ban history list...</p>
      </div>
    );
  }
  if (isFetchingAll && !isLoadingUiForInitialData) {
    return (
      <Card className="shadow-lg w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <CardTitle className="text-xl">Loading Ban History</CardTitle>
          <CardDescription>
            Fetching ban history data. This may take a moment...
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Progress value={undefined} className="w-full" />
          <p className="text-sm text-muted-foreground text-center mt-2">
            Loaded {totalBanHistoryLoaded.toLocaleString()} entries so far...
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
  if (!isFetchingAll && fetchingError && allFetchedBanHistory.length === 0) {
     return (
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-2" />
          <CardTitle>Error Loading Ban History</CardTitle>
          <CardDescription>
            {fetchingError ?? "There was a problem fetching ban history data. Please try again later."}
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
            <Ban className="mr-2 h-6 w-6 text-primary" />
            <CardTitle className="text-2xl">Ban History</CardTitle>
          </div>
        </div>
        <CardDescription>
          View all ban history entries in the system. Use the search bar to filter by user, server, or reason.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <Input
            placeholder="Search by user, server, or reason..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
          <span className="text-xs text-muted-foreground ml-2">
            Showing {filteredBanHistory.length.toLocaleString()} of {allFetchedBanHistory.length.toLocaleString()} entries
          </span>
        </div>
        <div ref={parentRef} className="h-[500px] overflow-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User Discord ID</TableHead>
                <TableHead>Server ID</TableHead>
                <TableHead>Banned By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Banned At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {virtualItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No ban history found.
                  </TableCell>
                </TableRow>
              )}
              {virtualItems.map(virtualRow => {
                const entry = filteredBanHistory[virtualRow.index];
                if (!entry) return null;
                return (
                  <TableRow key={entry.id} style={{ height: `${virtualRow.size}px` }}>
                    <TableCell>{entry.user_discord_id}</TableCell>
                    <TableCell>{entry.server_id}</TableCell>
                    <TableCell>{entry.banned_by_user_id ?? "N/A"}</TableCell>
                    <TableCell>{entry.reason ?? "N/A"}</TableCell>
                    <TableCell>{entry.banned_at ? new Date(entry.banned_at).toLocaleString() : "N/A"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
} 