import { useQuery } from "@tanstack/react-query";

const API_BASE = "/ax/api";

export interface GraduationStats {
  raw: number;
  working: number;
  candidate: number;
  verified: number;
  certified: number;
  total: number;
}

export interface SchedulerStats {
  lastPromotionCheck: string | null;
  lastConsolidation: string | null;
  lastGraphCleanup: string | null;
  totalPromotions: number;
  totalDemotions: number;
  totalConsolidations: number;
  isRunning: boolean;
}

export interface DashboardStats {
  graduation: GraduationStats;
  scheduler: SchedulerStats;
  embedding: {
    provider: string;
    model: string;
    available: boolean;
    cacheSize: number;
  };
  entriesByType: Record<string, number>;
}

export interface TopAccessedEntry {
  id: string;
  title: string;
  entryType: string;
  memoryStage: string;
  accessCount: number;
  confirmationCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
}

export interface ActivityItem {
  entryId: string;
  entryTitle: string;
  fromStage: string;
  toStage: string;
  reason: string;
  promotedAt: string;
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await fetch(`${API_BASE}/dashboard/stats`);
  if (!res.ok) throw new Error(`Failed to fetch dashboard stats: ${res.statusText}`);
  return res.json();
}

async function fetchTopAccessed(limit: number): Promise<{ entries: TopAccessedEntry[] }> {
  const res = await fetch(`${API_BASE}/dashboard/top-accessed?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch top accessed: ${res.statusText}`);
  return res.json();
}

async function fetchRecentActivity(limit: number): Promise<{ activities: ActivityItem[] }> {
  const res = await fetch(`${API_BASE}/dashboard/activity?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch recent activity: ${res.statusText}`);
  return res.json();
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: ["dashboard", "stats"],
    queryFn: fetchDashboardStats,
    refetchInterval: 30000, // 30초마다 갱신
    staleTime: 10000,
  });
}

export function useTopAccessed(limit = 10) {
  return useQuery<{ entries: TopAccessedEntry[] }>({
    queryKey: ["dashboard", "topAccessed", limit],
    queryFn: () => fetchTopAccessed(limit),
    refetchInterval: 60000, // 1분마다 갱신
    staleTime: 30000,
  });
}

export function useRecentActivity(limit = 20) {
  return useQuery<{ activities: ActivityItem[] }>({
    queryKey: ["dashboard", "activity", limit],
    queryFn: () => fetchRecentActivity(limit),
    refetchInterval: 30000,
    staleTime: 10000,
  });
}
