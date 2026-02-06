
## 핵심 합의점: "상태가 아니라 전이를 타입화하라"

세 답변 모두 같은 결론에 도달합니다:

> **기억 자체를 정적 타입으로 고정하려 하면 실패한다. 대신 기억이 "변하는 방식(연산/이벤트)"을 타입으로 제어하고, 성숙도에 따라 단계적으로 승격시켜라.**

---

## 종합 아키텍처: Memory Graduation Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    MEMORY GRADUATION PIPELINE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   L0: RAW EVENT LOG (불변, append-only)                        │
│   ├─ 세션 로그, 대화, 문서, 결정 기록                           │
│   ├─ 타입 체크 없음, 벡터 임베딩만 (LanceDB)                    │
│   └─ 모든 후속 레이어의 "증거(evidence)"로 기능                 │
│                         ↓                                       │
│   L1: WORKING MEMORY (가변, 자유로움)                           │
│   ├─ 요약, 가설, 임시 정리                                      │
│   ├─ 스키마 없음 or 느슨한 JSON 스키마                          │
│   └─ Context Agent가 실시간 인출용으로 사용                     │
│                         ↓ (패턴 감지: 반복/중요도/결정 영향)    │
│   L2: CANDIDATE SPEC (구조화, 불완전 허용)                      │
│   ├─ 온톨로지/JSON-LD 수준 구조화                               │
│   ├─ Idris hole(?todoProof) 허용 — 증명 미완료 상태             │
│   └─ DuckDB 메타데이터 분석으로 후보 선별                       │
│                         ↓ (검증 게이트: 근거 충분 + 충돌 없음)  │
│   L3: VERIFIED SPEC (검증 완료, 개인 레이어)                    │
│   ├─ Idris 타입 체크 통과                                       │
│   ├─ 불변식(invariant) 만족                                     │
│   └─ 버전 태깅 시작                                             │
│                         ↓ (사용 빈도 + 범용성 충족)             │
│   L4: CERTIFIED SPEC (공통 레이어, 준불변)                      │
│   ├─ 직접 수정 금지 — 새 버전 추가만 허용                       │
│   ├─ Enterprise Base Specs로 기능                               │
│   └─ Decision Ledger에서 역추적 가능                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 핵심 설계 원칙 5가지

### 1. Event Sourcing — "현재 상태는 파생물"

| 원칙          | 설명                               |
| ------------- | ---------------------------------- |
| 진실의 원천   | Raw Event Log (L0)                 |
| 현재 상태     | 이벤트를 fold해서 계산된 결과      |
| 업데이트 방식 | 상태 직접 수정 금지, 이벤트 추가만 |

이렇게 하면 **동적 변화는 이벤트가 담당**하고, **정합성은 이벤트 적용 규칙이 보장**합니다.

### 2. Gradual Typing — "성숙도를 타입으로 표현"

idris

```idris
dataMemoryStage:Type->Typewhere
Raw:a->MemoryStagea-- 미검증
Candidate:a->MemoryStagea-- 구조화, hole 허용
Verified:a->MemoryStagea-- 불변식 통과
Certified:a->Version->MemoryStagea-- 공통 승격
```

**타입이 동적을 죽이는 게 아니라, 동적 상태를 타입의 일부로 흡수**합니다.

### 3. Dependent Types — "타입이 값에 의존"

idris

```idris
Memory:(status:Validity)->Type

-- Unverified 기억은 Decision Ledger 기록 불가
recordDecision:MemoryVerified->DecisionLedger->DecisionLedger
-- ↑ 타입 수준에서 강제됨
```

검증되지 않은 기억이 핵심 시스템에 유입되는 것을 **컴파일 타임에 차단**.

###4. 온톨로지 ↔ 타입의 역할 분리

| 층         | 역할           | 특성                            |
| ---------- | -------------- | ------------------------------- |
| 온톨로지   | 표현력, 확장성 | 런타임 스키마, 변경 가능        |
| Idris 타입 | 무결성, 검증   | 컴파일 산출물, 특정 버전에 고정 |

**버전으로 묶어서 운영**: 온톨로지 v3 ↔ IdrisSpecv3

###5. 승격 게이트 — 자동화의 핵심

```
승격 조건 =(근거 충분)AND(불변식 통과)AND(중복 없음)
```

 **Librarian Agent의 역할** :

* Spec Synthesis: 반복 패턴에서 Idris 코드 자동 생성
* Conflict Detection: 기존 스펙과 충돌 시 `Proof of Contradiction` 생성 → 비동기 큐로 해결
* Lazy Formalization: Hot Data(자주 인출되는 지식)부터 우선 타입화

---

## 운영 규칙 (실무 적용)

1. **L4(Certified)는 직접 수정 금지** — 새 버전 추가만 허용
2. **L1(Working)은 자유롭게** — 단, Raw 이벤트가 근거로 남아야 함
3. **모든 참조는 ID로** — Decision → SpecVersion, Session → EventId
4. **마이그레이션은 함수로** — 스키마 변경 시 변환 로직 명시 및 검증
5. **역방향 강등 허용** — 오래 안 쓰이는 Certified는 Verified로 강등 가능
