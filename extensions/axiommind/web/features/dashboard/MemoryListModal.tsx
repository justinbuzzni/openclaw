"use client";

import { memo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  X,
  Loader2,
  Database,
  FileText,
  Lightbulb,
  CheckSquare,
  Bookmark,
  Gavel,
  Brain,
  ChevronRight,
} from "lucide-react";
import MemoryEditor from "../memory/MemoryEditor";

const API_BASE = "/ax/api";

type EntryWithMeta = {
  id: string;
  sessionId: string;
  entryType: string;
  title: string;
  content: Record<string, unknown>;
  memoryStage: string;
  accessCount: number;
  confirmationCount: number;
  createdAt: string;
  sessionDate: string;
};

type MemoryListModalProps = {
  isOpen: boolean;
  onClose: () => void;
  filter: {
    type: "stage" | "entryType";
    value: string;
    label: string;
  } | null;
};

const ENTRY_TYPE_CONFIG: Record<string, { label: string; className: string; icon: typeof Database }> = {
  fact: { label: "Fact", className: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: FileText },
  decision: { label: "Decision", className: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: Gavel },
  insight: { label: "Insight", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: Lightbulb },
  task: { label: "Task", className: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: CheckSquare },
  reference: { label: "Reference", className: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: Bookmark },
};

const STAGE_CONFIG: Record<string, { label: string; className: string }> = {
  working: { label: "L1 Working", className: "bg-blue-500/20 text-blue-400" },
  candidate: { label: "L2 Candidate", className: "bg-amber-500/20 text-amber-400" },
  verified: { label: "L3 Verified", className: "bg-emerald-500/20 text-emerald-400" },
  certified: { label: "L4 Certified", className: "bg-purple-500/20 text-purple-400" },
};

async function fetchFilteredEntries(filter: MemoryListModalProps["filter"]): Promise<{ entries: EntryWithMeta[]; total: number }> {
  if (!filter) return { entries: [], total: 0 };

  const url = new URL(`${API_BASE}/entries`, window.location.origin);
  url.searchParams.set("limit", "50");

  if (filter.type === "stage") {
    url.searchParams.append("stages", filter.value);
  } else if (filter.type === "entryType") {
    url.searchParams.append("types", filter.value);
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to fetch entries: ${res.statusText}`);
  return res.json();
}

const MemoryListModal = ({ isOpen, onClose, filter }: MemoryListModalProps) => {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "filteredEntries", filter],
    queryFn: () => fetchFilteredEntries(filter),
    enabled: isOpen && !!filter,
  });

  const handleEntryClick = useCallback((entryId: string) => {
    setSelectedEntryId(entryId);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setSelectedEntryId(null);
  }, []);

  if (!isOpen || !filter) return null;

  const entries = data?.entries || [];

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40 p-4">
        <div className="bg-[#1a1b22] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Database className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-200">{filter.label}</h2>
                <p className="text-[10px] text-gray-500">
                  {entries.length} {entries.length === 1 ? "memory" : "memories"} found
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <p className="text-xs text-gray-500">Loading memories...</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Brain className="w-10 h-10 text-gray-600 mb-3" />
                <p className="text-sm text-gray-400">No memories found</p>
              </div>
            ) : (
              entries.map((entry) => {
                const typeConfig = ENTRY_TYPE_CONFIG[entry.entryType] || ENTRY_TYPE_CONFIG.reference;
                const stageConfig = STAGE_CONFIG[entry.memoryStage] || STAGE_CONFIG.working;
                const Icon = typeConfig.icon;

                return (
                  <div
                    key={entry.id}
                    onClick={() => handleEntryClick(entry.id)}
                    className="group p-4 bg-black/20 border border-white/5 rounded-xl hover:bg-black/30 hover:border-white/10 transition-all cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("p-2 rounded-lg shrink-0", typeConfig.className)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium", stageConfig.className)}>
                            {stageConfig.label}
                          </span>
                          <span className="text-[10px] text-gray-500">{entry.sessionDate}</span>
                        </div>
                        <p className="text-sm text-gray-200 group-hover:text-white transition-colors line-clamp-2">
                          {entry.title}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
                          <span>Views: {entry.accessCount}</span>
                          <span>Confirms: {entry.confirmationCount}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Memory Editor Modal */}
      {selectedEntryId && (
        <MemoryEditor entryId={selectedEntryId} onClose={handleCloseEditor} />
      )}
    </>
  );
};

export default memo(MemoryListModal);
