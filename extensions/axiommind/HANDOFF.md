# AxiomMind Plugin - Handoff Document

## 프로젝트 개요

OpenClaw용 커스텀 채팅 UI + Memory Graduation Pipeline 플러그인

- **플러그인 위치**: `extensions/axiommind/`
- **웹 UI 위치**: `extensions/axiommind/web/`
- **문서**: `specs/axiommind/` (spec.md, plan.md, context.md)

## 현재 상태

### 완료된 작업

1. **플러그인 스캐폴딩**
   - `openclaw.plugin.json` - 플러그인 매니페스트 (id: "plugin-axiommind")
   - `package.json` - 의존성 정의
   - `index.ts` - 플러그인 진입점
   - `.gitignore` - 빌드 파일 제외

2. **Memory Pipeline (TypeScript)**
   - `memory-pipeline/types.ts` - MemorySchema 타입 정의
   - `memory-pipeline/extractor.ts` - LLM Session Extractor
   - `memory-pipeline/idris-generator.ts` - JSON → .idr 생성
   - `memory-pipeline/validator.ts` - Idris2 컴파일러 호출 (없으면 스킵)
   - `memory-pipeline/indexer.ts` - DuckDB + LanceDB 인덱싱
   - `memory-pipeline/search.ts` - 시맨틱 검색
   - `memory-pipeline/orchestrator.ts` - 파이프라인 오케스트레이터
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

1. **`features/chat/_stores/chat.ts`**
   - 스트리밍 상태 관리 추가 (chatRunIdAtom, streamingTextAtom)
   - 도구 진행 상태 관리 (toolProgressListAtom)
   - 메시지 업데이트 액션 추가 (updateMessageAtom)
   - 스트리밍 제어 액션들 (startStreamingAtom, updateStreamingDeltaAtom, finishStreamingAtom)

2. **`features/chat/_hooks/useGateway.ts`**
   - `chat.send` 메서드 사용 (sessionKey, idempotencyKey 포함)
   - `chat.history` 로드 기능
   - `chat` 이벤트 핸들러 (delta → streaming, final → complete)
   - `agent` 이벤트 핸들러 (tool 진행 상황 추적)
   - `chat.abort` 실행 중지 기능
   - `sessionKeyRef` 사용으로 stale closure 문제 해결
   - `handleChatEventRef`, `handleAgentEventRef` refs로 이벤트 핸들러 관리

3. **`features/chat/MessageList.tsx`**
   - 스트리밍 인디케이터 (점 애니메이션)
   - 도구 진행 상태 표시 (running/done/error 뱃지)
   - **마크다운 렌더링** (react-markdown + remark-gfm)
     - 코드 블록, 인라인 코드
     - 링크, 리스트, 테이블
     - 헤딩, 인용문, 구분선
   - **접기/펼치기 가능한 도구 진행 표시**
     - 기본 접힌 상태
     - 요약 헤더 (실행 중/완료 개수 표시)
     - 클릭으로 상세 목록 토글

4. **`features/chat/MessageInput.tsx`**
   - 스트리밍 중 입력 비활성화
   - 중지 버튼 (스트리밍 중)

5. **`features/chat/ChatWindow.tsx`**
   - 세션 키 표시
   - 스트리밍 상태 표시

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

### 1. 채팅 기능 고도화
- [x] 마크다운 렌더링 ✅
- [x] 도구 진행 상태 접기/펼치기 ✅
- [ ] 생각 모드 (thinking) 지원
- [ ] 파일 첨부 지원

### 2. 메모리 기능 완성
- [ ] 검색 API 테스트
- [ ] 메모리 저장/불러오기 UI

### 3. 코드 정리
- [ ] 하드코딩된 토큰 제거 (환경변수 또는 설정에서 읽기)
- [ ] 에러 핸들링 개선

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
