"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { SearchResult, EntryType } from "./_stores/memory";

type SearchResultsProps = {
  results: SearchResult[];
  isLoading: boolean;
};

const ENTRY_TYPE_LABELS: Record<EntryType, { label: string; color: string }> = {
  fact: { label: "사실", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  decision: { label: "결정", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  insight: { label: "인사이트", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  task: { label: "할일", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  reference: { label: "참조", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
};

type ResultItemProps = {
  result: SearchResult;
};

const ResultItem = memo(function ResultItem({ result }: ResultItemProps) {
  const typeInfo = ENTRY_TYPE_LABELS[result.entryType];

  return (
    <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
      <div className="flex items-center gap-2 mb-1">
        <span className={cn("text-xs px-2 py-0.5 rounded", typeInfo.color)}>
          {typeInfo.label}
        </span>
        <span className="text-xs text-gray-500">{result.date}</span>
      </div>
      <p className="font-medium text-sm">{result.title}</p>
      <p className="text-xs text-gray-500 mt-1">세션: {result.sessionId}</p>
    </div>
  );
});

const SearchResults = ({ results, isLoading }: SearchResultsProps) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        검색 결과가 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.map((result) => (
        <ResultItem key={result.id} result={result} />
      ))}
    </div>
  );
};

export default memo(SearchResults);
