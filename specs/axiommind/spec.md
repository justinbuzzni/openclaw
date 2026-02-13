# AxiomMind - 기능 명세서 (Specification)

## 1. 개요

AxiomMind는 OpenClaw와 통합되는 커스텀 채팅 웹 UI + Memory Graduation Pipeline 시스템입니다.

### 1.1 목표

- 나만의 커스텀 채팅 화면 웹 UI 제공
- 기억(Memory)의 저장/불러오기 로직 커스터마이징
- OpenClaw 게이트웨이와 완전한 통합

### 1.2 범위

- **In Scope**: 채팅 UI, 메모리 파이프라인, OpenClaw 플러그인
- **Out of Scope**: OpenClaw 코어 수정, 기존 메모리 시스템 대체

---

## 2. 시스템 구성요소

### 2.1 웹 UI (Next.js 15)

| 컴포넌트 | 설명 | 상태 |
|----------|------|------|
| ChatWindow | 메인 채팅 인터페이스 | ✅ 완료 |
| MessageList | 메시지 목록 표시 (마크다운, 도구 진행) | ✅ 완료 |
| MessageInput | 메시지 입력 (스트리밍 중 비활성화) | ✅ 완료 |
| MemoryPanel | 기억 검색/표시 패널 | ✅ 완료 |
| MemoryOperationIndicator | 메모리 작업 시각화 | ✅ 완료 |
| GraduationPipeline | L0-L4 단계 시각화 | ❌ 미구현 |
| ThinkingModeToggle | 생각 모드 토글 | ❌ 미구현 |
| FileAttachment | 파일 첨부 UI | ❌ 미구현 |

#### 기술 스택

- **Framework**: Next.js 15 (App Router)
- **UI Library**: shadcn/ui
- **Styling**: Tailwind CSS
- **State**: Jotai
- **Data Fetching**: TanStack Query (React Query)
- **Type Safety**: TypeScript (Strict Mode)

### 2.2 Memory Pipeline

| 컴포넌트 | 설명 | 상태 |
|----------|------|------|
| SessionExtractor | 채팅 세션 → 구조화된 JSON 추출 (LLM) | ✅ 완료 |
| IdrisGenerator | JSON → Idris 코드 생성 | ✅ 완료 |
| IdrisValidator | Idris2 컴파일러로 타입 검증 | ✅ 완료 |
| MemoryIndexer | DuckDB + LanceDB 인덱싱 | ✅ 완료 |
| MemorySearch | 시맨틱 검색 + 키워드 검색 | ✅ 완료 |
| GraduationManager | L0→L4 승격/강등 관리 | ❌ 미구현 |
| ConflictResolver | 메모리 충돌 감지 및 해결 | ❌ 미구현 |

### 2.3 OpenClaw 플러그인

| 기능 | 설명 | 상태 |
|------|------|------|
| 후크 - before_agent_start | 메모리 프롬프트 자동 주입 | ✅ 완료 |
| 후크 - session_end | 세션 종료 시 자동 메모리 처리 | ❌ 미구현 |
| 도구 - axiom_search | 메모리 검색 | ✅ 완료 |
| 도구 - axiom_recall | 특정 기억 불러오기 | ✅ 완료 |
| 도구 - axiom_save | 수동 기억 저장 | ✅ 완료 |
| HTTP | /ax/chat, /ax/api/* | ✅ 완료 |

---

## 3. 데이터 모델

### 3.1 Memory Entry Types

```typescript
type Priority = 'low' | 'medium' | 'high' | 'critical';
type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'cancelled';
type MemoryStage = 'raw' | 'working' | 'candidate' | 'verified' | 'certified';

type Fact = {
  type: 'fact';
  title: string;
  evidence?: string;
};

type Decision = {
  type: 'decision';
  title: string;
  rationale?: string;
  basedOn: string[];
};

type Insight = {
  type: 'insight';
  observation: string;
  implication: string;
};

type Task = {
  type: 'task';
  title: string;
  status: TaskStatus;
  priority: Priority;
  blockedBy: string[];
};

type Reference = {
  type: 'reference';
  path: string;
  description?: string;
};

type AnyEntry = Fact | Decision | Insight | Task | Reference;
```

### 3.2 Session 구조

```typescript
type Session = {
  date: string;           // "2026-01-31"
  sessionId: number;      // 1, 2, 3...
  timeRange: string;      // "22:30~22:50"
  title: string;
  entries: AnyEntry[];
};
```

### 3.3 Memory Day 구조

```typescript
type MemoryDay = {
  date: string;
  summary?: string;
  sessions: Session[];
};
```

---

## 4. Memory Graduation Pipeline

### 4.1 단계 정의

| Level | 이름 | 특성 | 저장소 | 구현 상태 |
|-------|------|------|--------|----------|
| L0 | RAW EVENT LOG | 불변, append-only | LanceDB | ✅ 완료 |
| L1 | WORKING MEMORY | 가변, 자유로움 | DuckDB (stage='working') | ✅ 완료 |
| L2 | CANDIDATE SPEC | 구조화, Idris 타입 체크 통과 | DuckDB (stage='candidate') | ❌ 미구현 |
| L3 | VERIFIED SPEC | 반복 확인 또는 시간 경과 | DuckDB (stage='verified') | ❌ 미구현 |
| L4 | CERTIFIED SPEC | 장기 안정, 준불변 | DuckDB (stage='certified') | ❌ 미구현 |

### 4.2 승격 조건 (상세)

```
L0 → L1 (Working):
  - 자동 (세션 종료 시 LLM Extractor로 추출)
  - 조건: 세션 로그 존재

L1 → L2 (Candidate):
  - Idris2 타입 체크 통과
  - 조건: compile_status = 'success'
  - 트리거: 자동 (파이프라인 완료 시)

L2 → L3 (Verified):
  - 조건 중 하나 충족:
    a) 같은 정보가 3개 이상의 다른 세션에서 언급
    b) 사용자가 UI에서 "확인" 버튼 클릭
    c) 7일 경과 후 자동 승격
  - 트리거: 스케줄러 (일일 1회) + 사용자 액션

L3 → L4 (Certified):
  - 조건 모두 충족:
    a) 30일 이상 변경 없이 유지
    b) 다른 Verified 메모리와 충돌 없음
    c) 사용자가 "중요" 표시 (선택)
  - 트리거: 스케줄러 (주간 1회)

역방향 강등:
  - L4 → L3: 90일 이상 미사용 시
  - L3 → L2: 충돌 감지 시
  - L2 → L1: 컴파일 실패 시
```

### 4.3 불변식 (Invariants)

```idris
-- Task가 Done인데 blockedBy가 있으면 안됨
validTask : Task -> Bool
validTask t = case t.status of
  Done => isNil t.blockedBy
  _ => True

-- Decision은 반드시 근거가 있어야 함
validDecision : Decision -> Bool
validDecision d = not (isNothing d.rationale)

-- Verified 이상 레벨은 evidence 필수
validVerifiedFact : Fact -> MemoryStage -> Bool
validVerifiedFact f stage = case stage of
  Verified => not (isNothing f.evidence)
  Certified => not (isNothing f.evidence)
  _ => True
```

---

## 5. API 명세

### 5.1 REST API

#### GET /ax/api/search

시맨틱 검색

```
Query Parameters:
  q: string (required) - 검색 쿼리
  types?: string[] - 필터링할 entry 타입
  stages?: string[] - 필터링할 memory stage (new)
  limit?: number (default: 10)
  dateFrom?: string
  dateTo?: string

Response:
{
  results: [{
    id: string,
    sessionId: string,
    date: string,
    entryType: string,
    title: string,
    content: object,
    stage: string,  // new
    score: number
  }]
}
```

#### GET /ax/api/decisions

Decision과 연결된 Fact 조회

```
Query Parameters:
  dateFrom?: string
  stages?: string[] - 필터링할 memory stage (new)

Response:
{
  decisions: [{
    decision: Decision,
    date: string,
    stage: string,  // new
    evidenceFacts: Fact[],
    idrPath: string
  }]
}
```

#### GET /ax/api/tasks

미완료 Task 조회

```
Response:
{
  tasks: [{
    task: Task,
    date: string,
    session: string,
    stage: string  // new
  }]
}
```

#### POST /ax/api/process

수동 세션 처리

```
Body:
{
  sessionLog: string,
  date?: string,
  sessionId?: number
}

Response:
{
  sessionId: string,
  idrPath: string,
  compileStatus: 'success' | 'failed',
  entriesCount: number,
  stage: string  // new: 'working' | 'candidate'
}
```

#### POST /ax/api/promote (NEW)

메모리 수동 승격

```
Body:
{
  entryId: string,
  targetStage: 'verified' | 'certified'
}

Response:
{
  success: boolean,
  entryId: string,
  newStage: string,
  message?: string
}
```

#### GET /ax/api/graduation/stats (NEW)

단계별 메모리 통계

```
Response:
{
  stats: {
    raw: number,
    working: number,
    candidate: number,
    verified: number,
    certified: number
  },
  recentPromotions: [{
    entryId: string,
    fromStage: string,
    toStage: string,
    promotedAt: string
  }]
}
```

### 5.2 WebSocket (Gateway 연동)

OpenClaw Gateway WebSocket 프로토콜 사용:
- 연결: `ws://localhost:18789/`
- 인증: Device Identity + Token
- 프레임: `GatewayEventFrame`, `GatewayResponseFrame`

### 5.3 Agent Tools

#### axiom_search

```typescript
{
  name: "axiom_search",
  description: "AxiomMind 메모리에서 시맨틱 검색",
  parameters: {
    query: string,        // 검색 쿼리
    entryTypes?: string[],// 필터링할 타입
    stages?: string[],    // 필터링할 stage (new)
    limit?: number        // 결과 수 (기본: 5)
  }
}
```

#### axiom_recall

```typescript
{
  name: "axiom_recall",
  description: "특정 기억 불러오기",
  parameters: {
    sessionId: string,    // 세션 ID
    entryIndex?: number   // 엔트리 인덱스
  }
}
```

#### axiom_save

```typescript
{
  name: "axiom_save",
  description: "수동으로 기억 저장",
  parameters: {
    entry: AnyEntry,      // 저장할 엔트리
    date?: string,        // 날짜 (기본: 오늘)
    stage?: string        // 시작 stage (기본: 'working')
  }
}
```

---

## 6. 저장소 구조

### 6.1 파일 시스템

```
~/.openclaw/axiommind/
├── src/LongTermMemory/           # Idris 파일
│   ├── MemorySchema.idr          # 기반 타입
│   ├── Session_2026_01_31_01.idr # 세션 파일들
│   └── Day_2026_01_31.idr        # 일일 통합
├── data/
│   ├── memory.duckdb             # 메타데이터 DB
│   └── lance/                    # 벡터 DB
│       └── memory_entries.lance
└── sessions/                     # 원본 세션 로그
    └── 2026-01-31/
        └── session_01.txt
```

### 6.2 DuckDB 스키마 (Updated)

```sql
CREATE TABLE sessions (
  id VARCHAR PRIMARY KEY,
  date DATE NOT NULL,
  session_id INTEGER NOT NULL,
  time_range VARCHAR,
  title VARCHAR NOT NULL,
  idr_path VARCHAR NOT NULL,
  compiled_at TIMESTAMP,
  compile_status VARCHAR DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, session_id)
);

CREATE TABLE entries (
  id VARCHAR PRIMARY KEY,
  session_id VARCHAR REFERENCES sessions(id),
  entry_type VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  content JSONB,
  embedding_id VARCHAR,
  -- NEW: Graduation Pipeline 지원
  memory_stage VARCHAR DEFAULT 'working',  -- raw|working|candidate|verified|certified
  promoted_at TIMESTAMP,
  promotion_reason VARCHAR,
  last_accessed_at TIMESTAMP,
  access_count INTEGER DEFAULT 0,
  confirmation_count INTEGER DEFAULT 0,  -- 다른 세션에서 언급된 횟수
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NEW: 승격 이력 테이블
CREATE TABLE promotion_history (
  id VARCHAR PRIMARY KEY,
  entry_id VARCHAR REFERENCES entries(id),
  from_stage VARCHAR NOT NULL,
  to_stage VARCHAR NOT NULL,
  reason VARCHAR,
  promoted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NEW: 충돌 기록 테이블
CREATE TABLE conflicts (
  id VARCHAR PRIMARY KEY,
  entry_id_1 VARCHAR REFERENCES entries(id),
  entry_id_2 VARCHAR REFERENCES entries(id),
  conflict_type VARCHAR NOT NULL,  -- contradiction|outdated|duplicate
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);
CREATE INDEX IF NOT EXISTS idx_entries_stage ON entries(memory_stage);  -- NEW
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
```

### 6.3 LanceDB 스키마

```
memory_entries:
  - id: string
  - session_id: string
  - date: string
  - type: string
  - text: string
  - stage: string       # NEW
  - vector: float[768]  # intfloat/multilingual-e5-base
```

---

## 7. 비기능적 요구사항

### 7.1 성능

- 검색 응답: < 500ms
- 세션 처리: < 30s (LLM 호출 포함)
- 승격 처리: < 5s (단일 엔트리)
- 웹 UI 초기 로드: < 2s

### 7.2 확장성

- 세션당 최대 100개 엔트리
- 일일 최대 50개 세션
- 총 저장: 제한 없음 (디스크 용량 내)

### 7.3 의존성

- Idris2 컴파일러 설치 필요 (L1→L2 승격 시)
- Node.js 22+
- DuckDB, LanceDB (npm 패키지)

---

## 8. 채팅 UI 추가 기능 (NEW)

### 8.1 Thinking Mode 지원

```typescript
type ThinkingMode = 'none' | 'low' | 'medium' | 'high';

// 메시지 전송 시 thinking 모드 포함
{
  type: "req",
  method: "chat.send",
  params: {
    sessionKey: string,
    message: string,
    thinking?: ThinkingMode,  // NEW
    idempotencyKey: string
  }
}

// 응답에서 thinking 블록 표시
{
  role: "assistant",
  content: [
    { type: "thinking", thinking: "..." },
    { type: "text", text: "..." }
  ]
}
```

### 8.2 파일 첨부 지원

```typescript
type Attachment = {
  type: 'file' | 'image';
  name: string;
  mimeType: string;
  data: string;  // base64
  size: number;
};

// 메시지 전송 시 첨부 포함
{
  type: "req",
  method: "chat.send",
  params: {
    sessionKey: string,
    message: string,
    attachments?: Attachment[],  // NEW
    idempotencyKey: string
  }
}
```

### 8.3 Memory Graduation 시각화

```typescript
// UI 컴포넌트: GraduationPipeline
// 표시 내용:
// - 각 단계별 메모리 개수
// - 최근 승격/강등 이력
// - 수동 승격 버튼 (L2→L3, L3→L4)
// - 충돌 알림 배지
```
