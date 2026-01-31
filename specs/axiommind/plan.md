# AxiomMind - 구현 계획 (Implementation Plan)

## 마일스톤 개요

| Phase | 마일스톤 | 예상 작업 |
|-------|----------|----------|
| 1 | 플러그인 스캐폴딩 | 디렉토리 구조, 매니페스트, 진입점 |
| 2 | Memory Pipeline | TypeScript 포팅, Idris 스키마 |
| 3 | OpenClaw 연동 | 후크, 도구, API 엔드포인트 |
| 4 | Next.js 웹 UI | 프로젝트 설정, 컴포넌트 개발 |
| 5 | 통합 테스트 | E2E 테스트, 버그 수정 |

---

## Phase 1: 플러그인 스캐폴딩

### 1.1 디렉토리 생성

```bash
mkdir -p extensions/axiommind/{memory-pipeline,idris/src/LongTermMemory,web}
```

### 1.2 파일 생성 목록

- [ ] `extensions/axiommind/openclaw.plugin.json`
- [ ] `extensions/axiommind/package.json`
- [ ] `extensions/axiommind/tsconfig.json`
- [ ] `extensions/axiommind/index.ts`

### 1.3 openclaw.plugin.json

```json
{
  "id": "axiommind",
  "name": "AxiomMind Memory System",
  "description": "Memory Graduation Pipeline + Custom Chat UI",
  "version": "0.1.0"
}
```

### 1.4 package.json

```json
{
  "name": "@openclaw/plugin-axiommind",
  "version": "0.1.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {
    "duckdb": "^1.0.0",
    "lancedb": "^0.4.0",
    "@anthropic-ai/sdk": "^0.30.0"
  },
  "peerDependencies": {
    "openclaw": ">=2026.1.26"
  },
  "devDependencies": {
    "openclaw": "workspace:*"
  }
}
```

---

## Phase 2: Memory Pipeline

### 2.1 Types 정의

- [ ] `memory-pipeline/types.ts`
  - Priority, TaskStatus, MemoryStage enum
  - Fact, Decision, Insight, Task, Reference 타입
  - Session, MemoryDay 타입
  - ProcessResult 타입

### 2.2 Session Extractor

- [ ] `memory-pipeline/extractor.ts`
  - Anthropic SDK 초기화
  - 추출 프롬프트 정의
  - extract(sessionLog, date, sessionId) 함수
  - JSON 파싱 및 검증

### 2.3 Idris Generator

- [ ] `memory-pipeline/idris-generator.ts`
  - generateSession(data) 함수
  - _buildSessionCode(data, moduleName) 함수
  - _entryToIdris(entry) 함수
  - 문자열 이스케이프 처리

### 2.4 Idris Validator

- [ ] `memory-pipeline/validator.ts`
  - validate(idrPath) 함수
  - idris2 --check 프로세스 실행
  - 에러/경고/hole 파싱

### 2.5 Indexer

- [ ] `memory-pipeline/indexer.ts`
  - DuckDB 연결 및 스키마 초기화
  - LanceDB 연결
  - indexSession(data, idrPath, status) 함수
  - 임베딩 생성 (sentence-transformers 또는 OpenAI)

### 2.6 Search

- [ ] `memory-pipeline/search.ts`
  - semanticSearch(query, options) 함수
  - keywordSearch(keywords, options) 함수
  - getDecisionsWithEvidence(dateFrom) 함수
  - getPendingTasks() 함수

### 2.7 Orchestrator

- [ ] `memory-pipeline/orchestrator.ts`
  - MemoryPipeline 클래스
  - processSession(sessionLog, date) 함수
  - _retryWithFeedback(sessionLog, errors) 함수
  - _getNextSessionId(date) 함수

### 2.8 Idris 스키마

- [ ] `idris/memory.ipkg`
- [ ] `idris/src/LongTermMemory/MemorySchema.idr`
  - 기본 타입 (DateStr, SessionId, Priority, TaskStatus)
  - 엔트리 타입 (Fact, Decision, Insight, Task, Reference)
  - AnyEntry 합타입
  - Session, MemoryDay 레코드
  - 검증 함수 (validTask, validDecision)

---

## Phase 3: OpenClaw 연동

### 3.1 플러그인 등록

- [ ] `index.ts` 업데이트
  - MemoryPipeline 초기화
  - session_end 후크 등록
  - HTTP 라우트 등록

### 3.2 Agent Tools

- [ ] `memory-pipeline/tools.ts`
  - createSearchTool(pipeline) 함수
  - createRecallTool(pipeline) 함수
  - createSaveTool(pipeline) 함수

### 3.3 HTTP API

- [ ] `api/routes.ts`
  - GET /search
  - GET /decisions
  - GET /tasks
  - POST /process

---

## Phase 4: Next.js 웹 UI

### 4.1 프로젝트 설정

```bash
cd extensions/axiommind/web
npx create-next-app@latest . --typescript --tailwind --app --eslint
npx shadcn@latest init
npx shadcn@latest add button card input textarea scroll-area
```

### 4.2 프로젝트 구조 파일

- [ ] `web/package.json`
- [ ] `web/next.config.ts`
- [ ] `web/tailwind.config.ts`
- [ ] `web/tsconfig.json`

### 4.3 레이아웃 및 페이지

- [ ] `web/app/layout.tsx`
- [ ] `web/app/page.tsx`
- [ ] `web/app/globals.css`
- [ ] `web/lib/utils.ts`
- [ ] `web/lib/providers.tsx`

### 4.4 Chat Feature

- [ ] `web/features/chat/ChatWindow.tsx`
- [ ] `web/features/chat/MessageList.tsx`
- [ ] `web/features/chat/MessageInput.tsx`
- [ ] `web/features/chat/_api/queries.ts`
- [ ] `web/features/chat/_hooks/useGateway.ts`
- [ ] `web/features/chat/_stores/chat.ts`

### 4.5 Memory Feature

- [ ] `web/features/memory/MemoryPanel.tsx`
- [ ] `web/features/memory/SearchResults.tsx`
- [ ] `web/features/memory/GraduationPipeline.tsx`
- [ ] `web/features/memory/_api/queries.ts`
- [ ] `web/features/memory/_hooks/useMemory.ts`
- [ ] `web/features/memory/_stores/memory.ts`

### 4.6 서버 통합

- [ ] `web/server.ts`
  - serveNextApp() 함수
  - Next.js 빌드 및 서빙

---

## Phase 5: 통합 테스트

### 5.1 플러그인 테스트

- [ ] 플러그인 로딩 확인
- [ ] 설정 로드 테스트

### 5.2 Memory Pipeline 테스트

- [ ] Extractor 테스트 (mock LLM)
- [ ] Idris Generator 테스트
- [ ] Validator 테스트 (Idris2 필요)
- [ ] Indexer 테스트
- [ ] Search 테스트

### 5.3 웹 UI 테스트

- [ ] 컴포넌트 단위 테스트
- [ ] Gateway 연결 테스트
- [ ] E2E 테스트

### 5.4 통합 테스트

- [ ] 전체 파이프라인 E2E
- [ ] OpenClaw 연동 테스트

---

## 의존성 순서

```
Phase 1 (스캐폴딩)
    │
    ▼
Phase 2.1-2.2 (Types, Extractor)
    │
    ├─────────────────────┐
    ▼                     ▼
Phase 2.3-2.4         Phase 2.5-2.6
(Generator, Validator) (Indexer, Search)
    │                     │
    └──────────┬──────────┘
               ▼
         Phase 2.7 (Orchestrator)
               │
    ┌──────────┴──────────┐
    ▼                     ▼
Phase 3              Phase 4
(OpenClaw 연동)      (Next.js UI)
    │                     │
    └──────────┬──────────┘
               ▼
         Phase 5 (통합 테스트)
```

---

## 체크리스트

### Phase 1

- [ ] 디렉토리 구조 생성
- [ ] openclaw.plugin.json 작성
- [ ] package.json 작성
- [ ] tsconfig.json 작성
- [ ] index.ts 기본 구조 작성

### Phase 2

- [ ] types.ts 완성
- [ ] extractor.ts 완성
- [ ] idris-generator.ts 완성
- [ ] validator.ts 완성
- [ ] indexer.ts 완성
- [ ] search.ts 완성
- [ ] orchestrator.ts 완성
- [ ] MemorySchema.idr 완성

### Phase 3

- [ ] index.ts 후크 등록
- [ ] tools.ts 완성
- [ ] routes.ts 완성

### Phase 4

- [ ] Next.js 프로젝트 초기화
- [ ] shadcn/ui 설정
- [ ] ChatWindow 컴포넌트
- [ ] MemoryPanel 컴포넌트
- [ ] useGateway 훅
- [ ] useMemory 훅
- [ ] 서버 통합

### Phase 5

- [ ] 플러그인 로딩 테스트
- [ ] Memory Pipeline 테스트
- [ ] 웹 UI 테스트
- [ ] E2E 통합 테스트
