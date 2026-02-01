"use client";

import { memo, useCallback, type ChangeEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useMemorySearch, usePendingTasks, useGraduationStats } from "./_hooks/useMemory";
import SearchResults from "./SearchResults";
import GraduationPipeline from "./GraduationPipeline";
import { cn } from "@/lib/utils";
import { Search, ListTodo, Database, CheckCircle2, ChevronRight, BrainCircuit, LayoutDashboard } from "lucide-react";

const MemoryPanel = () => {
  const { searchQuery, setSearchQuery, search, results, isLoading } = useMemorySearch();
  const { data: tasks } = usePendingTasks();
  const { data: graduationStats, isLoading: isLoadingStats, refetch: refetchStats } = useGraduationStats();

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
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
         <div className="flex items-center gap-3">
           <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
               <Database className="w-5 h-5" />
           </div>
           <div>
              <h2 className="text-sm font-bold text-gray-200 tracking-wide">MEMORY BANK</h2>
              <p className="text-[10px] text-gray-500 font-medium">KNOWLEDGE & TASKS</p>
           </div>
         </div>
         <Link
           href="/dashboard"
           className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
           title="Open Dashboard"
         >
           <LayoutDashboard className="w-5 h-5 text-gray-400 hover:text-gray-200" />
         </Link>
      </div>

      {/* Search Bar */}
      <div className="p-4">
        <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-500 group-focus-within:text-primary-400 transition-colors" />
            </div>
            <input
            type="text"
            value={searchQuery}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Search memories..."
            className={cn(
                "w-full pl-10 pr-4 py-2.5 text-sm rounded-xl",
                "bg-black/20 border border-white/5 text-gray-200 placeholder:text-gray-600",
                "focus:outline-none focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50",
                "transition-all duration-200"
            )}
            />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
        {searchQuery.length >= 2 ? (
          <SearchResults results={results} isLoading={isLoading} />
        ) : (
          <div className="space-y-6">
            {/* Graduation Pipeline Status */}
            <div className="p-4 bg-[#1a1b22] border border-white/5 rounded-xl">
              <GraduationPipeline
                stats={graduationStats}
                isLoading={isLoadingStats}
                onRefresh={() => refetchStats()}
              />
            </div>

            {/* Pending Tasks */}
            <div>
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <ListTodo className="w-3 h-3" />
                    Pending Verification
                </h3>
                
                {tasks && tasks.length > 0 ? (
                <div className="space-y-2">
                    {tasks.slice(0, 5).map((t, i) => (
                    <div
                        key={i}
                        className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg group hover:border-amber-500/30 transition-all cursor-pointer"
                    >
                        <div className="flex items-start justify-between">
                             <p className="font-medium text-amber-200/90 text-sm leading-snug">{(t.task as { title?: string }).title || "Untitled Task"}</p>
                             <ChevronRight className="w-4 h-4 text-amber-500/40 group-hover:text-amber-500 transition-colors" />
                        </div>
                        <p className="text-[10px] text-amber-500/60 mt-2 font-medium">{t.date}</p>
                    </div>
                    ))}
                </div>
                ) : (
                <div className="flex flex-col items-center justify-center p-6 border border-dashed border-white/10 rounded-xl bg-white/5">
                    <CheckCircle2 className="w-8 h-8 text-gray-600 mb-2 opacity-50" />
                    <p className="text-xs text-gray-500 font-medium">All caught up</p>
                </div>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(MemoryPanel);
