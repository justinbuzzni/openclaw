import type { SessionSummary } from "../_stores/session";

export type ListSessionsOptions = {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
  excludeCron?: boolean;
  agentId?: string;
};

export type ListSessionsResponse = {
  sessions: SessionSummary[];
  total: number;
};

/**
 * 세션 목록 조회
 */
export async function fetchSessions(
  options: ListSessionsOptions = {},
): Promise<ListSessionsResponse> {
  const params = new URLSearchParams();

  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  if (options.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options.dateTo) params.set("dateTo", options.dateTo);
  if (options.excludeCron) params.set("excludeCron", "true");
  if (options.agentId) params.set("agentId", options.agentId);

  const queryString = params.toString();
  const url = `/ax/api/sessions${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch sessions: ${response.statusText}`);
  }

  return response.json();
}

export type ProgressStep = {
  toolName: string;
  summary?: string;
  isError?: boolean;
  timestamp: number;
};

export type SessionMessage = {
  id: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp: number;
  progressSteps?: ProgressStep[];
};

export type SessionDetailResponse = {
  sessionId: string;
  messages: SessionMessage[];
  count: number;
};

/**
 * 세션 상세 조회 (메시지 히스토리 포함)
 */
export async function fetchSession(sessionId: string): Promise<SessionDetailResponse> {
  const response = await fetch(`/ax/api/sessions/${sessionId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 세션 삭제
 */
export async function deleteSession(sessionId: string): Promise<{ success: boolean }> {
  const response = await fetch(`/ax/api/sessions/${sessionId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.statusText}`);
  }

  return response.json();
}

// === Import API ===

export type ImportStatus = {
  sessionFileId: string;
  imported: boolean;
  title?: string;
  messageCount?: number;
};

export type ImportResult = {
  sessionFileId: string;
  success: boolean;
  skipped: boolean;
  entryCount: number;
  error?: string;
};

export type ImportAllResult = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  results: ImportResult[];
};

/**
 * Import 상태 조회
 */
export async function fetchImportStatuses(): Promise<{ statuses: ImportStatus[] }> {
  const response = await fetch("/ax/api/sessions/import-status");

  if (!response.ok) {
    throw new Error(`Failed to fetch import statuses: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 전체 미처리 세션 import
 */
export async function importAllSessions(): Promise<ImportAllResult> {
  const response = await fetch("/ax/api/sessions/import-all", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to import sessions: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 단일 세션 import
 */
export async function importSession(sessionFileId: string): Promise<ImportResult> {
  const response = await fetch(`/ax/api/sessions/${sessionFileId}/import`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to import session: ${response.statusText}`);
  }

  return response.json();
}
