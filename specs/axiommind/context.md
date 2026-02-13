# AxiomMind - 컨텍스트 문서 (Context)

## 1. 프로젝트 현황

### 1.1 구현 완료 (Phase 1-6)

| 영역 | 완료 항목 |
|------|-----------|
| 플러그인 | 스캐폴딩, 매니페스트, 진입점 |
| Memory Pipeline | L0-L1 레벨, Extractor, Generator, Validator, Indexer, Search |
| OpenClaw 연동 | before_agent_start 훅, 3개 도구, HTTP API |
| 웹 UI | 채팅, 메모리 검색, 마크다운, 도구 진행, 메모리 작업 시각화 |
| Memory Graduation | L2-L4 승격/강등, DB 스키마 확장, API 엔드포인트, Idris 스키마 |

### 1.2 미구현 (Phase 7-9)

| 영역 | 미구현 항목 |
|------|-------------|
| 채팅 UI | Thinking 모드, 파일 첨부, Graduation 시각화 |
| 자동 메모리 | 세션 종료 처리, 충돌 해결 UI, Similarity 기반 Confirmation |
| 코드 품질 | 하드코딩 제거, 에러 핸들링 |

---

## 2. 사용자 설계 문서 참조

### 2.1 프론트엔드 설계 (CLAUDE.md)

**위치**: [my-docs/CLAUDE.md](../../my-docs/CLAUDE.md)

**핵심 내용**:

- Next.js 15 (App Router) 기반
- shadcn/ui + Tailwind CSS
- TanStack Query (React Query) + Jotai
- TypeScript Strict Mode
- Features 기반 아키텍처

**코딩 규약**:

- 컴포넌트: PascalCase, export default, React.memo 필수
- 함수: handleUploadImage, fetchUserData 형식
- Boolean: isLoading, hasError, canEdit 형식
- 절대 경로 import (@/) 사용
- 매개변수 2개 이상이면 객체로 묶기

**Feature 모듈 구조**:

```
features/{name}/
├── {ComponentName}.tsx
├── _api/
│   ├── types.ts
│   └── queries.ts
├── _hooks/
│   └── use{Name}.ts
├── _stores/
│   └── {name}.ts
└── _utils/
    └── {name}.ts
```

### 2.2 메모리 아키텍처 (memory_architecture.md)

**위치**: [my-docs/memory_architecture.md](../../my-docs/memory_architecture.md)

**핵심 합의점**: "상태가 아니라 전이를 타입화하라"

**Memory Graduation Pipeline**:

```
L0: RAW EVENT LOG (불변, append-only, LanceDB)
     ↓
L1: WORKING MEMORY (가변, 자유로움)
     ↓ (패턴 감지)
L2: CANDIDATE SPEC (구조화, 불완전 허용, Idris hole)
     ↓ (검증 게이트)
L3: VERIFIED SPEC (Idris 타입 체크 통과)
     ↓ (사용 빈도 + 범용성)
L4: CERTIFIED SPEC (공통 레이어, 준불변)
```

**5가지 핵심 설계 원칙**:

1. **Event Sourcing**: 현재 상태는 이벤트를 fold해서 계산된 결과
2. **Gradual Typing**: 성숙도를 타입으로 표현 (Raw → Candidate → Verified → Certified)
3. **Dependent Types**: 타입이 값에 의존 (검증되지 않은 기억은 Decision Ledger 기록 불가)
4. **온톨로지 ↔ 타입 분리**: 온톨로지는 표현력/확장성, Idris 타입은 무결성/검증
5. **승격 게이트**: (근거 충분) AND (불변식 통과) AND (중복 없음)

### 2.3 파이프라인 구현 (q.md)

**위치**: [my-docs/q.md](../../my-docs/q.md)

**Auto Memory Pipeline 구조**:

```
[채팅 세션] → [Session Extractor] → [Idris Generator] → [Idris Compiler]
                    │ LLM 추출           │ JSON→.idr         │ 타입 검증
                    ▼                    ▼                   ▼
                  JSON              .idr 파일            ✅/❌
                                                          │
                            ┌─────────────────────────────┤
                            ▼                             ▼
                    [Error Queue]                  [Search DB]
                    재시도/수동 수정            DuckDB + LanceDB
```

**구현 모듈** (Python → TypeScript 포팅 완료):

1. `extractor.py` → `extractor.ts` ✅
2. `idris_generator.py` → `idris-generator.ts` ✅
3. `validator.py` → `validator.ts` ✅
4. `indexer.py` → `indexer.ts` ✅
5. `search.py` → `search.ts` ✅
6. `orchestrator.py` → `orchestrator.ts` ✅

---

## 3. OpenClaw 연동 포인트

### 3.1 플러그인 시스템

**참조 파일**:

- [src/plugins/types.ts](../../src/plugins/types.ts) - 플러그인 타입 정의
- [src/plugin-sdk/index.ts](../../src/plugin-sdk/index.ts) - 플러그인 SDK
- [src/plugins/discovery.ts](../../src/plugins/discovery.ts) - 플러그인 발견
- [src/plugins/loader.ts](../../src/plugins/loader.ts) - 플러그인 로딩

**플러그인 API 주요 메서드**:

```typescript
api.registerTool(tool, opts)           // 에이전트 도구 등록
api.registerHook(events, handler)      // 라이프사이클 후크
api.registerHttpRoute({ path, handler }) // HTTP 엔드포인트
api.registerService(service)           // 백그라운드 서비스
api.on(hookName, handler)              // 이벤트 핸들러
```

**사용 가능한 후크**:

- `before_agent_start` - 에이전트 시작 전 ✅ 사용중
- `agent_end` - 에이전트 완료 후
- `message_received` - 메시지 수신
- `message_sending` - 메시지 발송 전
- `session_start` / `session_end` - 세션 라이프사이클 (❌ 미사용)

### 3.2 게이트웨이 연결

**참조 파일**:

- [ui/src/ui/gateway.ts](../../ui/src/ui/gateway.ts) - 게이트웨이 클라이언트
- [src/gateway/protocol/](../../src/gateway/protocol/) - 프로토콜 정의

**WebSocket 연결**:

```typescript
// GatewayBrowserClient
const client = new GatewayBrowserClient({
  url: 'ws://localhost:18789/',
  deviceId: string,
  token?: string
});

await client.connect();
client.on('event', (frame: GatewayEventFrame) => { ... });
client.send(method, params);
```

**게이트웨이 프로토콜**:

```typescript
// chat.send 요청
{
  type: "req",
  id: "req-1",
  method: "chat.send",
  params: {
    sessionKey: "agent:main:main",
    message: "안녕하세요",
    idempotencyKey: "uuid-...",
    deliver: false
  }
}

// chat 이벤트 (스트리밍)
{
  type: "event",
  event: "chat",
  payload: {
    runId: "uuid-...",
    sessionKey: "agent:main:main",
    state: "delta" | "final" | "aborted" | "error",
    message: { role: "assistant", content: [...], timestamp: ... }
  }
}

// agent 이벤트 (도구 진행)
{
  type: "event",
  event: "agent",
  payload: {
    runId: "uuid-...",
    stream: "tool" | "assistant" | "lifecycle",
    sessionKey: "agent:main:main",
    data: { name: "Bash", input: {...}, output: {...} }
  }
}
```

### 3.3 기존 메모리 시스템

**참조 파일**:

- [src/memory/memory-schema.ts](../../src/memory/memory-schema.ts) - SQLite 스키마
- [extensions/memory-core/index.ts](../../extensions/memory-core/index.ts) - 메모리 플러그인
- [src/agents/tools/memory-tool.ts](../../src/agents/tools/memory-tool.ts) - 메모리 도구

**기존 저장 위치**:

- `~/.openclaw/workspace/memory/YYYY-MM-DD.md` - 일일 로그
- `~/.openclaw/workspace/MEMORY.md` - 장기 기억
- `~/.openclaw/memory/<agentId>.sqlite` - 벡터 인덱스

**AxiomMind는 별도 저장소 사용**:

- `~/.openclaw/axiommind/` - 독립 디렉토리

### 3.4 HTTP 핸들러

**참조 파일**:

- [src/gateway/server/plugins-http.ts](../../src/gateway/server/plugins-http.ts) - HTTP 핸들러
- [src/gateway/server-http.ts](../../src/gateway/server-http.ts) - HTTP 서버

**등록 방법**:

```typescript
api.registerHttpRoute({
  path: "/ax",
  handler: async (req, res) => {
    // 처리 로직
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }
});
```

---

## 4. 구현 완료 기능 상세

### 4.1 Memory Graduation (Phase 6) ✅ 구현 완료

**GraduationManager 클래스** (`memory-pipeline/graduation.ts`):

구현된 메서드:
- `promoteToCandidate(entryId)` - L1 → L2 승격 (Idris 컴파일 성공 시)
- `promoteToVerified(entryId, reason)` - L2 → L3 승격
- `promoteToCertified(entryId)` - L3 → L4 승격
- `promoteManually(entryId, targetStage)` - 수동 승격
- `demote(entryId, reason)` - 역방향 강등
- `checkAutoPromotions()` - 자동 승격 체크 (스케줄러용)
- `getStats()` - 통계 조회
- `getRecentPromotions(limit)` - 승격 이력 조회
- `recordAccess(entryId)` - 접근 기록 업데이트
- `incrementConfirmation(entryId)` - confirmation 카운트 증가
- `recordConflict(...)`, `resolveConflict(...)` - 충돌 관리

**API 엔드포인트** (`api/routes.ts`):
- `POST /ax/api/promote` - 수동 승격
- `POST /ax/api/demote` - 수동 강등
- `GET /ax/api/graduation/stats` - 통계 조회
- `GET /ax/api/graduation/history` - 승격 이력 조회
- `POST /ax/api/graduation/run-auto` - 자동 승격 실행
- `GET /ax/api/search?stages=...` - stage 필터 추가

**Idris 스키마** (`idris/src/LongTermMemory/`):
- `MemorySchema.idr` - 기본 타입 (Fact, Decision, Insight, Task, Reference)
- `GraduationSchema.idr` - 승격 타입 (MemoryStage, CanPromote, CanDemote)

**승격 조건 상수**:
```typescript
PROMOTION_CONFIG = {
  DAYS_FOR_VERIFIED: 7,        // L2 → L3: 7일 경과
  CONFIRMATION_COUNT_FOR_VERIFIED: 3,  // L2 → L3: 확인 3회
  DAYS_FOR_CERTIFIED: 30,      // L3 → L4: 30일 경과
  DAYS_FOR_DEMOTION: 90,       // L4 → L3: 90일 미사용
}
```

---

## 5. 구현 예정 기능 상세

### 5.1 Similarity 기반 Confirmation (Phase 8)

```typescript
// memory-pipeline/similarity.ts

import { LanceDB } from 'lancedb';

class SimilarityChecker {
  constructor(private lance: LanceDB) {}

  // 새 엔트리 저장 시 기존 엔트리와 유사도 비교
  async checkAndUpdateConfirmation(
    newEntry: Entry,
    embedding: number[]
  ): Promise<string[]> {
    const similar = await this.lance.search(embedding, {
      limit: 5,
      threshold: 0.85  // 유사도 임계값
    });

    const confirmedEntries: string[] = [];

    for (const match of similar) {
      if (match.id !== newEntry.id && match.score >= 0.85) {
        await this.incrementConfirmation(match.id);
        confirmedEntries.push(match.id);
      }
    }

    return confirmedEntries;
  }

  private async incrementConfirmation(entryId: string): Promise<void> {
    // DuckDB에서 confirmation_count 증가
  }
}
```

### 5.2 충돌 감지 (Phase 8.2)

```typescript
// memory-pipeline/conflict-resolver.ts

type ConflictType = 'contradiction' | 'outdated' | 'duplicate';

interface Conflict {
  id: string;
  entryId1: string;
  entryId2: string;
  type: ConflictType;
  detectedAt: Date;
}

class ConflictResolver {
  // 충돌 감지
  async detectConflicts(entry: Entry): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // 1. 같은 주제의 다른 정보 찾기
    const similar = await this.findSimilarEntries(entry);

    for (const other of similar) {
      const conflictType = this.classifyConflict(entry, other);
      if (conflictType) {
        conflicts.push({
          id: crypto.randomUUID(),
          entryId1: entry.id,
          entryId2: other.id,
          type: conflictType,
          detectedAt: new Date()
        });
      }
    }

    return conflicts;
  }

  // 충돌 유형 분류
  classifyConflict(e1: Entry, e2: Entry): ConflictType | null {
    // 같은 타입, 같은 주제지만 내용이 다르면 contradiction
    // 날짜가 오래됐으면 outdated
    // 내용이 거의 동일하면 duplicate
    return null;
  }

  // 자동 해결 (가능한 경우)
  async autoResolve(conflict: Conflict): Promise<Resolution | null> {
    if (conflict.type === 'duplicate') {
      // 중복은 자동 병합 가능
      return this.mergeDuplicates(conflict);
    }
    if (conflict.type === 'outdated') {
      // 오래된 것은 자동 강등 가능
      return this.demoteOlder(conflict);
    }
    // contradiction은 수동 해결 필요
    return null;
  }
}
```

### 5.3 세션 종료 처리 (Phase 8.1)

```typescript
// index.ts 수정

api.on('session_end', async (context) => {
  const sessionLog = await extractSessionFromContext(context);

  if (sessionLog && sessionLog.length > 100) {
    await pipeline.processSession(sessionLog, {
      autoPromote: true,
      checkConflicts: true
    });
  }
});

// memory-pipeline/context-extractor.ts

async function extractSessionFromContext(
  context: AgentContext
): Promise<string> {
  const messages = context.messages || [];

  const sessionLog = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const content = typeof m.content === 'string'
        ? m.content
        : m.content.map(c => c.text || '').join('\n');
      return `${role}: ${content}`;
    })
    .join('\n\n');

  return sessionLog;
}
```

---

## 6. 참고 파일 목록

### 6.1 플러그인 예시

| 파일 | 설명 |
|------|------|
| [extensions/memory-core/index.ts](../../extensions/memory-core/index.ts) | 메모리 플러그인 예시 |
| [extensions/memory-lancedb/index.ts](../../extensions/memory-lancedb/index.ts) | LanceDB 백엔드 예시 |
| [extensions/discord/index.ts](../../extensions/discord/index.ts) | 채널 플러그인 예시 |

### 6.2 웹 UI 참조

| 파일 | 설명 |
|------|------|
| [ui/src/ui/app.ts](../../ui/src/ui/app.ts) | 메인 앱 컴포넌트 |
| [ui/src/ui/views/chat.ts](../../ui/src/ui/views/chat.ts) | 채팅 뷰 |
| [ui/src/ui/controllers/chat.ts](../../ui/src/ui/controllers/chat.ts) | 채팅 컨트롤러 |
| [ui/src/ui/gateway.ts](../../ui/src/ui/gateway.ts) | 게이트웨이 클라이언트 |

### 6.3 타입 정의

| 파일 | 설명 |
|------|------|
| [src/plugins/types.ts](../../src/plugins/types.ts) | 플러그인 타입 |
| [src/plugins/runtime/types.ts](../../src/plugins/runtime/types.ts) | 런타임 타입 |
| [src/channels/plugins/types.plugin.ts](../../src/channels/plugins/types.plugin.ts) | 채널 플러그인 타입 |

### 6.4 사용자 설계 문서

| 파일 | 설명 |
|------|------|
| [my-docs/CLAUDE.md](../../my-docs/CLAUDE.md) | 프론트엔드 설계 |
| [my-docs/memory_architecture.md](../../my-docs/memory_architecture.md) | 메모리 아키텍처 |
| [my-docs/q.md](../../my-docs/q.md) | 파이프라인 구현 |

### 6.5 AxiomMind 구현 파일

| 파일 | 설명 |
|------|------|
| [extensions/axiommind/index.ts](../../extensions/axiommind/index.ts) | 플러그인 진입점 |
| [extensions/axiommind/memory-pipeline/orchestrator.ts](../../extensions/axiommind/memory-pipeline/orchestrator.ts) | 파이프라인 오케스트레이터 |
| [extensions/axiommind/memory-pipeline/tools.ts](../../extensions/axiommind/memory-pipeline/tools.ts) | 에이전트 도구 |
| [extensions/axiommind/api/routes.ts](../../extensions/axiommind/api/routes.ts) | REST API |
| [extensions/axiommind/web/](../../extensions/axiommind/web/) | Next.js 웹 UI |

---

## 7. 기술 스택 요약

### 7.1 백엔드 (플러그인)

| 항목 | 기술 |
|------|------|
| 언어 | TypeScript (ESM) |
| 런타임 | Node.js 22+ / Bun |
| 타입 검증 | Idris2 |
| 메타데이터 DB | DuckDB |
| 벡터 DB | LanceDB |
| LLM | Anthropic Claude API |

### 7.2 프론트엔드 (웹 UI)

| 항목 | 기술 |
|------|------|
| 프레임워크 | Next.js 15 (App Router) |
| UI 라이브러리 | shadcn/ui |
| 스타일링 | Tailwind CSS |
| 상태 관리 | Jotai |
| 데이터 페칭 | TanStack Query |
| 언어 | TypeScript (Strict) |

### 7.3 시스템 요구사항

| 항목 | 요구사항 |
|------|----------|
| Node.js | 22+ |
| Idris2 | 설치 필요 (선택적) |
| OpenClaw | >= 2026.1.26 |
| 디스크 | 충분한 공간 (LanceDB) |

---

## 8. 주의사항

### 8.1 플러그인 의존성

- `dependencies`에 런타임 의존성 명시
- `peerDependencies`에 openclaw 명시
- `devDependencies`에 `openclaw: "workspace:*"` (개발용)

### 8.2 Idris2 설치

Idris2 컴파일러가 필요합니다 (L2 승격 시):

```bash
# macOS
brew install idris2

# Linux (pack)
git clone https://github.com/stefan-hoeck/idris2-pack
cd idris2-pack && make install

# 확인
idris2 --version
```

**참고**: Idris2가 없으면 L1 → L2 승격이 스킵됩니다.

### 8.3 임베딩 모델

q.md에서 `intfloat/multilingual-e5-base` 사용. 대안:

- OpenAI `text-embedding-3-small`
- Sentence Transformers (로컬)
- Ollama (로컬)

### 8.4 Next.js 서빙

OpenClaw 게이트웨이에서 Next.js 앱 서빙 방법:

1. **빌드 후 정적 서빙**: `npm run build` → `.next/` 정적 파일 서빙 ✅ 현재 사용
2. **프록시**: Next.js 개발 서버 프록시
3. **내장**: Next.js 서버 통합 (복잡)

### 8.5 브라우저 캐시

변경사항 테스트 시:
- 시크릿 모드 사용
- 강제 새로고침 (Cmd+Shift+R)
- 개발자 도구에서 "Disable cache" 활성화

### 8.6 하드코딩된 토큰

현재 `api/auth.ts`에 하드코딩된 토큰 사용 중:
- `58a362bc29faaeff7c11422bcfeb79c4`
- Phase 9에서 환경변수로 대체 예정

---

## 9. 실행 방법

### 9.1 게이트웨이 실행

```bash
cd /Users/namsangboy/workspace/opensource/openclaw
pnpm openclaw gateway run --bind loopback --port 18789 --force
```

### 9.2 웹 UI 빌드

```bash
cd extensions/axiommind/web
npm run build
```

### 9.3 접속

- **AxiomMind UI**: http://127.0.0.1:18789/ax/chat?session=agent:main:main
- **Control UI (기본)**: http://127.0.0.1:18789/

### 9.4 디버깅

```bash
# 게이트웨이 로그
tail -f /tmp/openclaw-gateway.log

# 포트 확인
lsof -i :18789

# 브라우저 콘솔에서
- Gateway connected
- [chat event] delta/final
- [agent event] tool
```
