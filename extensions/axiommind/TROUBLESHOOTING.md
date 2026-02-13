# AxiomMind 트러블슈팅 가이드

## 목차
1. [DB 스키마 관련 이슈](#1-db-스키마-관련-이슈)
2. [플러그인 설치 및 의존성](#2-플러그인-설치-및-의존성)
3. [WebSocket 연결 문제](#3-websocket-연결-문제)
4. [API 경로 문제](#4-api-경로-문제)

---

## 1. DB 스키마 관련 이슈

### 증상
```
Error: Binder Error: Table "entries" does not have a column named "memory_stage"
```

### 원인
- 기존 DuckDB 파일이 새 스키마(memory_stage 등 Graduation Pipeline 컬럼)가 추가되기 전에 생성됨
- `CREATE TABLE IF NOT EXISTS`는 기존 테이블을 수정하지 않음

### 해결책

**방법 1: DB 파일 삭제 후 재생성 (데이터 없을 때)**
```bash
rm -f ~/.openclaw/axiommind/data/memory.duckdb*
pkill -9 -f openclaw-gateway
openclaw gateway run --bind loopback --port 18789 --force
```

**방법 2: 마이그레이션 코드 확인**
`indexer.ts`의 `initialize()` 메서드에서 `migrateSchema()` 호출 확인:
```typescript
async initialize(): Promise<void> {
  await fs.mkdir(path.join(this.dataDir, "data"), { recursive: true });
  this.db = new duckdb.Database(this.dbPath);
  await this.initSchema();
  await this.migrateSchema();  // 이 줄이 있어야 함
}
```

### DB 파일 위치
```
~/.openclaw/axiommind/data/memory.duckdb
~/.openclaw/axiommind/data/memory.duckdb.wal
```

---

## 2. 플러그인 설치 및 의존성

### 증상
```
plugin-axiommind failed to load: Error: Cannot find module '@anthropic-ai/sdk'
```

### 원인
- 플러그인 디렉토리에 npm 의존성이 설치되지 않음
- `npm install --omit=dev`가 불완전하게 실행됨

### 해결책

**플러그인 의존성 명시적 설치:**
```bash
cd ~/.openclaw/extensions/plugin-axiommind
npm install @anthropic-ai/sdk duckdb --save
```

**플러그인 재설치 전체 과정:**
```bash
# 1. 기존 플러그인 설정 정리
cat ~/.openclaw/openclaw.json | jq 'del(.plugins.entries["plugin-axiommind"]) | del(.plugins.installs["plugin-axiommind"])' > /tmp/oc.json && mv /tmp/oc.json ~/.openclaw/openclaw.json

# 2. 플러그인 설치
cd /path/to/openclaw
openclaw plugins install ./extensions/axiommind

# 3. 의존성 설치
cd ~/.openclaw/extensions/plugin-axiommind
npm install @anthropic-ai/sdk duckdb --save

# 4. 게이트웨이 재시작
pkill -9 -f openclaw-gateway
openclaw gateway run --bind loopback --port 18789 --force
```

### 플러그인 파일 위치
- 소스: `extensions/axiommind/`
- 설치됨: `~/.openclaw/extensions/plugin-axiommind/`
- 설정: `~/.openclaw/openclaw.json` (plugins 섹션)

---

## 3. WebSocket 연결 문제

### 증상 1: Secure Context 오류
```
closed before connect ... reason=control ui requires HTTPS or localhost (secure context)
```

### 원인
- `openclaw-control-ui` 클라이언트 ID는 secure context(HTTPS 또는 localhost)를 요구함
- `127.0.0.1`은 secure context로 인식되지 않음

### 해결책
**클라이언트 ID를 `webchat`으로 변경:**

`useGateway.ts`:
```typescript
const params: ConnectParams = {
  minProtocol: 3,
  maxProtocol: 3,
  client: {
    id: "webchat",  // "openclaw-control-ui" 대신 사용
    version: "1.0.0",
    platform: typeof navigator !== "undefined" ? navigator.platform : "web",
    mode: "webchat",
    instanceId: generateUUID(),
  },
  // ...
};
```

### 허용된 클라이언트 ID 목록
(`src/gateway/protocol/client-info.ts` 참조)
- `webchat-ui`
- `openclaw-control-ui` (secure context 필요)
- `webchat` ✅ (권장)
- `cli`
- `gateway-client`
- `openclaw-macos`
- `openclaw-ios`
- `openclaw-android`
- `node-host`
- `test`
- `fingerprint`
- `openclaw-probe`

---

### 증상 2: Token Missing 오류
```
unauthorized ... reason=token_missing
```

### 원인
- WebSocket URL이 하드코딩되어 현재 페이지 호스트와 불일치
- 토큰이 URL에서 제대로 추출되지 않음

### 해결책
**WebSocket URL을 동적으로 결정:**

`useGateway.ts`:
```typescript
// 현재 페이지 기반으로 WebSocket URL 결정
function getWebSocketUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:18789/";
  const { protocol, hostname, port } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
  const wsPort = port || (protocol === "https:" ? "443" : "80");
  return `${wsProtocol}//${hostname}:${wsPort}/`;
}

export function useGateway(options: UseGatewayOptions = {}) {
  const { url = getWebSocketUrl(), autoConnect = true } = options;
  // ...
}
```

---

### 증상 3: Invalid Client ID 오류
```
invalid connect params: at /client/id: must be equal to constant
```

### 원인
- 허용되지 않은 클라이언트 ID 사용

### 해결책
- 위의 "허용된 클라이언트 ID 목록"에서 선택하여 사용

---

## 4. API 경로 문제

### 증상
API 호출이 HTML을 반환하거나 404 오류 발생

### 원인
- 프론트엔드 API 경로와 백엔드 라우터 경로 불일치

### 확인 사항

**프론트엔드 API 경로** (`web/features/memory/_api/queries.ts`):
```typescript
const API_BASE = "/ax/api";  // 올바른 경로
```

**백엔드 라우터** (`api/routes.ts`):
```typescript
const apiPath = path.replace(/^\/ax\/api\/?/, "");  // /ax/api/ 제거
```

**API 테스트:**
```bash
curl -s "http://127.0.0.1:18789/ax/api/graduation/stats?token=YOUR_TOKEN"
# 예상 응답: {"stats":{"raw":0,"working":0,...}}
```

---

## 빠른 진단 명령어

```bash
# 게이트웨이 로그 확인
tail -f /tmp/openclaw-gateway.log

# 게이트웨이 상태 확인
openclaw channels status --probe

# 포트 사용 확인
lsof -i :18789

# API 테스트
curl -s "http://127.0.0.1:18789/ax/api/graduation/stats?token=58a362bc29faaeff7c11422bcfeb79c4"

# 플러그인 상태 확인
cat ~/.openclaw/openclaw.json | jq '.plugins'

# DB 파일 확인
ls -la ~/.openclaw/axiommind/data/
```

---

## 웹 UI 빌드 및 배포

```bash
# 1. 웹 UI 빌드
cd extensions/axiommind/web
npm run build

# 2. 플러그인 디렉토리로 복사
cp -r out ~/.openclaw/extensions/plugin-axiommind/web/

# 3. 게이트웨이 재시작
pkill -9 -f openclaw-gateway
openclaw gateway run --bind loopback --port 18789 --force
```

---

## 접속 URL

```
http://localhost:18789/ax?token=YOUR_GATEWAY_TOKEN
```

**주의:** `127.0.0.1` 대신 `localhost` 사용 권장 (secure context 관련)

---

## 관련 파일 요약

| 파일 | 역할 |
|------|------|
| `memory-pipeline/indexer.ts` | DB 스키마, 마이그레이션 |
| `web/features/chat/_hooks/useGateway.ts` | WebSocket 연결 |
| `web/features/memory/_api/queries.ts` | API 호출 |
| `api/routes.ts` | API 라우팅 |
| `api/static.ts` | 정적 파일 서빙 |
| `index.ts` | 플러그인 진입점 |

---

---

## 5. UI "Generating..." / "Thinking..." 상태가 멈춤

### 증상
- 메시지를 보냈는데 "Generating..." 또는 "Thinking..." 표시만 계속됨
- 게이트웨이 로그에 `chat.send` 관련 기록이 없음
- 에이전트 세션 로그가 업데이트 안 됨

### 원인
1. 브라우저가 오래된 JS 캐시를 사용 중
2. WebSocket 연결이 끊어졌지만 UI가 인식 못함
3. 구버전 useGateway.ts가 실행 중

### 해결책

**방법 1: 브라우저 강제 새로고침**
```
Mac: Cmd + Shift + R
Windows/Linux: Ctrl + Shift + R
```

**방법 2: 새 시크릿/프라이빗 창에서 접속**
```
http://localhost:18789/ax?token=YOUR_TOKEN
```

**방법 3: 브라우저 캐시 완전 삭제 후 재접속**
- 개발자 도구 (F12) → Application → Storage → Clear site data

**방법 4: 웹 UI 재빌드 및 재배포**
```bash
cd extensions/axiommind/web
npm run build
cp -r out ~/.openclaw/extensions/plugin-axiommind/web/
pkill -9 -f openclaw-gateway
openclaw gateway run --bind loopback --port 18789 --force
```

### 디버깅
브라우저 개발자 도구 (F12) → Console에서 확인:
```javascript
// 연결 상태 확인
// 성공 시: "Gateway connected" 로그가 있어야 함
// 실패 시: "Connect failed" 또는 에러 메시지

// 메시지 전송 시:
// 성공: "chat.send response:" 로그
// 실패: "Failed to send message:" 에러
```

---

*마지막 업데이트: 2026-02-01*
