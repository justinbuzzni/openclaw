# AxiomMind - 구현 계획 (Implementation Plan)

## 마일스톤 개요

| Phase | 마일스톤 | 상태 | 설명 |
|-------|----------|------|------|
| 1 | 플러그인 스캐폴딩 | ✅ 완료 | 디렉토리 구조, 매니페스트, 진입점 |
| 2 | Memory Pipeline (L0-L1) | ✅ 완료 | TypeScript 포팅, Idris 스키마 |
| 3 | OpenClaw 연동 | ✅ 완료 | 후크, 도구, API 엔드포인트 |
| 4 | Next.js 웹 UI | ✅ 완료 | 프로젝트 설정, 컴포넌트 개발 |
| 5 | 통합 테스트 | 🔄 진행중 | E2E 테스트, 버그 수정 |
| **6** | **Memory Graduation (L2-L4)** | ✅ 완료 | **승격/강등 로직, DB 스키마 확장** |
| **7** | **채팅 UI 고도화** | ✅ 완료 | **Thinking 모드, 파일 첨부** |
| **8** | **자동 메모리 시스템** | ✅ 완료 | **세션 종료 처리, 충돌 해결** |
| **9** | **코드 품질 개선** | ✅ 완료 | **하드코딩 제거, 에러 핸들링** |

---

## Phase 6: Memory Graduation Pipeline (L2-L4) ✅ 완료

### 6.1 DB 스키마 확장 ✅

**우선순위: 🔴 높음**

- [x] `memory-pipeline/indexer.ts` 수정
  - `entries` 테이블에 `memory_stage` 컬럼 추가
  - `promoted_at`, `promotion_reason` 컬럼 추가
  - `last_accessed_at`, `access_count` 컬럼 추가
  - `confirmation_count` 컬럼 추가

- [x] 새 테이블 생성
  - `promotion_history` - 승격 이력 기록
  - `conflicts` - 충돌 기록

- [x] 마이그레이션 스크립트
  - `migrateSchema()` 메서드 구현
  - 기존 데이터 `memory_stage = 'working'`으로 설정

### 6.2 GraduationManager 구현 ✅

**우선순위: 🔴 높음**

- [x] `memory-pipeline/graduation.ts` 생성
  - `promoteToCandidate()` - L1 → L2 승격
  - `promoteToVerified()` - L2 → L3 승격
  - `promoteToCertified()` - L3 → L4 승격
  - `promoteManually()` - 수동 승격
  - `demote()` - 역방향 강등
  - `checkAutoPromotions()` - 자동 승격 체크
  - `getStats()` - 통계 조회
  - `getRecentPromotions()` - 승격 이력 조회
  - `recordAccess()` - 접근 기록
  - `incrementConfirmation()` - 확인 카운트 증가
  - `recordConflict()`, `resolveConflict()` - 충돌 관리

### 6.3 자동 승격 로직 ✅

**우선순위: 🟡 중간**

- [x] L1 → L2 자동 승격
  - `orchestrator.ts`의 `processSession` 완료 후
  - `compile_status = 'success'`일 때 자동 호출

- [x] L2 → L3 자동 승격 (스케줄러)
  - `checkAutoPromotions()` 메서드 구현
  - 조건 체크:
    - 7일 경과 (`DAYS_FOR_VERIFIED = 7`)
    - 또는 `confirmation_count >= 3`

- [x] L3 → L4 자동 승격 (스케줄러)
  - `checkAutoPromotions()` 메서드 구현
  - 조건 체크:
    - 30일 경과 (`DAYS_FOR_CERTIFIED = 30`)
    - 충돌 없음 (`conflicts` 테이블 확인)

- [x] L4 → L3 자동 강등
  - 90일 미사용 시 (`DAYS_FOR_DEMOTION = 90`)

### 6.4 confirmation_count 업데이트 로직

**우선순위: 🟡 중간**

- [x] `incrementConfirmation()` 메서드 구현
- [ ] `memory-pipeline/similarity.ts` 생성 (Phase 8로 이동)
  - 새 엔트리 저장 시 기존 엔트리와 유사도 비교
  - 유사도 > 0.85일 경우 기존 엔트리의 `confirmation_count++`

### 6.5 API 엔드포인트 추가 ✅

**우선순위: 🟡 중간**

- [x] `api/routes.ts` 업데이트
  - `POST /ax/api/promote` - 수동 승격
  - `POST /ax/api/demote` - 수동 강등
  - `GET /ax/api/graduation/stats` - 통계 조회
  - `GET /ax/api/graduation/history` - 승격 이력 조회
  - `POST /ax/api/graduation/run-auto` - 자동 승격 실행
  - 기존 검색 API에 `stages` 필터 추가

### 6.6 Idris 스키마 확장 ✅

- [x] `idris/src/LongTermMemory/MemorySchema.idr` 생성
  - 기본 타입 정의 (Fact, Decision, Insight, Task, Reference)
  - 검증 함수 (validTask, validDecision, validEntry)

- [x] `idris/src/LongTermMemory/GraduationSchema.idr` 생성
  - MemoryStage 타입 (Raw | Working | Candidate | Verified | Certified)
  - CanPromote/CanDemote 타입 레벨 제약
  - PromotionReason, DemotionReason, ConflictType
  - validForStage 검증 함수

### 6.7 TypeScript 타입 동기화 ✅

- [x] `memory-pipeline/types.ts` 업데이트
  - MemoryStage, PromotionPath, DemotionPath 타입
  - PromotionReason, DemotionReason 타입
  - StagedEntry, Conflict, PromotionRecord 타입
  - canPromote, canDemote 검증 함수
  - isValidForStage 검증 함수

---

## Phase 7: 채팅 UI 고도화

### 7.1 Thinking Mode 지원

**우선순위: 🟡 중간**

- [ ] `features/chat/_stores/chat.ts` 수정
  - `thinkingModeAtom` 추가
  - `ThinkingMode` 타입 정의

- [ ] `features/chat/ThinkingModeToggle.tsx` 생성
  - 드롭다운 또는 토글 버튼
  - 모드: none, low, medium, high

- [ ] `features/chat/_hooks/useGateway.ts` 수정
  - `chat.send` params에 `thinking` 추가

- [ ] `features/chat/MessageList.tsx` 수정
  - thinking 블록 표시 (접기/펼치기)
  - 스타일: 연한 배경, 이탤릭체

### 7.2 파일 첨부 지원

**우선순위: 🟢 낮음**

- [ ] `features/chat/FileAttachment.tsx` 생성
  - 드래그앤드롭 영역
  - 파일 선택 버튼
  - 미리보기 (이미지)
  - 지원 포맷: 이미지, PDF, 텍스트

- [ ] `features/chat/_stores/chat.ts` 수정
  - `attachmentsAtom` 추가
  - `Attachment` 타입 정의

- [ ] `features/chat/MessageInput.tsx` 수정
  - 첨부 파일 표시
  - 제거 버튼

- [ ] `features/chat/_hooks/useGateway.ts` 수정
  - `chat.send` params에 `attachments` 추가
  - base64 인코딩

### 7.3 Memory Graduation 시각화

**우선순위: 🟡 중간**

- [ ] `features/memory/GraduationPipeline.tsx` 생성
  - 단계별 카운트 표시 (막대 그래프)
  - 최근 승격 이력 리스트
  - 수동 승격 버튼

- [ ] `features/memory/_api/queries.ts` 수정
  - `graduationStatsQuery` 추가
  - `promoteMemoryMutation` 추가

- [ ] `features/memory/MemoryPanel.tsx` 수정
  - `GraduationPipeline` 컴포넌트 통합
  - 탭 또는 섹션으로 분리

---

## Phase 8: 자동 메모리 시스템

### 8.1 세션 종료 시 자동 처리

**우선순위: 🔴 높음**

- [ ] `index.ts` 수정
  - `session_end` 훅 등록
  - `processSessionFromContext()` 구현

- [ ] `memory-pipeline/context-extractor.ts` 생성
  ```typescript
  async function extractSessionFromContext(
    context: AgentContext
  ): Promise<SessionLog> {
    // 컨텍스트에서 세션 로그 추출
    // 메시지 히스토리 → 텍스트 변환
  }
  ```

- [ ] `memory-pipeline/orchestrator.ts` 수정
  - `processSessionFromContext()` 메서드 추가
  - 컨텍스트 기반 자동 처리

### 8.2 메모리 충돌 감지 및 해결

**우선순위: 🟡 중간**

- [ ] `memory-pipeline/conflict-resolver.ts` 생성
  ```typescript
  class ConflictResolver {
    // 충돌 감지
    async detectConflicts(entry: Entry): Promise<Conflict[]>

    // 충돌 유형 분류
    classifyConflict(e1: Entry, e2: Entry): ConflictType

    // 자동 해결 (가능한 경우)
    async autoResolve(conflict: Conflict): Promise<Resolution | null>

    // 수동 해결 대기열에 추가
    async queueForManualResolution(conflict: Conflict): Promise<void>
  }
  ```

- [ ] 충돌 유형:
  - `contradiction`: 상반되는 정보
  - `outdated`: 이전 정보가 업데이트됨
  - `duplicate`: 동일한 정보 중복

- [ ] UI 알림 추가
  - 충돌 감지 시 배지 표시
  - 해결 인터페이스

---

## Phase 9: 코드 품질 개선

### 9.1 하드코딩 제거

**우선순위: 🟡 중간**

- [ ] 토큰 관리 개선
  - `api/auth.ts`의 하드코딩 토큰 제거
  - 환경변수 또는 설정 파일에서 읽기
  - `AXIOMMIND_AUTH_TOKEN` 환경변수 지원

- [ ] 설정 파일 도입
  - `~/.openclaw/axiommind/config.json`
  - 또는 플러그인 설정에 통합

### 9.2 에러 핸들링 개선

**우선순위: 🟢 낮음**

- [ ] 공통 에러 타입 정의
  ```typescript
  type AxiomMindError =
    | { code: 'EXTRACTION_FAILED'; message: string }
    | { code: 'COMPILE_FAILED'; errors: string[] }
    | { code: 'INDEX_FAILED'; message: string }
    | { code: 'CONFLICT_DETECTED'; conflicts: Conflict[] }
  ```

- [ ] 에러 로깅 개선
  - 구조화된 로그 포맷
  - 에러 추적 ID

### 9.3 TypeScript 타입 오류 수정

**우선순위: 🟢 낮음**

- [ ] 기존 타입 오류 목록 확인
  - TS7016: 선언 파일 없음
  - TS7006: 암시적 any

- [ ] strict 모드 점진적 적용

---

## 의존성 순서

```
Phase 6.1 (DB 스키마)
    │
    ▼
Phase 6.2-6.4 (Graduation 로직)
    │
    ├─────────────────────┐
    ▼                     ▼
Phase 6.5             Phase 7.3
(API 엔드포인트)      (UI 시각화)
    │                     │
    └──────────┬──────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
Phase 7.1-7.2         Phase 8.1
(Thinking, 첨부)      (세션 종료 처리)
    │                     │
    └──────────┬──────────┘
               ▼
         Phase 8.2
         (충돌 해결)
               │
               ▼
         Phase 9
         (코드 품질)
```

---

## 작업 우선순위 요약

### 🔴 높음 (P0) - 핵심 기능

1. **DB 스키마 확장** (Phase 6.1)
2. **GraduationManager 구현** (Phase 6.2)
3. **세션 종료 자동 처리** (Phase 8.1)

### 🟡 중간 (P1) - 중요 기능

4. **자동 승격 로직** (Phase 6.3)
5. **confirmation_count 로직** (Phase 6.4)
6. **API 엔드포인트** (Phase 6.5)
7. **Thinking Mode** (Phase 7.1)
8. **Graduation 시각화** (Phase 7.3)
9. **충돌 감지/해결** (Phase 8.2)
10. **하드코딩 제거** (Phase 9.1)

### 🟢 낮음 (P2) - 개선 사항

11. **파일 첨부** (Phase 7.2)
12. **에러 핸들링** (Phase 9.2)
13. **TypeScript 타입 수정** (Phase 9.3)

---

## 예상 작업량

| Phase | 예상 작업량 | 복잡도 |
|-------|------------|--------|
| 6.1 DB 스키마 | 2-3시간 | 낮음 |
| 6.2 GraduationManager | 4-6시간 | 중간 |
| 6.3 자동 승격 | 3-4시간 | 중간 |
| 6.4 confirmation | 2-3시간 | 낮음 |
| 6.5 API | 2-3시간 | 낮음 |
| 7.1 Thinking | 3-4시간 | 중간 |
| 7.2 파일 첨부 | 4-6시간 | 중간 |
| 7.3 Graduation UI | 3-4시간 | 중간 |
| 8.1 세션 종료 | 3-4시간 | 중간 |
| 8.2 충돌 해결 | 6-8시간 | 높음 |
| 9.1 하드코딩 | 1-2시간 | 낮음 |
| 9.2 에러 핸들링 | 2-3시간 | 낮음 |
| 9.3 타입 수정 | 2-3시간 | 낮음 |

**총 예상**: 37-53시간

---

## 체크리스트

### Phase 6: Memory Graduation ✅

- [x] DB 스키마 마이그레이션 (indexer.ts)
- [x] GraduationManager 클래스 (graduation.ts)
- [x] promoteToCandidate 구현
- [x] promoteToVerified 구현
- [x] promoteToCertified 구현
- [x] demote 구현
- [x] 자동 승격 로직 (checkAutoPromotions)
- [x] confirmation_count 로직
- [x] POST /ax/api/promote
- [x] POST /ax/api/demote
- [x] GET /ax/api/graduation/stats
- [x] GET /ax/api/graduation/history
- [x] POST /ax/api/graduation/run-auto
- [x] 검색 API stage 필터
- [x] Idris 스키마 (MemorySchema.idr, GraduationSchema.idr)
- [x] TypeScript 타입 동기화

### Phase 7: 채팅 UI ✅

- [x] ThinkingModeToggle 컴포넌트
- [x] thinking 블록 렌더링
- [x] FileAttachment 컴포넌트
- [x] 파일 미리보기
- [x] GraduationPipeline 컴포넌트
- [x] 수동 승격 UI

### Phase 8: 자동 메모리 ✅

- [x] session_end 훅 등록
- [x] processSessionFromContext 구현
- [x] ConflictResolver 클래스
- [x] SimilarityChecker 클래스
- [x] 충돌 감지 로직
- [x] 충돌 API 엔드포인트

### Phase 9: 코드 품질 ✅

- [x] 환경변수 토큰 지원
- [x] 설정 파일 도입 (config.ts)
- [x] 에러 타입 정의 (errors.ts)
- [x] 에러 로깅 개선
- [ ] TypeScript strict 적용 (점진적 적용 필요)
