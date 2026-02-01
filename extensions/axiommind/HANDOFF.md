# AxiomMind Plugin - Handoff Document

## 프로젝트 개요

OpenClaw용 커스텀 채팅 UI + Memory Graduation Pipeline 플러그인

- **플러그인 위치**: `extensions/axiommind/`
- **웹 UI 위치**: `extensions/axiommind/web/`
- **문서**: `specs/axiommind/` (spec.md, plan.md, context.md)
- **README**: `extensions/axiommind/README.md`

## 현재 상태 (2026-02-01 v2.1.1 업데이트)

### v2.0 주요 변경 - Intent-based Memory Retrieval

**문제점 (v1):**
- 매 메시지마다 무거운 memory instruction 주입 (~1K tokens)
- "항상 axiom_search 먼저 호출하라"는 지시로 불필요한 tool call 발생
- 세션 컨텍스트에 이미 있는 정보를 중복 검색

**해결책 (v2):**
- Intent 기반 메모리 검색 (필요할 때만)
- 세션 시작 시 메타데이터만 프리로드
- 시맨틱 캐시로 중복 검색 방지
- 세션 종료 시 자동 메모리 추출

```
v1: 매 메시지 → 무거운 instruction (~1K tokens) → 항상 tool call
v2: 매 메시지 → Intent 분류 → 필요시에만 검색 (~0.3K tokens)
```

### Memory Graduation Pipeline 구현 상태

| 레벨 | 이름 | 구현 상태 | 설명 | 승격 조건 |
|------|------|----------|------|------------|
| L0 | Raw Data | ✅ 완료 | 대화에서 정보 추출 (LLM Extractor) | 자동 |
| L1 | Working Memory | ✅ 완료 | DuckDB 저장 + memory_stage 컬럼 | L0 완료 시 |
| L2 | Candidate | ✅ 완료 | Idris2 타입 체크 통과 | `compile_status = 'success'` |
| L3 | Verified | ✅ 완료 | 추가 검증 통과 | 반복 확인 / 사용자 승인 |
| L4 | Certified | ✅ 완료 | 장기 안정 메모리 | 30일 유지 + 일관성 |

### 완료된 작업

#### 1. 플러그인 기반 (이전 완료)
- `openclaw.plugin.json` - 플러그인 매니페스트
- `package.json` - 의존성 정의
- `index.ts` - 플러그인 진입점 (v2.0 리팩토링)
- `.gitignore` - 빌드 파일 제외

#### 2. Memory Pipeline (2026-02-01 완료)

**핵심 파일:**
- `memory-pipeline/types.ts` - MemorySchema 타입 정의 (MemoryStage 포함)
- `memory-pipeline/indexer.ts` - DuckDB 인덱싱
- `memory-pipeline/orchestrator.ts` - 파이프라인 오케스트레이터 + EventEmitter
- `memory-pipeline/search.ts` - 키워드 검색 + memory_stage 필터
- `memory-pipeline/tools.ts` - 에이전트 도구 (axiom_search, axiom_recall, axiom_save)

**Graduation Pipeline:**
- `memory-pipeline/graduation.ts` - 메모리 승격 로직
- `memory-pipeline/conflict-resolver.ts` - 충돌 감지 및 해결
- `memory-pipeline/similarity.ts` - 유사도 계산
- `memory-pipeline/context-extractor.ts` - 컨텍스트 추출
- `memory-pipeline/config.ts` - 설정 상수
- `memory-pipeline/errors.ts` - 커스텀 에러 클래스

#### 3. v2.0 Intent-based Memory System (2026-02-01 NEW)

**새 파일:**

| 파일 | 설명 |
|------|------|
| `memory-pipeline/intent-router.ts` | Intent 분류 + 스코어링 시스템 |
| `memory-pipeline/memory-tiers.ts` | 3-Tier 메모리 아키텍처 타입 정의 |
| `memory-pipeline/memory-graph.ts` | 그래프 기반 메모리 관리 (multi-hop) |
| `memory-pipeline/semantic-cache.ts` | 시맨틱 유사도 기반 캐싱 |
| `memory-pipeline/safety-filter.ts` | Anti-Creepy 필터 (안전성 검증) |
| `memory-pipeline/message-handler.ts` | 통합 메시지 처리 플로우 |

#### 4. v2.1 추가 기능 (2026-02-01 NEW)

| 파일 | 설명 |
|------|------|
| `memory-pipeline/auto-scheduler.ts` | 자동 승격 스케줄러 (백그라운드 작업) |
| `memory-pipeline/embeddings.ts` | Vector Embedding 모듈 (OpenAI/Cohere/Local) |
| `web/features/memory/ConflictResolver.tsx` | 충돌 해결 UI 컴포넌트 |

**AutoPromotionScheduler:**
```typescript
// 스케줄러 설정
const scheduler = getAutoScheduler(pipeline, {
  promotionCheckInterval: 60 * 60 * 1000, // 1시간
  consolidationInterval: 6 * 60 * 60 * 1000, // 6시간
  graphCleanupInterval: 24 * 60 * 60 * 1000, // 24시간
  enabled: true,
});

// API 엔드포인트 (v2.1.1 테스트 완료 ✅)
GET  /ax/api/scheduler/stats              // 스케줄러 통계
POST /ax/api/scheduler/trigger-promotion  // 수동 승격 트리거
POST /ax/api/scheduler/trigger-consolidation // 수동 통합 트리거
POST /ax/api/scheduler/start              // 스케줄러 시작
POST /ax/api/scheduler/stop               // 스케줄러 중지
```

**API 테스트 결과 (v2.1.1):**
```bash
# 스케줄러 통계 조회
$ curl http://127.0.0.1:18789/ax/api/scheduler/stats
{
  "stats": {
    "lastPromotionCheck": null,
    "lastConsolidation": null,
    "lastGraphCleanup": null,
    "totalPromotions": 0,
    "totalDemotions": 0,
    "totalConsolidations": 0,
    "isRunning": true
  }
}
```

**Vector Embedding:**
```typescript
// 임베딩 매니저 (OpenAI/Cohere/Local 자동 폴백)
const embeddingManager = getEmbeddingManager({
  provider: "openai", // or "cohere" or "local"
  model: "text-embedding-3-small",
  enableFallback: true, // 실패 시 로컬 TF-IDF 사용
});

// 사용 예시
const result = await embeddingManager.embed("커피를 좋아합니다");
const similar = await embeddingManager.findSimilar(query, candidates, 0.7);
const similarity = embeddingManager.cosineSimilarity(vec1, vec2);
```

**Intent 종류 (8가지):**
```typescript
type MemoryIntent =
  | "direct_recall"       // "기억나?", "지난번에 뭐라고 했지?"
  | "preference_query"    // "추천해줘", "뭐 마실까?"
  | "project_resume"      // "그거 이어서", "아까 설계안"
  | "reference_resolve"   // "그거", "저번에 말한 방식"
  | "temporal_query"      // "언제", "얼마나 오래 전에"
  | "multi_hop_query"     // "A가 추천한 B의 C" (관계 추론)
  | "contradiction_check" // "전에는 다르게 말했던 것 같은데"
  | "no_memory_needed";   // 일반 질문
```

**스코어링 요소:**
- explicitness: 명시적 메모리 요청 (0-3)
- anaphora: 지시어 사용 (0-2)
- preference: 선호도 질문 (0-2)
- continuity: 연속성 표현 (0-2)
- temporalSignal: 시간 관련 (0-2)
- multiHopSignal: 관계 추론 (0-2)
- contradictionSignal: 충돌 확인 (0-2)
- sessionSufficiency: 세션 내 답 있으면 감점 (-3-0)

**3-Tier 메모리 아키텍처:**
```
Tier 1: Core (In-Context) - 항상 접근 가능
├── UserProfile (압축된 프로필)
├── RecentFacts (최근 사실 5-10개)
└── ActiveProjects (활성 프로젝트)

Tier 2: Recall (Searchable) - 시맨틱 검색
├── Episodic (세션별 에피소드)
├── Semantic (추출된 사실)
└── Relations (메모리 그래프)

Tier 3: Archival (Long-term) - 필요시 복원
├── ConsolidatedMemories (통합된 메모리)
└── RawSessions (압축된 원본)
```

**Safety Filter (Anti-Creepy):**
```typescript
type MemoryUseAction = "use" | "confirm" | "soft_hint" | "skip";

// 예시:
// 'use': "커피 좋아하시니까 카페인 관련 조언 드릴게요."
// 'soft_hint': "혹시 아직도 커피 좋아하시나요? 그렇다면..."
// 'confirm': "예전에 커피 좋아한다고 하셨던 것 같은데, 지금도 그러세요?"
// 'skip': (민감정보, 관련 없음 → 언급 안 함)
```

#### 4. API 레이어

- `api/routes.ts` - REST API 라우터 (/ax/api/*)
  - ✅ `GET /graduation/stats` - 승격 통계
  - ✅ `POST /graduation/promote` - 수동 승격
  - ✅ `GET /conflicts` - 충돌 목록
  - ✅ `POST /conflicts/resolve` - 충돌 해결
- `api/static.ts` - Next.js 정적 파일 서빙
- `api/auth.ts` - 토큰 인증 (localhost 우회 포함)

#### 5. Next.js 웹 UI

**채팅 기능:**
- ✅ `chat.send` 메서드 사용 (올바른 게이트웨이 프로토콜)
- ✅ `chat` 이벤트 처리 (delta, final, aborted, error)
- ✅ `agent` 이벤트 처리 (tool 진행 상황)
- ✅ 스트리밍 응답 실시간 표시
- ✅ 도구 호출 상태 표시 (running/done/error)
- ✅ 마크다운 렌더링 (react-markdown + remark-gfm)

**컴포넌트:**
- `ThinkingModeToggle.tsx` - 생각 모드 토글
- `ThinkingBlock.tsx` - 생각 과정 시각화
- `FileAttachment.tsx` - 파일 첨부 (이미지, 문서)
- `MemoryOperationIndicator.tsx` - 메모리 작업 진행 표시
- `GraduationPipeline.tsx` - 메모리 레벨별 시각화

#### 6. Idris 타입 정의

- `idris/src/LongTermMemory/MemorySchema.idr` - 기본 메모리 스키마
- `idris/src/LongTermMemory/GraduationSchema.idr` - Graduation 단계 정의

### 수정된 주요 버그

1. **Plugin API 이벤트 오류 (2026-02-01 v2.1.1 수정)**
   - 문제: `api.on("shutdown")`, `api.on("session_start")` 사용 시 TypeScript 오류
   - 원인: Plugin API는 `before_agent_start`, `session_end`, `agent_end`만 지원
   - 해결:
     - `shutdown` → `process.on("SIGTERM/SIGINT")` 사용
     - `session_start` → `before_agent_start`에서 lazy-load 처리

2. **설치된 플러그인 버전 불일치 (2026-02-01 v2.1.1 수정)**
   - 문제: 게이트웨이가 `~/.openclaw/extensions/plugin-axiommind/dist`의 구버전 사용
   - 해결: 빌드 후 `cp -r dist/* ~/.openclaw/extensions/plugin-axiommind/dist/` 필요
   - 향후: deploy.sh 스크립트에 자동 복사 추가 예정

3. **DuckDB SQL 호환성 문제 (2026-02-01 수정 완료 ✅)**
   - 문제 1: `datetime('now', '-7 days')` SQLite 문법이 DuckDB에서 작동 안 함
   - 해결 1: `current_timestamp - interval '7 days'` DuckDB 문법으로 변경
   - 문제 2: `CURRENT_TIMESTAMP`가 컬럼명으로 인식됨
   - 해결 2: `now()` DuckDB 함수로 변경
   - 문제 3: `COUNT(*)`, `MAX()` 등이 BigInt 반환 → Node.js 크래시
   - 해결 3: `CAST(COUNT(*) AS INTEGER)` 로 명시적 변환
   - 수정 파일: `indexer.ts`, `graduation.ts`, `conflict-resolver.ts`, `similarity.ts`, `memory-graph.ts`, `auto-scheduler.ts`

4. **DuckDB INSERT 충돌 (2026-02-01 수정)**
   - 문제: `INSERT OR REPLACE` 사용 시 다중 UNIQUE 제약 조건에서 오류
   - 해결: `ON CONFLICT (id) DO UPDATE SET ...` 문법으로 변경

2. **SessionKey Mismatch (2026-02-01 해결)**
   - 문제: Cron 작업이 `agent:main:cron:*` 세션 사용, UI는 `agent:main:main` 사용
   - 해결: axiommind 전용 에이전트 설정 + URL에 `session=agent:axiommind:main` 파라미터

3. **과도한 메모리 검색 (2026-02-01 v2.0 해결)**
   - 문제: 매 메시지마다 무조건 axiom_search 호출
   - 해결: Intent 기반 검색으로 필요시에만 호출

## 아키텍처 (v2.0)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Message Flow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Message                                                    │
│       ↓                                                          │
│  ┌─────────────────┐                                            │
│  │  Intent Router  │ ← classifyIntent() + calculateMemoryScore()│
│  └────────┬────────┘                                            │
│           ↓                                                      │
│  ┌─────────────────┐                                            │
│  │ Action Decision │ → skip / cache_check / search / graph      │
│  └────────┬────────┘                                            │
│           ↓                                                      │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ Semantic Cache  │ ←→ │  Memory Graph   │                     │
│  └────────┬────────┘    └─────────────────┘                     │
│           ↓                                                      │
│  ┌─────────────────┐                                            │
│  │  Safety Filter  │ → use / confirm / soft_hint / skip         │
│  └────────┬────────┘                                            │
│           ↓                                                      │
│  ┌─────────────────┐                                            │
│  │ Light Context   │ → 경량 컨텍스트 생성 (~300 tokens)          │
│  └─────────────────┘                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Session Lifecycle                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Session Start                                                   │
│       ↓                                                          │
│  ┌─────────────────┐                                            │
│  │ Preload Meta    │ ← 메타데이터만 로드 (본문 X)                 │
│  └─────────────────┘                                            │
│       ↓                                                          │
│  [... 대화 진행 ...]                                             │
│       ↓                                                          │
│  Session End                                                     │
│       ↓                                                          │
│  ┌─────────────────┐                                            │
│  │ Auto Extract    │ → processSessionFromContext()              │
│  └─────────────────┘                                            │
│       ↓                                                          │
│  ┌─────────────────┐                                            │
│  │ Graduation      │ → L1 → L2 (Idris 검증 시)                   │
│  │ Pipeline        │                                            │
│  └─────────────────┘                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 게이트웨이 프로토콜 정리

### 메시지 전송
```typescript
// chat.send 요청
{
  type: "req",
  id: "req-1",
  method: "chat.send",
  params: {
    sessionKey: "agent:axiommind:main",
    message: "안녕하세요",
    idempotencyKey: "uuid-...",
    deliver: false
  }
}
```

### 이벤트 수신
```typescript
// chat 이벤트 (스트리밍)
{
  type: "event",
  event: "chat",
  payload: {
    runId: "uuid-...",
    sessionKey: "agent:axiommind:main",
    state: "delta" | "final" | "aborted" | "error",
    message: { role: "assistant", content: [...], timestamp: ... },
    errorMessage?: "..."
  }
}

// agent 이벤트 (도구 진행)
{
  type: "event",
  event: "agent",
  payload: {
    runId: "uuid-...",
    stream: "tool" | "assistant" | "lifecycle",
    sessionKey: "agent:axiommind:main",
    data: { name: "axiom_save", input: {...}, output: {...} }
  }
}
```

## 설치 및 실행

### 빠른 설치

```bash
# 1. 의존성 설치
cd extensions/axiommind && npm install
cd web && npm install

# 2. 웹 UI 빌드
npm run build

# 3. 설치된 플러그인에 dist 복사 (중요!)
cp -r dist/* ~/.openclaw/extensions/plugin-axiommind/dist/

# 4. 배포
./deploy.sh

# 5. 게이트웨이 재시작
pkill -9 -f openclaw-gateway
openclaw gateway run --bind loopback --port 18789 --force
```

> **주의**: 빌드 후 반드시 `~/.openclaw/extensions/plugin-axiommind/dist/`에 복사해야 함.
> 게이트웨이는 설치된 플러그인 경로를 우선 로드하므로 소스 dist만 빌드하면 반영 안 됨.

### 접속 URL

```
http://localhost:18789/ax?token=YOUR_TOKEN&session=agent:axiommind:main
```

**중요**: `session=agent:axiommind:main` 파라미터 필수 (Cron 세션과 분리)

### 전용 에이전트 설정

`~/.openclaw/openclaw.json`:
```json
{
  "agents": {
    "list": [
      {
        "id": "axiommind",
        "name": "AxiomMind Memory Agent",
        "model": { "primary": "openai-codex/gpt-5.2" }
      }
    ]
  }
}
```

## 남은 작업

### 우선순위 높음
- [x] ~~자동 승격 스케줄러~~ (v2.1 완료 - auto-scheduler.ts)
- [x] ~~충돌 해결 UI~~ (v2.1 완료 - ConflictResolver.tsx)
- [x] ~~Vector Embedding 통합~~ (v2.1 완료 - embeddings.ts)

### 우선순위 중간
- [x] ~~Intent 기반 메모리 검색~~ (v2.0 완료)
- [x] ~~Semantic Cache~~ (v2.0 완료)
- [x] ~~Anti-Creepy Filter~~ (v2.0 완료)
- [ ] 메모리 편집 UI
- [ ] 메모리 삭제/강등 UI
- [ ] 내보내기/가져오기 기능

### 우선순위 낮음
- [ ] Idris2 컴파일러 자동 설치 스크립트
- [x] ~~메모리 시각화 그래프~~ (v2.0 memory-graph.ts)
- [x] ~~그래프 시맨틱 검색~~ (v2.1 embeddings 통합)
- [ ] 통계 대시보드
- [ ] 메모리 검색 결과 하이라이팅
- [x] ~~DuckDB SQL 호환성 수정~~ (v2.1.1 완료 - datetime → interval 문법)

## 데이터 저장 위치

```
~/.openclaw/axiommind/
├── data/
│   └── memory.duckdb          # 메모리 데이터베이스
│       ├── sessions           # 세션 테이블
│       ├── entries            # 엔트리 테이블
│       ├── memory_nodes       # 그래프 노드 (v2.0)
│       ├── memory_edges       # 그래프 엣지 (v2.0)
│       ├── promotion_history  # 승격 이력
│       └── conflicts          # 충돌 기록
└── sessions/
    └── YYYY-MM-DD_NN.idr      # Idris 세션 파일

~/.openclaw/workspace/
└── MEMORY.md                  # 워크스페이스 메모리 파일
```

## 참고 문서

- `README.md` - 설치 및 사용 가이드
- `TROUBLESHOOTING.md` - 문제 해결 가이드
- `specs/axiommind/spec.md` - 기능 명세서
- `specs/axiommind/plan.md` - 구현 계획
- `specs/axiommind/context.md` - 컨텍스트 문서

## 참고 연구

v2.0 설계에 참고한 연구/프로젝트:
- [MemGPT](https://arxiv.org/abs/2310.08560) - 2-Tier 메모리 아키텍처
- [Mem0](https://arxiv.org/abs/2504.19413) - 그래프 기반 메모리
- [Supermemory](https://supermemory.ai/research) - Temporal + Relational 메모리
- [Semantic Caching](https://redis.io/blog/what-is-semantic-caching/) - 비용 최적화

## 주의사항

1. **브라우저 캐시**: 변경사항 테스트 시 강제 새로고침 (Cmd+Shift+R) 필요
2. **세션 분리**: `session=agent:axiommind:main` 파라미터 사용 권장
3. **게이트웨이 재시작**: 플러그인 변경 후 반드시 재시작 필요
4. **localhost 사용**: `127.0.0.1` 대신 `localhost` 사용 권장 (secure context)

## 성능 예상 (v2.1)

| 시나리오 | v1 | v2.0 | v2.1 | 개선율 |
|---------|-----|------|------|--------|
| 일반 대화 (메모리 불필요) | ~2초 | ~0.5초 | ~0.5초 | 75% ↓ |
| 캐시 히트 (Jaccard) | N/A | ~100ms | ~80ms | - |
| 캐시 히트 (Vector) | N/A | N/A | ~50ms | 50% ↓ |
| 메모리 검색 필요 | ~3초 | ~1.5초 | ~1.2초 | 60% ↓ |
| 시맨틱 검색 (Vector) | N/A | N/A | ~300ms | NEW |
| 토큰 사용량 (평균) | 1.5K/msg | 0.3K/msg | 0.3K/msg | 80% ↓ |

### v2.1 새 기능

| 기능 | 설명 | 성능 |
|------|------|------|
| AutoPromotionScheduler | 백그라운드 승격/통합 | 1시간/6시간/24시간 주기 |
| Vector Embeddings | OpenAI/Cohere/Local 지원 | ~100ms (캐시 히트) |
| Semantic Graph Search | 그래프 노드 시맨틱 검색 | ~200ms (100 노드) |
| Conflict Resolver UI | 충돌 해결 인터페이스 | - |

---

*Last updated: 2026-02-01 (v2.1.1)*
