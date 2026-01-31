/**
 * AxiomMind Memory Types
 *
 * Memory Graduation Pipeline의 타입 정의
 * Idris MemorySchema.idr과 동기화 유지
 */

// === 기본 타입 ===

export type DateStr = string; // "2026-01-31"
export type SessionId = number; // 1, 2, 3...

export type Priority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "cancelled";
export type MemoryStage = "raw" | "candidate" | "verified" | "certified";
export type CompileStatus = "pending" | "success" | "failed";

// === 엔트리 타입들 ===

export type Fact = {
  type: "fact";
  title: string;
  evidence?: string;
};

export type Decision = {
  type: "decision";
  title: string;
  rationale?: string;
  basedOn: string[]; // Fact 참조
};

export type Insight = {
  type: "insight";
  observation: string;
  implication: string;
};

export type Task = {
  type: "task";
  title: string;
  status: TaskStatus;
  priority: Priority;
  blockedBy: string[]; // 다른 Task 참조
};

export type Reference = {
  type: "reference";
  path: string;
  description?: string;
};

// === 통합 엔트리 ===

export type AnyEntry = Fact | Decision | Insight | Task | Reference;

export type EntryType = AnyEntry["type"];

// === 세션 레코드 ===

export type Session = {
  date: DateStr;
  sessionId: SessionId;
  timeRange: string; // "22:30~22:50"
  title: string;
  entries: AnyEntry[];
};

// === 일일 메모리 ===

export type MemoryDay = {
  date: DateStr;
  summary?: string;
  sessions: Session[];
};

// === 파이프라인 결과 ===

export type ProcessResult = {
  sessionId: string; // "2026-01-31_01"
  idrPath: string;
  compileStatus: CompileStatus;
  entriesCount: number;
  warnings?: string[];
  holes?: string[];
};

export type CompileResult = {
  success: boolean;
  errors: string[];
  warnings: string[];
  holes: string[];
};

// === 검색 결과 ===

export type SearchResult = {
  id: string;
  sessionId: string;
  date: DateStr;
  entryType: EntryType;
  title: string;
  content: AnyEntry;
  score: number;
  idrPath?: string;
};

export type SearchOptions = {
  query: string;
  entryTypes?: EntryType[];
  limit?: number;
  dateFrom?: DateStr;
  dateTo?: DateStr;
};

// === 검증 함수 ===

/**
 * Task가 Done인데 blockedBy가 있으면 안됨
 */
export function isValidTask(task: Task): boolean {
  if (task.status === "done") {
    return task.blockedBy.length === 0;
  }
  return true;
}

/**
 * Decision은 반드시 rationale이 있어야 함
 */
export function isValidDecision(decision: Decision): boolean {
  return decision.rationale !== undefined && decision.rationale.length > 0;
}

/**
 * 모든 엔트리의 유효성 검사
 */
export function validateEntry(entry: AnyEntry): { valid: boolean; error?: string } {
  switch (entry.type) {
    case "task":
      if (!isValidTask(entry)) {
        return { valid: false, error: "Task marked as done but has blockedBy dependencies" };
      }
      break;
    case "decision":
      if (!isValidDecision(entry)) {
        return { valid: false, error: "Decision must have a rationale" };
      }
      break;
  }
  return { valid: true };
}

// === 타입 가드 ===

export function isFact(entry: AnyEntry): entry is Fact {
  return entry.type === "fact";
}

export function isDecision(entry: AnyEntry): entry is Decision {
  return entry.type === "decision";
}

export function isInsight(entry: AnyEntry): entry is Insight {
  return entry.type === "insight";
}

export function isTask(entry: AnyEntry): entry is Task {
  return entry.type === "task";
}

export function isReference(entry: AnyEntry): entry is Reference {
  return entry.type === "reference";
}
