"use client";

import { memo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Layers,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Award,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

type MemoryStage = "raw" | "working" | "candidate" | "verified" | "certified";

type GraduationStats = {
  raw: number;
  working: number;
  candidate: number;
  verified: number;
  certified: number;
  totalPromotions: number;
  totalDemotions: number;
  lastAutoPromotion?: string;
};

type StageInfo = {
  id: MemoryStage;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ComponentType<{ className?: string }>;
};

const STAGES: StageInfo[] = [
  {
    id: "raw",
    label: "L0: Raw",
    shortLabel: "Raw",
    description: "Unprocessed session data",
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/20",
    icon: Layers,
  },
  {
    id: "working",
    label: "L1: Working",
    shortLabel: "Working",
    description: "Extracted and validated entries",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    icon: Clock,
  },
  {
    id: "candidate",
    label: "L2: Candidate",
    shortLabel: "Candidate",
    description: "Successfully compiled with Idris",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    icon: TrendingUp,
  },
  {
    id: "verified",
    label: "L3: Verified",
    shortLabel: "Verified",
    description: "Confirmed through repeated access",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    icon: CheckCircle2,
  },
  {
    id: "certified",
    label: "L4: Certified",
    shortLabel: "Certified",
    description: "Long-term stable knowledge",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
    icon: Award,
  },
];

type GraduationPipelineProps = {
  stats?: GraduationStats;
  isLoading?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
};

const GraduationPipeline = ({
  stats,
  isLoading = false,
  onRefresh,
  compact = false,
}: GraduationPipelineProps) => {
  const [selectedStage, setSelectedStage] = useState<MemoryStage | null>(null);

  const getCount = (stage: MemoryStage): number => {
    if (!stats) return 0;
    return stats[stage] ?? 0;
  };

  const totalEntries = stats
    ? stats.raw + stats.working + stats.candidate + stats.verified + stats.certified
    : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {STAGES.map((stage, idx) => {
          const count = getCount(stage.id);
          const Icon = stage.icon;
          return (
            <div
              key={stage.id}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs",
                stage.bgColor,
                stage.borderColor,
                "border"
              )}
              title={`${stage.label}: ${count} entries`}
            >
              <Icon className={cn("w-3 h-3", stage.color)} />
              <span className={cn("font-medium", stage.color)}>{count}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary-400" />
          <h3 className="text-sm font-semibold text-white">Memory Graduation Pipeline</h3>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              "text-gray-400 hover:text-white hover:bg-white/5",
              isLoading && "animate-spin"
            )}
            title="Refresh stats"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Pipeline Visualization */}
      <div className="relative">
        {/* Connection line */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-gray-600 via-blue-500 via-amber-500 via-emerald-500 to-purple-500 opacity-30 -translate-y-1/2 z-0" />

        <div className="relative flex items-center justify-between gap-2 z-10">
          {STAGES.map((stage, idx) => {
            const count = getCount(stage.id);
            const Icon = stage.icon;
            const isSelected = selectedStage === stage.id;
            const percentage = totalEntries > 0 ? Math.round((count / totalEntries) * 100) : 0;

            return (
              <div key={stage.id} className="flex items-center">
                {/* Stage Node */}
                <button
                  onClick={() => setSelectedStage(isSelected ? null : stage.id)}
                  className={cn(
                    "relative flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-200",
                    "border",
                    isSelected
                      ? cn(stage.bgColor, stage.borderColor, "scale-105")
                      : "bg-[#1a1b22] border-white/10 hover:border-white/20"
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center",
                      stage.bgColor
                    )}
                  >
                    <Icon className={cn("w-5 h-5", stage.color)} />
                  </div>

                  {/* Count */}
                  <span className={cn("text-lg font-bold", stage.color)}>
                    {isLoading ? "-" : count}
                  </span>

                  {/* Label */}
                  <span className="text-[10px] text-gray-400 font-medium">
                    {stage.shortLabel}
                  </span>

                  {/* Percentage bar */}
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1">
                    <div
                      className={cn("h-full transition-all duration-500", stage.bgColor.replace("/10", "/50"))}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </button>

                {/* Arrow */}
                {idx < STAGES.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-gray-600 mx-1 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Stage Details */}
      {selectedStage && (
        <div
          className={cn(
            "p-4 rounded-xl border",
            STAGES.find((s) => s.id === selectedStage)?.bgColor,
            STAGES.find((s) => s.id === selectedStage)?.borderColor
          )}
        >
          <div className="flex items-start gap-3">
            {(() => {
              const stage = STAGES.find((s) => s.id === selectedStage)!;
              const Icon = stage.icon;
              return (
                <>
                  <Icon className={cn("w-5 h-5 mt-0.5", stage.color)} />
                  <div>
                    <h4 className={cn("font-semibold", stage.color)}>{stage.label}</h4>
                    <p className="text-xs text-gray-400 mt-1">{stage.description}</p>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
          <div className="text-center">
            <p className="text-lg font-bold text-white">{totalEntries}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total Entries</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-emerald-400">
              {stats.totalPromotions}
            </p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Promotions</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-amber-400">
              {stats.totalDemotions}
            </p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Demotions</p>
          </div>
        </div>
      )}

      {/* Last Auto-Promotion */}
      {stats?.lastAutoPromotion && (
        <div className="text-[10px] text-gray-500 text-center">
          Last auto-promotion: {new Date(stats.lastAutoPromotion).toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default memo(GraduationPipeline);
