# AxiomMind Plugin - Handoff Document

## 프로젝트 개요

OpenClaw용 커스텀 채팅 UI + Memory Graduation Pipeline 플러그인

- **플러그인 위치**: `extensions/axiommind/`
- **웹 UI 위치**: `extensions/axiommind/web/`
- **문서**: `specs/axiommind/` (spec.md, plan.md, context.md)
- **README**: `extensions/axiommind/README.md`

## 현재 상태 (2026-02-01 업데이트)

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
- `index.ts` - 플러그인 진입점
- `.gitignore` - 빌드 파일 제외

#### 2. Memory Pipeline (2026-02-01 완료)

**핵심 파일:**
- `memory-pipeline/types.ts` - MemorySchema 타입 정의 (MemoryStage 포함)
- `memory-pipeline/indexer.ts` - DuckDB 인덱싱
  - ✅ `memory_stage` 컬럼 추가
  - ✅ ON CONFLICT (id) DO UPDATE 문법으로 수정 (INSERT OR REPLACE 버그 해결)
  - ✅ 마이그레이션 로직 (`migrateSchema()`)
- `memory-pipeline/orchestrator.ts` - 파이프라인 오케스트레이터 + EventEmitter
- `memory-pipeline/search.ts` - 키워드 검색 + memory_stage 필터
- `memory-pipeline/tools.ts` - 에이전트 도구 (axiom_search, axiom_recall, axiom_save)

**Graduation Pipeline (NEW):**
- `memory-pipeline/graduation.ts` - 메모리 승격 로직
  - `promoteEntry()` - 수동 승격
  - `checkAutoPromotions()` - 자동 승격 체크
  - `getGraduationStats()` - 레벨별 통계
- `memory-pipeline/conflict-resolver.ts` - 충돌 감지 및 해결
  - 중복 감지 (제목/내용 유사도)
  - 모순 감지 (동일 주제 다른 결론)
  - 해결 전략 (keep_newer, keep_older, merge, delete_both)
- `memory-pipeline/similarity.ts` - 유사도 계산
  - Jaccard similarity
  - 키워드 기반 유사도
- `memory-pipeline/context-extractor.ts` - 컨텍스트 추출
  - `isMemorizable()` - 메모리 저장 대상 판별
  - 키워드 감지 (결정, 계획, 기억해, 중요 등)
- `memory-pipeline/config.ts` - 설정 상수
- `memory-pipeline/errors.ts` - 커스텀 에러 클래스

#### 3. API 레이어 (2026-02-01 확장)

- `api/routes.ts` - REST API 라우터 (/ax/api/*)
  - ✅ `GET /graduation/stats` - 승격 통계
  - ✅ `POST /graduation/promote` - 수동 승격
  - ✅ `GET /conflicts` - 충돌 목록
  - ✅ `POST /conflicts/resolve` - 충돌 해결
- `api/static.ts` - Next.js 정적 파일 서빙
- `api/auth.ts` - 토큰 인증 (localhost 우회 포함)

#### 4. Next.js 웹 UI (2026-02-01 확장)

**채팅 기능:**
- ✅ `chat.send` 메서드 사용 (올바른 게이트웨이 프로토콜)
- ✅ `chat` 이벤트 처리 (delta, final, aborted, error)
- ✅ `agent` 이벤트 처리 (tool 진행 상황)
- ✅ 스트리밍 응답 실시간 표시
- ✅ 도구 호출 상태 표시 (running/done/error)
- ✅ 마크다운 렌더링 (react-markdown + remark-gfm)
- ✅ 접기/펼치기 가능한 도구 진행 표시

**새 컴포넌트 (NEW):**
- `ThinkingModeToggle.tsx` - 생각 모드 토글
- `ThinkingBlock.tsx` - 생각 과정 시각화
- `FileAttachment.tsx` - 파일 첨부 (이미지, 문서)
- `MemoryOperationIndicator.tsx` - 메모리 작업 진행 표시
- `GraduationPipeline.tsx` - 메모리 레벨별 시각화

**상태 관리 (`_stores/chat.ts`):**
- ✅ `MemoryOperation` 타입: save/recall/search 작업 추적
- ✅ `MemoryOperationPhase`: extracting → generating → validating → indexing → complete
- ✅ 첨부 파일 상태 (attachmentsAtom)
- ✅ thinking level 상태

#### 5. Idris 타입 정의 (NEW)

- `idris/src/LongTermMemory/MemorySchema.idr` - 기본 메모리 스키마
- `idris/src/LongTermMemory/GraduationSchema.idr` - Graduation 단계 정의

#### 6. 문서화 (NEW)

- `README.md` - 설치 및 사용 가이드
- `TROUBLESHOOTING.md` - 문제 해결 가이드
- `UI_REVAMP_WALKTHROUGH.md` - UI 개선 내용
- `deploy.sh` - 배포 스크립트

### 수정된 주요 버그

1. **DuckDB INSERT 충돌 (2026-02-01 수정)**
   - 문제: `INSERT OR REPLACE` 사용 시 다중 UNIQUE 제약 조건에서 오류
   - 해결: `ON CONFLICT (id) DO UPDATE SET ...` 문법으로 변경
   - 파일: `memory-pipeline/indexer.ts`

2. **SessionKey Mismatch (2026-02-01 해결)**
   - 문제: Cron 작업이 `agent:main:cron:*` 세션 사용, UI는 `agent:main:main` 사용
   - 해결: axiommind 전용 에이전트 설정 + URL에 `session=agent:axiommind:main` 파라미터
   - 설정: `agents.list`에 axiommind 에이전트 추가

3. **MEMORY.md 파일 없음 (2026-02-01 수정)**
   - 문제: `~/.openclaw/workspace/MEMORY.md` 파일이 없어서 ENOENT 오류
   - 해결: 파일 생성

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

# 3. 배포
./deploy.sh

# 4. 게이트웨이 재시작
pkill -9 -f openclaw-gateway
openclaw gateway run --bind loopback --port 18789 --force
```

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
- [ ] 자동 승격 스케줄러 (백그라운드 작업)
- [ ] 충돌 해결 UI (현재 API만 구현)
- [ ] 메모리 검색 결과 하이라이팅

### 우선순위 중간
- [ ] `processSessionFromContext` 완전 구현 (세션 종료 시 자동 추출)
- [ ] 메모리 편집 UI
- [ ] 메모리 삭제/강등 UI
- [ ] 내보내기/가져오기 기능

### 우선순위 낮음
- [ ] Idris2 컴파일러 자동 설치 스크립트
- [ ] 메모리 시각화 그래프 (관계도)
- [ ] 통계 대시보드

## 데이터 저장 위치

```
~/.openclaw/axiommind/
├── data/
│   └── memory.duckdb          # 메모리 데이터베이스
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

## 주의사항

1. **브라우저 캐시**: 변경사항 테스트 시 강제 새로고침 (Cmd+Shift+R) 필요
2. **세션 분리**: `session=agent:axiommind:main` 파라미터 사용 권장
3. **게이트웨이 재시작**: 플러그인 변경 후 반드시 재시작 필요
4. **localhost 사용**: `127.0.0.1` 대신 `localhost` 사용 권장 (secure context)

---

*Last updated: 2026-02-01*
