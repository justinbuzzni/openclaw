import { atom } from "jotai";

export type EntryType = "fact" | "decision" | "insight" | "task" | "reference";

export type MemoryStage = "working" | "candidate" | "verified" | "certified";

export type SearchResult = {
  id: string;
  sessionId: string;
  date: string;
  entryType: EntryType;
  title: string;
  content: Record<string, unknown>;
  score: number;
  memoryStage?: MemoryStage;
};

// 검색 쿼리
export const searchQueryAtom = atom<string>("");

// 검색 결과
export const searchResultsAtom = atom<SearchResult[]>([]);

// 로딩 상태
export const isSearchingAtom = atom<boolean>(false);

// 선택된 메모리 단계 (L0-L4)
export const selectedStageAtom = atom<number | null>(null);

// 에러 상태
export const searchErrorAtom = atom<string | null>(null);

// 현재 편집 중인 엔트리 ID
export const selectedEntryIdAtom = atom<string | null>(null);
