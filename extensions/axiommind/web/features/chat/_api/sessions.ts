import type { SessionSummary } from "../_stores/session";

export type ListSessionsOptions = {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
};

export type ListSessionsResponse = {
  sessions: SessionSummary[];
  total: number;
};

/**
 * 세션 목록 조회
 */
export async function fetchSessions(
  options: ListSessionsOptions = {}
): Promise<ListSessionsResponse> {
  const params = new URLSearchParams();

  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  if (options.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options.dateTo) params.set("dateTo", options.dateTo);

  const queryString = params.toString();
  const url = `/ax/api/sessions${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch sessions: ${response.statusText}`);
  }

  return response.json();
}

export type SessionMessage = {
  id: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp: number;
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
