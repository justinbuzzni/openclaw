"use client";

import { memo, useCallback, type ChangeEvent, type KeyboardEvent } from "react";
import { useMemorySearch, usePendingTasks } from "./_hooks/useMemory";
import SearchResults from "./SearchResults";
import { cn } from "@/lib/utils";

const MemoryPanel = () => {
  const { searchQuery, setSearchQuery, search, results, isLoading } = useMemorySearch();
  const { data: tasks } = usePendingTasks();

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [setSearchQuery]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        search(searchQuery);
      }
    },
    [search, searchQuery]
  );

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          📚 Memory
        </h2>
      </div>

      {/* 검색 */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <input
          type="text"
          value={searchQuery}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="기억 검색..."
          className={cn(
            "w-full px-3 py-2 text-sm rounded-lg",
            "border border-gray-300 dark:border-gray-700",
            "bg-white dark:bg-gray-900",
            "focus:outline-none focus:ring-2 focus:ring-blue-500"
          )}
        />
      </div>

      {/* 검색 결과 또는 할일 목록 */}
      <div className="flex-1 overflow-y-auto p-3">
        {searchQuery.length >= 2 ? (
          <SearchResults results={results} isLoading={isLoading} />
        ) : (
          <div>
            {/* 미완료 Task */}
            <h3 className="text-xs font-semibold text-gray-500 mb-2">
              📋 미완료 Task
            </h3>
            {tasks && tasks.length > 0 ? (
              <div className="space-y-2">
                {tasks.slice(0, 5).map((t, i) => (
                  <div
                    key={i}
                    className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm"
                  >
                    <p className="font-medium">{(t.task as { title?: string }).title}</p>
                    <p className="text-xs text-gray-500">{t.date}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">할일이 없습니다</p>
            )}

            {/* Memory Pipeline 단계 */}
            <h3 className="text-xs font-semibold text-gray-500 mt-4 mb-2">
              🔄 Memory Pipeline
            </h3>
            <div className="space-y-1">
              {["L0: Raw", "L1: Working", "L2: Candidate", "L3: Verified", "L4: Certified"].map(
                (level, i) => (
                  <div
                    key={i}
                    className={cn(
                      "px-2 py-1 rounded text-xs",
                      i === 0
                        ? "bg-gray-100 dark:bg-gray-800"
                        : "text-gray-400"
                    )}
                  >
                    {level}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(MemoryPanel);
