"use client";

import { memo, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  RefreshCw,
  Check,
  X,
  GitMerge,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Trash2,
} from "lucide-react";

// === Types ===

type ConflictType = "semantic_duplicate" | "temporal_conflict" | "contradiction";

type Conflict = {
  id: string;
  entryId1: string;
  entryId2: string;
  conflictType: ConflictType;
  detectedAt: string;
  entry1?: {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    stage: string;
  };
  entry2?: {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    stage: string;
  };
};

type ResolutionOption = "keep_newer" | "keep_older" | "merge" | "manual";

type ConflictResolverProps = {
  apiBase?: string;
  onConflictResolved?: (conflictId: string) => void;
};

// === Styles ===

const CONFLICT_TYPES: Record<
  ConflictType,
  { label: string; color: string; bgColor: string; icon: React.ComponentType<{ className?: string }> }
> = {
  semantic_duplicate: {
    label: "Duplicate",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    icon: GitMerge,
  },
  temporal_conflict: {
    label: "Outdated",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    icon: Clock,
  },
  contradiction: {
    label: "Contradiction",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    icon: AlertTriangle,
  },
};

const RESOLUTION_OPTIONS: Array<{
  value: ResolutionOption;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "keep_newer",
    label: "Keep Newer",
    description: "Keep the most recent entry and discard the older one",
    icon: Clock,
  },
  {
    value: "keep_older",
    label: "Keep Older",
    description: "Keep the original entry and discard the newer one",
    icon: Clock,
  },
  {
    value: "merge",
    label: "Merge",
    description: "Combine information from both entries",
    icon: GitMerge,
  },
  {
    value: "manual",
    label: "Manual",
    description: "Manually review and decide later",
    icon: AlertTriangle,
  },
];

// === Component ===

const ConflictResolver = ({
  apiBase = "/ax/api",
  onConflictResolved,
}: ConflictResolverProps) => {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<ResolutionOption>("keep_newer");

  // Fetch conflicts
  const fetchConflicts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBase}/conflicts`);
      if (!response.ok) {
        throw new Error(`Failed to fetch conflicts: ${response.status}`);
      }

      const data = await response.json();
      setConflicts(data.conflicts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch conflicts");
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchConflicts();
  }, [fetchConflicts]);

  // Resolve conflict
  const resolveConflict = async (conflictId: string, resolution: ResolutionOption) => {
    setResolvingId(conflictId);

    try {
      const response = await fetch(`${apiBase}/conflicts/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conflictId,
          resolution,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to resolve conflict: ${response.status}`);
      }

      // Remove from list
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      setExpandedId(null);

      onConflictResolved?.(conflictId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve conflict");
    } finally {
      setResolvingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // No conflicts
  if (!isLoading && conflicts.length === 0) {
    return (
      <div className="p-6 text-center">
        <Check className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-white mb-1">No Conflicts</h3>
        <p className="text-sm text-gray-400">
          All memory entries are consistent. No action needed.
        </p>
        <button
          onClick={fetchConflicts}
          className="mt-4 px-4 py-2 text-sm bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 transition-colors"
        >
          <RefreshCw className="w-4 h-4 inline mr-2" />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">
            Memory Conflicts
            {conflicts.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full text-xs">
                {conflicts.length}
              </span>
            )}
          </h3>
        </div>
        <button
          onClick={fetchConflicts}
          disabled={isLoading}
          className={cn(
            "p-1.5 rounded-lg transition-colors",
            "text-gray-400 hover:text-white hover:bg-white/5",
            isLoading && "animate-spin"
          )}
          title="Refresh conflicts"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      )}

      {/* Conflict List */}
      {!isLoading && conflicts.length > 0 && (
        <div className="space-y-2">
          {conflicts.map((conflict) => {
            const typeInfo = CONFLICT_TYPES[conflict.conflictType];
            const TypeIcon = typeInfo.icon;
            const isExpanded = expandedId === conflict.id;
            const isResolving = resolvingId === conflict.id;

            return (
              <div
                key={conflict.id}
                className={cn(
                  "border rounded-xl overflow-hidden transition-all",
                  isExpanded
                    ? "border-white/20 bg-white/5"
                    : "border-white/10 hover:border-white/20"
                )}
              >
                {/* Conflict Header */}
                <button
                  onClick={() => toggleExpand(conflict.id)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                  disabled={isResolving}
                >
                  {/* Type Badge */}
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs",
                      typeInfo.bgColor,
                      typeInfo.color
                    )}
                  >
                    <TypeIcon className="w-3 h-3" />
                    {typeInfo.label}
                  </div>

                  {/* Content Preview */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">
                      {conflict.entry1?.title || conflict.entryId1}
                    </p>
                    <p className="text-xs text-gray-500">
                      vs {conflict.entry2?.title || conflict.entryId2}
                    </p>
                  </div>

                  {/* Detected Date */}
                  <span className="text-xs text-gray-500">
                    {new Date(conflict.detectedAt).toLocaleDateString()}
                  </span>

                  {/* Expand Icon */}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="p-4 pt-0 space-y-4">
                    {/* Entry Comparison */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Entry 1 */}
                      <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium text-gray-400">Entry 1</span>
                          {conflict.entry1?.stage && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                              {conflict.entry1.stage}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-white font-medium mb-1">
                          {conflict.entry1?.title || "Unknown"}
                        </p>
                        <p className="text-xs text-gray-400 line-clamp-3">
                          {conflict.entry1?.content || "Content not available"}
                        </p>
                        {conflict.entry1?.createdAt && (
                          <p className="text-[10px] text-gray-500 mt-2">
                            Created: {new Date(conflict.entry1.createdAt).toLocaleString()}
                          </p>
                        )}
                      </div>

                      {/* Entry 2 */}
                      <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium text-gray-400">Entry 2</span>
                          {conflict.entry2?.stage && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                              {conflict.entry2.stage}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-white font-medium mb-1">
                          {conflict.entry2?.title || "Unknown"}
                        </p>
                        <p className="text-xs text-gray-400 line-clamp-3">
                          {conflict.entry2?.content || "Content not available"}
                        </p>
                        {conflict.entry2?.createdAt && (
                          <p className="text-[10px] text-gray-500 mt-2">
                            Created: {new Date(conflict.entry2.createdAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Resolution Options */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-400">Resolve this conflict:</p>
                      <div className="grid grid-cols-2 gap-2">
                        {RESOLUTION_OPTIONS.map((option) => {
                          const Icon = option.icon;
                          const isSelected = selectedResolution === option.value;

                          return (
                            <button
                              key={option.value}
                              onClick={() => setSelectedResolution(option.value)}
                              className={cn(
                                "flex items-center gap-2 p-2 rounded-lg border transition-all text-left",
                                isSelected
                                  ? "border-primary-500/50 bg-primary-500/10"
                                  : "border-white/10 hover:border-white/20"
                              )}
                            >
                              <Icon
                                className={cn(
                                  "w-4 h-4 flex-shrink-0",
                                  isSelected ? "text-primary-400" : "text-gray-400"
                                )}
                              />
                              <div className="min-w-0">
                                <p
                                  className={cn(
                                    "text-sm font-medium",
                                    isSelected ? "text-primary-400" : "text-white"
                                  )}
                                >
                                  {option.label}
                                </p>
                                <p className="text-[10px] text-gray-500 truncate">
                                  {option.description}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                      <button
                        onClick={() => setExpandedId(null)}
                        className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                        disabled={isResolving}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => resolveConflict(conflict.id, selectedResolution)}
                        disabled={isResolving}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                          "bg-primary-500 hover:bg-primary-600 text-white",
                          isResolving && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {isResolving ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        Apply Resolution
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Actions */}
      {!isLoading && conflicts.length > 3 && (
        <div className="p-3 bg-white/5 rounded-lg border border-white/10">
          <p className="text-xs text-gray-400 mb-2">Quick Actions</p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                for (const conflict of conflicts) {
                  await resolveConflict(conflict.id, "keep_newer");
                }
              }}
              className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 transition-colors"
            >
              <Clock className="w-3 h-3 inline mr-1" />
              Resolve All (Keep Newer)
            </button>
            <button
              onClick={async () => {
                for (const conflict of conflicts) {
                  await resolveConflict(conflict.id, "merge");
                }
              }}
              className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 transition-colors"
            >
              <GitMerge className="w-3 h-3 inline mr-1" />
              Merge All
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(ConflictResolver);
