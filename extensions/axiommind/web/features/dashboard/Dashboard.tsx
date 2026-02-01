"use client";

import { memo, useState, useCallback } from "react";
import Link from "next/link";
import {
  Database,
  Brain,
  TrendingUp,
  Clock,
  Activity,
  Layers,
  Eye,
  CheckCircle2,
  Shield,
  Zap,
  ArrowLeft,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardStats, useTopAccessed, useRecentActivity } from "./useDashboard";
import MemoryListModal from "./MemoryListModal";
import MemoryEditor from "../memory/MemoryEditor";

const STAGE_COLORS: Record<string, string> = {
  working: "bg-blue-500",
  candidate: "bg-amber-500",
  verified: "bg-emerald-500",
  certified: "bg-purple-500",
};

const STAGE_LABELS: Record<string, string> = {
  working: "L1 Working",
  candidate: "L2 Candidate",
  verified: "L3 Verified",
  certified: "L4 Certified",
};

const TYPE_ICONS: Record<string, typeof Database> = {
  fact: Database,
  decision: Brain,
  task: CheckCircle2,
  reference: Layers,
  insight: Zap,
};

type FilterState = {
  type: "stage" | "entryType";
  value: string;
  label: string;
} | null;

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  color = "emerald",
  onClick,
}: {
  title: string;
  value: string | number;
  icon: typeof Database;
  description?: string;
  trend?: { value: number; label: string };
  color?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-5 bg-[#1a1b22] border border-white/5 rounded-xl transition-all",
        onClick && "cursor-pointer hover:border-white/10 hover:bg-[#1e1f26]"
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{title}</p>
          <p className="text-3xl font-bold text-gray-100 mt-2">{value}</p>
          {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
        </div>
        <div className={cn("p-3 rounded-lg", `bg-${color}-500/10`)}>
          <Icon className={cn("w-6 h-6", `text-${color}-400`)} />
        </div>
      </div>
      {trend && (
        <div className="flex items-center gap-1 mt-3">
          <TrendingUp className={cn("w-3 h-3", trend.value >= 0 ? "text-emerald-400" : "text-red-400")} />
          <span className={cn("text-xs font-medium", trend.value >= 0 ? "text-emerald-400" : "text-red-400")}>
            {trend.value >= 0 ? "+" : ""}
            {trend.value}%
          </span>
          <span className="text-xs text-gray-500">{trend.label}</span>
        </div>
      )}
      {onClick && (
        <div className="flex items-center gap-1 mt-3 text-xs text-gray-500">
          <span>Click to view</span>
          <ChevronRight className="w-3 h-3" />
        </div>
      )}
    </div>
  );
}

function StageDistribution({
  stats,
  onStageClick,
}: {
  stats: { working: number; candidate: number; verified: number; certified: number; total: number };
  onStageClick: (stage: string, label: string) => void;
}) {
  const stages = [
    { key: "working", count: stats.working },
    { key: "candidate", count: stats.candidate },
    { key: "verified", count: stats.verified },
    { key: "certified", count: stats.certified },
  ];

  const total = stats.total || 1;

  return (
    <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Layers className="w-4 h-4 text-emerald-400" />
        Memory Graduation Distribution
      </h3>

      {/* Bar Chart */}
      <div className="flex h-8 rounded-lg overflow-hidden mb-4">
        {stages.map(({ key, count }) => {
          const percentage = (count / total) * 100;
          if (percentage === 0) return null;
          return (
            <div
              key={key}
              onClick={() => count > 0 && onStageClick(key, STAGE_LABELS[key])}
              className={cn(
                STAGE_COLORS[key],
                "transition-all duration-500",
                count > 0 && "cursor-pointer hover:opacity-80"
              )}
              style={{ width: `${percentage}%` }}
              title={`${STAGE_LABELS[key]}: ${count} (${percentage.toFixed(1)}%) - Click to view`}
            />
          );
        })}
        {total === 0 && <div className="w-full bg-gray-700" />}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-3">
        {stages.map(({ key, count }) => (
          <div
            key={key}
            onClick={() => count > 0 && onStageClick(key, STAGE_LABELS[key])}
            className={cn(
              "flex items-center gap-2 p-2 rounded-lg transition-colors",
              count > 0 && "cursor-pointer hover:bg-white/5"
            )}
          >
            <div className={cn("w-3 h-3 rounded-sm", STAGE_COLORS[key])} />
            <span className="text-xs text-gray-400">{STAGE_LABELS[key]}</span>
            <span className="text-xs font-semibold text-gray-200 ml-auto">{count}</span>
            {count > 0 && <ChevronRight className="w-3 h-3 text-gray-600" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TopAccessedList({ onEntryClick }: { onEntryClick: (entryId: string) => void }) {
  const { data, isLoading } = useTopAccessed(10);

  if (isLoading) {
    return (
      <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl animate-pulse">
        <div className="h-4 w-32 bg-gray-700 rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const entries = data?.entries || [];

  return (
    <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Eye className="w-4 h-4 text-cyan-400" />
        Top Accessed Memories
      </h3>

      {entries.length === 0 ? (
        <div className="text-center py-8">
          <Eye className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No accessed memories yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => {
            const Icon = TYPE_ICONS[entry.entryType] || Database;
            return (
              <div
                key={entry.id}
                onClick={() => onEntryClick(entry.id)}
                className="flex items-center gap-3 p-3 bg-black/20 rounded-lg hover:bg-black/30 transition-colors cursor-pointer group"
              >
                <span className="text-xs font-bold text-gray-500 w-5">#{i + 1}</span>
                <Icon className="w-4 h-4 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate group-hover:text-white transition-colors">{entry.title}</p>
                  <p className="text-xs text-gray-500">
                    {entry.entryType} · {STAGE_LABELS[entry.memoryStage] || entry.memoryStage}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-emerald-400">{entry.accessCount}</p>
                  <p className="text-xs text-gray-500">views</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentActivityList({ onEntryClick }: { onEntryClick: (entryId: string) => void }) {
  const { data, isLoading } = useRecentActivity(10);

  if (isLoading) {
    return (
      <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl animate-pulse">
        <div className="h-4 w-32 bg-gray-700 rounded mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const activities = data?.activities || [];

  return (
    <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Activity className="w-4 h-4 text-amber-400" />
        Recent Activity
      </h3>

      {activities.length === 0 ? (
        <div className="text-center py-8">
          <Activity className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No recent activity</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map((activity, i) => (
            <div
              key={`${activity.entryId}-${i}`}
              onClick={() => activity.entryId && onEntryClick(activity.entryId)}
              className={cn(
                "flex items-center gap-3 p-3 bg-black/20 rounded-lg",
                activity.entryId && "cursor-pointer hover:bg-black/30 transition-colors group"
              )}
            >
              <div className={cn("w-2 h-2 rounded-full", STAGE_COLORS[activity.toStage] || "bg-gray-500")} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate group-hover:text-white transition-colors">
                  {activity.entryTitle || "Untitled"}
                </p>
                <p className="text-xs text-gray-500">
                  {STAGE_LABELS[activity.fromStage] || activity.fromStage} → {STAGE_LABELS[activity.toStage] || activity.toStage}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">
                  {activity.promotedAt ? new Date(activity.promotedAt).toLocaleDateString() : "-"}
                </p>
              </div>
              {activity.entryId && <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntriesByTypeChart({
  entriesByType,
  onTypeClick,
}: {
  entriesByType: Record<string, number>;
  onTypeClick: (type: string, label: string) => void;
}) {
  const types = Object.entries(entriesByType).sort((a, b) => b[1] - a[1]);
  const total = types.reduce((sum, [, count]) => sum + count, 0) || 1;

  const colors = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-cyan-500"];
  const typeLabels: Record<string, string> = {
    fact: "Facts",
    decision: "Decisions",
    insight: "Insights",
    task: "Tasks",
    reference: "References",
  };

  return (
    <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Database className="w-4 h-4 text-blue-400" />
        Memories by Type
      </h3>

      {types.length === 0 ? (
        <div className="text-center py-8">
          <Database className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No memories yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {types.map(([type, count], i) => {
            const percentage = (count / total) * 100;
            const Icon = TYPE_ICONS[type] || Database;
            const label = typeLabels[type] || type;
            return (
              <div
                key={type}
                onClick={() => count > 0 && onTypeClick(type, label)}
                className={cn("p-2 rounded-lg transition-colors", count > 0 && "cursor-pointer hover:bg-white/5")}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Icon className="w-3 h-3 text-gray-400" />
                    <span className="text-xs text-gray-300 capitalize">{type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-200">{count}</span>
                    {count > 0 && <ChevronRight className="w-3 h-3 text-gray-600" />}
                  </div>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={cn(colors[i % colors.length], "h-full rounded-full transition-all duration-500")}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmbeddingInfo({ embedding }: { embedding: { provider: string; model: string; available: boolean; cacheSize: number } }) {
  return (
    <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Brain className="w-4 h-4 text-purple-400" />
        Embedding Provider
      </h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Provider</span>
          <span className="text-sm font-medium text-gray-200">{embedding.provider || "local"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Model</span>
          <span className="text-sm font-medium text-gray-200 truncate max-w-[150px]">
            {embedding.model || "EmbeddingGemma-308M"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Status</span>
          <span className={cn("text-sm font-medium flex items-center gap-1", embedding.available ? "text-emerald-400" : "text-red-400")}>
            <span className={cn("w-2 h-2 rounded-full", embedding.available ? "bg-emerald-400" : "bg-red-400")} />
            {embedding.available ? "Available" : "Unavailable"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Cache Size</span>
          <span className="text-sm font-medium text-gray-200">{embedding.cacheSize} entries</span>
        </div>
      </div>
    </div>
  );
}

function SchedulerStatus({ scheduler }: { scheduler: { isRunning: boolean; totalPromotions: number; totalDemotions: number; totalConsolidations: number } }) {
  return (
    <div className="p-5 bg-[#1a1b22] border border-white/5 rounded-xl">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4 text-cyan-400" />
        Auto Scheduler
      </h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Status</span>
          <span className={cn("text-sm font-medium flex items-center gap-1", scheduler.isRunning ? "text-emerald-400" : "text-gray-400")}>
            <span className={cn("w-2 h-2 rounded-full", scheduler.isRunning ? "bg-emerald-400 animate-pulse" : "bg-gray-500")} />
            {scheduler.isRunning ? "Running" : "Stopped"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Total Promotions</span>
          <span className="text-sm font-medium text-gray-200">{scheduler.totalPromotions}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Total Demotions</span>
          <span className="text-sm font-medium text-gray-200">{scheduler.totalDemotions}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Consolidations</span>
          <span className="text-sm font-medium text-gray-200">{scheduler.totalConsolidations}</span>
        </div>
      </div>
    </div>
  );
}

const Dashboard = () => {
  const { data: stats, isLoading, refetch } = useDashboardStats();
  const [filter, setFilter] = useState<FilterState>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const handleStageClick = useCallback((stage: string, label: string) => {
    setFilter({ type: "stage", value: stage, label });
  }, []);

  const handleTypeClick = useCallback((type: string, label: string) => {
    setFilter({ type: "entryType", value: type, label });
  }, []);

  const handleEntryClick = useCallback((entryId: string) => {
    setSelectedEntryId(entryId);
  }, []);

  const handleCloseFilter = useCallback(() => {
    setFilter(null);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setSelectedEntryId(null);
  }, []);

  if (isLoading || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-100">Memory Dashboard</h1>
              <p className="text-xs text-gray-500">Monitor and analyze your memory system</p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-gray-400" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              title="Total Memories"
              value={stats.graduation.total}
              icon={Database}
              description="All stored memories"
              color="emerald"
            />
            <StatCard
              title="Verified (L3)"
              value={stats.graduation.verified}
              icon={Shield}
              description="Type-checked memories"
              color="green"
              onClick={stats.graduation.verified > 0 ? () => handleStageClick("verified", "L3 Verified") : undefined}
            />
            <StatCard
              title="Certified (L4)"
              value={stats.graduation.certified}
              icon={CheckCircle2}
              description="Long-term stable"
              color="purple"
              onClick={stats.graduation.certified > 0 ? () => handleStageClick("certified", "L4 Certified") : undefined}
            />
            <StatCard
              title="Pending (L1+L2)"
              value={stats.graduation.working + stats.graduation.candidate}
              icon={Clock}
              description="Awaiting promotion"
              color="amber"
              onClick={stats.graduation.working + stats.graduation.candidate > 0 ? () => handleStageClick("working", "L1 Working") : undefined}
            />
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              <StageDistribution stats={stats.graduation} onStageClick={handleStageClick} />
              <EntriesByTypeChart entriesByType={stats.entriesByType} onTypeClick={handleTypeClick} />
            </div>

            {/* Center Column */}
            <div className="space-y-6">
              <TopAccessedList onEntryClick={handleEntryClick} />
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <RecentActivityList onEntryClick={handleEntryClick} />
              <EmbeddingInfo embedding={stats.embedding} />
              <SchedulerStatus scheduler={stats.scheduler} />
            </div>
          </div>
        </div>
      </div>

      {/* Memory List Modal */}
      <MemoryListModal
        isOpen={!!filter}
        onClose={handleCloseFilter}
        filter={filter}
      />

      {/* Memory Editor Modal */}
      {selectedEntryId && (
        <MemoryEditor entryId={selectedEntryId} onClose={handleCloseEditor} />
      )}
    </>
  );
};

export default memo(Dashboard);
