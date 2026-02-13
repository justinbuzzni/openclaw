-- LongTermMemory/MemorySchema.idr
--
-- AxiomMind Memory Pipeline 기반 타입 정의
-- TypeScript types.ts와 동기화 유지

module LongTermMemory.MemorySchema

%default total

-- === 기본 타입 ===

public export
DateStr : Type
DateStr = String  -- "2026-01-31"

public export
SessionId : Type
SessionId = Nat  -- 1, 2, 3...

public export
data Priority = Low | Medium | High | Critical

public export
Show Priority where
  show Low = "low"
  show Medium = "medium"
  show High = "high"
  show Critical = "critical"

public export
data TaskStatus = Pending | InProgress | Done | Blocked | Cancelled

public export
Show TaskStatus where
  show Pending = "pending"
  show InProgress = "in_progress"
  show Done = "done"
  show Blocked = "blocked"
  show Cancelled = "cancelled"

-- === 엔트리 타입들 ===

public export
record Fact where
  constructor MkFact
  title : String
  evidence : Maybe String

public export
record Decision where
  constructor MkDecision
  title : String
  rationale : Maybe String
  basedOn : List String  -- Fact 참조

public export
record Insight where
  constructor MkInsight
  observation : String
  implication : String

public export
record Task where
  constructor MkTask
  title : String
  status : TaskStatus
  priority : Priority
  blockedBy : List String  -- 다른 Task 참조

public export
record Reference where
  constructor MkReference
  path : String
  description : Maybe String

-- === 통합 엔트리 ===

public export
data AnyEntry
  = AFact Fact
  | ADecision Decision
  | AInsight Insight
  | ATask Task
  | AReference Reference

-- === 세션 레코드 ===

public export
record Session where
  constructor MkSession
  date : DateStr
  sessionId : SessionId
  timeRange : String  -- "22:30~22:50"
  title : String
  entries : List AnyEntry

-- === 일일 메모리 ===

public export
record MemoryDay where
  constructor MkMemoryDay
  date : DateStr
  summary : Maybe String
  sessions : List Session

-- === 검증 함수 (불변식) ===

||| Task가 Done인데 blockedBy가 있으면 안됨
public export
validTask : Task -> Bool
validTask t = case t.status of
  Done => isNil t.blockedBy
  _ => True

||| Decision은 반드시 rationale이 있어야 함
public export
validDecision : Decision -> Bool
validDecision d = isJust d.rationale

||| 엔트리 유효성 검사
public export
validEntry : AnyEntry -> Bool
validEntry (AFact _) = True
validEntry (ADecision d) = validDecision d
validEntry (AInsight _) = True
validEntry (ATask t) = validTask t
validEntry (AReference _) = True

||| 세션의 모든 엔트리가 유효한지 검사
public export
validSession : Session -> Bool
validSession s = all validEntry s.entries
