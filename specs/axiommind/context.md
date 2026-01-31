# AxiomMind - 컨텍스트 문서 (Context)

## 1. 사용자 설계 문서 참조

### 1.1 프론트엔드 설계 (CLAUDE.md)

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

### 1.2 메모리 아키텍처 (memory_architecture.md)

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

### 1.3 파이프라인 구현 (q.md)

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

**구현 모듈** (Python → TypeScript 포팅 필요):

1. `extractor.py` → `extractor.ts`
2. `idris_generator.py` → `idris-generator.ts`
3. `validator.py` → `validator.ts`
4. `indexer.py` → `indexer.ts`
5. `search.py` → `search.ts`
6. `orchestrator.py` → `orchestrator.ts`

---

## 2. OpenClaw 연동 포인트

### 2.1 플러그인 시스템

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

- `before_agent_start` - 에이전트 시작 전
- `agent_end` - 에이전트 완료 후
- `message_received` - 메시지 수신
- `message_sending` - 메시지 발송 전
- `session_start` / `session_end` - 세션 라이프사이클

### 2.2 게이트웨이 연결

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

### 2.3 기존 메모리 시스템

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

### 2.4 HTTP 핸들러

**참조 파일**:

- [src/gateway/server/plugins-http.ts](../../src/gateway/server/plugins-http.ts) - HTTP 핸들러
- [src/gateway/server-http.ts](../../src/gateway/server-http.ts) - HTTP 서버

**등록 방법**:

```typescript
api.registerHttpRoute({
  path: "/axiommind",
  handler: async (req, res) => {
    // 처리 로직
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }
});
```

---

## 3. 참고 파일 목록

### 3.1 플러그인 예시

| 파일 | 설명 |
|------|------|
| [extensions/memory-core/index.ts](../../extensions/memory-core/index.ts) | 메모리 플러그인 예시 |
| [extensions/memory-lancedb/index.ts](../../extensions/memory-lancedb/index.ts) | LanceDB 백엔드 예시 |
| [extensions/discord/index.ts](../../extensions/discord/index.ts) | 채널 플러그인 예시 |

### 3.2 웹 UI 참조

| 파일 | 설명 |
|------|------|
| [ui/src/ui/app.ts](../../ui/src/ui/app.ts) | 메인 앱 컴포넌트 |
| [ui/src/ui/views/chat.ts](../../ui/src/ui/views/chat.ts) | 채팅 뷰 |
| [ui/src/ui/controllers/chat.ts](../../ui/src/ui/controllers/chat.ts) | 채팅 컨트롤러 |
| [ui/src/ui/gateway.ts](../../ui/src/ui/gateway.ts) | 게이트웨이 클라이언트 |

### 3.3 타입 정의

| 파일 | 설명 |
|------|------|
| [src/plugins/types.ts](../../src/plugins/types.ts) | 플러그인 타입 |
| [src/plugins/runtime/types.ts](../../src/plugins/runtime/types.ts) | 런타임 타입 |
| [src/channels/plugins/types.plugin.ts](../../src/channels/plugins/types.plugin.ts) | 채널 플러그인 타입 |

### 3.4 사용자 설계 문서

| 파일 | 설명 |
|------|------|
| [my-docs/CLAUDE.md](../../my-docs/CLAUDE.md) | 프론트엔드 설계 |
| [my-docs/memory_architecture.md](../../my-docs/memory_architecture.md) | 메모리 아키텍처 |
| [my-docs/q.md](../../my-docs/q.md) | 파이프라인 구현 |

---

## 4. 기술 스택 요약

### 4.1 백엔드 (플러그인)

| 항목 | 기술 |
|------|------|
| 언어 | TypeScript (ESM) |
| 런타임 | Node.js 22+ / Bun |
| 타입 검증 | Idris2 |
| 메타데이터 DB | DuckDB |
| 벡터 DB | LanceDB |
| LLM | Anthropic Claude API |

### 4.2 프론트엔드 (웹 UI)

| 항목 | 기술 |
|------|------|
| 프레임워크 | Next.js 15 (App Router) |
| UI 라이브러리 | shadcn/ui |
| 스타일링 | Tailwind CSS |
| 상태 관리 | Jotai |
| 데이터 페칭 | TanStack Query |
| 언어 | TypeScript (Strict) |

### 4.3 시스템 요구사항

| 항목 | 요구사항 |
|------|----------|
| Node.js | 22+ |
| Idris2 | 설치 필요 |
| OpenClaw | >= 2026.1.26 |
| 디스크 | 충분한 공간 (LanceDB) |

---

## 5. 주의사항

### 5.1 플러그인 의존성

- `dependencies`에 런타임 의존성 명시
- `peerDependencies`에 openclaw 명시
- `devDependencies`에 `openclaw: "workspace:*"` (개발용)

### 5.2 Idris2 설치

Idris2 컴파일러가 필요합니다:

```bash
# macOS
brew install idris2

# Linux (pack)
git clone https://github.com/stefan-hoeck/idris2-pack
cd idris2-pack && make install

# 확인
idris2 --version
```

### 5.3 임베딩 모델

q.md에서 `intfloat/multilingual-e5-base` 사용. 대안:

- OpenAI `text-embedding-3-small`
- Sentence Transformers (로컬)
- Ollama (로컬)

### 5.4 Next.js 서빙

OpenClaw 게이트웨이에서 Next.js 앱 서빙 방법:

1. **빌드 후 정적 서빙**: `next build && next export` → 정적 파일 서빙
2. **프록시**: Next.js 개발 서버 프록시
3. **내장**: Next.js 서버 통합 (복잡)

권장: 옵션 1 (빌드 후 정적 서빙)
