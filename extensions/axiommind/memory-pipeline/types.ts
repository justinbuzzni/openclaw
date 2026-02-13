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
export type MemoryStage = "raw" | "working" | "candidate" | "verified" | "certified";
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
  memoryStage?: MemoryStage;
};

export type SearchOptions = {
  query: string;
  entryTypes?: EntryType[];
  memoryStages?: MemoryStage[];
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

// === Graduation Pipeline 타입 ===

/**
 * 승격 가능한 경로
 * Idris GraduationSchema.idr의 CanPromote와 동기화
 */
export type PromotionPath =
  | { from: "working"; to: "candidate" }
  | { from: "candidate"; to: "verified" }
  | { from: "verified"; to: "certified" };

/**
 * 강등 가능한 경로
 */
export type DemotionPath =
  | { from: "certified"; to: "verified" }
  | { from: "verified"; to: "candidate" }
  | { from: "candidate"; to: "working" };

/**
 * 승격 이유
 */
export type PromotionReason =
  | "compile_success" // L1 -> L2: Idris 컴파일 성공
  | "time_elapsed" // L2 -> L3: 7일 경과 / L3 -> L4: 30일 경과
  | "confirmation_reached" // L2 -> L3: confirmation_count >= 3
  | "user_action"; // 사용자 수동 승격

/**
 * 강등 이유
 */
export type DemotionReason =
  | "unused" // 장기 미사용
  | "conflict_detected" // 충돌 감지
  | "compile_failed" // 재컴파일 실패
  | "user_demotion"; // 사용자 수동 강등

/**
 * Stage가 태깅된 엔트리
 */
export type StagedEntry = {
  id: string;
  sessionId: string;
  entry: AnyEntry;
  stage: MemoryStage;
  promotedAt?: string;
  promotionReason?: PromotionReason;
  lastAccessedAt?: string;
  accessCount: number;
  confirmationCount: number;
  createdAt: string;
};

/**
 * 충돌 타입
 */
export type ConflictType =
  | "contradiction" // 상반되는 정보
  | "outdated" // 이전 정보가 업데이트됨
  | "duplicate"; // 동일한 정보 중복

/**
 * 충돌 레코드
 */
export type Conflict = {
  id: string;
  entryId1: string;
  entryId2: string;
  conflictType: ConflictType;
  detectedAt: string;
  resolvedAt?: string;
  resolution?: string;
};

/**
 * 승격 이력
 */
export type PromotionRecord = {
  id: string;
  entryId: string;
  fromStage: MemoryStage;
  toStage: MemoryStage;
  reason: PromotionReason;
  promotedAt: string;
};

/**
 * 승격 결과
 */
export type PromotionResult = {
  success: boolean;
  entryId: string;
  fromStage: MemoryStage;
  toStage: MemoryStage;
  reason: PromotionReason;
  message?: string;
};

/**
 * Graduation 통계
 */
export type GraduationStats = {
  raw: number;
  working: number;
  candidate: number;
  verified: number;
  certified: number;
  total: number;
};

// === Stage별 유효성 검증 ===

/**
 * Verified 이상 레벨에서 Fact는 evidence 필수
 */
export function isValidForVerified(entry: AnyEntry): boolean {
  switch (entry.type) {
    case "fact":
      return entry.evidence !== undefined && entry.evidence.length > 0;
    case "decision":
      return entry.rationale !== undefined && entry.rationale.length > 0;
    default:
      return validateEntry(entry).valid;
  }
}

/**
 * Stage별 엔트리 유효성 검사
 */
export function isValidForStage(stage: MemoryStage, entry: AnyEntry): { valid: boolean; error?: string } {
  // 기본 유효성 검사
  const baseValidation = validateEntry(entry);
  if (!baseValidation.valid) return baseValidation;

  // Verified 이상에서는 추가 검증
  if (stage === "verified" || stage === "certified") {
    if (!isValidForVerified(entry)) {
      if (entry.type === "fact") {
        return { valid: false, error: "Verified/Certified Fact must have evidence" };
      }
      if (entry.type === "decision") {
        return { valid: false, error: "Verified/Certified Decision must have rationale" };
      }
    }
  }

  return { valid: true };
}

/**
 * 승격 가능 여부 확인
 */
export function canPromote(from: MemoryStage, to: MemoryStage): boolean {
  const validPaths: Array<[MemoryStage, MemoryStage]> = [
    ["working", "candidate"],
    ["candidate", "verified"],
    ["verified", "certified"],
  ];
  return validPaths.some(([f, t]) => f === from && t === to);
}

/**
 * 강등 가능 여부 확인
 */
export function canDemote(from: MemoryStage, to: MemoryStage): boolean {
  const validPaths: Array<[MemoryStage, MemoryStage]> = [
    ["certified", "verified"],
    ["verified", "candidate"],
    ["candidate", "working"],
  ];
  return validPaths.some(([f, t]) => f === from && t === to);
}

/**
 * Stage 순서 비교 (숫자로 변환)
 */
export function stageToNumber(stage: MemoryStage): number {
  const order: Record<MemoryStage, number> = {
    raw: 0,
    working: 1,
    candidate: 2,
    verified: 3,
    certified: 4,
  };
  return order[stage];
}

/**
 * Stage 비교
 */
export function compareStages(a: MemoryStage, b: MemoryStage): number {
  return stageToNumber(a) - stageToNumber(b);
}
