# AxiomMind Plugin - Handoff Document

## 프로젝트 개요

OpenClaw용 커스텀 채팅 UI + Memory Graduation Pipeline 플러그인

- **플러그인 위치**: `extensions/axiommind/`
- **웹 UI 위치**: `extensions/axiommind/web/`
- **문서**: `specs/axiommind/` (spec.md, plan.md, context.md)

## 현재 상태

### Memory Graduation Pipeline 레벨

| 레벨 | 이름 | 구현 상태 | 설명 | 승격 조건 |
|------|------|----------|------|----------|
| L0 | Raw Data | ✅ 완료 | 대화에서 정보 추출 (LLM Extractor) | 자동 |
| L1 | Working Memory | ✅ 완료 | Idris 코드 생성 + DuckDB 저장 | L0 완료 시 |
| L2 | Candidate | ❌ 미구현 | Idris2 타입 체크 통과 | `compile_status = 'success'` |
| L3 | Verified | ❌ 미구현 | 추가 검증 통과 | 아래 참고 |
| L4 | Certified | ❌ 미구현 | 장기 안정 메모리 | 아래 참고 |

#### 제안된 Graduation 로직 (미구현)

```
L1 → L2 (Candidate):
  - Idris2 타입 체크 통과 시 자동 승격
  - compile_status = 'success' 일 때

L2 → L3 (Verified):
  - 같은 정보가 여러 세션에서 반복 확인될 때
  - 사용자가 명시적으로 확인할 때 (UI 버튼)
  - 일정 시간(예: 7일) 경과 후 자동 승격

L3 → L4 (Certified):
  - 30일 이상 변경 없이 유지
  - 다른 Verified 메모리와 일관성 유지
  - 사용자가 중요하다고 표시
```

### 완료된 작업

1. **플러그인 스캐폴딩**
   - `openclaw.plugin.json` - 플러그인 매니페스트 (id: "plugin-axiommind")
   - `package.json` - 의존성 정의
   - `index.ts` - 플러그인 진입점
   - `.gitignore` - 빌드 파일 제외

2. **Memory Pipeline (TypeScript)**
   - `memory-pipeline/types.ts` - MemorySchema 타입 정의 (MemoryStage 포함하나 미사용)
   - `memory-pipeline/extractor.ts` - LLM Session Extractor
   - `memory-pipeline/idris-generator.ts` - JSON → .idr 생성
   - `memory-pipeline/validator.ts` - Idris2 컴파일러 호출 (없으면 스킵)
   - `memory-pipeline/indexer.ts` - DuckDB 인덱싱 (⚠️ memory_stage 컬럼 없음)
   - `memory-pipeline/search.ts` - 키워드 검색
   - `memory-pipeline/orchestrator.ts` - 파이프라인 오케스트레이터 + EventEmitter
   - `memory-pipeline/tools.ts` - 에이전트 도구 (axiom_search, axiom_recall, axiom_save)

3. **API 레이어**
   - `api/routes.ts` - REST API 라우터 (/ax/api/*)
   - `api/static.ts` - Next.js 정적 파일 서빙
   - `api/auth.ts` - 토큰 인증 (localhost 우회 포함)

4. **Next.js 웹 UI** ✅ (2026-01-31 업데이트)
   - App Router 구조 (app/layout.tsx, app/page.tsx)
   - **채팅 기능 완성:**
     - `chat.send` 메서드 사용 (올바른 게이트웨이 프로토콜)
     - `chat` 이벤트 처리 (delta, final, aborted, error)
     - `agent` 이벤트 처리 (tool 진행 상황)
     - 스트리밍 응답 실시간 표시
     - 도구 호출 상태 표시 (running/done/error)
   - 메모리 패널 (features/memory/*)
   - Jotai 상태 관리, TanStack Query

5. **설정**
   - `~/.openclaw/openclaw.json`에 플러그인 활성화
   - `gateway.controlUi.allowInsecureAuth: true` 추가

### 수정된 주요 파일 (2026-01-31)

#### 메모리 작업 시각화 기능 추가

1. **`features/chat/_stores/chat.ts`**
   - 스트리밍 상태 관리 추가 (chatRunIdAtom, streamingTextAtom)
   - 도구 진행 상태 관리 (toolProgressListAtom)
   - **메모리 작업 상태 관리** (memoryOperationsAtom) ✨ NEW
     - `MemoryOperation` 타입: save/recall/search 작업 추적
     - `MemoryOperationPhase`: extracting → generating → validating → indexing → complete
   - 메시지 업데이트 액션 추가 (updateMessageAtom)
   - 스트리밍 제어 액션들 (startStreamingAtom, updateStreamingDeltaAtom, finishStreamingAtom)
   - 메모리 작업 액션들 (startMemoryOperationAtom, updateMemoryOperationAtom)

2. **`features/chat/_hooks/useGateway.ts`**
   - `chat.send` 메서드 사용 (sessionKey, idempotencyKey 포함)
   - `chat.history` 로드 기능
   - `chat` 이벤트 핸들러 (delta → streaming, final → complete)
   - `agent` 이벤트 핸들러 (tool 진행 상황 추적)
   - **메모리 도구 감지 및 단계 시뮬레이션** ✨ NEW
     - axiom_save, axiom_recall, axiom_search 도구 자동 감지
     - 시간 기반 단계 시뮬레이션 (extracting → generating → validating → indexing)
   - `chat.abort` 실행 중지 기능
   - `sessionKeyRef` 사용으로 stale closure 문제 해결
   - `handleChatEventRef`, `handleAgentEventRef` refs로 이벤트 핸들러 관리

3. **`features/chat/MemoryOperationIndicator.tsx`** ✨ NEW
   - 메모리 저장/검색/조회 과정 실시간 시각화
   - 단계별 진행 바 (체크마크, 스피너, 아이콘)
   - 확장/축소 가능한 상세 정보
   - 완료 시 결과 정보 표시 (세션 ID, 엔트리 수)

4. **`features/chat/MessageList.tsx`**
   - 스트리밍 인디케이터 (점 애니메이션)
   - 도구 진행 상태 표시 (running/done/error 뱃지)
   - **MemoryOperationIndicator 통합** ✨ NEW
   - **마크다운 렌더링** (react-markdown + remark-gfm)
     - 코드 블록, 인라인 코드
     - 링크, 리스트, 테이블
     - 헤딩, 인용문, 구분선
   - **접기/펼치기 가능한 도구 진행 표시**
     - 기본 접힌 상태
     - 요약 헤더 (실행 중/완료 개수 표시)
     - 클릭으로 상세 목록 토글

5. **`features/chat/MessageInput.tsx`**
   - 스트리밍 중 입력 비활성화
   - 중지 버튼 (스트리밍 중)

6. **`features/chat/ChatWindow.tsx`**
   - 세션 키 표시
   - 스트리밍 상태 표시

#### 자동 메모리 시스템 추가

7. **`index.ts`** ✨ NEW
   - `before_agent_start` 훅으로 메모리 시스템 프롬프트 자동 주입
   - 모든 대화에서 자동으로 관련 메모리 검색 지시
   - 중요 정보 자동 저장 지시
   - 사용자 메시지에서 검색 키워드 자동 추출 (불용어 제외)

8. **`memory-pipeline/orchestrator.ts`** ✨ NEW
   - EventEmitter 상속으로 진행 이벤트 발생
   - `emitProgress()` 메서드 추가
   - `searchWithProgress()`, `recallWithProgress()` 메서드 추가
   - 각 파이프라인 단계마다 progress 이벤트 발생

9. **`memory-pipeline/tools.ts`**
   - 도구 출력을 JSON 형식으로 구조화 (프론트엔드 파싱용)

## 게이트웨이 프로토콜 정리

### 메시지 전송
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
```

### 이벤트 수신
```typescript
// chat 이벤트 (스트리밍)
{
  type: "event",
  event: "chat",
  payload: {
    runId: "uuid-...",
    sessionKey: "agent:main:main",
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
    sessionKey: "agent:main:main",
    data: { name: "Bash", input: {...}, output: {...} }
  }
}
```

## 게이트웨이 실행 방법

```bash
# 개발 모드 (로컬 extensions 인식)
cd /Users/namsangboy/workspace/opensource/openclaw
pnpm openclaw gateway run --bind loopback --port 18789 --force

# 로그 확인
tail -f /tmp/openclaw-gateway.log
```

## 웹 UI 빌드

```bash
cd extensions/axiommind/web
npm run build
```

## 접속 URL

- **AxiomMind UI**: http://127.0.0.1:18789/ax/chat?session=agent:main:main
- **Control UI (기본)**: http://127.0.0.1:18789/

## 테스트 방법

1. 게이트웨이가 실행 중인지 확인: `lsof -i :18789`
2. 시크릿 모드에서 접속: http://127.0.0.1:18789/ax/chat?session=agent:main:main
3. 콘솔에서 확인:
   - `Gateway connected` 메시지
   - `[chat event] delta/final` 메시지
   - `[agent event] tool` 메시지

## 남은 작업

### 1. Memory Graduation Pipeline 완성 (핵심)
- [ ] **DB 스키마에 `memory_stage` 컬럼 추가**
  - `indexer.ts`의 entries 테이블에 stage 필드 추가
  - 기본값: 'raw' → Idris 생성 후 'working'
- [ ] **L1 → L2 자동 승격 로직**
  - `compile_status = 'success'` 시 stage를 'candidate'로 업데이트
- [ ] **L2 → L3 승격 로직**
  - 반복 확인 감지 (같은 fact가 여러 세션에서 언급)
  - 시간 기반 자동 승격 (7일 경과)
  - UI에서 수동 승격 버튼
- [ ] **L3 → L4 승격 로직**
  - 30일 안정성 체크
  - 일관성 검증 (다른 verified 메모리와 충돌 없음)
- [ ] **MemoryPanel UI 업데이트**
  - 각 레벨별 메모리 개수 표시
  - 레벨별 메모리 목록 조회
  - 수동 승격/강등 UI

### 2. 채팅 기능 고도화
- [x] 마크다운 렌더링 ✅
- [x] 도구 진행 상태 접기/펼치기 ✅
- [x] 메모리 작업 시각화 ✅
- [ ] 생각 모드 (thinking) 지원
- [ ] 파일 첨부 지원

### 3. 자동 메모리 시스템 개선
- [x] 에이전트 시작 시 메모리 프롬프트 주입 ✅
- [x] 자동 메모리 검색 지시 ✅
- [x] 자동 메모리 저장 지시 ✅
- [ ] `processSessionFromContext` 구현 (세션 종료 시 자동 추출)
- [ ] 메모리 충돌 감지 및 해결

### 4. 코드 정리
- [ ] 하드코딩된 토큰 제거 (환경변수 또는 설정에서 읽기)
- [ ] 에러 핸들링 개선
- [ ] TypeScript 타입 오류 수정 (기존 TS7016, TS7006 등)

## 참고 문서

- `specs/axiommind/spec.md` - 기능 명세서
- `specs/axiommind/plan.md` - 구현 계획
- `specs/axiommind/context.md` - 컨텍스트 문서
- `my-docs/q.md` - Python 메모리 파이프라인 원본
- `my-docs/memory_architecture.md` - Memory Graduation Pipeline 설계
- `my-docs/CLAUDE.md` - Next.js 프론트엔드 가이드
- `ui/src/ui/controllers/chat.ts` - Control UI 채팅 구현 참고

## 주의사항

1. **브라우저 캐시**: 변경사항 테스트 시 시크릿 모드 또는 강제 새로고침 필요
2. **개발 모드 필수**: `pnpm openclaw`로 실행해야 로컬 플러그인 인식
3. **토큰**: 현재 하드코딩된 토큰 사용 중 (`58a362bc29faaeff7c11422bcfeb79c4`)

## 의존성 추가

```bash
cd extensions/axiommind/web
npm install react-markdown remark-gfm
```

---

*Last updated: 2026-01-31*
