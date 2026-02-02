import { atom } from "jotai";

/**
 * 세션 요약 타입
 */
export type SessionSummary = {
  id: string;
  date: string;
  sessionId: number;
  title: string;
  timeRange: string | null;
  compileStatus: string;
  createdAt: string;
  entryCount: number;
};

/**
 * 세션 목록
 */
export const sessionsListAtom = atom<SessionSummary[]>([]);

/**
 * 세션 로딩 상태
 */
export const sessionsLoadingAtom = atom<boolean>(false);

/**
 * 세션 패널 열림 상태
 */
export const sessionsPanelOpenAtom = atom<boolean>(false);

/**
 * 세션 목록 로드 액션
 */
export const loadSessionsAtom = atom(null, (_get, set, sessions: SessionSummary[]) => {
  set(sessionsListAtom, sessions);
  set(sessionsLoadingAtom, false);
});

/**
 * 세션 로딩 시작 액션
 */
export const startLoadingSessionsAtom = atom(null, (_get, set) => {
  set(sessionsLoadingAtom, true);
});

/**
 * 세션 패널 토글 액션
 */
export const toggleSessionsPanelAtom = atom(null, (get, set) => {
  set(sessionsPanelOpenAtom, !get(sessionsPanelOpenAtom));
});
