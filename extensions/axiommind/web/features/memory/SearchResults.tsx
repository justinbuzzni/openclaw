"use client";

import { memo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { SearchResult, EntryType, MemoryStage } from "./_stores/memory";
import { FileText, Lightbulb, CheckSquare, Bookmark, Gavel, Loader2 } from "lucide-react";
import MemoryEditor from "./MemoryEditor";

type SearchResultsProps = {
  results: SearchResult[];
  isLoading: boolean;
};

const ENTRY_TYPE_CONFIG: Record<EntryType, { label: string; className: string; icon: any }> = {
  fact: { label: "Fact", className: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: FileText },
  decision: { label: "Decision", className: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: Gavel },
  insight: { label: "Insight", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: Lightbulb },
  task: { label: "Task", className: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: CheckSquare },
  reference: { label: "Reference", className: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: Bookmark },
};

const STAGE_CONFIG: Record<string, { label: string; className: string }> = {
  working: { label: "L1", className: "bg-gray-500/20 text-gray-400" },
  candidate: { label: "L2", className: "bg-blue-500/20 text-blue-400" },
  verified: { label: "L3", className: "bg-emerald-500/20 text-emerald-400" },
  certified: { label: "L4", className: "bg-purple-500/20 text-purple-400" },
};

type ResultItemProps = {
  result: SearchResult;
  onClick: () => void;
};

const ResultItem = memo(function ResultItem({ result, onClick }: ResultItemProps) {
  const config = ENTRY_TYPE_CONFIG[result.entryType] || ENTRY_TYPE_CONFIG['reference'];
  const stageConfig = STAGE_CONFIG[result.memoryStage || 'working'] || STAGE_CONFIG.working;
  const Icon = config.icon;

  return (
    <div
      onClick={onClick}
      className="group p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all duration-200 cursor-pointer"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider", config.className)}>
             <Icon className="w-3 h-3" />
             {config.label}
          </div>
          <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium", stageConfig.className)}>
            {stageConfig.label}
          </span>
        </div>
        <span className="text-[10px] text-gray-500 font-mono">{result.date}</span>
      </div>

      <p className="font-medium text-sm text-gray-200 group-hover:text-white transition-colors line-clamp-2">
        {result.title}
      </p>

      <div className="mt-3 flex items-center justify-between">
         <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-600"></span>
            <span className="truncate max-w-[100px]">SESSION: {result.sessionId}</span>
         </div>
         <span className="text-[10px] text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity">
           Click to edit
         </span>
      </div>
    </div>
  );
});

const SearchResults = ({ results, isLoading }: SearchResultsProps) => {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const handleItemClick = useCallback((entryId: string) => {
    setSelectedEntryId(entryId);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setSelectedEntryId(null);
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        <p className="text-xs font-medium">Searching memory banks...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3">
             <FileText className="w-5 h-5 text-gray-600" />
        </div>
        <p className="text-sm font-medium text-gray-400">No memories found</p>
        <p className="text-xs text-gray-600 mt-1">Try adjusting your search terms</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {results.map((result) => (
          <ResultItem
            key={result.id}
            result={result}
            onClick={() => handleItemClick(result.id)}
          />
        ))}
      </div>

      {selectedEntryId && (
        <MemoryEditor entryId={selectedEntryId} onClose={handleCloseEditor} />
      )}
    </>
  );
};

export default memo(SearchResults);
