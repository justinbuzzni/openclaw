import type { SearchResult, EntryType } from "../_stores/memory";

const API_BASE = "/ax/api";

export type SearchParams = {
  query: string;
  types?: EntryType[];
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
};

export type DecisionWithEvidence = {
  decision: Record<string, unknown>;
  date: string;
  evidenceFacts: Record<string, unknown>[];
  idrPath: string;
};

export type TaskWithContext = {
  task: Record<string, unknown>;
  date: string;
  session: string;
};

export type GraduationStats = {
  raw: number;
  working: number;
  candidate: number;
  verified: number;
  certified: number;
  totalPromotions: number;
  totalDemotions: number;
  lastAutoPromotion?: string;
};

// 메모리 검색
export async function searchMemory(params: SearchParams): Promise<SearchResult[]> {
  const url = new URL(`${API_BASE}/search`, window.location.origin);
  url.searchParams.set("q", params.query);

  if (params.types && params.types.length > 0) {
    params.types.forEach((t) => url.searchParams.append("types", t));
  }
  if (params.limit) {
    url.searchParams.set("limit", String(params.limit));
  }
  if (params.dateFrom) {
    url.searchParams.set("dateFrom", params.dateFrom);
  }
  if (params.dateTo) {
    url.searchParams.set("dateTo", params.dateTo);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Search failed: ${res.statusText}`);
  }

  const data = await res.json();
  return data.results;
}

// Decision 목록 조회
export async function getDecisions(dateFrom?: string): Promise<DecisionWithEvidence[]> {
  const url = new URL(`${API_BASE}/decisions`, window.location.origin);
  if (dateFrom) {
    url.searchParams.set("dateFrom", dateFrom);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Failed to fetch decisions: ${res.statusText}`);
  }

  const data = await res.json();
  return data.decisions;
}

// 미완료 Task 목록 조회
export async function getPendingTasks(): Promise<TaskWithContext[]> {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) {
    throw new Error(`Failed to fetch tasks: ${res.statusText}`);
  }

  const data = await res.json();
  return data.tasks;
}

// Graduation 통계 조회
export async function getGraduationStats(): Promise<GraduationStats> {
  const res = await fetch(`${API_BASE}/graduation/stats`);
  if (!res.ok) {
    throw new Error(`Failed to fetch graduation stats: ${res.statusText}`);
  }

  const data = await res.json();
  return data.stats;
}

// 자동 승격 실행
export async function runAutoPromotions(): Promise<{ promotedCount: number }> {
  const res = await fetch(`${API_BASE}/graduation/run-auto`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to run auto promotions: ${res.statusText}`);
  }

  return res.json();
}

// 엔트리 목록 조회
export type ListEntriesParams = {
  limit?: number;
  offset?: number;
  types?: string[];
  stages?: string[];
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: "ASC" | "DESC";
};

export type EntryWithMeta = {
  id: string;
  sessionId: string;
  entryType: string;
  title: string;
  content: Record<string, unknown>;
  textForSearch: string;
  memoryStage: string;
  promotedAt: string | null;
  promotionReason: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  confirmationCount: number;
  createdAt: string;
  sessionDate: string;
  sessionTitle: string;
  idrPath: string;
};

export async function listEntries(params: ListEntriesParams = {}): Promise<{ entries: EntryWithMeta[]; total: number }> {
  const url = new URL(`${API_BASE}/entries`, window.location.origin);

  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.offset) url.searchParams.set("offset", String(params.offset));
  if (params.types) params.types.forEach((t) => url.searchParams.append("types", t));
  if (params.stages) params.stages.forEach((s) => url.searchParams.append("stages", s));
  if (params.dateFrom) url.searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) url.searchParams.set("dateTo", params.dateTo);
  if (params.sortBy) url.searchParams.set("sortBy", params.sortBy);
  if (params.sortOrder) url.searchParams.set("sortOrder", params.sortOrder);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Failed to fetch entries: ${res.statusText}`);
  return res.json();
}

// 개별 엔트리 조회
export async function getEntry(entryId: string): Promise<EntryWithMeta> {
  const res = await fetch(`${API_BASE}/entries/${entryId}`);
  if (!res.ok) throw new Error(`Failed to fetch entry: ${res.statusText}`);
  const data = await res.json();
  return data.entry;
}

// 엔트리 수정
export async function updateEntry(entryId: string, updates: { title?: string; content?: Record<string, unknown> }): Promise<void> {
  const res = await fetch(`${API_BASE}/entries/${entryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update entry: ${res.statusText}`);
}

// 엔트리 삭제
export async function deleteEntry(entryId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/entries/${entryId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete entry: ${res.statusText}`);
}

// 엔트리 승격
export async function promoteEntry(entryId: string, targetStage: string): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryId, targetStage }),
  });
  if (!res.ok) throw new Error(`Failed to promote entry: ${res.statusText}`);
  return res.json();
}

// 엔트리 강등
export async function demoteEntry(entryId: string, reason: string = "user_demotion"): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/demote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryId, reason }),
  });
  if (!res.ok) throw new Error(`Failed to demote entry: ${res.statusText}`);
  return res.json();
}

// React Query용 쿼리 옵션
export const memoryQueries = {
  search: (params: SearchParams) => ({
    queryKey: ["memory", "search", params] as const,
    queryFn: () => searchMemory(params),
    enabled: params.query.length > 0,
  }),

  decisions: (dateFrom?: string) => ({
    queryKey: ["memory", "decisions", dateFrom] as const,
    queryFn: () => getDecisions(dateFrom),
  }),

  tasks: {
    queryKey: ["memory", "tasks"] as const,
    queryFn: getPendingTasks,
  },

  graduationStats: {
    queryKey: ["memory", "graduation", "stats"] as const,
    queryFn: getGraduationStats,
    staleTime: 30000, // 30초 캐싱
  },

  entries: (params: ListEntriesParams = {}) => ({
    queryKey: ["memory", "entries", params] as const,
    queryFn: () => listEntries(params),
    staleTime: 10000,
  }),

  entry: (entryId: string) => ({
    queryKey: ["memory", "entry", entryId] as const,
    queryFn: () => getEntry(entryId),
    enabled: !!entryId,
  }),
};
