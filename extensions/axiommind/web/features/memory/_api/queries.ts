import type { SearchResult, EntryType } from "../_stores/memory";

const API_BASE = "/axiommind/api";

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
};
