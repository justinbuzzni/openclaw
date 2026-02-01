# AxiomMind - Memory Graduation Pipeline for OpenClaw

OpenClaw용 지능형 메모리 시스템 플러그인. 대화에서 중요한 정보를 자동으로 추출하고, 단계적 검증을 거쳐 장기 메모리로 승격합니다.

## 주요 기능

- **Memory Graduation Pipeline**: 5단계 메모리 승격 시스템 (Raw → Working → Candidate → Verified → Certified)
- **자동 메모리 추출**: 대화에서 사실, 결정, 인사이트, 태스크 자동 추출
- **충돌 감지 및 해결**: 중복/모순 정보 자동 감지
- **커스텀 채팅 UI**: 메모리 작업 시각화, 마크다운 렌더링, 파일 첨부 지원
- **Idris 타입 검증**: 형식 검증을 통한 메모리 무결성 보장 (선택적)

## 설치

### 1. 의존성 설치

```bash
cd extensions/axiommind
npm install

cd web
npm install
```

### 2. 웹 UI 빌드

```bash
cd extensions/axiommind/web
npm run build
```

### 3. 플러그인 설치

```bash
# openclaw 프로젝트 루트에서
openclaw plugins install ./extensions/axiommind
```

### 4. 플러그인 의존성 설치

```bash
cd ~/.openclaw/extensions/plugin-axiommind
npm install @anthropic-ai/sdk duckdb --save
```

### 5. 웹 UI 배포

```bash
cp -r extensions/axiommind/web/out ~/.openclaw/extensions/plugin-axiommind/web/
```

또는 deploy 스크립트 사용:

```bash
cd extensions/axiommind
./deploy.sh
```

## 설정

### 기본 설정

`~/.openclaw/openclaw.json`에 플러그인이 자동으로 추가됩니다:

```json
{
  "plugins": {
    "entries": {
      "plugin-axiommind": {
        "enabled": true
      }
    }
  }
}
```

### 전용 에이전트 설정 (권장)

Cron 작업과의 세션 충돌을 방지하려면 axiommind 전용 에이전트를 설정하세요:

```json
{
  "agents": {
    "list": [
      {
        "id": "axiommind",
        "name": "AxiomMind Memory Agent",
        "model": {
          "primary": "openai-codex/gpt-5.2"
        }
      }
    ]
  }
}
```

## 실행

### 게이트웨이 시작

```bash
# 개발 모드 (로컬 extensions 인식)
cd /path/to/openclaw
pnpm openclaw gateway run --bind loopback --port 18789 --force

# 또는 백그라운드 실행
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
```

### 웹 UI 접속

```
http://localhost:18789/ax?token=YOUR_GATEWAY_TOKEN&session=agent:axiommind:main
```

**URL 파라미터:**
- `token`: 게이트웨이 인증 토큰 (`~/.openclaw/openclaw.json`의 `gateway.auth.token`)
- `session`: 세션 키 (권장: `agent:axiommind:main`)

## 구조

```
extensions/axiommind/
├── index.ts                    # 플러그인 진입점
├── api/
│   ├── routes.ts               # REST API 라우터
│   ├── static.ts               # 정적 파일 서빙
│   └── auth.ts                 # 인증 처리
├── memory-pipeline/
│   ├── orchestrator.ts         # 파이프라인 오케스트레이터
│   ├── indexer.ts              # DuckDB 인덱싱
│   ├── search.ts               # 메모리 검색
│   ├── tools.ts                # 에이전트 도구
│   ├── types.ts                # 타입 정의
│   ├── graduation.ts           # 메모리 승격 로직
│   ├── conflict-resolver.ts    # 충돌 해결
│   ├── context-extractor.ts    # 컨텍스트 추출
│   └── similarity.ts           # 유사도 계산
├── idris/                      # Idris 타입 정의
│   └── src/LongTermMemory/
│       ├── MemorySchema.idr
│       └── GraduationSchema.idr
└── web/                        # Next.js 웹 UI
    ├── app/
    └── features/
        ├── chat/               # 채팅 컴포넌트
        └── memory/             # 메모리 패널
```

## API 엔드포인트

### 메모리 검색
```
GET /ax/api/search?keywords=키워드1,키워드2&types=fact,decision&stages=working,verified
```

### Graduation 통계
```
GET /ax/api/graduation/stats
```

### 수동 승격
```
POST /ax/api/graduation/promote
Content-Type: application/json

{
  "entryId": "entry-id",
  "reason": "user_confirmed"
}
```

### 충돌 목록
```
GET /ax/api/conflicts
```

### 충돌 해결
```
POST /ax/api/conflicts/resolve
Content-Type: application/json

{
  "conflictId": "conflict-id",
  "resolution": "keep_newer"
}
```

## 에이전트 도구

AxiomMind는 세 가지 에이전트 도구를 제공합니다:

| 도구 | 설명 |
|------|------|
| `axiom_search` | 키워드로 메모리 검색 |
| `axiom_recall` | 특정 세션의 메모리 조회 |
| `axiom_save` | 새 메모리 저장 |

## Memory Graduation Pipeline

| 단계 | 이름 | 설명 | 승격 조건 |
|------|------|------|----------|
| L0 | Raw | 대화에서 추출된 원시 정보 | 자동 |
| L1 | Working | DuckDB에 저장됨 | 추출 완료 시 |
| L2 | Candidate | Idris 타입 체크 통과 | `compile_status = 'success'` |
| L3 | Verified | 추가 검증 통과 | 반복 확인 또는 사용자 승인 |
| L4 | Certified | 장기 안정 메모리 | 30일 유지 + 일관성 검증 |

## 데이터 저장 위치

```
~/.openclaw/axiommind/
├── data/
│   └── memory.duckdb          # 메모리 데이터베이스
└── sessions/
    └── YYYY-MM-DD_NN.idr      # Idris 세션 파일
```

## 트러블슈팅

자세한 문제 해결 방법은 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)를 참조하세요.

### 빠른 진단

```bash
# 게이트웨이 상태 확인
openclaw channels status --probe

# 포트 확인
lsof -i :18789

# 로그 확인
tail -f /tmp/openclaw-gateway.log

# DB 파일 확인
ls -la ~/.openclaw/axiommind/data/
```

## 개발

### 웹 UI 개발 모드

```bash
cd extensions/axiommind/web
npm run dev
```

### 플러그인 빌드

```bash
cd extensions/axiommind
npm run build
```

### 변경사항 배포

```bash
./deploy.sh
# 게이트웨이 재시작 필요
pkill -9 -f openclaw-gateway
openclaw gateway run --bind loopback --port 18789 --force
```

## 라이선스

MIT License - OpenClaw 프로젝트의 일부

---

*Last updated: 2026-02-01*
