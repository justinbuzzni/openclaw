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

| 컴포넌트 | 설명 |
|----------|------|
| ChatWindow | 메인 채팅 인터페이스 |
| MessageList | 메시지 목록 표시 |
| MessageInput | 메시지 입력 |
| MemoryPanel | 기억 검색/표시 패널 |
| GraduationPipeline | L0-L4 단계 시각화 |

#### 기술 스택

- **Framework**: Next.js 15 (App Router)
- **UI Library**: shadcn/ui
- **Styling**: Tailwind CSS
- **State**: Jotai
- **Data Fetching**: TanStack Query (React Query)
- **Type Safety**: TypeScript (Strict Mode)

### 2.2 Memory Pipeline

| 컴포넌트 | 설명 |
|----------|------|
| SessionExtractor | 채팅 세션 → 구조화된 JSON 추출 (LLM) |
| IdrisGenerator | JSON → Idris 코드 생성 |
| IdrisValidator | Idris2 컴파일러로 타입 검증 |
| MemoryIndexer | DuckDB + LanceDB 인덱싱 |
| MemorySearch | 시맨틱 검색 + 키워드 검색 |

### 2.3 OpenClaw 플러그인

| 기능 | 설명 |
|------|------|
| 후크 | `session_end` - 세션 종료 시 자동 메모리 처리 |
| 도구 | `axiom_search`, `axiom_recall`, `axiom_save` |
| HTTP | `/axiommind/` - 웹 UI, `/axiommind/api/` - REST API |

---

## 3. 데이터 모델

### 3.1 Memory Entry Types

```typescript
type Priority = 'low' | 'medium' | 'high' | 'critical';
type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'cancelled';
type MemoryStage = 'raw' | 'candidate' | 'verified' | 'certified';

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

| Level | 이름 | 특성 | 저장소 |
|-------|------|------|--------|
| L0 | RAW EVENT LOG | 불변, append-only | LanceDB |
| L1 | WORKING MEMORY | 가변, 자유로움 | 메모리/임시 파일 |
| L2 | CANDIDATE SPEC | 구조화, 불완전 허용 | Idris (hole 허용) |
| L3 | VERIFIED SPEC | Idris 타입 체크 통과 | Idris (검증 완료) |
| L4 | CERTIFIED SPEC | 공통 레이어, 준불변 | Idris + 버전 태깅 |

### 4.2 승격 조건

```
L0 → L1: 자동 (세션 종료 시)
L1 → L2: 패턴 감지 (반복/중요도/결정 영향)
L2 → L3: 검증 게이트 (근거 충분 + 충돌 없음 + Idris 타입 체크)
L3 → L4: 사용 빈도 + 범용성 충족
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
```

---

## 5. API 명세

### 5.1 REST API

#### GET /axiommind/api/search

시맨틱 검색

```
Query Parameters:
  q: string (required) - 검색 쿼리
  types?: string[] - 필터링할 entry 타입
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
    score: number
  }]
}
```

#### GET /axiommind/api/decisions

Decision과 연결된 Fact 조회

```
Query Parameters:
  dateFrom?: string

Response:
{
  decisions: [{
    decision: Decision,
    date: string,
    evidenceFacts: Fact[],
    idrPath: string
  }]
}
```

#### GET /axiommind/api/tasks

미완료 Task 조회

```
Response:
{
  tasks: [{
    task: Task,
    date: string,
    session: string
  }]
}
```

#### POST /axiommind/api/process

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
  entriesCount: number
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
    date?: string         // 날짜 (기본: 오늘)
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

### 6.2 DuckDB 스키마

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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6.3 LanceDB 스키마

```
memory_entries:
  - id: string
  - session_id: string
  - date: string
  - type: string
  - text: string
  - vector: float[768]  # intfloat/multilingual-e5-base
```

---

## 7. 비기능적 요구사항

### 7.1 성능

- 검색 응답: < 500ms
- 세션 처리: < 30s (LLM 호출 포함)
- 웹 UI 초기 로드: < 2s

### 7.2 확장성

- 세션당 최대 100개 엔트리
- 일일 최대 50개 세션
- 총 저장: 제한 없음 (디스크 용량 내)

### 7.3 의존성

- Idris2 컴파일러 설치 필요
- Node.js 22+
- DuckDB, LanceDB (npm 패키지)
