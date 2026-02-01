"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom, useSetAtom } from "jotai";
import {
  searchQueryAtom,
  searchResultsAtom,
  isSearchingAtom,
  searchErrorAtom,
} from "../_stores/memory";
import {
  memoryQueries,
  searchMemory,
  updateEntry,
  deleteEntry,
  promoteEntry,
  demoteEntry,
  type SearchParams,
  type ListEntriesParams,
  type EntryWithMeta,
} from "../_api/queries";

export function useMemorySearch() {
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const setSearchResults = useSetAtom(searchResultsAtom);
  const setIsSearching = useSetAtom(isSearchingAtom);
  const setSearchError = useSetAtom(searchErrorAtom);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    ...memoryQueries.search({ query: searchQuery }),
    enabled: searchQuery.length >= 2,
  });

  // 검색 결과 동기화
  if (data) {
    setSearchResults(data);
    setIsSearching(false);
    setSearchError(null);
  }

  if (error) {
    setSearchError(String(error));
    setIsSearching(false);
  }

  const search = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      setIsSearching(true);

      if (query.length >= 2) {
        await refetch();
      }
    },
    [setSearchQuery, setIsSearching, refetch]
  );

  return {
    searchQuery,
    setSearchQuery,
    search,
    results: data || [],
    isLoading,
    error: error ? String(error) : null,
  };
}

export function useDecisions(dateFrom?: string) {
  return useQuery(memoryQueries.decisions(dateFrom));
}

export function usePendingTasks() {
  return useQuery(memoryQueries.tasks);
}

export function useGraduationStats() {
  return useQuery(memoryQueries.graduationStats);
}

export function useEntries(params: ListEntriesParams = {}) {
  return useQuery(memoryQueries.entries(params));
}

export function useEntry(entryId: string) {
  return useQuery(memoryQueries.entry(entryId));
}

export function useUpdateEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, updates }: { entryId: string; updates: { title?: string; content?: Record<string, unknown> } }) =>
      updateEntry(entryId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", "entries"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "entry"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "search"] });
    },
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId: string) => deleteEntry(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", "entries"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "search"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "graduation", "stats"] });
    },
  });
}

export function usePromoteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, targetStage }: { entryId: string; targetStage: string }) =>
      promoteEntry(entryId, targetStage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", "entries"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "entry"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "graduation", "stats"] });
    },
  });
}

export function useDemoteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason?: string }) =>
      demoteEntry(entryId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", "entries"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "entry"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "graduation", "stats"] });
    },
  });
}
