-- LongTermMemory/GraduationSchema.idr
--
-- Memory Graduation Pipeline 타입 정의
-- L0 (Raw) -> L1 (Working) -> L2 (Candidate) -> L3 (Verified) -> L4 (Certified)

module LongTermMemory.GraduationSchema

import LongTermMemory.MemorySchema

%default total

-- === Memory Stage 타입 ===

||| 메모리 성숙도 단계
||| Raw: 원본 이벤트 로그
||| Working: 작업 메모리 (L1)
||| Candidate: 후보 스펙 (L2) - Idris 타입 체크 통과
||| Verified: 검증된 스펙 (L3) - 반복 확인 또는 시간 경과
||| Certified: 인증된 스펙 (L4) - 장기 안정
public export
data MemoryStage = Raw | Working | Candidate | Verified | Certified

public export
Show MemoryStage where
  show Raw = "raw"
  show Working = "working"
  show Candidate = "candidate"
  show Verified = "verified"
  show Certified = "certified"

public export
Eq MemoryStage where
  Raw == Raw = True
  Working == Working = True
  Candidate == Candidate = True
  Verified == Verified = True
  Certified == Certified = True
  _ == _ = False

-- === Stage 순서 (Ord) ===

public export
stageToNat : MemoryStage -> Nat
stageToNat Raw = 0
stageToNat Working = 1
stageToNat Candidate = 2
stageToNat Verified = 3
stageToNat Certified = 4

public export
Ord MemoryStage where
  compare s1 s2 = compare (stageToNat s1) (stageToNat s2)

-- === 승격 가능 여부 (타입 레벨 제약) ===

||| 승격 가능한 경로를 타입으로 정의
||| 이를 통해 잘못된 승격 (예: Raw -> Certified)을 컴파일 타임에 방지
public export
data CanPromote : MemoryStage -> MemoryStage -> Type where
  ||| Working -> Candidate: Idris 타입 체크 통과 시
  WorkingToCandidate : CanPromote Working Candidate
  ||| Candidate -> Verified: 확인 조건 충족 시
  CandidateToVerified : CanPromote Candidate Verified
  ||| Verified -> Certified: 장기 안정 조건 충족 시
  VerifiedToCertified : CanPromote Verified Certified

-- === 강등 가능 여부 ===

public export
data CanDemote : MemoryStage -> MemoryStage -> Type where
  ||| Certified -> Verified: 90일 미사용 시
  CertifiedToVerified : CanDemote Certified Verified
  ||| Verified -> Candidate: 충돌 감지 시
  VerifiedToCandidate : CanDemote Verified Candidate
  ||| Candidate -> Working: 컴파일 실패 시
  CandidateToWorking : CanDemote Candidate Working

-- === 승격 이유 ===

public export
data PromotionReason
  = CompileSuccess      -- L1 -> L2: Idris 컴파일 성공
  | TimeElapsed         -- L2 -> L3: 7일 경과 / L3 -> L4: 30일 경과
  | ConfirmationReached -- L2 -> L3: confirmation_count >= 3
  | UserAction          -- 사용자 수동 승격

public export
Show PromotionReason where
  show CompileSuccess = "compile_success"
  show TimeElapsed = "time_elapsed"
  show ConfirmationReached = "confirmation_reached"
  show UserAction = "user_action"

-- === 강등 이유 ===

public export
data DemotionReason
  = Unused              -- 장기 미사용
  | ConflictDetected    -- 충돌 감지
  | CompileFailed       -- 재컴파일 실패
  | UserDemotion        -- 사용자 수동 강등

public export
Show DemotionReason where
  show Unused = "unused"
  show ConflictDetected = "conflict_detected"
  show CompileFailed = "compile_failed"
  show UserDemotion = "user_demotion"

-- === Staged Entry (Stage별 엔트리) ===

||| Stage가 태깅된 엔트리
public export
record StagedEntry where
  constructor MkStagedEntry
  entry : AnyEntry
  stage : MemoryStage
  promotedAt : Maybe String  -- ISO timestamp
  promotionReason : Maybe PromotionReason

-- === Stage별 유효성 검증 ===

||| Verified 이상에서는 evidence/rationale 필수
public export
validForStage : MemoryStage -> AnyEntry -> Bool
validForStage stage entry = case stage of
  Raw => True
  Working => validEntry entry
  Candidate => validEntry entry
  Verified => validForVerified entry
  Certified => validForVerified entry
  where
    validForVerified : AnyEntry -> Bool
    validForVerified (AFact f) = isJust f.evidence && validEntry (AFact f)
    validForVerified (ADecision d) = isJust d.rationale && validEntry (ADecision d)
    validForVerified e = validEntry e

||| StagedEntry 전체 유효성 검증
public export
validStagedEntry : StagedEntry -> Bool
validStagedEntry se = validForStage se.stage se.entry

-- === 충돌 타입 ===

public export
data ConflictType
  = Contradiction  -- 상반되는 정보
  | Outdated       -- 이전 정보가 업데이트됨
  | Duplicate      -- 동일한 정보 중복

public export
Show ConflictType where
  show Contradiction = "contradiction"
  show Outdated = "outdated"
  show Duplicate = "duplicate"

-- === 충돌 레코드 ===

public export
record Conflict where
  constructor MkConflict
  conflictId : String
  entryId1 : String
  entryId2 : String
  conflictType : ConflictType
  detectedAt : String  -- ISO timestamp
  resolvedAt : Maybe String
  resolution : Maybe String

-- === 승격 조건 타입 레벨 검증 ===

||| 승격 전 조건을 만족하는지 증명
||| 실제 런타임에서는 TypeScript에서 처리하지만,
||| 타입 레벨에서 의도를 명확히 함
public export
data CanPromoteEntry : StagedEntry -> MemoryStage -> Type where
  ||| Working -> Candidate: Idris 컴파일 성공
  PromoteWC : (se : StagedEntry)
            -> (se.stage = Working)
            -> (validEntry se.entry = True)
            -> CanPromoteEntry se Candidate

  ||| Candidate -> Verified: 확인 조건 충족
  PromoteCV : (se : StagedEntry)
            -> (se.stage = Candidate)
            -> (validForStage Verified se.entry = True)
            -> CanPromoteEntry se Verified

  ||| Verified -> Certified: 장기 안정
  PromoteVC : (se : StagedEntry)
            -> (se.stage = Verified)
            -> (validForStage Certified se.entry = True)
            -> CanPromoteEntry se Certified

-- === 승격 이력 ===

public export
record PromotionRecord where
  constructor MkPromotionRecord
  entryId : String
  fromStage : MemoryStage
  toStage : MemoryStage
  reason : PromotionReason
  promotedAt : String  -- ISO timestamp
