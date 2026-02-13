"use client";

import { memo, useState } from "react";
import { useAtomValue } from "jotai";
import { motion, AnimatePresence } from "framer-motion";
import {
  memoryOperationsAtom,
  type MemoryOperation,
  type MemoryOperationPhase,
} from "./_stores/chat";
import { cn } from "@/lib/utils";
import {
  Brain,
  Database,
  Search,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  FileCode2,
  Shield,
  Archive,
  Sparkles,
} from "lucide-react";

// Phase configuration
const phaseConfig: Record<
  MemoryOperationPhase,
  { label: string; icon: React.ElementType; color: string }
> = {
  extracting: {
    label: "Extracting knowledge...",
    icon: Sparkles,
    color: "text-purple-400",
  },
  generating: {
    label: "Generating Idris code...",
    icon: FileCode2,
    color: "text-blue-400",
  },
  validating: {
    label: "Type verification...",
    icon: Shield,
    color: "text-amber-400",
  },
  indexing: {
    label: "Indexing to memory...",
    icon: Archive,
    color: "text-emerald-400",
  },
  searching: {
    label: "Searching memory...",
    icon: Search,
    color: "text-cyan-400",
  },
  retrieving: {
    label: "Retrieving results...",
    icon: Database,
    color: "text-indigo-400",
  },
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    color: "text-emerald-400",
  },
  error: {
    label: "Error",
    icon: XCircle,
    color: "text-rose-400",
  },
};

// Save operation phases (in order)
const savePhases: MemoryOperationPhase[] = [
  "extracting",
  "generating",
  "validating",
  "indexing",
  "complete",
];

// Search/Recall phases (in order)
const searchPhases: MemoryOperationPhase[] = [
  "searching",
  "retrieving",
  "complete",
];

function getPhaseIndex(phase: MemoryOperationPhase, type: "save" | "recall" | "search"): number {
  const phases = type === "save" ? savePhases : searchPhases;
  return phases.indexOf(phase);
}

function getOperationPhases(type: "save" | "recall" | "search"): MemoryOperationPhase[] {
  return type === "save" ? savePhases : searchPhases;
}

const MemoryOperationItem = memo(function MemoryOperationItem({
  operation,
}: {
  operation: MemoryOperation;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const config = phaseConfig[operation.phase];
  const PhaseIcon = config.icon;
  const phases = getOperationPhases(operation.type);
  const currentPhaseIndex = getPhaseIndex(operation.phase, operation.type);
  const isComplete = operation.phase === "complete";
  const isError = operation.phase === "error";
  const isRunning = !isComplete && !isError;

  const operationLabel =
    operation.type === "save"
      ? "Saving to Memory"
      : operation.type === "recall"
        ? "Recalling Memory"
        : "Searching Memory";

  return (
    <div className="rounded-xl bg-gradient-to-br from-primary-500/10 to-purple-500/10 border border-primary-500/20 overflow-hidden shadow-lg">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
      >
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            "bg-gradient-to-br from-primary-500/20 to-purple-500/20",
            "border border-primary-500/30"
          )}
        >
          <Brain className="w-4 h-4 text-primary-400" />
        </div>

        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white/90">
              {operationLabel}
            </span>
            {isRunning && (
              <Loader2 className="w-3.5 h-3.5 text-primary-400 animate-spin" />
            )}
            {isComplete && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
            {isError && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
          </div>
          {operation.query && (
            <p className="text-xs text-white/40 truncate max-w-[200px]">
              {operation.query}
            </p>
          )}
        </div>

        <ChevronRight
          className={cn(
            "w-4 h-4 text-white/40 transition-transform",
            isExpanded && "rotate-90"
          )}
        />
      </button>

      {/* Progress Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Phase Progress */}
              <div className="flex items-center gap-1">
                {phases.slice(0, -1).map((phase, idx) => {
                  const isPast = idx < currentPhaseIndex;
                  const isCurrent = idx === currentPhaseIndex;
                  const phaseConf = phaseConfig[phase];

                  return (
                    <div key={phase} className="flex items-center flex-1">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center transition-all",
                          isPast && "bg-emerald-500/20",
                          isCurrent && "bg-primary-500/20 ring-2 ring-primary-500/50",
                          !isPast && !isCurrent && "bg-white/5"
                        )}
                      >
                        {isPast ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : isCurrent ? (
                          <Loader2 className="w-3.5 h-3.5 text-primary-400 animate-spin" />
                        ) : (
                          <phaseConf.icon className="w-3 h-3 text-white/30" />
                        )}
                      </div>
                      {idx < phases.length - 2 && (
                        <div
                          className={cn(
                            "flex-1 h-0.5 mx-1",
                            isPast ? "bg-emerald-500/50" : "bg-white/10"
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Current Phase Label */}
              <div
                className={cn(
                  "flex items-center gap-2 text-xs px-3 py-2 rounded-lg",
                  "bg-black/20 border border-white/5"
                )}
              >
                <PhaseIcon className={cn("w-4 h-4", config.color)} />
                <span className={cn("font-medium", config.color)}>
                  {config.label}
                </span>
              </div>

              {/* Results Info */}
              {isComplete && (
                <div className="text-xs text-white/60 space-y-1 px-1">
                  {operation.sessionId && (
                    <p>
                      Session:{" "}
                      <span className="text-emerald-400 font-mono">
                        {operation.sessionId}
                      </span>
                    </p>
                  )}
                  {operation.entriesCount !== undefined && (
                    <p>
                      Entries:{" "}
                      <span className="text-emerald-400">
                        {operation.entriesCount}
                      </span>
                    </p>
                  )}
                  {operation.results && operation.results.length > 0 && (
                    <p>
                      Results:{" "}
                      <span className="text-emerald-400">
                        {operation.results.length} found
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* Error Message */}
              {isError && operation.error && (
                <div className="text-xs text-rose-400 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  {operation.error}
                </div>
              )}

              {/* Time Info */}
              {operation.completedAt && (
                <div className="text-[10px] text-white/30 px-1">
                  Completed in {operation.completedAt - operation.startedAt}ms
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

const MemoryOperationIndicator = memo(function MemoryOperationIndicator({
  isStreaming,
}: {
  isStreaming?: boolean;
}) {
  const operations = useAtomValue(memoryOperationsAtom);

  if (operations.length === 0) return null;

  return (
    <div className="space-y-3 mt-3 mb-2">
      {operations.map((op) => (
        <MemoryOperationItem key={op.id} operation={op} />
      ))}
    </div>
  );
});

export default MemoryOperationIndicator;
