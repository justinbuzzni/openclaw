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
import { memoryQueries, searchMemory, type SearchParams } from "../_api/queries";

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
