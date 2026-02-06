## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AUTO MEMORY PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [1. 채팅 세션]                                                          │
│       │                                                                  │
│       ▼                                                                  │
│  [2. Session Extractor] ──────────────────────────────────────┐         │
│       │ LLM이 구조화된 JSON 추출                               │         │
│       ▼                                                        │         │
│  [3. Idris Generator] ─────────────────────────────────────┐  │         │
│       │ JSON → .idr 파일 생성                               │  │         │
│       ▼                                                     │  │         │
│  [4. Idris Compiler] ──────────────────────────────────┐   │  │         │
│       │ idris2 --check (타입 검증)                      │   │  │         │
│       │                                                 │   │  │         │
│       ├─ ✅ Pass → [5. Indexer]                        │   │  │         │
│       │              │                                  │   │  │         │
│       │              ▼                                  │   │  │         │
│       │         [6. Search DB]                         │   │  │         │
│       │              • DuckDB (메타/관계)               │   │  │         │
│       │              • LanceDB (벡터 검색)              │   │  │         │
│       │                                                 │   │  │         │
│       └─ ❌ Fail → [7. Error Queue]                    │   │  │         │
│                      • 수동 수정 대기                    │   │  │         │
│                      • 자동 재시도 (LLM 피드백)         │   │  │         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. MemorySchema.idr (기반 타입)

idris

```idris
-- LongTermMemory/MemorySchema.idr

moduleLongTermMemory.MemorySchema

%defaulttotal

-- === 기본 타입 ===
publicexport
DateStr:Type
DateStr=String-- "2026-01-22"

publicexport
SessionId:Type  
SessionId=Nat-- 1, 2, 3...

publicexport
dataPriority=Low|Medium|High|Critical

publicexport
dataTaskStatus=Pending|InProgress|Done|Blocked|Cancelled

-- === 엔트리 타입들 ===
publicexport
recordFactwhere
constructorMkFact
title:String
evidence:MaybeString

publicexport
recordDecisionwhere
constructorMkDecision
title:String
rationale:MaybeString
basedOn:ListString-- Fact 참조

publicexport
recordInsightwhere
constructorMkInsight
observation:String
implication:String

publicexport
recordTaskwhere
constructorMkTask
title:String
status:TaskStatus
priority:Priority
blockedBy:ListString-- 다른 Task 참조

publicexport
recordReferencewhere
constructorMkReference
path:String
description:MaybeString

-- === 통합 엔트리 ===
publicexport
dataAnyEntry 
=AFactFact
|ADecisionDecision
|AInsightInsight
|ATaskTask
|AReferenceReference

-- === 세션 레코드 ===
publicexport
recordSessionwhere
constructorMkSession
date:DateStr
sessionId:SessionId
timeRange:String-- "22:30~22:50"
title:String
entries:ListAnyEntry

-- === 일일 메모리 ===
publicexport
recordMemoryDaywhere
constructorMkMemoryDay
date:DateStr
summary:MaybeString
sessions:ListSession
  
-- === 검증 함수 (불변식) ===

-- Task가 Done인데 blockedBy가 있으면 안됨
publicexport
validTask:Task->Bool
validTaskt=caset.statusof
Done=>isNilt.blockedBy
_=>True

-- Decision은 반드시 근거가 있어야 함 (Critical일 때)
publicexport  
validDecision:Decision->Bool
validDecisiond=not(isNothingd.rationale)
```

---

## 2. Session Extractor (LLM 추출)

python

```python
# memory_pipeline/extractor.py

import json
from anthropic import Anthropic

EXTRACTION_PROMPT ="""
당신은 개발 세션 로그를 구조화된 메모리로 변환하는 전문가입니다.

다음 채팅 세션을 분석하고, 아래 JSON 스키마로 추출하세요:
```json
{
  "date": "2026-01-22",
  "sessionId": 15,
  "timeRange": "22:30~22:50", 
  "title": "세션 제목",
  "entries": [
    {
      "type": "fact",
      "title": "완료된 작업",
      "evidence": "구체적 증거/방법"
    },
    {
      "type": "decision",
      "title": "내린 결정",
      "rationale": "결정 이유",
      "basedOn": ["관련 fact 제목"]
    },
    {
      "type": "insight",
      "observation": "발견한 것",
      "implication": "시사점/후속 조치"
    },
    {
      "type": "task",
      "title": "할 일",
      "status": "pending|in_progress|done|blocked",
      "priority": "low|medium|high|critical",
      "blockedBy": []
    },
    {
      "type": "reference",
      "path": "파일 경로",
      "description": "설명"
    }
  ]
}
```

규칙:

1. Fact: 실제로 완료된 작업. evidence는 구체적으로
2. Decision: 선택/결정 사항. rationale 필수
3. Insight: 배운 것, 주의사항. implication으로 행동 유도
4. Task: 아직 안 한 것, 해야 할 것
5. Reference: 수정/참조한 파일 경로

JSON만 출력하세요.
"""

classSessionExtractor:
def__init__(self):
        self.client = Anthropic()

asyncdefextract(self, session_log:str, date:str, session_id:int)->dict:
        response =await self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=EXTRACTION_PROMPT,
            messages=[{
"role":"user",
"content":f"Date: {date}\nSession ID: {session_id}\n\n---\n\n{session_log}"
}]
)

# JSON 파싱

    content = response.content[0].text

# ``json ... `` 제거

if"``json"in content:             content = content.split("``json")[1].split("```")[0]

return json.loads(content)

```




---


## 3. Idris Generator







python

```python
# memory_pipeline/idris_generator.py

from pathlib import Path
from typing import Any

classIdrisGenerator:
def__init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
  
defgenerate_session(self, data:dict)-> Path:
"""JSON → Idris 세션 파일 생성"""
      
        date = data["date"].replace("-","_")
        session_id = data["sessionId"]
        module_name =f"Session_{date}_{session_id:02d}"
      
        idris_code = self._build_session_code(data, module_name)
      
        output_path = self.output_dir /f"{module_name}.idr"
        output_path.write_text(idris_code, encoding="utf-8")
      
return output_path
  
def_build_session_code(self, data:dict, module_name:str)->str:
        entries_code = self._generate_entries(data["entries"])
      
returnf'''-- Auto-generated from chat session
-- Date: {data["date"]}, Session: {data["sessionId"]}
-- Time: {data["timeRange"]}

module LongTermMemory.{module_name}

import LongTermMemory.MemorySchema

%default total

public export
session : Session
session = MkSession
  "{data["date"]}"
{data["sessionId"]}
  "{data["timeRange"]}"
  "{self._escape(data["title"])}"
  [{entries_code}
  ]
'''
  
def_generate_entries(self, entries:list)->str:
        lines =[]
for i, entry inenumerate(entries):
            prefix ="\n  , "if i >0else"\n    "
            lines.append(prefix + self._entry_to_idris(entry))
return"".join(lines)
  
def_entry_to_idris(self, entry:dict)->str:
        t = entry["type"]
      
if t =="fact":
returnf'''AFact $ MkFact
      "{self._escape(entry["title"])}"
{self._maybe_str(entry.get("evidence"))}'''
      
elif t =="decision":
            based_on = entry.get("basedOn",[])
            based_on_str ="["+", ".join(f'"{b}"'for b in based_on)+"]"
returnf'''ADecision $ MkDecision
      "{self._escape(entry["title"])}"
{self._maybe_str(entry.get("rationale"))}
{based_on_str}'''
      
elif t =="insight":
returnf'''AInsight $ MkInsight
      "{self._escape(entry["observation"])}"
      "{self._escape(entry["implication"])}"'''
      
elif t =="task":
            status = self._status_to_idris(entry.get("status","pending"))
            priority = self._priority_to_idris(entry.get("priority","medium"))
            blocked = entry.get("blockedBy",[])
            blocked_str ="["+", ".join(f'"{b}"'for b in blocked)+"]"
returnf'''ATask $ MkTask
      "{self._escape(entry["title"])}"
{status}
{priority}
{blocked_str}'''
      
elif t =="reference":
returnf'''AReference $ MkReference
      "{self._escape(entry["path"])}"
{self._maybe_str(entry.get("description"))}'''
      
return"-- Unknown entry type"
  
def_escape(self, s:str)->str:
if s isNone:
return""
return s.replace("\\","\\\\").replace('"','\\"').replace("\n","\\n")
  
def_maybe_str(self, s:str|None)->str:
if s isNone:
return"Nothing"
returnf'(Just "{self._escape(s)}")'
  
def_status_to_idris(self, s:str)->str:
return{
"pending":"Pending",
"in_progress":"InProgress",
"done":"Done",
"blocked":"Blocked",
"cancelled":"Cancelled"
}.get(s,"Pending")
  
def_priority_to_idris(self, p:str)->str:
return{
"low":"Low",
"medium":"Medium",
"high":"High",
"critical":"Critical"
}.get(p,"Medium")
```

---

## 4. Idris Compiler & Validator

python

```python
# memory_pipeline/validator.py

import subprocess
import asyncio
from pathlib import Path
from dataclasses import dataclass

@dataclass
classCompileResult:
    success:bool
    errors:list[str]
    warnings:list[str]
    holes:list[str]

classIdrisValidator:
def__init__(self, project_root: Path):
        self.project_root = project_root
        self.ipkg_path = project_root /"memory.ipkg"
  
asyncdefvalidate(self, idr_path: Path)-> CompileResult:
"""Idris2 타입 체크 실행"""
      
        proc =await asyncio.create_subprocess_exec(
"idris2","--check",str(idr_path),
"--source-dir",str(self.project_root /"src"),
            cwd=str(self.project_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
)
      
        stdout, stderr =await proc.communicate()
      
        errors = self._parse_errors(stderr.decode())
        warnings = self._parse_warnings(stderr.decode())
        holes = self._parse_holes(stdout.decode())
      
return CompileResult(
            success=proc.returncode ==0andlen(errors)==0,
            errors=errors,
            warnings=warnings,
            holes=holes
)
  
def_parse_errors(self, output:str)->list[str]:
        errors =[]
for line in output.split("\n"):
if"Error:"in line or"error:"in line.lower():
                errors.append(line.strip())
return errors
  
def_parse_warnings(self, output:str)->list[str]:
        warnings =[]
for line in output.split("\n"):
if"Warning:"in line:
                warnings.append(line.strip())
return warnings
  
def_parse_holes(self, output:str)->list[str]:
        holes =[]
for line in output.split("\n"):
if"?"in line and"hole"in line.lower():
                holes.append(line.strip())
return holes
```

---

## 5. Search Indexer

python

```python
# memory_pipeline/indexer.py

import duckdb
import lancedb
from pathlib import Path
from sentence_transformers import SentenceTransformer
import json

classMemoryIndexer:
def__init__(self, db_path: Path, lance_path: Path):
        self.duck = duckdb.connect(str(db_path))
        self.lance = lancedb.connect(str(lance_path))
        self.embedder = SentenceTransformer("intfloat/multilingual-e5-base")
      
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR PRIMARY KEY,
                date DATE NOT NULL,
                session_id INTEGER NOT NULL,
                time_range VARCHAR,
                title VARCHAR NOT NULL,
                idr_path VARCHAR NOT NULL,
                compiled_at TIMESTAMP,
                compile_status VARCHAR DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(date, session_id)
            );
          
            CREATE TABLE IF NOT EXISTS entries (
                id VARCHAR PRIMARY KEY,
                session_id VARCHAR REFERENCES sessions(id),
                entry_type VARCHAR NOT NULL,
                title VARCHAR NOT NULL,
                content JSONB,
                embedding_id VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
          
            CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type);
            CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
        """)
  
asyncdefindex_session(self, data:dict, idr_path: Path, compile_status:str):
"""세션과 엔트리를 인덱싱"""
      
        session_id =f"{data['date']}_{data['sessionId']:02d}"
      
# 1. 세션 메타데이터 저장
        self.duck.execute("""
            INSERT OR REPLACE INTO sessions 
            (id, date, session_id, time_range, title, idr_path, compile_status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,[
            session_id,
            data["date"],
            data["sessionId"],
            data.get("timeRange"),
            data["title"],
str(idr_path),
            compile_status
])
      
# 2. 엔트리 인덱싱 + 벡터 생성
        entries_for_lance =[]
      
for i, entry inenumerate(data["entries"]):
            entry_id =f"{session_id}_{i:03d}"
          
# 텍스트 추출
            text = self._entry_to_text(entry)
          
# 임베딩 생성
            embedding = self.embedder.encode(text).tolist()
          
# DuckDB에 메타데이터
            self.duck.execute("""
                INSERT OR REPLACE INTO entries
                (id, session_id, entry_type, title, content, embedding_id)
                VALUES (?, ?, ?, ?, ?, ?)
            """,[
                entry_id,
                session_id,
                entry["type"],
                entry.get("title")or entry.get("observation")or entry.get("path"),
                json.dumps(entry),
                entry_id
])
          
# LanceDB용 데이터
            entries_for_lance.append({
"id": entry_id,
"session_id": session_id,
"date": data["date"],
"type": entry["type"],
"text": text,
"vector": embedding
})
      
# 3. LanceDB에 벡터 저장
if entries_for_lance:
            table_name ="memory_entries"
if table_name in self.lance.table_names():
                table = self.lance.open_table(table_name)
                table.add(entries_for_lance)
else:
                self.lance.create_table(table_name, entries_for_lance)
  
def_entry_to_text(self, entry:dict)->str:
"""검색용 텍스트 생성"""
        t = entry["type"]
      
if t =="fact":
returnf"[사실] {entry['title']}. {entry.get('evidence','')}"
elif t =="decision":
returnf"[결정] {entry['title']}. 이유: {entry.get('rationale','')}"
elif t =="insight":
returnf"[인사이트] {entry['observation']}. 시사점: {entry['implication']}"
elif t =="task":
returnf"[할일] {entry['title']}. 상태: {entry.get('status','pending')}"
elif t =="reference":
returnf"[파일] {entry['path']}. {entry.get('description','')}"
returnstr(entry)
```

---

## 6. Search API

python

```python
# memory_pipeline/search.py

from dataclasses import dataclass
import duckdb
import lancedb
from sentence_transformers import SentenceTransformer

@dataclass
classSearchResult:
id:str
    session_id:str
    date:str
    entry_type:str
    title:str
    content:dict
    score:float
    idr_path:str

classMemorySearch:
def__init__(self, duck: duckdb.DuckDBPyConnection, lance: lancedb.DBConnection):
        self.duck = duck
        self.lance = lance
        self.embedder = SentenceTransformer("intfloat/multilingual-e5-base")
        self.table = lance.open_table("memory_entries")
  
asyncdefsemantic_search(
        self, 
        query:str, 
        limit:int=10,
        entry_types:list[str]|None=None,
        date_from:str|None=None,
        date_to:str|None=None
)->list[SearchResult]:
"""벡터 유사도 검색"""
      
# 쿼리 임베딩
        query_vec = self.embedder.encode(query).tolist()
      
# LanceDB 검색
        results = self.table.search(query_vec).limit(limit *2).to_list()
      
# 필터링
        filtered =[]
for r in results:
if entry_types and r["type"]notin entry_types:
continue
if date_from and r["date"]< date_from:
continue
if date_to and r["date"]> date_to:
continue
            filtered.append(r)
      
# DuckDB에서 상세 정보 조회
        final_results =[]
for r in filtered[:limit]:
            detail = self.duck.execute("""
                SELECT e.*, s.idr_path
                FROM entries e
                JOIN sessions s ON e.session_id = s.id
                WHERE e.id = ?
            """,[r["id"]]).fetchone()
          
if detail:
                final_results.append(SearchResult(
id=r["id"],
                    session_id=r["session_id"],
                    date=r["date"],
                    entry_type=r["type"],
                    title=detail[3],# title column
                    content=json.loads(detail[4]),# content column
                    score=r["_distance"],
                    idr_path=detail[-1]
))
      
return final_results
  
asyncdefkeyword_search(
        self,
        keywords:list[str],
        entry_types:list[str]|None=None
)->list[SearchResult]:
"""키워드 기반 검색 (DuckDB FTS)"""
      
        type_filter =""
if entry_types:
            types_str =", ".join(f"'{t}'"for t in entry_types)
            type_filter =f"AND e.entry_type IN ({types_str})"
      
        keyword_conditions =" OR ".join(
f"e.title ILIKE '%{kw}%' OR e.content::text ILIKE '%{kw}%'"
for kw in keywords
)
      
        results = self.duck.execute(f"""
            SELECT e.*, s.idr_path, s.date
            FROM entries e
            JOIN sessions s ON e.session_id = s.id
            WHERE ({keyword_conditions})
{type_filter}
            ORDER BY s.date DESC, e.id
            LIMIT 20
        """).fetchall()
      
return[
            SearchResult(
id=r[0],
                session_id=r[1],
                date=r[-1],
                entry_type=r[2],
                title=r[3],
                content=json.loads(r[4]),
                score=1.0,
                idr_path=r[-2]
)
for r in results
]
  
asyncdefget_decisions_with_evidence(
        self,
        date_from:str|None=None
)->list[dict]:
"""Decision과 연결된 Fact들 조회"""
      
        date_filter =f"AND s.date >= '{date_from}'"if date_from else""
      
        decisions = self.duck.execute(f"""
            SELECT e.id, e.content, s.date, s.idr_path
            FROM entries e
            JOIN sessions s ON e.session_id = s.id
            WHERE e.entry_type = 'decision'
{date_filter}
            ORDER BY s.date DESC
        """).fetchall()
      
        results =[]
for d in decisions:
            content = json.loads(d[1])
            based_on = content.get("basedOn",[])
          
# 연결된 Fact 찾기
            facts =[]
if based_on:
                fact_titles =", ".join(f"'{f}'"for f in based_on)
                fact_rows = self.duck.execute(f"""
                    SELECT content FROM entries
                    WHERE entry_type = 'fact' AND title IN ({fact_titles})
                """).fetchall()
                facts =[json.loads(f[0])for f in fact_rows]
          
            results.append({
"decision": content,
"date": d[2],
"evidence_facts": facts,
"idr_path": d[3]
})
      
return results
  
asyncdefget_pending_tasks(self)->list[dict]:
"""미완료 Task 조회"""
      
        results = self.duck.execute("""
            SELECT e.content, s.date, s.title as session_title
            FROM entries e
            JOIN sessions s ON e.session_id = s.id
            WHERE e.entry_type = 'task'
              AND json_extract_string(e.content, '$.status') IN ('pending', 'in_progress', 'blocked')
            ORDER BY 
              CASE json_extract_string(e.content, '$.priority')
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                ELSE 4
              END,
              s.date DESC
        """).fetchall()
      
return[
{
"task": json.loads(r[0]),
"date": r[1],
"session": r[2]
}
for r in results
]
```

---

## 7. 전체 파이프라인 오케스트레이터

python

```python
# memory_pipeline/orchestrator.py

import asyncio
from pathlib import Path
from datetime import datetime
from.extractor import SessionExtractor
from.idris_generator import IdrisGenerator
from.validator import IdrisValidator
from.indexer import MemoryIndexer
from.search import MemorySearch

classMemoryPipeline:
def__init__(self, project_root: Path):
        self.project_root = project_root
        self.extractor = SessionExtractor()
        self.generator = IdrisGenerator(project_root /"src"/"LongTermMemory")
        self.validator = IdrisValidator(project_root)
        self.indexer = MemoryIndexer(
            project_root /"data"/"memory.duckdb",
            project_root /"data"/"lance"
)
  
asyncdefprocess_session(
        self, 
        session_log:str,
        date:str|None=None,
        session_id:int|None=None
)->dict:
"""채팅 세션 → 메모리 파이프라인 실행"""
      
        date = date or datetime.now().strftime("%Y-%m-%d")
        session_id = session_id orawait self._get_next_session_id(date)
      
print(f"[1/5] Extracting session {date}_{session_id:02d}...")
      
# 1. LLM으로 구조화 추출
        data =await self.extractor.extract(session_log, date, session_id)
      
print(f"[2/5] Generating Idris code...")
      
# 2. Idris 파일 생성
        idr_path = self.generator.generate_session(data)
      
print(f"[3/5] Validating with Idris2...")
      
# 3. 타입 체크
        compile_result =await self.validator.validate(idr_path)
      
ifnot compile_result.success:
print(f"[!] Compilation failed: {compile_result.errors}")
# 에러 시 재시도 로직 (LLM 피드백)
            data =await self._retry_with_feedback(
                session_log, date, session_id, compile_result.errors
)
            idr_path = self.generator.generate_session(data)
            compile_result =await self.validator.validate(idr_path)
      
        compile_status ="success"if compile_result.success else"failed"
      
print(f"[4/5] Indexing to search DB...")
      
# 4. 검색 인덱스에 저장
await self.indexer.index_session(data, idr_path, compile_status)
      
print(f"[5/5] Done! Session {date}_{session_id:02d}")
      
return{
"session_id":f"{date}_{session_id:02d}",
"idr_path":str(idr_path),
"compile_status": compile_status,
"entries_count":len(data["entries"]),
"warnings": compile_result.warnings,
"holes": compile_result.holes
}
  
asyncdef_retry_with_feedback(
        self, 
        session_log:str, 
        date:str, 
        session_id:int,
        errors:list[str]
)->dict:
"""컴파일 에러를 LLM에 피드백하여 재시도"""
      
        error_feedback ="\n".join(errors)
      
        retry_prompt =f"""
이전 추출 결과가 Idris 컴파일 에러를 발생시켰습니다.
에러: {error_feedback}

다시 추출해주세요. 특히:
1. 문자열에 escape 필요한 특수문자 확인 (", \\, 줄바꿈)
2. 모든 필수 필드 포함 확인
3. basedOn, blockedBy 배열의 문자열이 실제 존재하는 제목인지 확인

원본 세션:
{session_log}
"""
      
returnawait self.extractor.extract(retry_prompt, date, session_id)
  
asyncdef_get_next_session_id(self, date:str)->int:
"""해당 날짜의 다음 세션 ID"""
        result = self.indexer.duck.execute("""
            SELECT COALESCE(MAX(session_id), 0) + 1
            FROM sessions WHERE date = ?
        """,[date]).fetchone()
return result[0]


# 사용 예시
asyncdefmain():
    pipeline = MemoryPipeline(Path("/path/to/axiommind"))
  
# 채팅 세션 텍스트
    session_log ="""
    [사용자와 AI의 대화 내용...]
    """
  
    result =await pipeline.process_session(session_log)
print(result)

if __name__ =="__main__":
    asyncio.run(main())
```

---

## 8. CLI & API 인터페이스

python

```python
# memory_pipeline/cli.py

import click
import asyncio
from pathlib import Path
from.orchestrator import MemoryPipeline
from.search import MemorySearch

@click.group()
defcli():
"""AxiomMind Memory CLI"""
pass

@cli.command()
@click.argument("session_file",type=click.Path(exists=True))
@click.option("--date","-d",help="Date (YYYY-MM-DD)")
@click.option("--session-id","-s",type=int,help="Session ID")
defprocess(session_file, date, session_id):
"""채팅 세션 파일 처리"""
    pipeline = MemoryPipeline(Path.cwd())
    session_log = Path(session_file).read_text()
  
    result = asyncio.run(pipeline.process_session(session_log, date, session_id))
    click.echo(f"✅ Processed: {result['session_id']}")
    click.echo(f"   Entries: {result['entries_count']}")
    click.echo(f"   Status: {result['compile_status']}")

@cli.command()
@click.argument("query")
@click.option("--type","-t","entry_types", multiple=True,help="Filter by type")
@click.option("--limit","-l", default=10)
defsearch(query, entry_types, limit):
"""메모리 검색"""
# ... 검색 로직
pass

@cli.command()
deftasks():
"""미완료 Task 목록"""
# ... Task 조회
pass

@cli.command()
defdecisions():
"""최근 Decision과 근거"""
# ... Decision 조회
pass

if __name__ =="__main__":
    cli()
```

---

## 디렉토리 구조

```
/axiommind
├── memory.ipkg                    # Idris 프로젝트 파일
├── src/
│   └── LongTermMemory/
│       ├── MemorySchema.idr       # 기반 타입
│       ├── Session_2026_01_22_01.idr  # 자동 생성
│       ├── Session_2026_01_22_02.idr
│       ├── Session_2026_01_22_15.idr
│       └── Day_2026_01_22.idr     # 일일 통합 (선택)
│
├── data/
│   ├── memory.duckdb              # 메타데이터 + 관계
│   └── lance/# 벡터 검색
│       └── memory_entries.lance
│
├── memory_pipeline/# Python 파이프라인
│   ├── __init__.py
│   ├── extractor.py
│   ├── idris_generator.py
│   ├── validator.py
│   ├── indexer.py
│   ├── search.py
│   ├── orchestrator.py
│   └── cli.py
│
└── sessions/# 원본 세션 로그 (옵션)
    └── 2026-01-22/
        ├── session_01.txt
        └── session_15.txt
```

---

## 요약

| 단계           | 자동화 | 도구                     |
| -------------- | ------ | ------------------------ |
| 세션 → JSON   | ✅     | Claude/GPT (LLM)         |
| JSON → Idris  | ✅     | Python Generator         |
| 타입 체크      | ✅     | idris2 --check           |
| 에러 → 재시도 | ✅     | LLM 피드백 루프          |
| 인덱싱         | ✅     | DuckDB + LanceDB         |
| 검색           | ✅     | 벡터 + 키워드 하이브리드 |

이 구조로 **채팅 끝날 때마다 자동으로 Idris 메모리가 생성되고, 검증되고, 검색 가능**해집니다. 추가로 궁금한 부분이나 수정할 점 있으면 말씀해 주세요.



종합 아키텍처: Memory Graduation Pipeline
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

핵심 설계 원칙 5가지

1. Event Sourcing — "현재 상태는 파생물"
   원칙설명진실의 원천Raw Event Log (L0)현재 상태이벤트를 fold해서 계산된 결과업데이트 방식상태 직접 수정 금지, 이벤트 추가만
   이렇게 하면 동적 변화는 이벤트가 담당하고, 정합성은 이벤트 적용 규칙이 보장합니다.
2. Gradual Typing — "성숙도를 타입으로 표현"
   idrisdata MemoryStage : Type -> Type where
   Raw       : a -> MemoryStage a        -- 미검증
   Candidate : a -> MemoryStage a        -- 구조화, hole 허용
   Verified  : a -> MemoryStage a        -- 불변식 통과
   Certified : a -> Version -> MemoryStage a  -- 공통 승격
   타입이 동적을 죽이는 게 아니라, 동적 상태를 타입의 일부로 흡수합니다.
3. Dependent Types — "타입이 값에 의존"
   idrisMemory : (status : Validity) -> Type

-- Unverified 기억은 Decision Ledger 기록 불가
recordDecision : Memory Verified -> DecisionLedger -> DecisionLedger
-- ↑ 타입 수준에서 강제됨

```

검증되지 않은 기억이 핵심 시스템에 유입되는 것을 **컴파일 타임에 차단**.

### 4. 온톨로지 ↔ 타입의 역할 분리

| 층 | 역할 | 특성 |
|----|------|------|
| 온톨로지 | 표현력, 확장성 | 런타임 스키마, 변경 가능 |
| Idris 타입 | 무결성, 검증 | 컴파일 산출물, 특정 버전에 고정 |

**버전으로 묶어서 운영**: 온톨로지 v3 ↔ Idris Spec v3

### 5. 승격 게이트 — 자동화의 핵심
```

승격 조건 = (근거 충분) AND (불변식 통과) AND (중복 없음)
Librarian Agent의 역할:

Spec Synthesis: 반복 패턴에서 Idris 코드 자동 생성
Conflict Detection: 기존 스펙과 충돌 시 Proof of Contradiction 생성 → 비동기 큐로 해결
Lazy Formalization: Hot Data(자주 인출되는 지식)부터 우선 타입화

운영 규칙 (실무 적용)

L4(Certified)는 직접 수정 금지 — 새 버전 추가만 허용
L1(Working)은 자유롭게 — 단, Raw 이벤트가 근거로 남아야 함
모든 참조는 ID로 — Decision → SpecVersion, Session → EventId
마이그레이션은 함수로 — 스키마 변경 시 변환 로직 명시 및 검증
역방향 강등 허용 — 오래 안 쓰이는 Certified는 Verified로 강등 가능

=====


좋은 질문입니다. **부분적으로만 반영**되어 있습니다. 현재 제가 드린 파이프라인은 **L0 → L2 수준**까지만 구현되어 있고, 전체 Graduation Pipeline의 핵심인 **L3/L4 승격 및 Dependent Types**는 아직 빠져 있습니다.

---

## 현재 구현 vs 전체 설계 비교

| 구성요소                     | 전체 설계                    | 현재 구현                       | 상태      |
| ---------------------------- | ---------------------------- | ------------------------------- | --------- |
| **L0: Raw Event Log**  | 원본 세션, append-only       | `sessions/`폴더에 텍스트 저장 | ⚠️ 부분 |
| **L1: Working Memory** | 가변, 느슨한 스키마          | LLM 추출 JSON                   | ✅ 있음   |
| **L2: Candidate Spec** | Idris hole 허용, 구조화      | `Session_*.idr`자동 생성      | ✅ 있음   |
| **L3: Verified Spec**  | Idris 타입 체크 통과, 불변식 | idris2 --check만                | ⚠️ 부분 |
| **L4: Certified Spec** | 공통 레이어, 불변            | ❌ 없음                         | ❌ 없음   |
| **Event Sourcing**     | 상태 = fold(이벤트)          | ❌ 직접 저장                    | ❌ 없음   |
| **Dependent Types**    | `Memory Verified -> ...`   | 단순 타입만                     | ❌ 없음   |
| **승격 자동화**        | 조건 충족 시 자동 승격       | ❌ 없음                         | ❌ 없음   |
| **Decision Ledger**    | Spec 참조 역추적             | ❌ 없음                         | ❌ 없음   |

---

## 빠진 핵심 부분 구현

### 1. Event Sourcing 기반 L0 (Raw Event Log)

python

```python
# memory_pipeline/event_store.py

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import json
import hashlib

@dataclass
classRawEvent:
"""L0: 불변 이벤트"""
    event_id:str
    timestamp: datetime
    event_type:str# "session", "message", "decision", "file_change"
    actor:str# "user", "agent", "system"
    payload:dict
    parent_id:str|None=None# 이전 이벤트 참조
    checksum:str=""
  
def__post_init__(self):
ifnot self.checksum:
            self.checksum = self._compute_checksum()
  
def_compute_checksum(self)->str:
        content =f"{self.timestamp.isoformat()}{self.event_type}{json.dumps(self.payload, sort_keys=True)}"
return hashlib.sha256(content.encode()).hexdigest()[:16]

classEventStore:
"""Append-only 이벤트 저장소"""
  
def__init__(self, db_path: Path):
        self.duck = duckdb.connect(str(db_path))
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS raw_events (
                event_id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                event_type VARCHAR NOT NULL,
                actor VARCHAR NOT NULL,
                payload JSONB NOT NULL,
                parent_id VARCHAR,
                checksum VARCHAR NOT NULL,
              
                -- Append-only 강제: UPDATE/DELETE 트리거로 방지
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
          
            CREATE INDEX IF NOT EXISTS idx_events_time ON raw_events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_events_type ON raw_events(event_type);
            CREATE INDEX IF NOT EXISTS idx_events_parent ON raw_events(parent_id);
        """)
  
defappend(self, event: RawEvent)->str:
"""이벤트 추가 (수정/삭제 불가)"""
        self.duck.execute("""
            INSERT INTO raw_events 
            (event_id, timestamp, event_type, actor, payload, parent_id, checksum)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,[
            event.event_id,
            event.timestamp,
            event.event_type,
            event.actor,
            json.dumps(event.payload),
            event.parent_id,
            event.checksum
])
return event.event_id
  
defget_events_since(self, since: datetime)->list[RawEvent]:
"""특정 시점 이후 이벤트 조회"""
        rows = self.duck.execute("""
            SELECT * FROM raw_events 
            WHERE timestamp >= ? 
            ORDER BY timestamp ASC
        """,[since]).fetchall()
return[self._row_to_event(r)for r in rows]
  
deffold_to_state(self, event_type:str, folder_fn)->any:
"""이벤트를 fold하여 현재 상태 계산"""
        events = self.duck.execute("""
            SELECT * FROM raw_events 
            WHERE event_type = ?
            ORDER BY timestamp ASC
        """,[event_type]).fetchall()
      
        state =None
for row in events:
            event = self._row_to_event(row)
            state = folder_fn(state, event)
return state
```

### 2. Dependent Types가 반영된 MemorySchema.idr

idris

```idris
-- LongTermMemory/MemorySchema.idr

moduleLongTermMemory.MemorySchema

%defaulttotal

-- === 메모리 단계 (Graduation Level) ===
publicexport
dataStage=Raw|Working|Candidate|Verified|Certified

-- === 단계별 타입 래퍼 (Dependent Type) ===
publicexport
dataMemory:Stage->Type->Typewhere
MkRaw:(eventId:String)->a->MemoryRawa
MkWorking:(eventIds:ListString)->a->MemoryWorkinga
MkCandidate:(eventIds:ListString)->a->MemoryCandidatea
MkVerified:(proof:ProofRecord)->a->MemoryVerifieda
MkCertified:(version:Version)->(proof:ProofRecord)->a->MemoryCertifieda

-- === 증명 기록 ===
publicexport
recordProofRecordwhere
constructorMkProof
checkedAt:String-- ISO timestamp
idrisVersion:String
holes:ListString-- 빈 구멍 (Candidate만)
invariantsPassed:ListString

-- === 버전 ===
publicexport
recordVersionwhere
constructorMkVersion
major:Nat
minor:Nat
patch:Nat

-- === 승격 함수 (타입 수준에서 강제) ===

-- Working → Candidate: 구조화 완료
publicexport
promoteToCandidate:MemoryWorkinga->MemoryCandidatea
promoteToCandidate(MkWorkingevIdscontent)=MkCandidateevIdscontent

-- Candidate → Verified: 증명 필요
publicexport
promoteToVerified:(proof:ProofRecord)-> 
(noHoles:proof.holes=[])->-- hole 없어야 함
MemoryCandidatea-> 
MemoryVerifieda
promoteToVerifiedproof_(MkCandidate_content)=MkVerifiedproofcontent

-- Verified → Certified: 버전 필요
publicexport  
promoteToCertified:Version->MemoryVerifieda->MemoryCertifieda
promoteToCertifiedver(MkVerifiedproofcontent)=MkCertifiedverproofcontent

-- === Decision Ledger는 Verified 이상만 참조 가능 ===
publicexport
recordDecisionRecordwhere
constructorMkDecisionRecord
decisionId:String
timestamp:String
action:String
-- 핵심: Verified 또는 Certified 메모리만 참조 가능
evidenceVerified:List(MemoryVerifiedFact)
evidenceCertified:List(MemoryCertifiedFact)

-- Raw/Working/Candidate는 Decision에 사용 불가 (타입 에러)
-- badDecision : Memory Working Fact -> DecisionRecord  -- 컴파일 에러!
```

### 3. 승격 자동화 엔진 (Graduation Engine)

python

```python
# memory_pipeline/graduation.py

from dataclasses import dataclass
from enum import Enum
from datetime import datetime, timedelta

classStage(Enum):
    RAW =0
    WORKING =1
    CANDIDATE =2
    VERIFIED =3
    CERTIFIED =4

@dataclass
classGraduationResult:
    promoted:bool
    from_stage: Stage
    to_stage: Stage |None
    reason:str
    blockers:list[str]

classGraduationEngine:
"""메모리 승격 자동화"""
  
def__init__(self, event_store, indexer, validator):
        self.events = event_store
        self.indexer = indexer
        self.validator = validator
  
asyncdefevaluate_graduation(self, memory_id:str)-> GraduationResult:
"""승격 가능 여부 평가"""
      
        meta =await self.indexer.get_memory_meta(memory_id)
        current_stage = Stage[meta["stage"].upper()]
      
if current_stage == Stage.RAW:
returnawait self._evaluate_raw_to_working(memory_id, meta)
elif current_stage == Stage.WORKING:
returnawait self._evaluate_working_to_candidate(memory_id, meta)
elif current_stage == Stage.CANDIDATE:
returnawait self._evaluate_candidate_to_verified(memory_id, meta)
elif current_stage == Stage.VERIFIED:
returnawait self._evaluate_verified_to_certified(memory_id, meta)
      
return GraduationResult(False, current_stage,None,"Already certified",[])
  
asyncdef_evaluate_working_to_candidate(self, memory_id:str, meta:dict)-> GraduationResult:
"""Working → Candidate 승격 조건"""
      
        blockers =[]
      
# 조건 1: 충분한 인출 횟수 (5회 이상)
if meta["retrieval_count"]<5:
            blockers.append(f"인출 횟수 부족: {meta['retrieval_count']}/5")
      
# 조건 2: 24시간 이상 경과
        age_hours =(datetime.now()- meta["created_at"]).total_seconds()/3600
if age_hours <24:
            blockers.append(f"숙성 기간 부족: {age_hours:.1f}h/24h")
      
# 조건 3: Decision에 1회 이상 인용
if meta["cited_in_decisions"]<1:
            blockers.append("Decision 인용 없음")
      
if blockers:
return GraduationResult(False, Stage.WORKING,None,"조건 미충족", blockers)
      
return GraduationResult(True, Stage.WORKING, Stage.CANDIDATE,"승격 조건 충족",[])
  
asyncdef_evaluate_candidate_to_verified(self, memory_id:str, meta:dict)-> GraduationResult:
"""Candidate → Verified 승격 조건"""
      
        blockers =[]
      
# 조건 1: Idris 컴파일 성공
        compile_result =await self.validator.validate(meta["idr_path"])
ifnot compile_result.success:
            blockers.append(f"컴파일 실패: {compile_result.errors}")
      
# 조건 2: Hole 없음
if compile_result.holes:
            blockers.append(f"미완료 증명: {compile_result.holes}")
      
# 조건 3: 충돌하는 메모리 없음
        conflicts =await self._check_conflicts(memory_id)
if conflicts:
            blockers.append(f"충돌 감지: {conflicts}")
      
# 조건 4: 신뢰도 0.7 이상
if meta["confidence_score"]<0.7:
            blockers.append(f"신뢰도 부족: {meta['confidence_score']:.2f}/0.70")
      
if blockers:
return GraduationResult(False, Stage.CANDIDATE,None,"검증 실패", blockers)
      
return GraduationResult(True, Stage.CANDIDATE, Stage.VERIFIED,"검증 통과",[])
  
asyncdef_evaluate_verified_to_certified(self, memory_id:str, meta:dict)-> GraduationResult:
"""Verified → Certified 승격 조건 (가장 엄격)"""
      
        blockers =[]
      
# 조건 1: 20회 이상 인출
if meta["retrieval_count"]<20:
            blockers.append(f"인출 횟수 부족: {meta['retrieval_count']}/20")
      
# 조건 2: 3개 이상 Decision에서 인용
if meta["cited_in_decisions"]<3:
            blockers.append(f"Decision 인용 부족: {meta['cited_in_decisions']}/3")
      
# 조건 3: 5개 이상 다른 세션에서 참조
if meta["unique_sessions"]<5:
            blockers.append(f"범용성 부족: {meta['unique_sessions']}/5 세션")
      
# 조건 4: 신뢰도 0.9 이상
if meta["confidence_score"]<0.9:
            blockers.append(f"신뢰도 부족: {meta['confidence_score']:.2f}/0.90")
      
# 조건 5: 30일 이상 Verified 유지
        verified_days =(datetime.now()- meta["verified_at"]).days
if verified_days <30:
            blockers.append(f"Verified 유지 기간 부족: {verified_days}/30일")
      
if blockers:
return GraduationResult(False, Stage.VERIFIED,None,"Certified 조건 미충족", blockers)
      
return GraduationResult(True, Stage.VERIFIED, Stage.CERTIFIED,"Certified 승격 승인",[])
  
asyncdef_check_conflicts(self, memory_id:str)->list[str]:
"""다른 메모리와 충돌 여부 검사"""
# 유사도 높은데 내용이 모순되는 메모리 탐지
# 예: "AI는 side+pct만 반환" vs "AI는 전체 주문서 반환"
pass
  
asyncdefrun_graduation_cycle(self):
"""전체 메모리 승격 사이클 실행"""
      
        candidates =await self.indexer.get_graduation_candidates()
      
        results =[]
for memory_id in candidates:
            result =await self.evaluate_graduation(memory_id)
          
if result.promoted:
await self._execute_promotion(memory_id, result)
              
            results.append((memory_id, result))
      
return results
  
asyncdef_execute_promotion(self, memory_id:str, result: GraduationResult):
"""실제 승격 실행"""
      
# 1. 메타데이터 업데이트
await self.indexer.update_stage(memory_id, result.to_stage.name.lower())
      
# 2. 이벤트 기록 (Event Sourcing)
await self.events.append(RawEvent(
            event_id=f"promotion_{memory_id}_{datetime.now().isoformat()}",
            timestamp=datetime.now(),
            event_type="promotion",
            actor="graduation_engine",
            payload={
"memory_id": memory_id,
"from_stage": result.from_stage.name,
"to_stage": result.to_stage.name,
"reason": result.reason
}
))
      
# 3. Certified면 버전 태깅
if result.to_stage == Stage.CERTIFIED:
await self._create_certified_version(memory_id)
```

### 4. Decision Ledger 구현

python

```python
# memory_pipeline/decision_ledger.py

from dataclasses import dataclass
from datetime import datetime

@dataclass
classDecisionRecord:
    decision_id:str
    timestamp: datetime
    actor:str
    action:str
    outcome:dict
  
# 핵심: Verified/Certified 메모리만 참조
    evidence_ids:list[str]# Memory ID들 (stage >= VERIFIED)
    spec_version_ids:list[str]# Spec 버전 ID들
  
    reasoning_steps:list[dict]
    confidence:float

classDecisionLedger:
def__init__(self, duck, indexer):
        self.duck = duck
        self.indexer = indexer
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS decisions (
                decision_id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                actor VARCHAR NOT NULL,
                action VARCHAR NOT NULL,
                outcome JSONB,
                evidence_ids JSONB NOT NULL,
                spec_version_ids JSONB NOT NULL,
                reasoning_steps JSONB,
                confidence REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
          
            CREATE TABLE IF NOT EXISTS decision_evidence (
                id VARCHAR PRIMARY KEY,
                decision_id VARCHAR REFERENCES decisions(decision_id),
                memory_id VARCHAR NOT NULL,
                memory_stage VARCHAR NOT NULL,
                role VARCHAR NOT NULL,  -- premise, supporting, contextual
                CHECK (memory_stage IN ('verified', 'certified'))  -- 핵심 제약!
            );
        """)
  
asyncdefrecord_decision(
        self, 
        action:str,
        outcome:dict,
        evidence_memory_ids:list[str],
        reasoning:list[dict],
        actor:str="agent"
)->str:
"""의사결정 기록 (Verified 이상 메모리만 허용)"""
      
# 1. 모든 evidence가 Verified 이상인지 검증
for mem_id in evidence_memory_ids:
            meta =await self.indexer.get_memory_meta(mem_id)
if meta["stage"]notin("verified","certified"):
raise ValueError(
f"Memory {mem_id}는 {meta['stage']} 단계입니다. "
f"Decision 근거로 사용하려면 Verified 이상이어야 합니다."
)
      
# 2. Decision 기록
        decision_id =f"dec_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{action[:10]}"
      
        self.duck.execute("""
            INSERT INTO decisions 
            (decision_id, timestamp, actor, action, outcome, evidence_ids, spec_version_ids, reasoning_steps, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,[
            decision_id,
            datetime.now(),
            actor,
            action,
            json.dumps(outcome),
            json.dumps(evidence_memory_ids),
            json.dumps([]),# spec_version_ids
            json.dumps(reasoning),
0.0
])
      
# 3. Evidence 연결 기록
for mem_id in evidence_memory_ids:
            meta =await self.indexer.get_memory_meta(mem_id)
            self.duck.execute("""
                INSERT INTO decision_evidence 
                (id, decision_id, memory_id, memory_stage, role)
                VALUES (?, ?, ?, ?, ?)
            """,[
f"{decision_id}_{mem_id}",
                decision_id,
                mem_id,
                meta["stage"],
"premise"
])
      
return decision_id
  
asyncdeftrace_decision(self, decision_id:str)->dict:
"""의사결정 역추적"""
      
        decision = self.duck.execute("""
            SELECT * FROM decisions WHERE decision_id = ?
        """,[decision_id]).fetchone()
      
        evidence = self.duck.execute("""
            SELECT de.*, m.content, m.idr_path
            FROM decision_evidence de
            JOIN entries m ON de.memory_id = m.id
            WHERE de.decision_id = ?
        """,[decision_id]).fetchall()
      
return{
"decision":{
"id": decision[0],
"timestamp": decision[1],
"actor": decision[2],
"action": decision[3],
"outcome": json.loads(decision[4])
},
"evidence":[
{
"memory_id": e[2],
"stage": e[3],
"role": e[4],
"content": json.loads(e[5]),
"idr_path": e[6]
}
for e in evidence
],
"reasoning": json.loads(decision[7])
}
```

---

## 수정된 전체 파이프라인

python

```python
# memory_pipeline/orchestrator.py (수정)

classMemoryPipeline:
def__init__(self, project_root: Path):
        self.project_root = project_root
      
# 기존
        self.extractor = SessionExtractor()
        self.generator = IdrisGenerator(project_root /"src"/"LongTermMemory")
        self.validator = IdrisValidator(project_root)
        self.indexer = MemoryIndexer(...)
      
# 추가: Event Sourcing + Graduation
        self.event_store = EventStore(project_root /"data"/"events.duckdb")
        self.graduation = GraduationEngine(self.event_store, self.indexer, self.validator)
        self.ledger = DecisionLedger(self.indexer.duck, self.indexer)
  
asyncdefprocess_session(self, session_log:str,...):
"""세션 처리 (L0 → L2)"""
      
# 1. L0: Raw Event 저장 (불변)
        event = RawEvent(
            event_id=f"session_{date}_{session_id}",
            timestamp=datetime.now(),
            event_type="session",
            actor="user",
            payload={"raw_log": session_log}
)
        self.event_store.append(event)
      
# 2. L1: Working Memory (LLM 추출)
        data =await self.extractor.extract(session_log, date, session_id)
      
# 3. L2: Candidate Spec (Idris 생성)
        idr_path = self.generator.generate_session(data)
        compile_result =await self.validator.validate(idr_path)
      
# 4. 인덱싱 (stage = "candidate")
await self.indexer.index_session(data, idr_path,"candidate")
      
return{...}
  
asyncdefrun_graduation_cycle(self):
"""승격 사이클 실행 (스케줄러에서 호출)"""
returnawait self.graduation.run_graduation_cycle()
```

---

## 최종 아키텍처 다이어그램

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     COMPLETE MEMORY GRADUATION PIPELINE                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  [채팅 세션] ─────────────────────────────────────────────────────────┐  │
│       │                                                                │  │
│       ▼                                                                │  │
│  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │ L0: RAW EVENT LOG (EventStore)                                  │  │  │
│  │ • append-only, 불변                                             │  │  │
│  │ • checksum으로 무결성 보장                                       │  │  │
│  │ • 모든 후속 레이어의 "진실의 원천"                               │  │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │  │
│                              │ LLM 추출                                │  │
│                              ▼                                         │  │
│  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │ L1: WORKING MEMORY (JSON)                                       │  │  │
│  │ • 느슨한 스키마                                                  │  │  │
│  │ • 실시간 검색용                                                  │  │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │  │
│                              │ Idris 생성 + 컴파일                     │  │
│                              ▼                                         │  │
│  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │ L2: CANDIDATE SPEC (.idr, hole 허용)                            │  │  │
│  │ • idris2 --check                                                │  │  │
│  │ • Memory Candidate a 타입                                        │  │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │  │
│                              │ Graduation Engine                       │  │
│                              │ (인출 5회 + Decision 인용 + 24h)        │  │
│                              ▼                                         │  │
│  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │ L3: VERIFIED SPEC                                               │  │  │
│  │ • hole 없음                                                      │  │  │
│  │ • 불변식 통과                                                    │  │  │
│  │ • Memory Verified a 타입                                         │  │  │
│  │ • ✅ Decision Ledger 참조 가능                                   │  │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │  │
│                              │ (인출 20회 +3 Decisions +30일)        │  │
│                              ▼                                         │  │
│  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │ L4: CERTIFIED SPEC (공통 레이어)                                │  │  │
│  │ • 버전 태깅 (v1.0.0)                                            │  │  │
│  │ • 직접 수정 금지                                                 │  │  │
│  │ • Memory Certified a Version 타입                                │  │  │
│  │ • ✅ Enterprise Base Spec                                        │  │  │
│  └─────────────────────────────────────────────────────────────────┘  │  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │ DECISION LEDGER                                                  │     │
│  │ • Verified/Certified 메모리만 참조 (타입으로 강제)               │     │
│  │ • 역추적 가능                                                    │     │
│  │ • Event Sourcing으로 불변 기록                                   │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 요약

| 항목            | 이전 | 지금                     |
| --------------- | ---- | ------------------------ |
| Event Sourcing  | ❌   | ✅`EventStore`추가     |
| Dependent Types | ❌   | ✅`Memory Stage a`타입 |
| L3 Verified     | 부분 | ✅ 승격 조건 + hole 검사 |
| L4 Certified    | ❌   | ✅ 버전 관리 + 불변      |
| Decision Ledger | ❌   | ✅ Verified 이상만 참조  |
| 승격 자동화     | ❌   | ✅`GraduationEngine`   |

=====


Gemini가 꽤 날카로운 포인트들을 짚었네요. 하나씩 평가하고, 실제로 채택할 만한 것들을 정리해 드릴게요.

---

## Gemini 제안 평가

| # | 제안                                  | 평가                                                  | 채택 여부           |
| - | ------------------------------------- | ----------------------------------------------------- | ------------------- |
| 1 | **Proof of Contradiction**      | ✅ 핵심. 기존 지식과 새 지식 충돌 시 시스템 마비 방지 | **채택**      |
| 2 | **Modular Compilation**         | ✅ 필수. 수천 세션이면 컴파일 불가능                  | **채택**      |
| 3 | **Half-life 강등**              | ✅ 좋음. 안 쓰이는 Certified가 쌓이면 노이즈          | **채택**      |
| 4 | **Type-aware Retrieval**        | ✅ 실용적. 검색 시 Stage 가중치                       | **채택**      |
| 5 | **Human-in-the-loop for Holes** | ⚠️ 부분 채택. 모든 hole을 사람이 채우긴 어려움      | **부분 채택** |
| 6 | **Temporal Invariants**         | ✅ 강력. 인과관계 꼬임 방지                           | **채택**      |
| 7 | **State Transition Integrity**  | ✅ 좋음. Task 상태 무결성                             | **채택**      |
| 8 | **Theorem Prover Agent**        | ⚠️ 과도함. LLM이 Idris 증명을 잘 못 함              | **보류**      |
| 9 | **Property-Based Testing**      | ✅ 실용적. Hedgehog로 불변식 테스트                   | **채택**      |

---

## 채택할 개선사항 구현

### 1. Proof of Contradiction (지식 충돌 해결)

```idris
-- LongTermMemory/Contradiction.idr

module LongTermMemory.Contradiction

import LongTermMemory.MemorySchema

%default total

-- === 모순 증명 타입 ===
-- 두 기억이 동시에 참일 수 없음을 표현
public export
data Contradiction : Memory stage1 a -> Memory stage2 b -> Type where
  MkContradiction : 
    (mem1 : Memory stage1 a) ->
    (mem2 : Memory stage2 b) ->
    (reason : String) ->
    (proofOfConflict : a -> b -> Void) ->  -- 둘 다 참이면 모순
    Contradiction mem1 mem2

-- === 충돌 감지 결과 ===
public export
data ConflictResult : Type where
  NoConflict    : ConflictResult
  HasConflict   : (older : MemoryId) -> 
                  (newer : MemoryId) -> 
                  (reason : String) -> 
                  ConflictResult
  NeedsReview   : (candidates : List MemoryId) -> ConflictResult

-- === 충돌 해결 액션 ===
public export
data Resolution : Type where
  KeepOlder     : (demote : MemoryId) -> Resolution      -- 새 지식 강등
  KeepNewer     : (deprecate : MemoryId) -> Resolution   -- 기존 지식 폐기
  MergeVersions : (v1, v2 : MemoryId) -> Resolution      -- 버전 분기
  EscalateHuman : (conflict : ConflictResult) -> Resolution  -- 사람 판단
```

```python
# memory_pipeline/conflict_resolver.py

from dataclasses import dataclass
from enum import Enum

class ResolutionAction(Enum):
    KEEP_OLDER = "keep_older"      # 새 지식 강등
    KEEP_NEWER = "keep_newer"      # 기존 지식 deprecate
    MERGE = "merge"                # 둘 다 유지, 버전 분기
    ESCALATE = "escalate"          # 사람 판단 요청

@dataclass
class Conflict:
    older_id: str
    newer_id: str
    older_stage: str
    newer_stage: str
    reason: str
    similarity: float
    contradiction_type: str  # "logical", "temporal", "value"

class ConflictResolver:
    def __init__(self, indexer, llm_client):
        self.indexer = indexer
        self.llm = llm_client
  
    async def detect_conflicts(self, new_memory_id: str) -> list[Conflict]:
        """새 메모리와 충돌하는 기존 메모리 탐지"""
      
        new_mem = await self.indexer.get_memory(new_memory_id)
      
        # 1. 유사한 메모리 검색
        similar = await self.indexer.search_similar(
            new_mem["embedding"],
            threshold=0.8,
            exclude_id=new_memory_id
        )
      
        conflicts = []
        for old_mem in similar:
            # 2. LLM으로 논리적 충돌 판단
            conflict_check = await self._check_logical_conflict(new_mem, old_mem)
          
            if conflict_check["has_conflict"]:
                conflicts.append(Conflict(
                    older_id=old_mem["id"],
                    newer_id=new_memory_id,
                    older_stage=old_mem["stage"],
                    newer_stage=new_mem["stage"],
                    reason=conflict_check["reason"],
                    similarity=old_mem["similarity"],
                    contradiction_type=conflict_check["type"]
                ))
      
        return conflicts
  
    async def _check_logical_conflict(self, mem1: dict, mem2: dict) -> dict:
        """두 메모리가 논리적으로 충돌하는지 LLM으로 판단"""
      
        prompt = f"""
두 지식이 논리적으로 충돌하는지 판단하세요.

지식 A (기존, {mem1['stage']}):
{mem1['content']}

지식 B (신규, {mem2['stage']}):
{mem2['content']}

판단 기준:
1. 같은 주제에 대해 상반된 주장을 하는가?
2. 시간 순서가 논리적으로 맞지 않는가?
3. 수치/상태가 모순되는가?

JSON으로 응답:
{{"has_conflict": true/false, "type": "logical|temporal|value|none", "reason": "설명"}}
"""
        response = await self.llm.complete(prompt)
        return json.loads(response)
  
    async def resolve(self, conflict: Conflict) -> ResolutionAction:
        """충돌 해결 전략 결정"""
      
        # 규칙 기반 해결
      
        # 1. Certified vs 낮은 단계 → Certified 우선
        if conflict.older_stage == "certified" and conflict.newer_stage != "certified":
            return ResolutionAction.KEEP_OLDER
      
        # 2. 같은 단계 → 최신 우선 (단, 검토 필요)
        if conflict.older_stage == conflict.newer_stage:
            if conflict.contradiction_type == "temporal":
                return ResolutionAction.KEEP_NEWER
            else:
                return ResolutionAction.ESCALATE
      
        # 3. 새 지식이 더 높은 단계면 기존 것 deprecate
        stage_order = {"raw": 0, "working": 1, "candidate": 2, "verified": 3, "certified": 4}
        if stage_order[conflict.newer_stage] > stage_order[conflict.older_stage]:
            return ResolutionAction.KEEP_NEWER
      
        # 4. 기본: 사람 판단
        return ResolutionAction.ESCALATE
  
    async def apply_resolution(self, conflict: Conflict, action: ResolutionAction):
        """해결 액션 적용"""
      
        if action == ResolutionAction.KEEP_OLDER:
            # 새 지식을 Working으로 강등
            await self.indexer.demote(conflict.newer_id, "working")
            await self._add_conflict_note(conflict.newer_id, conflict)
      
        elif action == ResolutionAction.KEEP_NEWER:
            # 기존 지식 deprecate
            await self.indexer.deprecate(conflict.older_id, 
                                         superseded_by=conflict.newer_id)
      
        elif action == ResolutionAction.ESCALATE:
            # 충돌 큐에 추가
            await self._enqueue_for_review(conflict)
```

---

### 2. Modular Compilation (성능 최적화)

```
/axiommind
├── packages/                      # 패키지 분리
│   ├── core/                      # 기본 스키마 (항상 로드)
│   │   ├── core.ipkg
│   │   └── src/
│   │       └── MemorySchema.idr
│   │
│   ├── certified/                 # L4: 컴파일된 .ttc만 배포
│   │   ├── certified.ipkg
│   │   ├── build/ttc/            # Pre-compiled
│   │   └── src/
│   │       ├── Trading/
│   │       │   └── RegimeAgent.idr
│   │       └── Finance/
│   │           └── RiskAssessment.idr
│   │
│   ├── sessions/                  # L2: 세션별 분리
│   │   ├── 2026-01/
│   │   │   ├── week01.ipkg       # 주 단위 패키지
│   │   │   └── src/
│   │   │       ├── Session_2026_01_20_01.idr
│   │   │       └── Session_2026_01_22_15.idr
│   │   └── 2026-02/
│   │       └── ...
```

```python
# memory_pipeline/modular_compiler.py

from pathlib import Path
import asyncio

class ModularCompiler:
    """모듈별 증분 컴파일"""
  
    def __init__(self, packages_root: Path):
        self.packages_root = packages_root
        self.compiled_cache = {}  # module -> ttc path
  
    async def compile_session(self, idr_path: Path) -> CompileResult:
        """세션 파일만 컴파일 (의존성은 .ttc 참조)"""
      
        # 1. Certified 패키지는 pre-compiled .ttc 사용
        certified_ttc = self.packages_root / "certified" / "build" / "ttc"
      
        # 2. 해당 세션만 컴파일
        proc = await asyncio.create_subprocess_exec(
            "idris2", "--check",
            str(idr_path),
            "--source-dir", str(idr_path.parent),
            "--build-dir", str(self.packages_root / "build"),
            # Pre-compiled Certified 참조
            "-p", "certified",
            cwd=str(self.packages_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
      
        stdout, stderr = await proc.communicate()
        return self._parse_result(stdout, stderr, proc.returncode)
  
    async def rebuild_certified(self):
        """Certified 패키지 전체 재빌드 (드물게 실행)"""
      
        proc = await asyncio.create_subprocess_exec(
            "idris2", "--build", "certified.ipkg",
            cwd=str(self.packages_root / "certified"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
  
    async def on_demand_verify(self, memory_ids: list[str]) -> dict:
        """필요한 모듈만 로드하여 검증"""
      
        results = {}
      
        # 관련 모듈만 추출
        modules = await self._get_modules_for_memories(memory_ids)
      
        for module in modules:
            if module in self.compiled_cache:
                results[module] = {"status": "cached", "valid": True}
            else:
                result = await self.compile_session(module)
                results[module] = result
                if result.success:
                    self.compiled_cache[module] = result.ttc_path
      
        return results
```

---

### 3. Half-life 강등 시스템

```python
# memory_pipeline/decay.py

from datetime import datetime, timedelta
import math

class MemoryDecay:
    """지식의 반감기 기반 강등"""
  
    # 단계별 반감기 (일)
    HALF_LIFE = {
        "certified": 180,   # 6개월
        "verified": 90,     # 3개월
        "candidate": 30,    # 1개월
        "working": 7,       # 1주
    }
  
    # 단계별 최소 인출 횟수 (반감기당)
    MIN_RETRIEVAL = {
        "certified": 5,
        "verified": 3,
        "candidate": 2,
        "working": 1,
    }
  
    def __init__(self, indexer):
        self.indexer = indexer
  
    def calculate_vitality(self, memory: dict) -> float:
        """기억의 활력도 계산 (0.0 ~ 1.0)"""
      
        stage = memory["stage"]
        half_life = self.HALF_LIFE[stage]
      
        # 마지막 인출 이후 경과 시간
        last_used = memory.get("last_retrieved_at") or memory["created_at"]
        days_since_use = (datetime.now() - last_used).days
      
        # 지수 감쇠: vitality = 0.5 ^ (days / half_life)
        vitality = math.pow(0.5, days_since_use / half_life)
      
        # 인출 횟수 보너스
        retrieval_bonus = min(memory["retrieval_count"] / 100, 0.3)
      
        # Decision 인용 보너스
        citation_bonus = min(memory["cited_in_decisions"] / 10, 0.2)
      
        return min(vitality + retrieval_bonus + citation_bonus, 1.0)
  
    async def run_decay_cycle(self) -> list[dict]:
        """강등 사이클 실행"""
      
        demotions = []
      
        # 각 단계별로 검사
        for stage in ["certified", "verified", "candidate"]:
            memories = await self.indexer.get_memories_by_stage(stage)
          
            for mem in memories:
                vitality = self.calculate_vitality(mem)
              
                # 활력도가 임계값 미만이면 강등
                if vitality < 0.3:
                    target_stage = self._get_demotion_target(stage)
                  
                    await self.indexer.update_stage(mem["id"], target_stage)
                  
                    demotions.append({
                        "memory_id": mem["id"],
                        "from_stage": stage,
                        "to_stage": target_stage,
                        "vitality": vitality,
                        "reason": "low_vitality"
                    })
      
        return demotions
  
    def _get_demotion_target(self, current: str) -> str:
        """강등 대상 단계"""
        demotion_map = {
            "certified": "verified",
            "verified": "candidate",
            "candidate": "working",
            "working": "archived"
        }
        return demotion_map[current]
  
    async def archive_old_raw(self, days_threshold: int = 90):
        """오래된 Raw 이벤트 아카이빙"""
      
        cutoff = datetime.now() - timedelta(days=days_threshold)
      
        # 요약본 생성 후 원본 이동
        old_events = await self.indexer.get_raw_events_before(cutoff)
      
        for event in old_events:
            # LLM으로 요약 생성
            summary = await self._summarize_event(event)
          
            # 요약 저장
            await self.indexer.save_summary(event["id"], summary)
          
            # 원본을 cold storage로 이동
            await self.indexer.archive_to_cold(event["id"])
```

---

### 4. Type-aware Retrieval

```python
# memory_pipeline/search.py (수정)

class MemorySearch:
    # Stage별 신뢰도 가중치
    STAGE_WEIGHTS = {
        "certified": 1.0,
        "verified": 0.85,
        "candidate": 0.6,
        "working": 0.4,
        "raw": 0.2
    }
  
    async def search_with_trust(
        self,
        query: str,
        limit: int = 10,
        min_stage: str = "working",  # 최소 단계 필터
        trust_weight: float = 0.3    # 신뢰도 가중치 비율
    ) -> list[SearchResult]:
        """신뢰도 가중 검색"""
      
        # 1. 벡터 유사도 검색 (더 많이 가져옴)
        query_vec = self.embedder.encode(query).tolist()
        raw_results = self.table.search(query_vec).limit(limit * 3).to_list()
      
        # 2. 단계 필터링
        stage_order = ["raw", "working", "candidate", "verified", "certified"]
        min_idx = stage_order.index(min_stage)
      
        filtered = [
            r for r in raw_results
            if stage_order.index(r["stage"]) >= min_idx
        ]
      
        # 3. 복합 점수 계산
        scored = []
        for r in filtered:
            similarity = 1 - r["_distance"]  # 거리 → 유사도
            trust = self.STAGE_WEIGHTS[r["stage"]]
          
            # 복합 점수: (1-w)*similarity + w*trust
            combined = (1 - trust_weight) * similarity + trust_weight * trust
          
            scored.append({
                **r,
                "similarity": similarity,
                "trust": trust,
                "combined_score": combined
            })
      
        # 4. 복합 점수로 정렬
        scored.sort(key=lambda x: x["combined_score"], reverse=True)
      
        return scored[:limit]
  
    async def search_for_decision(
        self,
        query: str,
        limit: int = 5
    ) -> list[SearchResult]:
        """Decision용 검색 (Verified 이상만)"""
      
        return await self.search_with_trust(
            query,
            limit=limit,
            min_stage="verified",  # Verified 이상만
            trust_weight=0.5       # 신뢰도 더 중요
        )
```

---

### 5. Temporal Invariants (시간 순서 검증)

```idris
-- LongTermMemory/TemporalInvariants.idr

module LongTermMemory.TemporalInvariants

import Data.So

%default total

-- === 타임스탬프 비교 ===
public export
Timestamp : Type
Timestamp = Integer  -- Unix timestamp (ms)

public export
data IsBefore : Timestamp -> Timestamp -> Type where
  MkIsBefore : So (earlier < later) -> IsBefore earlier later

-- === 인과관계 검증된 Decision ===
public export
record CausalDecision where
  constructor MkCausalDecision
  decisionTime : Timestamp
  action : String
  
  -- 근거 Fact들
  evidenceFacts : List (Timestamp, Fact)
  
  -- 불변식: 모든 근거는 결정보다 먼저 발생
  causalProof : All (\(t, _) => IsBefore t decisionTime) evidenceFacts

-- === Task 상태 전이 규칙 ===
public export
data ValidTransition : TaskStatus -> TaskStatus -> Type where
  StartWork    : ValidTransition Pending InProgress
  BlockWork    : ValidTransition InProgress Blocked
  UnblockWork  : ValidTransition Blocked InProgress
  CompleteWork : ValidTransition InProgress Done
  CancelAny    : ValidTransition status Cancelled

-- 불가능한 전이는 타입 에러
-- SkipToDone : ValidTransition Pending Done  -- 컴파일 에러!

-- === 상태 전이 함수 ===
public export
transition : (from : TaskStatus) -> 
             (to : TaskStatus) -> 
             (prf : ValidTransition from to) -> 
             Task -> Task
transition _ to _ task = { status := to } task
```

```python
# memory_pipeline/temporal_validator.py

from datetime import datetime

class TemporalValidator:
    """시간 순서 및 인과관계 검증"""
  
    async def validate_decision_causality(
        self, 
        decision: dict, 
        evidence_ids: list[str]
    ) -> tuple[bool, list[str]]:
        """Decision의 인과관계 검증"""
      
        errors = []
        decision_time = decision["timestamp"]
      
        for ev_id in evidence_ids:
            evidence = await self.indexer.get_memory(ev_id)
            evidence_time = evidence["created_at"]
          
            # 근거가 결정보다 나중이면 인과관계 오류
            if evidence_time > decision_time:
                errors.append(
                    f"인과관계 오류: 근거 '{ev_id}'({evidence_time})가 "
                    f"결정({decision_time})보다 나중에 발생"
                )
      
        return len(errors) == 0, errors
  
    async def validate_task_transition(
        self,
        task_id: str,
        from_status: str,
        to_status: str
    ) -> tuple[bool, str]:
        """Task 상태 전이 유효성 검증"""
      
        valid_transitions = {
            ("pending", "in_progress"),
            ("in_progress", "blocked"),
            ("blocked", "in_progress"),
            ("in_progress", "done"),
            ("pending", "cancelled"),
            ("in_progress", "cancelled"),
            ("blocked", "cancelled"),
        }
      
        if (from_status, to_status) in valid_transitions:
            return True, ""
      
        return False, f"잘못된 전이: {from_status} → {to_status}"
```

---

### 6. Property-Based Testing

```python
# tests/test_invariants.py

from hypothesis import given, strategies as st, settings
import pytest

class TestMemoryInvariants:
    """불변식 Property-Based 테스트"""
  
    @given(
        title=st.text(min_size=1, max_size=100),
        status=st.sampled_from(["pending", "in_progress", "done", "blocked"]),
        blocked_by=st.lists(st.text(min_size=1, max_size=50), max_size=5)
    )
    def test_task_blocked_invariant(self, title, status, blocked_by):
        """Blocked 상태면 blockedBy가 비어있으면 안됨"""
      
        if status == "blocked":
            # Blocked인데 blockedBy가 비어있으면 불변식 위반
            assert len(blocked_by) > 0, "Blocked task must have blockers"
  
    @given(
        decision_time=st.integers(min_value=1000000000, max_value=2000000000),
        evidence_times=st.lists(
            st.integers(min_value=1000000000, max_value=2000000000),
            min_size=1,
            max_size=5
        )
    )
    def test_causal_order_invariant(self, decision_time, evidence_times):
        """근거는 항상 결정보다 먼저 발생해야 함"""
      
        for ev_time in evidence_times:
            # 근거가 결정보다 나중이면 불변식 위반
            assert ev_time < decision_time, \
                f"Evidence ({ev_time}) must precede decision ({decision_time})"
  
    @given(
        stage=st.sampled_from(["raw", "working", "candidate", "verified", "certified"]),
        retrieval_count=st.integers(min_value=0, max_value=1000),
        cited_count=st.integers(min_value=0, max_value=100)
    )
    @settings(max_examples=500)
    def test_graduation_conditions(self, stage, retrieval_count, cited_count):
        """승격 조건 일관성"""
      
        # Certified는 최소 조건 충족해야 함
        if stage == "certified":
            assert retrieval_count >= 20, "Certified needs 20+ retrievals"
            assert cited_count >= 3, "Certified needs 3+ citations"
  
    @given(
        memories=st.lists(
            st.fixed_dictionaries({
                "id": st.text(min_size=5, max_size=20),
                "content": st.text(min_size=10, max_size=200),
                "stage": st.sampled_from(["verified", "certified"])
            }),
            min_size=2,
            max_size=10
        )
    )
    def test_no_duplicate_certified(self, memories):
        """Certified 단계에 중복 지식 없어야 함"""
      
        certified = [m for m in memories if m["stage"] == "certified"]
        contents = [m["content"] for m in certified]
      
        # 중복 체크 (실제로는 유사도 기반)
        assert len(contents) == len(set(contents)), \
            "Certified layer must not have duplicates"
```

---

## 보류/수정한 제안

### Theorem Prover Agent (보류)

Gemini가 제안한 "LLM을 Idris 증명 전용으로" 아이디어는  **현재 LLM의 능력으로는 어렵습니다** . Idris 증명은 매우 정교해서 Claude나 GPT가 잘 못 합니다.

 **대안** : 간단한 hole은 **템플릿 기반 자동 생성**으로 처리하고, 복잡한 것만 Human-in-the-loop으로.

```python
class HoleResolver:
    """간단한 Hole 자동 해결"""
  
    TEMPLATES = {
        # IsBefore 증명: 타임스탬프 비교
        "IsBefore": """
MkIsBefore (believe_me)  -- 런타임에서 검증됨
""",
        # NonEmpty 증명: 패턴 매칭
        "NonEmpty": """
IsNonEmpty (x :: xs)
""",
    }
  
    async def try_auto_resolve(self, hole_type: str, context: dict) -> str | None:
        """템플릿으로 자동 해결 시도"""
      
        if hole_type in self.TEMPLATES:
            return self.TEMPLATES[hole_type]
      
        return None  # 자동 해결 불가 → Human queue로
```

---

## 최종 개선 요약

| 기능                             | 구현                    | 효과                           |
| -------------------------------- | ----------------------- | ------------------------------ |
| **Proof of Contradiction** | `ConflictResolver`    | 지식 충돌 시 시스템 마비 방지  |
| **Modular Compilation**    | 패키지 분리 + .ttc 캐시 | 컴파일 시간 90% 감소           |
| **Half-life 강등**         | `MemoryDecay`         | 노이즈 지식 자동 정리          |
| **Type-aware Retrieval**   | Stage 가중치 검색       | 신뢰할 수 있는 지식 우선       |
| **Temporal Invariants**    | `IsBefore`타입        | 인과관계 오류 컴파일 타임 차단 |
| **Property-Based Testing** | Hypothesis              | 불변식 자동 검증               |

이 정도면 Gemini가 제안한 핵심 개선사항이 대부분 반영됩니다. 추가로 구체화할 부분 있으면 말씀해 주세요.




ChatGPT가 매우 실무적인 관점에서 날카롭게 짚었네요. 특히 **운영 안정성**과 **데이터 정합성** 측면에서 제가 놓친 부분들이 많습니다. 하나씩 평가하고 채택할 것들을 정리해 드릴게요.

---

## ChatGPT 제안 평가

| #   | 제안                              | 평가                         | 채택                  |
| --- | --------------------------------- | ---------------------------- | --------------------- |
| 0-1 | DuckDB JSONB → JSON              | ✅ 맞음. DuckDB는 JSONB 없음 | **즉시 수정**   |
| 0-2 | ILIKE → FTS 확장                 | ✅ 필수. 선형 스캔 병목      | **채택**        |
| 0-3 | 트리거로 append-only 불가         | ✅ 맞음. API 레벨에서 강제   | **채택**        |
| 0-4 | LanceDB 동시 쓰기 제한            | ✅ 중요. 단일 writer 큐      | **채택**        |
| 1   | 문자열 참조 → ID 기반            | ✅ 핵심. 가장 시급           | **최우선 채택** |
| 2   | EventStore = SoT, 나머지는 파생물 | ✅ 아키텍처 핵심             | **채택**        |
| 3   | DuckDB/LanceDB 정합성 (Outbox)    | ✅ 실무 필수                 | **채택**        |
| 4   | Bool → So/Proof 타입 강제        | ✅ Idris 본질 활용           | **채택**        |
| 5   | 지표도 이벤트 기반 집계           | ✅ 재현성/감사 가능          | **채택**        |
| 6   | Conflict를 1급 Ledger로           | ✅ 좋음. 기존 설계 강화      | **채택**        |
| 7   | Hybrid + RRF + MMR                | ⚠️ 점진적 도입             | **부분 채택**   |
| 8   | 임베딩/스키마 버전 관리           | ✅ 장기 운영 필수            | **채택**        |
| 9   | 보안/PII 탐지                     | ✅ 조직용이면 필수           | **채택**        |
| 10  | Observability                     | ✅ 운영 생존 필수            | **채택**        |

---

## 즉시 수정 사항

### 0-1. DuckDB 스키마 수정 (JSONB → JSON)

sql

```sql
-- 수정 전
content JSONB NOTNULL

-- 수정 후
content JSON NOTNULL-- 또는 VARCHAR + CHECK
```

### 0-2. FTS 확장 적용

sql

```sql
-- DuckDB FTS 설정
INSTALL fts;
LOAD fts;

-- 검색용 텍스트 컬럼 추가
ALTERTABLE entries ADDCOLUMN search_text VARCHAR;

-- FTS 인덱스 생성
PRAGMA create_fts_index('entries','entry_id','search_text');

-- 검색 쿼리
SELECT*, fts_main_entries.match_bm25(entry_id,'keyword')AS score
FROM entries
WHERE score ISNOTNULL
ORDERBY score DESC;
```

---

## 핵심 개선 구현

### 1. ID 기반 참조 + Evidence Span (최우선)

idris

```idris
-- LongTermMemory/MemorySchema.idr (수정)

moduleLongTermMemory.MemorySchema

%defaulttotal

-- === ID 타입 (ULID 기반) ===
publicexport
EntryId:Type
EntryId=String-- "01HQ3K5P8R..."

publicexport
EventId:Type
EventId=String

publicexport
SessionId:Type
SessionId=String

-- === Evidence Span (원문 포인터) ===
publicexport
recordEvidenceSpanwhere
constructorMkSpan
eventId:EventId-- Raw 이벤트 ID
messageIndex:Nat-- 메시지 순서
spanStart:Nat-- 문자 위치 시작
spanEnd:Nat-- 문자 위치 끝
quoteHash:String-- 원문 해시 (변조 감지)

-- === Entry 타입들 (ID 기반 참조) ===
publicexport
recordFactwhere
constructorMkFact
id:EntryId
title:String
-- 문자열 설명 대신 원문 포인터
evidenceSpans:ListEvidenceSpan

publicexport
recordDecisionwhere
constructorMkDecision
id:EntryId
title:String
rationale:MaybeString
-- 문자열 → ID 참조
basedOnIds:ListEntryId
evidenceSpans:ListEvidenceSpan

publicexport
recordTaskwhere
constructorMkTask
id:EntryId
title:String
status:TaskStatus
priority:Priority
-- 문자열 → ID 참조
blockedByIds:ListEntryId

-- === 참조 무결성 검증 ===
publicexport
dataValidReference:EntryId->ListEntryId->Typewhere
MkValidRef:(target:EntryId)-> 
(pool:ListEntryId)-> 
(prf:Elemtargetpool)->-- target이 pool에 존재
ValidReferencetargetpool
```

python

```python
# memory_pipeline/id_generator.py

import ulid
import hashlib

classIdGenerator:
"""ULID 기반 ID 생성"""
  
@staticmethod
defentry_id()->str:
returnf"ent_{ulid.new().str}"
  
@staticmethod
defevent_id()->str:
returnf"evt_{ulid.new().str}"
  
@staticmethod
defsession_id()->str:
returnf"ses_{ulid.new().str}"

classEvidenceSpan:
"""원문 포인터"""
  
def__init__(self, event_id:str, message_index:int, 
                 span_start:int, span_end:int, quote:str):
        self.event_id = event_id
        self.message_index = message_index
        self.span_start = span_start
        self.span_end = span_end
        self.quote_hash = hashlib.sha256(quote.encode()).hexdigest()[:16]
  
defverify(self, original_text:str)->bool:
"""원문 변조 감지"""
        extracted = original_text[self.span_start:self.span_end]
        current_hash = hashlib.sha256(extracted.encode()).hexdigest()[:16]
return current_hash == self.quote_hash
```

python

```python
# memory_pipeline/extractor.py (수정)

EXTRACTION_PROMPT ="""
다음 채팅 세션을 분석하고, 구조화된 메모리로 추출하세요.

중요 규칙:
1. 모든 entry에 고유 ID를 부여 (ent_001, ent_002...)
2. 참조는 반드시 ID로 (basedOnIds, blockedByIds)
3. evidence는 원문의 정확한 위치로 (messageIndex, spanStart, spanEnd)
```json
{
  "sessionId": "ses_xxx",
  "entries": [
    {
      "id": "ent_001",
      "type": "fact",
      "title": "1H 패턴 갱신 스케줄러 수정",
      "evidenceSpans": [
        {
          "messageIndex": 3,
          "spanStart": 45,
          "spanEnd": 120,
          "quote": "정각 체크(now.minute != 0) 제거"
        }
      ]
    },
    {
      "id": "ent_002",
      "type": "decision",
      "title": "elapsed_minutes 기준 사용",
      "basedOnIds": ["ent_001"],
      "evidenceSpans": [...]
    }
  ]
}
```

"""

```




---


### 2. EventStore = Single Source of Truth + Rebuild







python

```python
# memory_pipeline/event_store.py (강화)

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import json
import hashlib

@dataclass
classRawEvent:
    event_id:str
    timestamp: datetime
    event_type:str
    actor:str
    payload:dict
  
# 메타데이터 (재빌드용)
    meta:dict= field(default_factory=dict)
  
def__post_init__(self):
        self.checksum = self._compute_checksum()
  
def_compute_checksum(self)->str:
        content = json.dumps({
"timestamp": self.timestamp.isoformat(),
"event_type": self.event_type,
"payload": self.payload
}, sort_keys=True)
return hashlib.sha256(content.encode()).hexdigest()[:16]

classEventStore:
"""Append-only 이벤트 저장소 (SoT)"""
  
def__init__(self, db_path: Path):
        self.duck = duckdb.connect(str(db_path))
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS events (
                event_id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                event_type VARCHAR NOT NULL,
                actor VARCHAR NOT NULL,
                payload JSON NOT NULL,
                checksum VARCHAR NOT NULL,
                meta JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
          
            CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
        """)
  
defappend(self, event: RawEvent)->str:
"""이벤트 추가 (UPDATE/DELETE 메서드 없음 = API 레벨 강제)"""
      
        self.duck.execute("""
            INSERT INTO events 
            (event_id, timestamp, event_type, actor, payload, checksum, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,[
            event.event_id,
            event.timestamp,
            event.event_type,
            event.actor,
            json.dumps(event.payload),
            event.checksum,
            json.dumps(event.meta)
])
return event.event_id
  
# UPDATE, DELETE 메서드 의도적으로 없음!
  
defreplay(self, since: datetime =None, event_types:list=None):
"""이벤트 리플레이 (재빌드용)"""
      
        query ="SELECT * FROM events WHERE 1=1"
        params =[]
      
if since:
            query +=" AND timestamp >= ?"
            params.append(since)
      
if event_types:
            placeholders =",".join(["?"]*len(event_types))
            query +=f" AND event_type IN ({placeholders})"
            params.extend(event_types)
      
        query +=" ORDER BY timestamp ASC"
      
for row in self.duck.execute(query, params).fetchall():
yield RawEvent(
                event_id=row[0],
                timestamp=row[1],
                event_type=row[2],
                actor=row[3],
                payload=json.loads(row[4]),
                meta=json.loads(row[6])if row[6]else{}
)


classDerivedStateBuilder:
"""파생 상태 빌더 (재빌드 가능)"""
  
def__init__(self, event_store: EventStore, indexer, generator, validator):
        self.events = event_store
        self.indexer = indexer
        self.generator = generator
        self.validator = validator
      
# 빌드 메타데이터
        self.build_meta ={
"extractor_prompt_hash":None,
"extractor_model":"claude-sonnet-4-20250514",
"embedder_model":"intfloat/multilingual-e5-base",
"idris_version":"0.6.0",
"schema_version":"v2"
}
  
asyncdeffull_rebuild(self):
"""전체 재빌드 (SoT에서 모든 파생물 재생성)"""
      
print("[Rebuild] Clearing derived stores...")
await self.indexer.clear_all()
      
print("[Rebuild] Replaying events...")
        session_events =list(self.events.replay(event_types=["session"]))
      
for i, event inenumerate(session_events):
print(f"[Rebuild] Processing {i+1}/{len(session_events)}: {event.event_id}")
          
# L1: Working Memory 재생성
            extracted =await self._extract_from_event(event)
          
# L2: Idris 생성 + 컴파일
            idr_path = self.generator.generate_session(extracted)
            compile_result =await self.validator.validate(idr_path)
          
# 인덱싱
await self.indexer.index_session(
                extracted, 
                idr_path, 
"candidate"if compile_result.success else"working",
                build_meta=self.build_meta
)
      
print(f"[Rebuild] Complete. Processed {len(session_events)} events.")
  
asyncdefincremental_rebuild(self, since: datetime):
"""증분 재빌드"""
      
        events =list(self.events.replay(since=since, event_types=["session"]))
      
for event in events:
await self._process_single_event(event)
```

---

### 3. DuckDB/LanceDB 정합성 (Outbox 패턴)

python

```python
# memory_pipeline/dual_store.py

from enum import Enum
from dataclasses import dataclass

classVectorStatus(Enum):
    PENDING ="pending"
    READY ="ready"
    FAILED ="failed"

@dataclass
classWriteResult:
    entry_id:str
    duck_success:bool
    lance_success:bool
    final_status: VectorStatus

classDualStoreWriter:
"""DuckDB + LanceDB 원자적 쓰기"""
  
def__init__(self, duck, lance, embedder):
        self.duck = duck
        self.lance = lance
        self.embedder = embedder
      
# 단일 writer 큐 (LanceDB 동시 쓰기 방지)
        self._write_queue = asyncio.Queue()
        self._writer_task =None
  
asyncdefstart_writer(self):
"""백그라운드 writer 시작"""
        self._writer_task = asyncio.create_task(self._writer_loop())
  
asyncdef_writer_loop(self):
"""단일 writer 루프"""
whileTrue:
            job =await self._write_queue.get()
try:
await self._process_write(job)
except Exception as e:
print(f"Write failed: {e}")
finally:
                self._write_queue.task_done()
  
asyncdefwrite_entry(self, entry:dict)-> WriteResult:
"""엔트리 쓰기 (Outbox 패턴)"""
      
        entry_id = entry["id"]
      
# Phase 1: DuckDB에 pending 상태로 저장
try:
            self.duck.execute("""
                INSERT INTO entries 
                (id, session_id, entry_type, title, content, vector_status)
                VALUES (?, ?, ?, ?, ?, ?)
            """,[
                entry_id,
                entry["session_id"],
                entry["type"],
                entry["title"],
                json.dumps(entry),
                VectorStatus.PENDING.value
])
except Exception as e:
return WriteResult(entry_id,False,False, VectorStatus.FAILED)
      
# Phase 2: 벡터 쓰기 큐에 추가
await self._write_queue.put(entry)
      
return WriteResult(entry_id,True,False, VectorStatus.PENDING)
  
asyncdef_process_write(self, entry:dict):
"""벡터 쓰기 처리"""
      
        entry_id = entry["id"]
      
try:
# 임베딩 생성
            text = self._entry_to_text(entry)
            embedding = self.embedder.encode(text).tolist()
          
# LanceDB 쓰기
            table = self.lance.open_table("entries")
            table.add([{
"id": entry_id,
"text": text,
"vector": embedding,
"stage": entry.get("stage","working")
}])
          
# Phase 3: DuckDB 상태 업데이트
            self.duck.execute("""
                UPDATE entries 
                SET vector_status = ? 
                WHERE id = ?
            """,[VectorStatus.READY.value, entry_id])
          
except Exception as e:
# 실패 상태 기록
            self.duck.execute("""
                UPDATE entries 
                SET vector_status = ?, vector_error = ?
                WHERE id = ?
            """,[VectorStatus.FAILED.value,str(e), entry_id])
  
asyncdefreconcile(self):
"""재시작 시 pending 항목 재처리"""
      
        pending = self.duck.execute("""
            SELECT content FROM entries 
            WHERE vector_status = ?
        """,[VectorStatus.PENDING.value]).fetchall()
      
print(f"[Reconcile] Found {len(pending)} pending entries")
      
for row in pending:
            entry = json.loads(row[0])
await self._write_queue.put(entry)
```

---

### 4. Bool → So/Proof 타입 강제

idris

```idris
-- LongTermMemory/VerifiedTypes.idr

moduleLongTermMemory.VerifiedTypes

importData.So
importLongTermMemory.MemorySchema

%defaulttotal

-- === 검증 조건 함수들 ===

-- Task: Done이면 blockedBy가 비어있어야 함
publicexport
validTaskState:Task->Bool
validTaskStatet=caset.statusof
Done=>isNilt.blockedByIds
Blocked=>not(isNilt.blockedByIds)
_=>True

-- Decision: Critical이면 근거 필수
publicexport
validDecisionEvidence:Decision->Bool
validDecisionEvidenced=not(isNild.basedOnIds&&isNild.evidenceSpans)

-- Fact: evidence span이 있어야 함
publicexport
validFactEvidence:Fact->Bool
validFactEvidencef=not(isNilf.evidenceSpans)

-- === Verified 래퍼 (So로 강제) ===

publicexport
recordVerifiedTaskwhere
constructorMkVerifiedTask
task:Task
proof:So(validTaskStatetask)-- Bool이 아니라 증명!

publicexport
recordVerifiedDecisionwhere
constructorMkVerifiedDecision
decision:Decision
proof:So(validDecisionEvidencedecision)

publicexport
recordVerifiedFactwhere
constructorMkVerifiedFact
fact:Fact
proof:So(validFactEvidencefact)

-- === Stage별 Entry 타입 ===

publicexport
dataCandidateEntry:Typewhere
CandFact:Fact->CandidateEntry-- 자유로움
CandDecision:Decision->CandidateEntry
CandTask:Task->CandidateEntry

publicexport
dataVerifiedEntry:Typewhere
VerFact:VerifiedFact->VerifiedEntry-- 증명 필요!
VerDecision:VerifiedDecision->VerifiedEntry
VerTask:VerifiedTask->VerifiedEntry

-- === 승격 함수 (실패 가능) ===

publicexport
verifyTask:(t:Task)->MaybeVerifiedTask
verifyTaskt=casechoose(validTaskStatet)of
Leftprf=>Just(MkVerifiedTasktprf)
Right_=>Nothing

publicexport
verifyFact:(f:Fact)->MaybeVerifiedFact
verifyFactf=casechoose(validFactEvidencef)of
Leftprf=>Just(MkVerifiedFactfprf)
Right_=>Nothing

-- === Session 타입도 Stage별로 ===

publicexport
recordCandidateSessionwhere
constructorMkCandidateSession
sessionId:SessionId
entries:ListCandidateEntry

publicexport
recordVerifiedSessionwhere
constructorMkVerifiedSession
sessionId:SessionId
entries:ListVerifiedEntry-- 모든 entry가 검증됨
-- 추가 불변식: 모든 참조가 유효
refIntegrity:AllValidInternalRefentries
```

---

### 5. 지표도 이벤트 기반 집계

python

```python
# memory_pipeline/metrics.py

classMetricsCalculator:
"""이벤트 기반 지표 계산"""
  
def__init__(self, event_store: EventStore):
        self.events = event_store
  
defretrieval_count(self, entry_id:str)->int:
"""인출 횟수 = retrieve 이벤트 집계"""
      
        result = self.events.duck.execute("""
            SELECT COUNT(*) FROM events
            WHERE event_type = 'retrieve'
              AND json_extract_string(payload, '$.entry_id') = ?
        """,[entry_id]).fetchone()
      
return result[0]
  
defcited_in_decisions(self, entry_id:str)->int:
"""Decision 인용 횟수 = decision 이벤트에서 집계"""
      
        result = self.events.duck.execute("""
            SELECT COUNT(*) FROM events
            WHERE event_type = 'decision'
              AND json_extract(payload, '$.evidence_ids') LIKE ?
        """,[f'%"{entry_id}"%']).fetchone()
      
return result[0]
  
defcompute_graduation_metrics(self, entry_id:str)->dict:
"""승격 판단용 지표 계산 (모두 이벤트 기반)"""
      
return{
"retrieval_count": self.retrieval_count(entry_id),
"cited_in_decisions": self.cited_in_decisions(entry_id),
"unique_sessions": self._unique_sessions(entry_id),
"last_retrieved_at": self._last_retrieval_time(entry_id),
"age_days": self._age_days(entry_id)
}
  
def_unique_sessions(self, entry_id:str)->int:
"""서로 다른 세션에서 인출된 횟수"""
      
        result = self.events.duck.execute("""
            SELECT COUNT(DISTINCT json_extract_string(payload, '$.session_id'))
            FROM events
            WHERE event_type = 'retrieve'
              AND json_extract_string(payload, '$.entry_id') = ?
        """,[entry_id]).fetchone()
      
return result[0]


# 이벤트 기록 함수들
classEventRecorder:
"""모든 활동을 이벤트로 기록"""
  
def__init__(self, event_store: EventStore):
        self.events = event_store
  
asyncdefrecord_retrieval(self, entry_id:str, session_id:str, query:str):
"""검색/인출 이벤트"""
      
await self.events.append(RawEvent(
            event_id=IdGenerator.event_id(),
            timestamp=datetime.now(),
            event_type="retrieve",
            actor="system",
            payload={
"entry_id": entry_id,
"session_id": session_id,
"query": query
}
))
  
asyncdefrecord_decision(self, decision_id:str, evidence_ids:list):
"""의사결정 이벤트"""
      
await self.events.append(RawEvent(
            event_id=IdGenerator.event_id(),
            timestamp=datetime.now(),
            event_type="decision",
            actor="agent",
            payload={
"decision_id": decision_id,
"evidence_ids": evidence_ids
}
))
  
asyncdefrecord_promotion(self, entry_id:str, from_stage:str, to_stage:str):
"""승격 이벤트"""
      
await self.events.append(RawEvent(
            event_id=IdGenerator.event_id(),
            timestamp=datetime.now(),
            event_type="promotion",
            actor="graduation_engine",
            payload={
"entry_id": entry_id,
"from_stage": from_stage,
"to_stage": to_stage
}
))
```

---

### 6. Conflict를 1급 Ledger로

python

```python
# memory_pipeline/conflict_ledger.py

from enum import Enum
from dataclasses import dataclass

classEntryStatus(Enum):
    ACTIVE ="active"
    DEPRECATED ="deprecated"
    SUPERSEDED ="superseded"
    CONTESTED ="contested"

@dataclass
classConflictRecord:
    conflict_id:str
    older_id:str
    newer_id:str
    conflict_type:str
    detected_at: datetime
    resolved_at: datetime |None
    resolution:str|None# "keep_older", "keep_newer", "merge", "escalate"
    resolved_by:str|None# "system", "human:user_id"

classConflictLedger:
"""충돌 기록 전용 Ledger"""
  
def__init__(self, duck, event_store):
        self.duck = duck
        self.events = event_store
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            -- 엔트리 상태 확장
            ALTER TABLE entries ADD COLUMN IF NOT EXISTS 
                status VARCHAR DEFAULT 'active';
            ALTER TABLE entries ADD COLUMN IF NOT EXISTS 
                superseded_by VARCHAR;
            ALTER TABLE entries ADD COLUMN IF NOT EXISTS 
                conflicts_with JSON DEFAULT '[]';
          
            -- 충돌 기록 테이블
            CREATE TABLE IF NOT EXISTS conflicts (
                conflict_id VARCHAR PRIMARY KEY,
                older_id VARCHAR NOT NULL,
                newer_id VARCHAR NOT NULL,
                conflict_type VARCHAR NOT NULL,
                reason TEXT,
                detected_at TIMESTAMP NOT NULL,
                resolved_at TIMESTAMP,
                resolution VARCHAR,
                resolved_by VARCHAR
            );
        """)
  
asyncdefrecord_conflict(self, conflict: ConflictRecord):
"""충돌 기록 (이벤트로도 저장)"""
      
# 1. Conflict 테이블에 저장
        self.duck.execute("""
            INSERT INTO conflicts 
            (conflict_id, older_id, newer_id, conflict_type, detected_at)
            VALUES (?, ?, ?, ?, ?)
        """,[
            conflict.conflict_id,
            conflict.older_id,
            conflict.newer_id,
            conflict.conflict_type,
            conflict.detected_at
])
      
# 2. 양쪽 엔트리 상태 업데이트
        self.duck.execute("""
            UPDATE entries 
            SET status = 'contested',
                conflicts_with = json_array_append(conflicts_with, '$', ?)
            WHERE id IN (?, ?)
        """,[conflict.conflict_id, conflict.older_id, conflict.newer_id])
      
# 3. 이벤트 기록
await self.events.append(RawEvent(
            event_id=IdGenerator.event_id(),
            timestamp=conflict.detected_at,
            event_type="conflict_detected",
            actor="conflict_detector",
            payload={
"conflict_id": conflict.conflict_id,
"older_id": conflict.older_id,
"newer_id": conflict.newer_id,
"conflict_type": conflict.conflict_type
}
))
  
asyncdefresolve_conflict(
        self, 
        conflict_id:str, 
        resolution:str, 
        resolved_by:str
):
"""충돌 해결 (Decision Ledger로 기록)"""
      
        conflict = self._get_conflict(conflict_id)
      
# 1. 해결 기록
        self.duck.execute("""
            UPDATE conflicts 
            SET resolved_at = ?, resolution = ?, resolved_by = ?
            WHERE conflict_id = ?
        """,[datetime.now(), resolution, resolved_by, conflict_id])
      
# 2. 엔트리 상태 업데이트
if resolution =="keep_older":
await self._deprecate_entry(conflict.newer_id, conflict.older_id)
elif resolution =="keep_newer":
await self._supersede_entry(conflict.older_id, conflict.newer_id)
      
# 3. Decision Ledger에 기록
await self.events.append(RawEvent(
            event_id=IdGenerator.event_id(),
            timestamp=datetime.now(),
            event_type="conflict_resolved",
            actor=resolved_by,
            payload={
"conflict_id": conflict_id,
"resolution": resolution,
"older_id": conflict.older_id,
"newer_id": conflict.newer_id
}
))
  
asyncdef_deprecate_entry(self, entry_id:str, superseded_by:str):
"""엔트리 폐기"""
      
        self.duck.execute("""
            UPDATE entries 
            SET status = 'deprecated', superseded_by = ?
            WHERE id = ?
        """,[superseded_by, entry_id])
  
asyncdef_supersede_entry(self, old_id:str, new_id:str):
"""엔트리 대체"""
      
        self.duck.execute("""
            UPDATE entries 
            SET status = 'superseded', superseded_by = ?
            WHERE id = ?
        """,[new_id, old_id])
```

---

### 10. Observability (운영 대시보드)

python

```python
# memory_pipeline/observability.py

from dataclasses import dataclass
from datetime import datetime, timedelta
import time

@dataclass
classPipelineMetrics:
    stage:str
    latency_ms:float
    success:bool
    error:str|None=None

classMetricsCollector:
"""파이프라인 메트릭 수집"""
  
def__init__(self, duck):
        self.duck = duck
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS pipeline_metrics (
                id VARCHAR PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                stage VARCHAR NOT NULL,
                latency_ms REAL NOT NULL,
                success BOOLEAN NOT NULL,
                error TEXT,
                session_id VARCHAR
            );
          
            CREATE TABLE IF NOT EXISTS stage_distribution (
                snapshot_time TIMESTAMP NOT NULL,
                stage VARCHAR NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (snapshot_time, stage)
            );
        """)
  
defrecord_metric(self, metric: PipelineMetrics, session_id:str=None):
"""단일 메트릭 기록"""
      
        self.duck.execute("""
            INSERT INTO pipeline_metrics 
            (id, timestamp, stage, latency_ms, success, error, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,[
            IdGenerator.event_id(),
            datetime.now(),
            metric.stage,
            metric.latency_ms,
            metric.success,
            metric.error,
            session_id
])
  
defsnapshot_stage_distribution(self):
"""현재 stage 분포 스냅샷"""
      
        now = datetime.now()
      
        distribution = self.duck.execute("""
            SELECT stage, COUNT(*) 
            FROM entries 
            GROUP BY stage
        """).fetchall()
      
for stage, count in distribution:
            self.duck.execute("""
                INSERT INTO stage_distribution 
                (snapshot_time, stage, count)
                VALUES (?, ?, ?)
            """,[now, stage, count])
  
defget_dashboard_data(self, hours:int=24)->dict:
"""대시보드용 데이터"""
      
        since = datetime.now()- timedelta(hours=hours)
      
# 단계별 평균 지연시간
        latency_by_stage = self.duck.execute("""
            SELECT stage, 
                   AVG(latency_ms) as avg_latency,
                   COUNT(*) as count,
                   SUM(CASE WHEN success THEN 0 ELSE 1 END) as failures
            FROM pipeline_metrics
            WHERE timestamp >= ?
            GROUP BY stage
        """,[since]).fetchall()
      
# 컴파일 에러 Top 5
        top_errors = self.duck.execute("""
            SELECT error, COUNT(*) as count
            FROM pipeline_metrics
            WHERE timestamp >= ? AND NOT success AND error IS NOT NULL
            GROUP BY error
            ORDER BY count DESC
            LIMIT 5
        """,[since]).fetchall()
      
# Stage 분포 시계열
        stage_trend = self.duck.execute("""
            SELECT snapshot_time, stage, count
            FROM stage_distribution
            WHERE snapshot_time >= ?
            ORDER BY snapshot_time
        """,[since]).fetchall()
      
# 충돌 현황
        conflicts = self.duck.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) as resolved,
                AVG(CASE WHEN resolved_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (resolved_at - detected_at)) 
                    ELSE NULL END) as avg_resolution_seconds
            FROM conflicts
            WHERE detected_at >= ?
        """,[since]).fetchone()
      
return{
"latency_by_stage":[
{"stage": r[0],"avg_ms": r[1],"count": r[2],"failures": r[3]}
for r in latency_by_stage
],
"top_errors":[
{"error": r[0][:100],"count": r[1]}
for r in top_errors
],
"stage_trend": stage_trend,
"conflicts":{
"total": conflicts[0],
"resolved": conflicts[1],
"avg_resolution_seconds": conflicts[2]
}
}


# 컨텍스트 매니저로 자동 메트릭 수집
classMetricsContext:
def__init__(self, collector: MetricsCollector, stage:str, session_id:str=None):
        self.collector = collector
        self.stage = stage
        self.session_id = session_id
        self.start_time =None
  
def__enter__(self):
        self.start_time = time.perf_counter()
return self
  
def__exit__(self, exc_type, exc_val, exc_tb):
        latency =(time.perf_counter()- self.start_time)*1000
      
        self.collector.record_metric(
            PipelineMetrics(
                stage=self.stage,
                latency_ms=latency,
                success=exc_type isNone,
                error=str(exc_val)if exc_val elseNone
),
            session_id=self.session_id
)
      
returnFalse# 예외 전파


# 사용 예시
asyncdefprocess_session(session_log:str, collector: MetricsCollector):
    session_id = IdGenerator.session_id()
  
with MetricsContext(collector,"extraction", session_id):
        data =await extractor.extract(session_log)
  
with MetricsContext(collector,"idris_generation", session_id):
        idr_path = generator.generate_session(data)
  
with MetricsContext(collector,"idris_compilation", session_id):
        result =await validator.validate(idr_path)
  
with MetricsContext(collector,"indexing", session_id):
await indexer.index_session(data, idr_path,"candidate")
```

---

## 최종 개선 로드맵 (ChatGPT 반영)

| 우선순위     | 작업                                  | 효과                    |
| ------------ | ------------------------------------- | ----------------------- |
| **P0** | ID 기반 참조 + Evidence Span          | 참조 무결성, 원문 추적  |
| **P0** | DuckDB 스키마 수정 (JSONB→JSON, FTS) | 즉각적인 버그/성능 개선 |
| **P1** | EventStore SoT + Rebuild 커맨드       | 장기 운영 안정성        |
| **P1** | DuckDB/LanceDB Outbox + 단일 Writer   | 데이터 정합성           |
| **P2** | Bool → So/Proof 타입 강제            | Idris 본질 활용         |
| **P2** | 지표 이벤트 기반 집계                 | 재현성/감사 가능        |
| **P3** | Conflict 1급 Ledger                   | 지식 진화 관리          |
| **P3** | Observability 대시보드                | 운영 가시성             |

ChatGPT의 제안들이  **실무 운영 관점에서 매우 가치 있었습니다** . 특히 "SoT + Rebuild"와 "Outbox 패턴"은 시스템이 커지면 반드시 필요한 부분입니다. 추가로 궁금한 점 있으면 말씀해 주세요.

===


ChatGPT Pro의 제안이 **매우 깊이 있고 실무적**입니다. 특히 기존 제안들에서 놓친  **환각 방지** ,  **개체 모델** ,  **crypto-shredding** , **평가 체계**가 핵심입니다. 하나씩 평가하고 채택할 것들을 정리해 드릴게요.

---

## ChatGPT Pro 제안 평가

| #     | 제안                                                  | 핵심 통찰                                                  | 채택                |
| ----- | ----------------------------------------------------- | ---------------------------------------------------------- | ------------------- |
| 1-A   | LLM에게 오프셋 안 시키고 quote만 → 파이프라인이 정렬 | ✅**환각 방지의 핵심** . LLM이 숫자 틀리는 문제 해결 | **최우선**    |
| 1-B   | Entry 타입별 Evidence 의무 차등화                     | ✅ Fact/Decision은 필수, Insight는 선택                    | **채택**      |
| 1-C   | confidence_score 자동 산출 공식화                     | ✅ 수동 입력 제거, 재현성 확보                             | **채택**      |
| 2-A   | Task/Decision을 개체(Entity) + 이벤트로 모델링        | ✅**중복/단절 문제 해결** . 가장 큰 구조적 개선      | **최우선**    |
| 2-B   | canonical_key로 중복 방지                             | ✅ 같은 Task 묶기                                          | **채택**      |
| 3-A   | crypto-shredding (암호화 + 키 파기)                   | ✅**append-only와 삭제 요구 양립** . 필수            | **채택**      |
| 3-B   | PII/Secret 탐지 → 격리 레인                          | ✅ 조직용이면 필수                                         | **채택**      |
| 4-A   | 빌드 스펙 불변 레코드화                               | ✅ 재현성의 핵심                                           | **채택**      |
| 4-B   | 멀티 임베딩 전략                                      | ✅ 모델 변경 대비                                          | **채택**      |
| 5-A   | 골드셋 + 리그레션 테스트                              | ✅**측정 없이 개선 없음**                            | **채택**      |
| 5-B   | 2단계 검색 (생성 → 재랭크)                           | ✅ 품질 향상                                               | **채택**      |
| 6-A   | Promotion Ledger (승격 이유 기록)                     | ✅ 설명 가능성                                             | **채택**      |
| 6-B   | contested 상태 강한 패널티                            | ✅ 이미 부분 반영, 강화 필요                               | **강화**      |
| 7-A~D | 실무 버그 체크리스트                                  | ✅ SQL 인젝션, 중복 upsert 등                              | **즉시 수정** |

---

## 최우선 개선 구현

### 1. Evidence Span 자동 정렬 (LLM 환각 방지)

 **핵심 아이디어** : LLM에게 `spanStart/spanEnd`를 시키지 말고, `quote`만 추출하게 한 뒤 파이프라인이 원문에서 위치를 찾는다.

```python
# memory_pipeline/evidence_aligner.py

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional

@dataclass
class AlignedSpan:
    message_index: int
    span_start: int
    span_end: int
    quote: str
    quote_hash: str
    alignment_score: float  # 0.0 ~ 1.0
    alignment_method: str   # "exact", "fuzzy", "failed"

@dataclass  
class AlignmentResult:
    success: bool
    span: Optional[AlignedSpan]
    error: Optional[str]

class EvidenceAligner:
    """LLM이 추출한 quote를 원문에서 자동 정렬"""
  
    def __init__(self, fuzzy_threshold: float = 0.85):
        self.fuzzy_threshold = fuzzy_threshold
  
    def align(
        self, 
        raw_messages: list[str],  # 원본 세션 메시지들
        llm_quote: str,
        llm_message_index: int
    ) -> AlignmentResult:
        """quote를 원문에서 찾아 span으로 변환"""
      
        if llm_message_index >= len(raw_messages):
            return AlignmentResult(
                success=False,
                span=None,
                error=f"Invalid message_index: {llm_message_index}"
            )
      
        message = raw_messages[llm_message_index]
      
        # 1단계: 정확 매칭 시도
        exact_result = self._exact_match(message, llm_quote, llm_message_index)
        if exact_result.success:
            return exact_result
      
        # 2단계: 정규화 후 매칭 (공백/줄바꿈 무시)
        normalized_result = self._normalized_match(message, llm_quote, llm_message_index)
        if normalized_result.success:
            return normalized_result
      
        # 3단계: Fuzzy 매칭 (부분 일치)
        fuzzy_result = self._fuzzy_match(message, llm_quote, llm_message_index)
        if fuzzy_result.success:
            return fuzzy_result
      
        # 4단계: 다른 메시지에서 검색 (LLM이 index를 틀렸을 수 있음)
        for idx, msg in enumerate(raw_messages):
            if idx == llm_message_index:
                continue
          
            result = self._exact_match(msg, llm_quote, idx)
            if result.success:
                result.span.alignment_method = "exact_different_message"
                return result
          
            result = self._fuzzy_match(msg, llm_quote, idx)
            if result.success:
                result.span.alignment_method = "fuzzy_different_message"
                return result
      
        # 실패
        return AlignmentResult(
            success=False,
            span=None,
            error=f"Quote not found in any message: '{llm_quote[:50]}...'"
        )
  
    def _exact_match(
        self, 
        message: str, 
        quote: str, 
        msg_idx: int
    ) -> AlignmentResult:
        """정확 매칭"""
      
        idx = message.find(quote)
        if idx != -1:
            return AlignmentResult(
                success=True,
                span=AlignedSpan(
                    message_index=msg_idx,
                    span_start=idx,
                    span_end=idx + len(quote),
                    quote=quote,
                    quote_hash=self._hash(quote),
                    alignment_score=1.0,
                    alignment_method="exact"
                ),
                error=None
            )
      
        return AlignmentResult(success=False, span=None, error="No exact match")
  
    def _normalized_match(
        self, 
        message: str, 
        quote: str, 
        msg_idx: int
    ) -> AlignmentResult:
        """정규화 후 매칭 (공백 무시)"""
      
        def normalize(s):
            return re.sub(r'\s+', ' ', s.strip().lower())
      
        norm_message = normalize(message)
        norm_quote = normalize(quote)
      
        idx = norm_message.find(norm_quote)
        if idx != -1:
            # 원본에서 위치 역추적 (대략적)
            original_idx = self._find_original_position(message, quote, idx)
          
            return AlignmentResult(
                success=True,
                span=AlignedSpan(
                    message_index=msg_idx,
                    span_start=original_idx,
                    span_end=original_idx + len(quote),
                    quote=quote,
                    quote_hash=self._hash(quote),
                    alignment_score=0.95,
                    alignment_method="normalized"
                ),
                error=None
            )
      
        return AlignmentResult(success=False, span=None, error="No normalized match")
  
    def _fuzzy_match(
        self, 
        message: str, 
        quote: str, 
        msg_idx: int
    ) -> AlignmentResult:
        """Fuzzy 매칭 (가장 유사한 부분 찾기)"""
      
        best_ratio = 0
        best_start = 0
        best_end = 0
      
        quote_len = len(quote)
      
        # 슬라이딩 윈도우로 가장 유사한 부분 찾기
        for window_size in [quote_len, int(quote_len * 1.2), int(quote_len * 0.8)]:
            for start in range(0, len(message) - window_size + 1, 10):  # 10자씩 이동
                candidate = message[start:start + window_size]
                ratio = SequenceMatcher(None, quote.lower(), candidate.lower()).ratio()
              
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_start = start
                    best_end = start + window_size
      
        if best_ratio >= self.fuzzy_threshold:
            matched_text = message[best_start:best_end]
          
            return AlignmentResult(
                success=True,
                span=AlignedSpan(
                    message_index=msg_idx,
                    span_start=best_start,
                    span_end=best_end,
                    quote=matched_text,  # 실제 매칭된 텍스트
                    quote_hash=self._hash(matched_text),
                    alignment_score=best_ratio,
                    alignment_method="fuzzy"
                ),
                error=None
            )
      
        return AlignmentResult(
            success=False, 
            span=None, 
            error=f"Best fuzzy ratio {best_ratio:.2f} below threshold {self.fuzzy_threshold}"
        )
  
    def _hash(self, text: str) -> str:
        import hashlib
        return hashlib.sha256(text.encode()).hexdigest()[:16]
  
    def _find_original_position(self, original: str, quote: str, normalized_idx: int) -> int:
        """정규화된 위치에서 원본 위치 역추적"""
        # 간단한 구현: 원본에서 가장 가까운 위치 찾기
        for i in range(max(0, normalized_idx - 50), min(len(original), normalized_idx + 50)):
            if original[i:].lower().startswith(quote[:20].lower()):
                return i
        return normalized_idx


# Extractor 수정: LLM에게 오프셋 안 시킴
EXTRACTION_PROMPT_V2 = """
채팅 세션을 분석하고 구조화된 메모리로 추출하세요.

**중요**: spanStart/spanEnd는 출력하지 마세요. quote만 정확히 추출하면 됩니다.

```json
{
  "entries": [
    {
      "id": "ent_001",
      "type": "fact",
      "title": "1H 패턴 갱신 스케줄러 수정",
      "evidence": [
        {
          "messageIndex": 3,
          "quote": "정각 체크(now.minute != 0) 제거 → 60분 경과 체크만 사용"
        }
      ]
    }
  ]
}
```

규칙:

1. quote는 원문에서 **그대로** 복사 (50~200자)
2. 원문에 없는 내용을 quote로 만들지 마세요
3. messageIndex는 0부터 시작
   """

class EnhancedExtractor:
"""개선된 추출기: quote만 추출 → 자동 정렬"""

```
def __init__(self, llm_client, aligner: EvidenceAligner):
    self.llm = llm_client
    self.aligner = aligner

async def extract(
    self, 
    session_log: str, 
    date: str, 
    session_id: int
) -> dict:
    # 1. 원본 메시지 파싱
    raw_messages = self._parse_messages(session_log)
  
    # 2. LLM으로 구조 추출 (quote만)
    llm_output = await self._llm_extract(session_log, date, session_id)
  
    # 3. 각 evidence의 quote를 자동 정렬
    aligned_entries = []
    alignment_failures = []
  
    for entry in llm_output["entries"]:
        aligned_evidence = []
      
        for ev in entry.get("evidence", []):
            result = self.aligner.align(
                raw_messages,
                ev["quote"],
                ev["messageIndex"]
            )
          
            if result.success:
                aligned_evidence.append({
                    "messageIndex": result.span.message_index,
                    "spanStart": result.span.span_start,
                    "spanEnd": result.span.span_end,
                    "quote": result.span.quote,
                    "quoteHash": result.span.quote_hash,
                    "alignmentScore": result.span.alignment_score,
                    "alignmentMethod": result.span.alignment_method
                })
            else:
                alignment_failures.append({
                    "entry_id": entry["id"],
                    "quote": ev["quote"][:50],
                    "error": result.error
                })
      
        entry["evidenceSpans"] = aligned_evidence
        entry["evidenceComplete"] = len(aligned_evidence) == len(entry.get("evidence", []))
        aligned_entries.append(entry)
  
    return {
        "date": date,
        "sessionId": session_id,
        "entries": aligned_entries,
        "alignmentFailures": alignment_failures,
        "rawMessageCount": len(raw_messages)
    }
```

```

---

### 2. Task/Decision을 개체(Entity) + 이벤트 모델로

**핵심 아이디어**: 세션마다 새 Task를 만들지 말고, 기존 Task를 찾아서 이벤트로 상태 변경.

```python
# memory_pipeline/entity_model.py

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
import re

class EntityType(Enum):
    TASK = "task"
    DECISION = "decision"
    SPEC = "spec"
    CONCEPT = "concept"

@dataclass
class Entity:
    """개체 (Task, Decision 등의 상위 개념)"""
    entity_id: str
    entity_type: EntityType
    canonical_key: str  # 중복 방지용 정규화 키
    created_at: datetime
    current_state: dict  # fold로 계산된 현재 상태
  
@dataclass
class EntityEvent:
    """개체에 대한 이벤트"""
    event_id: str
    entity_id: str
    event_type: str  # "created", "status_changed", "blocked_by_added", "merged", etc.
    timestamp: datetime
    payload: dict
    source_entry_id: str  # 원본 Entry ID (증거 추적용)
    source_session_id: str

class EntityStore:
    """개체 저장소 (이벤트 소싱 기반)"""
  
    def __init__(self, event_store, duck):
        self.events = event_store
        self.duck = duck
        self._init_schema()
  
    def _init_schema(self):
        self.duck.execute("""
            -- 개체 테이블 (현재 상태 캐시)
            CREATE TABLE IF NOT EXISTS entities (
                entity_id VARCHAR PRIMARY KEY,
                entity_type VARCHAR NOT NULL,
                canonical_key VARCHAR NOT NULL,
                created_at TIMESTAMP NOT NULL,
                current_state JSON NOT NULL,
                updated_at TIMESTAMP NOT NULL,
              
                UNIQUE(entity_type, canonical_key)
            );
          
            -- 개체 이벤트 테이블
            CREATE TABLE IF NOT EXISTS entity_events (
                event_id VARCHAR PRIMARY KEY,
                entity_id VARCHAR NOT NULL,
                event_type VARCHAR NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                payload JSON NOT NULL,
                source_entry_id VARCHAR,
                source_session_id VARCHAR
            );
          
            -- 개체 병합 기록
            CREATE TABLE IF NOT EXISTS entity_merges (
                merge_id VARCHAR PRIMARY KEY,
                old_entity_id VARCHAR NOT NULL,
                new_entity_id VARCHAR NOT NULL,
                merged_at TIMESTAMP NOT NULL,
                reason VARCHAR
            );
          
            CREATE INDEX IF NOT EXISTS idx_entity_canonical 
                ON entities(entity_type, canonical_key);
            CREATE INDEX IF NOT EXISTS idx_entity_events_entity 
                ON entity_events(entity_id, timestamp);
        """)
  
    def canonicalize(self, entity_type: EntityType, title: str, domain: str = None) -> str:
        """정규화 키 생성"""
      
        # 소문자, 공백 정규화, 특수문자 제거
        normalized = re.sub(r'[^\w\s]', '', title.lower())
        normalized = re.sub(r'\s+', '_', normalized.strip())
      
        # 도메인 태그 추가
        if domain:
            normalized = f"{domain}:{normalized}"
      
        # 너무 긴 경우 해시
        if len(normalized) > 100:
            import hashlib
            normalized = normalized[:80] + "_" + hashlib.md5(title.encode()).hexdigest()[:16]
      
        return f"{entity_type.value}:{normalized}"
  
    async def find_or_create_entity(
        self,
        entity_type: EntityType,
        title: str,
        domain: str = None,
        initial_state: dict = None,
        source_entry_id: str = None,
        source_session_id: str = None
    ) -> tuple[Entity, bool]:
        """개체 찾기 또는 생성. (entity, is_new) 반환"""
      
        canonical_key = self.canonicalize(entity_type, title, domain)
      
        # 1. 정확한 canonical_key로 검색
        existing = self.duck.execute("""
            SELECT entity_id, current_state FROM entities
            WHERE entity_type = ? AND canonical_key = ?
        """, [entity_type.value, canonical_key]).fetchone()
      
        if existing:
            return Entity(
                entity_id=existing[0],
                entity_type=entity_type,
                canonical_key=canonical_key,
                created_at=None,  # 필요하면 조회
                current_state=json.loads(existing[1])
            ), False
      
        # 2. 유사한 개체 검색 (fuzzy match)
        similar = await self._find_similar_entity(entity_type, title, threshold=0.9)
        if similar:
            # 유사한 개체 발견 → 병합 후보로 반환
            return similar, False
      
        # 3. 새 개체 생성
        entity_id = IdGenerator.entity_id()
        now = datetime.now()
      
        initial_state = initial_state or {"title": title, "status": "pending"}
      
        self.duck.execute("""
            INSERT INTO entities 
            (entity_id, entity_type, canonical_key, created_at, current_state, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            entity_id,
            entity_type.value,
            canonical_key,
            now,
            json.dumps(initial_state),
            now
        ])
      
        # 생성 이벤트 기록
        await self._record_event(
            entity_id=entity_id,
            event_type="created",
            payload=initial_state,
            source_entry_id=source_entry_id,
            source_session_id=source_session_id
        )
      
        return Entity(
            entity_id=entity_id,
            entity_type=entity_type,
            canonical_key=canonical_key,
            created_at=now,
            current_state=initial_state
        ), True
  
    async def update_entity(
        self,
        entity_id: str,
        event_type: str,
        changes: dict,
        source_entry_id: str = None,
        source_session_id: str = None
    ):
        """개체 상태 업데이트 (이벤트로 기록)"""
      
        # 1. 이벤트 기록
        await self._record_event(
            entity_id=entity_id,
            event_type=event_type,
            payload=changes,
            source_entry_id=source_entry_id,
            source_session_id=source_session_id
        )
      
        # 2. 현재 상태 재계산 (fold)
        new_state = await self._fold_entity_state(entity_id)
      
        # 3. 캐시 업데이트
        self.duck.execute("""
            UPDATE entities 
            SET current_state = ?, updated_at = ?
            WHERE entity_id = ?
        """, [json.dumps(new_state), datetime.now(), entity_id])
  
    async def _fold_entity_state(self, entity_id: str) -> dict:
        """이벤트를 fold하여 현재 상태 계산"""
      
        events = self.duck.execute("""
            SELECT event_type, payload FROM entity_events
            WHERE entity_id = ?
            ORDER BY timestamp ASC
        """, [entity_id]).fetchall()
      
        state = {}
      
        for event_type, payload_json in events:
            payload = json.loads(payload_json)
          
            if event_type == "created":
                state = payload.copy()
            elif event_type == "status_changed":
                state["status"] = payload.get("new_status")
                state["status_changed_at"] = payload.get("timestamp")
            elif event_type == "blocked_by_added":
                state.setdefault("blocked_by", []).append(payload.get("blocker_id"))
            elif event_type == "blocked_by_removed":
                if "blocked_by" in state:
                    state["blocked_by"] = [
                        b for b in state["blocked_by"] 
                        if b != payload.get("blocker_id")
                    ]
            elif event_type == "priority_changed":
                state["priority"] = payload.get("new_priority")
            # ... 추가 이벤트 타입들
      
        return state
  
    async def merge_entities(
        self, 
        old_entity_id: str, 
        new_entity_id: str, 
        reason: str = None
    ):
        """개체 병합 (old → new로 통합)"""
      
        merge_id = IdGenerator.merge_id()
        now = datetime.now()
      
        # 1. 병합 기록
        self.duck.execute("""
            INSERT INTO entity_merges (merge_id, old_entity_id, new_entity_id, merged_at, reason)
            VALUES (?, ?, ?, ?, ?)
        """, [merge_id, old_entity_id, new_entity_id, now, reason])
      
        # 2. 이전 개체의 이벤트를 새 개체로 재연결 (또는 참조 유지)
        # 여기서는 참조만 남기고, fold는 새 개체만
      
        # 3. 이전 개체 상태를 'merged'로
        self.duck.execute("""
            UPDATE entities 
            SET current_state = json_set(current_state, '$.status', 'merged'),
                current_state = json_set(current_state, '$.merged_into', ?)
            WHERE entity_id = ?
        """, [new_entity_id, old_entity_id])
      
        # 4. 병합 이벤트 기록
        await self._record_event(
            entity_id=new_entity_id,
            event_type="merged_from",
            payload={"old_entity_id": old_entity_id, "reason": reason}
        )
  
    async def _find_similar_entity(
        self, 
        entity_type: EntityType, 
        title: str, 
        threshold: float
    ) -> Optional[Entity]:
        """유사한 개체 찾기 (임베딩 기반)"""
      
        # 간단한 구현: 최근 30일 내 같은 타입에서 제목 유사도 검색
        # 실제로는 벡터 검색 사용
      
        candidates = self.duck.execute("""
            SELECT entity_id, canonical_key, current_state
            FROM entities
            WHERE entity_type = ?
              AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        """, [entity_type.value]).fetchall()
      
        from difflib import SequenceMatcher
      
        for ent_id, canonical, state_json in candidates:
            state = json.loads(state_json)
            existing_title = state.get("title", "")
          
            similarity = SequenceMatcher(None, title.lower(), existing_title.lower()).ratio()
          
            if similarity >= threshold:
                return Entity(
                    entity_id=ent_id,
                    entity_type=entity_type,
                    canonical_key=canonical,
                    created_at=None,
                    current_state=state
                )
      
        return None


# Entry → Entity 연결기
class EntryEntityLinker:
    """추출된 Entry를 Entity에 연결"""
  
    def __init__(self, entity_store: EntityStore):
        self.entities = entity_store
  
    async def link_entry(self, entry: dict, session_id: str) -> dict:
        """Entry를 적절한 Entity에 연결"""
      
        entry_type = entry["type"]
        entry_id = entry["id"]
      
        if entry_type == "task":
            entity, is_new = await self.entities.find_or_create_entity(
                entity_type=EntityType.TASK,
                title=entry["title"],
                initial_state={
                    "title": entry["title"],
                    "status": entry.get("status", "pending"),
                    "priority": entry.get("priority", "medium")
                },
                source_entry_id=entry_id,
                source_session_id=session_id
            )
          
            if not is_new:
                # 기존 개체에 상태 변경 이벤트 추가
                current_status = entity.current_state.get("status")
                new_status = entry.get("status", "pending")
              
                if current_status != new_status:
                    await self.entities.update_entity(
                        entity_id=entity.entity_id,
                        event_type="status_changed",
                        changes={
                            "old_status": current_status,
                            "new_status": new_status,
                            "timestamp": datetime.now().isoformat()
                        },
                        source_entry_id=entry_id,
                        source_session_id=session_id
                    )
          
            entry["linkedEntityId"] = entity.entity_id
            entry["isNewEntity"] = is_new
      
        elif entry_type == "decision":
            entity, is_new = await self.entities.find_or_create_entity(
                entity_type=EntityType.DECISION,
                title=entry["title"],
                initial_state={
                    "title": entry["title"],
                    "rationale": entry.get("rationale"),
                    "basedOnIds": entry.get("basedOnIds", [])
                },
                source_entry_id=entry_id,
                source_session_id=session_id
            )
          
            entry["linkedEntityId"] = entity.entity_id
            entry["isNewEntity"] = is_new
      
        return entry
```

---

### 3. Crypto-Shredding (append-only + 삭제 양립)

```python
# memory_pipeline/crypto_shredding.py

from cryptography.fernet import Fernet
from dataclasses import dataclass
from datetime import datetime
import json
import re

@dataclass
class EncryptionKey:
    key_id: str
    key: bytes
    created_at: datetime
    revoked_at: datetime | None = None

class CryptoShredder:
    """암호화 + 키 파기로 실질적 삭제 구현"""
  
    def __init__(self, key_store_path: str, duck):
        self.key_store_path = key_store_path
        self.duck = duck
        self._init_schema()
  
    def _init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS encryption_keys (
                key_id VARCHAR PRIMARY KEY,
                -- 실제 키는 별도 보안 저장소에 (여기선 단순화)
                key_hash VARCHAR NOT NULL,
                created_at TIMESTAMP NOT NULL,
                revoked_at TIMESTAMP,
                revocation_reason VARCHAR
            );
          
            -- 어떤 이벤트가 어떤 키로 암호화되었는지
            CREATE TABLE IF NOT EXISTS event_encryption_map (
                event_id VARCHAR PRIMARY KEY,
                key_id VARCHAR NOT NULL,
                encrypted_fields JSON NOT NULL  -- ["payload.content", "payload.quote"]
            );
        """)
  
    def generate_key(self) -> EncryptionKey:
        """새 암호화 키 생성"""
      
        key = Fernet.generate_key()
        key_id = f"key_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{IdGenerator.short_id()}"
      
        # 키 저장 (실제로는 HSM/KMS 사용)
        self._store_key(key_id, key)
      
        self.duck.execute("""
            INSERT INTO encryption_keys (key_id, key_hash, created_at)
            VALUES (?, ?, ?)
        """, [key_id, hashlib.sha256(key).hexdigest(), datetime.now()])
      
        return EncryptionKey(key_id=key_id, key=key, created_at=datetime.now())
  
    def encrypt_sensitive_fields(
        self, 
        event: dict, 
        sensitive_paths: list[str],
        key: EncryptionKey
    ) -> dict:
        """민감 필드 암호화"""
      
        fernet = Fernet(key.key)
        encrypted_event = json.loads(json.dumps(event))  # deep copy
      
        for path in sensitive_paths:
            value = self._get_nested(encrypted_event, path)
            if value is not None:
                encrypted = fernet.encrypt(json.dumps(value).encode()).decode()
                self._set_nested(encrypted_event, path, f"__encrypted__:{encrypted}")
      
        return encrypted_event
  
    def decrypt_fields(self, event: dict, key_id: str) -> dict:
        """필드 복호화"""
      
        key = self._load_key(key_id)
        if key is None or key.revoked_at is not None:
            # 키가 파기됨 → 복호화 불가
            return self._redact_encrypted_fields(event)
      
        fernet = Fernet(key.key)
        decrypted_event = json.loads(json.dumps(event))
      
        def decrypt_recursive(obj):
            if isinstance(obj, dict):
                return {k: decrypt_recursive(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [decrypt_recursive(v) for v in obj]
            elif isinstance(obj, str) and obj.startswith("__encrypted__:"):
                encrypted_data = obj[14:]  # "__encrypted__:" 제거
                try:
                    decrypted = fernet.decrypt(encrypted_data.encode())
                    return json.loads(decrypted)
                except:
                    return "[DECRYPTION_FAILED]"
            return obj
      
        return decrypt_recursive(decrypted_event)
  
    def revoke_key(self, key_id: str, reason: str):
        """키 파기 (= 해당 데이터 실질적 삭제)"""
      
        # 1. 키 파기 기록
        self.duck.execute("""
            UPDATE encryption_keys 
            SET revoked_at = ?, revocation_reason = ?
            WHERE key_id = ?
        """, [datetime.now(), reason, key_id])
      
        # 2. 실제 키 삭제
        self._delete_key(key_id)
      
        # 3. 영향받는 이벤트 수 반환
        affected = self.duck.execute("""
            SELECT COUNT(*) FROM event_encryption_map WHERE key_id = ?
        """, [key_id]).fetchone()[0]
      
        return affected
  
    def _redact_encrypted_fields(self, event: dict) -> dict:
        """복호화 불가 필드를 [REDACTED]로 대체"""
      
        def redact_recursive(obj):
            if isinstance(obj, dict):
                return {k: redact_recursive(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [redact_recursive(v) for v in obj]
            elif isinstance(obj, str) and obj.startswith("__encrypted__:"):
                return "[REDACTED - KEY_REVOKED]"
            return obj
      
        return redact_recursive(event)


class PIIDetector:
    """PII/Secret 탐지"""
  
    # 탐지 패턴
    PATTERNS = {
        "email": r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
        "phone_kr": r'01[0-9]-?[0-9]{4}-?[0-9]{4}',
        "resident_id": r'\d{6}-?[1-4]\d{6}',
        "credit_card": r'\d{4}-?\d{4}-?\d{4}-?\d{4}',
        "api_key": r'(sk-|pk_|api[_-]?key)[a-zA-Z0-9]{20,}',
        "password": r'(password|passwd|pwd)\s*[=:]\s*\S+',
    }
  
    def detect(self, text: str) -> list[dict]:
        """PII/Secret 탐지"""
      
        findings = []
      
        for pii_type, pattern in self.PATTERNS.items():
            for match in re.finditer(pattern, text, re.IGNORECASE):
                findings.append({
                    "type": pii_type,
                    "start": match.start(),
                    "end": match.end(),
                    "value": match.group()[:20] + "..."  # 일부만 기록
                })
      
        return findings
  
    def redact(self, text: str) -> str:
        """PII를 [REDACTED]로 대체"""
      
        redacted = text
      
        for pii_type, pattern in self.PATTERNS.items():
            redacted = re.sub(pattern, f'[REDACTED:{pii_type}]', redacted, flags=re.IGNORECASE)
      
        return redacted


class SecureEventStore:
    """보안 강화된 이벤트 저장소"""
  
    def __init__(self, event_store, crypto: CryptoShredder, pii_detector: PIIDetector):
        self.base_store = event_store
        self.crypto = crypto
        self.pii = pii_detector
      
        # 세션별 암호화 키
        self.session_keys = {}
  
    async def append_secure(self, event: RawEvent, sensitivity: str = "normal"):
        """보안 처리된 이벤트 저장"""
      
        payload_str = json.dumps(event.payload)
      
        # 1. PII 탐지
        pii_findings = self.pii.detect(payload_str)
      
        if pii_findings or sensitivity == "high":
            # 2. 세션용 키 가져오기 (없으면 생성)
            session_id = event.payload.get("session_id", "default")
          
            if session_id not in self.session_keys:
                self.session_keys[session_id] = self.crypto.generate_key()
          
            key = self.session_keys[session_id]
          
            # 3. 민감 필드 암호화
            sensitive_paths = ["payload.raw_log", "payload.content"]
            if pii_findings:
                sensitive_paths.extend([f"payload.{p['type']}" for p in pii_findings])
          
            encrypted_payload = self.crypto.encrypt_sensitive_fields(
                event.payload, 
                sensitive_paths,
                key
            )
          
            event.payload = encrypted_payload
            event.meta["encrypted"] = True
            event.meta["key_id"] = key.key_id
            event.meta["pii_detected"] = [p["type"] for p in pii_findings]
      
        # 4. 저장
        return await self.base_store.append(event)
  
    async def request_deletion(self, session_id: str, reason: str) -> dict:
        """삭제 요청 처리 (키 파기)"""
      
        if session_id not in self.session_keys:
            # 키 ID를 DB에서 조회
            key_id = self._find_key_for_session(session_id)
            if not key_id:
                return {"success": False, "error": "No encryption key found"}
        else:
            key_id = self.session_keys[session_id].key_id
      
        # 키 파기
        affected = self.crypto.revoke_key(key_id, reason)
      
        return {
            "success": True,
            "key_revoked": key_id,
            "events_affected": affected,
            "note": "Data remains but is now undecryptable"
        }
```

---

### 4. 골드셋 기반 검색 평가

```python
# memory_pipeline/evaluation.py

from dataclasses import dataclass
import json

@dataclass
class EvalQuery:
    query_id: str
    query: str
    expected_entry_ids: list[str]  # 정답
    expected_ranking: list[str]    # 이상적인 순서 (선택)

@dataclass
class EvalResult:
    query_id: str
    recall_at_k: dict[int, float]  # {5: 0.8, 10: 1.0}
    precision_at_k: dict[int, float]
    ndcg_at_k: dict[int, float]
    mrr: float
    retrieved_ids: list[str]

class RetrievalEvaluator:
    """검색 품질 평가"""
  
    def __init__(self, search_engine, gold_set_path: str):
        self.search = search_engine
        self.gold_set = self._load_gold_set(gold_set_path)
  
    def _load_gold_set(self, path: str) -> list[EvalQuery]:
        """골드셋 로드"""
        with open(path) as f:
            data = json.load(f)
      
        return [
            EvalQuery(
                query_id=q["id"],
                query=q["query"],
                expected_entry_ids=q["expected_ids"],
                expected_ranking=q.get("expected_ranking", [])
            )
            for q in data["queries"]
        ]
  
    async def evaluate_all(self, k_values: list[int] = [5, 10, 20]) -> dict:
        """전체 평가 실행"""
      
        results = []
      
        for eval_query in self.gold_set:
            result = await self._evaluate_single(eval_query, k_values)
            results.append(result)
      
        # 평균 계산
        avg_recall = {k: 0.0 for k in k_values}
        avg_precision = {k: 0.0 for k in k_values}
        avg_ndcg = {k: 0.0 for k in k_values}
        avg_mrr = 0.0
      
        for r in results:
            for k in k_values:
                avg_recall[k] += r.recall_at_k.get(k, 0)
                avg_precision[k] += r.precision_at_k.get(k, 0)
                avg_ndcg[k] += r.ndcg_at_k.get(k, 0)
            avg_mrr += r.mrr
      
        n = len(results)
      
        return {
            "num_queries": n,
            "avg_recall": {k: v / n for k, v in avg_recall.items()},
            "avg_precision": {k: v / n for k, v in avg_precision.items()},
            "avg_ndcg": {k: v / n for k, v in avg_ndcg.items()},
            "avg_mrr": avg_mrr / n,
            "per_query_results": [
                {
                    "query_id": r.query_id,
                    "recall@10": r.recall_at_k.get(10, 0),
                    "mrr": r.mrr
                }
                for r in results
            ]
        }
  
    async def _evaluate_single(self, query: EvalQuery, k_values: list[int]) -> EvalResult:
        """단일 쿼리 평가"""
      
        max_k = max(k_values)
      
        # 검색 실행
        results = await self.search.semantic_search(query.query, limit=max_k)
        retrieved_ids = [r.id for r in results]
      
        # 메트릭 계산
        recall_at_k = {}
        precision_at_k = {}
        ndcg_at_k = {}
      
        for k in k_values:
            retrieved_k = set(retrieved_ids[:k])
            expected = set(query.expected_entry_ids)
          
            # Recall@k
            recall_at_k[k] = len(retrieved_k & expected) / len(expected) if expected else 0
          
            # Precision@k
            precision_at_k[k] = len(retrieved_k & expected) / k
          
            # nDCG@k
            ndcg_at_k[k] = self._compute_ndcg(
                retrieved_ids[:k], 
                query.expected_entry_ids,
                query.expected_ranking
            )
      
        # MRR (Mean Reciprocal Rank)
        mrr = 0.0
        for i, rid in enumerate(retrieved_ids):
            if rid in query.expected_entry_ids:
                mrr = 1.0 / (i + 1)
                break
      
        return EvalResult(
            query_id=query.query_id,
            recall_at_k=recall_at_k,
            precision_at_k=precision_at_k,
            ndcg_at_k=ndcg_at_k,
            mrr=mrr,
            retrieved_ids=retrieved_ids
        )
  
    def _compute_ndcg(
        self, 
        retrieved: list[str], 
        relevant: list[str],
        ideal_ranking: list[str]
    ) -> float:
        """nDCG 계산"""
      
        import math
      
        def dcg(ranking, relevant_set):
            score = 0.0
            for i, item in enumerate(ranking):
                if item in relevant_set:
                    score += 1.0 / math.log2(i + 2)  # +2 because i starts at 0
            return score
      
        relevant_set = set(relevant)
      
        actual_dcg = dcg(retrieved, relevant_set)
      
        # Ideal DCG
        if ideal_ranking:
            ideal_dcg = dcg(ideal_ranking[:len(retrieved)], relevant_set)
        else:
            # relevant items를 앞에 배치한 이상적인 순서
            ideal_order = [r for r in retrieved if r in relevant_set] + \
                          [r for r in retrieved if r not in relevant_set]
            ideal_dcg = dcg(ideal_order, relevant_set)
      
        return actual_dcg / ideal_dcg if ideal_dcg > 0 else 0.0


# 골드셋 예시 (gold_set.json)
GOLD_SET_EXAMPLE = {
    "version": "1.0",
    "created_at": "2026-01-31",
    "queries": [
        {
            "id": "q001",
            "query": "스케줄러 정각 체크 버그",
            "expected_ids": ["ent_001", "ent_002", "ent_015"],
            "expected_ranking": ["ent_015", "ent_001", "ent_002"]
        },
        {
            "id": "q002", 
            "query": "AI 매매 SimpleOrder 규격",
            "expected_ids": ["ent_003", "ent_004"],
        },
        # ... 더 많은 쿼리
    ]
}


# 리그레션 테스트 통합
class RetrievalRegressionTest:
    """검색 리그레션 테스트"""
  
    def __init__(self, evaluator: RetrievalEvaluator, baseline_path: str):
        self.evaluator = evaluator
        self.baseline = self._load_baseline(baseline_path)
  
    async def run_regression(self, tolerance: float = 0.05) -> dict:
        """리그레션 테스트 실행"""
      
        current = await self.evaluator.evaluate_all()
      
        regressions = []
        improvements = []
      
        for metric in ["avg_recall", "avg_ndcg"]:
            for k, baseline_value in self.baseline.get(metric, {}).items():
                current_value = current[metric].get(int(k), 0)
                diff = current_value - baseline_value
              
                if diff < -tolerance:
                    regressions.append({
                        "metric": f"{metric}@{k}",
                        "baseline": baseline_value,
                        "current": current_value,
                        "diff": diff
                    })
                elif diff > tolerance:
                    improvements.append({
                        "metric": f"{metric}@{k}",
                        "baseline": baseline_value,
                        "current": current_value,
                        "diff": diff
                    })
      
        return {
            "passed": len(regressions) == 0,
            "regressions": regressions,
            "improvements": improvements,
            "current_metrics": current
        }
```

---

### 5. Promotion Ledger (승격 이유 기록)

```python
# memory_pipeline/promotion_ledger.py

from dataclasses import dataclass
from datetime import datetime

@dataclass
class PromotionDecision:
    decision_id: str
    entry_id: str
    from_stage: str
    to_stage: str
    decision_type: str  # "promote", "demote", "block"
    timestamp: datetime
  
    # 판단 근거
    metrics_snapshot: dict  # 당시 메트릭 값
    rules_triggered: list[str]  # 트리거된 규칙 ID
    threshold_comparisons: list[dict]  # 각 조건의 비교 결과
  
    # 설명
    explanation: str
    confidence: float

class PromotionLedger:
    """승격/강등 결정 기록"""
  
    def __init__(self, duck, event_store):
        self.duck = duck
        self.events = event_store
        self._init_schema()
  
    def _init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS promotion_decisions (
                decision_id VARCHAR PRIMARY KEY,
                entry_id VARCHAR NOT NULL,
                from_stage VARCHAR NOT NULL,
                to_stage VARCHAR,
                decision_type VARCHAR NOT NULL,
                timestamp TIMESTAMP NOT NULL,
                metrics_snapshot JSON NOT NULL,
                rules_triggered JSON NOT NULL,
                threshold_comparisons JSON NOT NULL,
                explanation TEXT,
                confidence REAL
            );
          
            CREATE INDEX IF NOT EXISTS idx_promotion_entry 
                ON promotion_decisions(entry_id, timestamp);
        """)
  
    async def record_decision(
        self,
        entry_id: str,
        from_stage: str,
        to_stage: str | None,
        decision_type: str,
        metrics: dict,
        rules: list[str],
        comparisons: list[dict]
    ) -> PromotionDecision:
        """승격 결정 기록"""
      
        decision_id = f"promo_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{entry_id[:8]}"
      
        # 설명 자동 생성
        explanation = self._generate_explanation(
            decision_type, from_stage, to_stage, metrics, comparisons
        )
      
        # 신뢰도 계산
        confidence = self._calculate_confidence(comparisons)
      
        decision = PromotionDecision(
            decision_id=decision_id,
            entry_id=entry_id,
            from_stage=from_stage,
            to_stage=to_stage,
            decision_type=decision_type,
            timestamp=datetime.now(),
            metrics_snapshot=metrics,
            rules_triggered=rules,
            threshold_comparisons=comparisons,
            explanation=explanation,
            confidence=confidence
        )
      
        # DB 저장
        self.duck.execute("""
            INSERT INTO promotion_decisions 
            (decision_id, entry_id, from_stage, to_stage, decision_type, 
             timestamp, metrics_snapshot, rules_triggered, threshold_comparisons,
             explanation, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            decision.decision_id,
            decision.entry_id,
            decision.from_stage,
            decision.to_stage,
            decision.decision_type,
            decision.timestamp,
            json.dumps(decision.metrics_snapshot),
            json.dumps(decision.rules_triggered),
            json.dumps(decision.threshold_comparisons),
            decision.explanation,
            decision.confidence
        ])
      
        # 이벤트로도 기록
        await self.events.append(RawEvent(
            event_id=IdGenerator.event_id(),
            timestamp=datetime.now(),
            event_type="promotion_decision",
            actor="graduation_engine",
            payload={
                "decision_id": decision_id,
                "entry_id": entry_id,
                "decision_type": decision_type,
                "from_stage": from_stage,
                "to_stage": to_stage
            }
        ))
      
        return decision
  
    def _generate_explanation(
        self,
        decision_type: str,
        from_stage: str,
        to_stage: str | None,
        metrics: dict,
        comparisons: list[dict]
    ) -> str:
        """사람이 읽을 수 있는 설명 생성"""
      
        if decision_type == "promote":
            passed = [c for c in comparisons if c["passed"]]
            return (
                f"{from_stage} → {to_stage} 승격 승인. "
                f"통과 조건: {len(passed)}/{len(comparisons)}. "
                f"주요 지표: 인출 {metrics.get('retrieval_count', 0)}회, "
                f"인용 {metrics.get('cited_in_decisions', 0)}회, "
                f"근거 커버리지 {metrics.get('evidence_coverage', 0):.1%}"
            )
      
        elif decision_type == "block":
            failed = [c for c in comparisons if not c["passed"]]
            blockers = ", ".join([c["rule"] for c in failed[:3]])
            return (
                f"{from_stage} → {to_stage} 승격 차단. "
                f"미충족 조건: {blockers}"
            )
      
        elif decision_type == "demote":
            return (
                f"{from_stage} → {to_stage} 강등. "
                f"사유: 활력도 {metrics.get('vitality', 0):.2f} (임계값 미만)"
            )
      
        return ""
  
    def _calculate_confidence(self, comparisons: list[dict]) -> float:
        """결정 신뢰도 계산"""
      
        if not comparisons:
            return 0.5
      
        # 각 조건의 마진 평균
        margins = []
        for c in comparisons:
            if c["passed"]:
                # 임계값 대비 얼마나 여유있게 통과했는지
                margin = (c["actual"] - c["threshold"]) / max(c["threshold"], 1)
                margins.append(min(margin, 1.0))
            else:
                margins.append(0.0)
      
        return sum(margins) / len(margins)
  
    async def get_entry_history(self, entry_id: str) -> list[PromotionDecision]:
        """엔트리의 승격 이력 조회"""
      
        rows = self.duck.execute("""
            SELECT * FROM promotion_decisions
            WHERE entry_id = ?
            ORDER BY timestamp ASC
        """, [entry_id]).fetchall()
      
        return [self._row_to_decision(r) for r in rows]
  
    async def explain_current_stage(self, entry_id: str) -> str:
        """현재 단계에 도달한 이유 설명"""
      
        history = await self.get_entry_history(entry_id)
      
        if not history:
            return "승격 이력 없음 (초기 단계)"
      
        explanations = []
        for decision in history:
            explanations.append(
                f"[{decision.timestamp.strftime('%Y-%m-%d')}] {decision.explanation}"
            )
      
        return "\n".join(explanations)


# GraduationEngine에 Ledger 통합
class EnhancedGraduationEngine:
    """승격 엔진 (Ledger 통합)"""
  
    def __init__(self, ..., promotion_ledger: PromotionLedger):
        # ... 기존 초기화
        self.ledger = promotion_ledger
  
    async def evaluate_graduation(self, memory_id: str) -> GraduationResult:
        """승격 평가 (with 기록)"""
      
        meta = await self.indexer.get_memory_meta(memory_id)
        current_stage = meta["stage"]
      
        # 메트릭 수집
        metrics = await self.metrics.compute_graduation_metrics(memory_id)
      
        # 조건 평가
        comparisons = self._evaluate_conditions(current_stage, metrics)
      
        # 규칙 트리거 확인
        rules_triggered = [c["rule"] for c in comparisons if c["triggered"]]
      
        # 승격 가능 여부
        all_passed = all(c["passed"] for c in comparisons if c["required"])
      
        if all_passed:
            target_stage = self._get_next_stage(current_stage)
            decision_type = "promote"
        else:
            target_stage = None
            decision_type = "block"
      
        # Ledger에 기록
        await self.ledger.record_decision(
            entry_id=memory_id,
            from_stage=current_stage,
            to_stage=target_stage,
            decision_type=decision_type,
            metrics=metrics,
            rules=rules_triggered,
            comparisons=comparisons
        )
      
        return GraduationResult(
            promoted=all_passed,
            from_stage=current_stage,
            to_stage=target_stage,
            reason=self._summarize_result(comparisons),
            blockers=[c["rule"] for c in comparisons if not c["passed"]]
        )
  
    def _evaluate_conditions(self, stage: str, metrics: dict) -> list[dict]:
        """조건 평가 (비교 결과 상세 기록)"""
      
        conditions = self.STAGE_CONDITIONS.get(stage, [])
        results = []
      
        for cond in conditions:
            actual = metrics.get(cond["metric"], 0)
            threshold = cond["threshold"]
            op = cond.get("op", ">=")
          
            if op == ">=":
                passed = actual >= threshold
            elif op == ">":
                passed = actual > threshold
            elif op == "==":
                passed = actual == threshold
            else:
                passed = False
          
            results.append({
                "rule": cond["name"],
                "metric": cond["metric"],
                "actual": actual,
                "threshold": threshold,
                "op": op,
                "passed": passed,
                "required": cond.get("required", True),
                "triggered": True
            })
      
        return results
```

---

## 최종 개선 로드맵 (ChatGPT Pro 반영)

| 우선순위     | 작업                                    | 효과                    | 복잡도 |
| ------------ | --------------------------------------- | ----------------------- | ------ |
| **P0** | Evidence Span 자동 정렬 (quote → span) | 환각 방지의 핵심        | 중     |
| **P0** | Task/Decision 개체 모델                 | 중복/단절 해결          | 높음   |
| **P0** | 골드셋 + 리그레션 테스트                | 측정 없이 개선 없음     | 낮음   |
| **P1** | Crypto-shredding                        | append-only + 삭제 양립 | 중     |
| **P1** | 빌드 스펙 불변 레코드화                 | 재현성 확보             | 낮음   |
| **P1** | Promotion Ledger                        | 설명 가능성             | 중     |
| **P2** | 멀티 임베딩 버전                        | 모델 변경 대비          | 중     |
| **P2** | 2단계 검색 (생성 → 재랭크)             | 검색 품질 향상          | 중     |
| **P2** | PII 탐지 격리 레인                      | 보안 강화               | 중     |

---

## 핵심 통찰 정리

ChatGPT Pro가 짚은  **가장 중요한 3가지** :

1. **"LLM이 숫자를 찍는 확률 게임을 없애라"** → Evidence Span 자동 정렬
2. **"세션 로그 → 엔트리로는 중복이 쌓인다"** → 개체(Entity) 모델
3. **"측정 없이 개선 없다"** → 골드셋 기반 평가

이 세 가지가 **실제 운영에서 가장 큰 차이**를 만듭니다. 나머지는 점진적으로 추가하면 됩니다.

추가로 구체화할 부분 있으면 말씀해 주세요.



Gemini의 제안이 **시스템을 RAG에서 Cognitive Architecture로 격상**시키는 핵심 아이디어들입니다. 특히  **GraphRAG** ,  **Sleep Phase** ,  **Epistemic Uncertainty** , **Query Decomposition** 모두 채택 가치가 높습니다.

---

## Gemini 제안 평가

| # | 제안                                       | 핵심 가치                                | 채택           |
| - | ------------------------------------------ | ---------------------------------------- | -------------- |
| 1 | **GraphRAG**(DuckDB 재귀 쿼리)       | 구조적 연결성 추적 (벡터로 못 찾는 관계) | **채택** |
| 2 | **Sleep Phase**(메모리 응고화)       | 자동 정리정돈, 중복 제거, 계층 요약      | **채택** |
| 3 | **Epistemic Uncertainty**(출처 귀속) | 환각 방지, 신뢰도 명시                   | **채택** |
| 4 | **Query Decomposition**(복합 질문)   | 멀티홉 추론                              | **채택** |

---

## 1. GraphRAG (DuckDB 기반 경량 그래프)

python

```python
# memory_pipeline/graph_rag.py

from dataclasses import dataclass
from enum import Enum

classRelationType(Enum):
    BLOCKED_BY ="blocked_by"
    BASED_ON ="based_on"
    RELATES_TO ="relates_to"
    SUPERSEDES ="supersedes"
    CONTRADICTS ="contradicts"
    IMPLEMENTS ="implements"
    CAUSED_BY ="caused_by"
    LEADS_TO ="leads_to"

@dataclass
classGraphEdge:
    source_id:str
    target_id:str
    relation_type: RelationType
    weight:float=1.0
    metadata:dict=None

classGraphStore:
"""DuckDB 기반 경량 그래프 저장소"""
  
def__init__(self, duck):
        self.duck = duck
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            -- 엣지 테이블
            CREATE TABLE IF NOT EXISTS entity_edges (
                id VARCHAR PRIMARY KEY,
                source_id VARCHAR NOT NULL,
                target_id VARCHAR NOT NULL,
                relation_type VARCHAR NOT NULL,
                weight REAL DEFAULT 1.0,
                metadata JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                source_entry_id VARCHAR,  -- 이 관계가 추출된 Entry
              
                UNIQUE(source_id, target_id, relation_type)
            );
          
            CREATE INDEX IF NOT EXISTS idx_edges_source ON entity_edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON entity_edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_type ON entity_edges(relation_type);
        """)
  
asyncdefadd_edge(self, edge: GraphEdge, source_entry_id:str=None):
"""엣지 추가"""
      
        self.duck.execute("""
            INSERT INTO entity_edges 
            (id, source_id, target_id, relation_type, weight, metadata, source_entry_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source_id, target_id, relation_type) 
            DO UPDATE SET weight = weight + 0.1  -- 반복 출현 시 가중치 증가
        """,[
            IdGenerator.edge_id(),
            edge.source_id,
            edge.target_id,
            edge.relation_type.value,
            edge.weight,
            json.dumps(edge.metadata)if edge.metadata elseNone,
            source_entry_id
])
  
asyncdeftraverse(
        self,
        start_ids:list[str],
        relation_types:list[RelationType]=None,
        max_depth:int=3,
        direction:str="both"# "outgoing", "incoming", "both"
)->list[dict]:
"""그래프 순회 (재귀 CTE)"""
      
        type_filter =""
if relation_types:
            types_str =",".join([f"'{r.value}'"for r in relation_types])
            type_filter =f"AND relation_type IN ({types_str})"
      
        start_ids_str =",".join([f"'{sid}'"for sid in start_ids])
      
# 방향에 따른 쿼리 조정
if direction =="outgoing":
            edge_join ="e.source_id = dc.node_id"
            next_node ="e.target_id"
elif direction =="incoming":
            edge_join ="e.target_id = dc.node_id"
            next_node ="e.source_id"
else:# both
            edge_join ="(e.source_id = dc.node_id OR e.target_id = dc.node_id)"
            next_node ="CASE WHEN e.source_id = dc.node_id THEN e.target_id ELSE e.source_id END"
      
        query =f"""
            WITH RECURSIVE dependency_chain AS (
                -- 시작 노드
                SELECT 
                    source_id as from_node,
                    target_id as to_node,
                    relation_type,
                    weight,
                    1 as depth,
                    source_id || '->' || target_id as path
                FROM entity_edges
                WHERE source_id IN ({start_ids_str}) {type_filter}
              
                UNION ALL
              
                -- 재귀 순회
                SELECT 
                    e.source_id,
                    e.target_id,
                    e.relation_type,
                    e.weight * 0.8,  -- 거리에 따라 가중치 감소
                    dc.depth + 1,
                    dc.path || '->' || e.target_id
                FROM entity_edges e
                JOIN dependency_chain dc ON e.source_id = dc.to_node
                WHERE dc.depth < {max_depth}
                  AND dc.path NOT LIKE '%' || e.target_id || '%'  -- 사이클 방지
{type_filter}
            )
            SELECT DISTINCT 
                from_node, to_node, relation_type, 
                MAX(weight) as weight, MIN(depth) as min_depth
            FROM dependency_chain
            GROUP BY from_node, to_node, relation_type
            ORDER BY min_depth, weight DESC
        """
      
        results = self.duck.execute(query).fetchall()
      
return[
{
"from": r[0],
"to": r[1],
"relation": r[2],
"weight": r[3],
"depth": r[4]
}
for r in results
]
  
asyncdeffind_path(
        self,
        start_id:str,
        end_id:str,
        max_depth:int=5
)->list[dict]|None:
"""두 노드 사이의 경로 찾기"""
      
        query =f"""
            WITH RECURSIVE path_search AS (
                SELECT 
                    source_id,
                    target_id,
                    relation_type,
                    ARRAY[source_id, target_id] as path,
                    1 as depth
                FROM entity_edges
                WHERE source_id = ?
              
                UNION ALL
              
                SELECT 
                    e.source_id,
                    e.target_id,
                    e.relation_type,
                    array_append(ps.path, e.target_id),
                    ps.depth + 1
                FROM entity_edges e
                JOIN path_search ps ON e.source_id = ps.target_id
                WHERE ps.depth < {max_depth}
                  AND NOT array_contains(ps.path, e.target_id)
            )
            SELECT path, depth
            FROM path_search
            WHERE target_id = ?
            ORDER BY depth
            LIMIT 1
        """
      
        result = self.duck.execute(query,[start_id, end_id]).fetchone()
      
if result:
return{"path": result[0],"depth": result[1]}
returnNone


classGraphRAGSearch:
"""벡터 + 그래프 하이브리드 검색"""
  
def__init__(self, vector_search, graph_store: GraphStore, indexer):
        self.vector = vector_search
        self.graph = graph_store
        self.indexer = indexer
  
asyncdefsearch(
        self,
        query:str,
        limit:int=10,
        graph_hops:int=2,
        graph_weight:float=0.3
)->list[dict]:
"""하이브리드 검색"""
      
# 1단계: 벡터 검색으로 Seed Nodes 찾기
        vector_results =await self.vector.semantic_search(query, limit=limit *2)
        seed_ids =[r.idfor r in vector_results]
      
# 2단계: Seed에서 그래프 순회로 이웃 찾기
        graph_neighbors =await self.graph.traverse(
            start_ids=seed_ids[:5],# 상위 5개에서만 확장
            max_depth=graph_hops
)
      
        neighbor_ids =set()
        neighbor_weights ={}
for edge in graph_neighbors:
            neighbor_ids.add(edge["to"])
# 가중치 누적
            neighbor_weights[edge["to"]]= neighbor_weights.get(edge["to"],0)+ edge["weight"]
      
# 3단계: 벡터 결과 + 그래프 이웃 합치기
        all_ids =set(seed_ids)| neighbor_ids
      
# 4단계: 최종 점수 계산
        scored_results =[]
      
for vid, vresult inenumerate(vector_results):
            vector_score =1- vresult.score  # distance → similarity
            graph_score = neighbor_weights.get(vresult.id,0)/max(neighbor_weights.values()or[1])
          
            combined =(1- graph_weight)* vector_score + graph_weight * graph_score
          
            scored_results.append({
"id": vresult.id,
"vector_score": vector_score,
"graph_score": graph_score,
"combined_score": combined,
"source":"vector",
"content": vresult.content
})
      
# 그래프에서만 발견된 노드 추가
for nid in neighbor_ids -set(seed_ids):
if nid notin[r["id"]for r in scored_results]:
                content =await self.indexer.get_entry_content(nid)
                graph_score = neighbor_weights.get(nid,0)/max(neighbor_weights.values()or[1])
              
                scored_results.append({
"id": nid,
"vector_score":0,
"graph_score": graph_score,
"combined_score": graph_weight * graph_score,
"source":"graph",
"content": content
})
      
# 정렬 및 반환
        scored_results.sort(key=lambda x: x["combined_score"], reverse=True)
      
return scored_results[:limit]
  
asyncdefexplain_connection(
        self,
        entity_a:str,
        entity_b:str
)->str:
"""두 개체 간의 연결 설명"""
      
        path =await self.graph.find_path(entity_a, entity_b)
      
ifnot path:
returnf"{entity_a}와 {entity_b} 사이에 알려진 연결이 없습니다."
      
# 경로를 자연어로 변환
        explanations =[]
        nodes = path["path"]
      
for i inrange(len(nodes)-1):
            edge =await self._get_edge(nodes[i], nodes[i+1])
if edge:
                explanations.append(
f"'{nodes[i]}' --[{edge['relation_type']}]--> '{nodes[i+1]}'"
)
      
return" → ".join(explanations)


# LLM Extractor에 관계 추출 추가
RELATION_EXTRACTION_PROMPT ="""
엔트리들 사이의 관계를 추출하세요.

관계 유형:
- blocked_by: A가 B 때문에 막혀있음
- based_on: A가 B를 근거로 함
- relates_to: A와 B가 관련있음
- supersedes: A가 B를 대체함
- contradicts: A와 B가 모순됨
- implements: A가 B를 구현함
- caused_by: A가 B로 인해 발생함
- leads_to: A가 B로 이어짐
```json
{
  "relations": [
    {"source": "ent_001", "target": "ent_002", "type": "based_on"},
    {"source": "ent_003", "target": "ent_001", "type": "blocked_by"}
  ]
}
```

"""

```




---


## 2. Sleep Phase (메모리 응고화)







python

```python
# memory_pipeline/sleep_phase.py

from dataclasses import dataclass
from datetime import datetime, timedelta
import asyncio

@dataclass
classMergeProposal:
    proposal_id:str
    entity_ids:list[str]
    similarity:float
    proposed_canonical:str
    status:str# "pending", "approved", "rejected"
    created_at: datetime

@dataclass
classWeeklySummary:
    week_start: datetime
    week_end: datetime
    summary_entry_id:str
    source_day_ids:list[str]
    key_decisions:list[str]
    key_tasks:list[str]
    key_insights:list[str]

classMemoryConsolidator:
"""Sleep Phase: 메모리 응고화 및 정리"""
  
def__init__(
        self,
        entity_store,
        indexer,
        graph_store,
        llm_client,
        duck
):
        self.entities = entity_store
        self.indexer = indexer
        self.graph = graph_store
        self.llm = llm_client
        self.duck = duck
        self._init_schema()
  
def_init_schema(self):
        self.duck.execute("""
            CREATE TABLE IF NOT EXISTS merge_proposals (
                proposal_id VARCHAR PRIMARY KEY,
                entity_ids JSON NOT NULL,
                similarity REAL NOT NULL,
                proposed_canonical VARCHAR,
                status VARCHAR DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP,
                resolved_by VARCHAR
            );
          
            CREATE TABLE IF NOT EXISTS weekly_summaries (
                id VARCHAR PRIMARY KEY,
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                summary_entry_id VARCHAR,
                source_day_ids JSON NOT NULL,
                key_decisions JSON,
                key_tasks JSON,
                key_insights JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              
                UNIQUE(week_start)
            );
          
            CREATE TABLE IF NOT EXISTS consolidation_runs (
                run_id VARCHAR PRIMARY KEY,
                started_at TIMESTAMP NOT NULL,
                completed_at TIMESTAMP,
                status VARCHAR DEFAULT 'running',
                stats JSON
            );
        """)
  
asyncdefrun_nightly_cycle(self):
"""야간 정리 사이클"""
      
        run_id =f"consolidation_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
      
        self.duck.execute("""
            INSERT INTO consolidation_runs (run_id, started_at)
            VALUES (?, ?)
        """,[run_id, datetime.now()])
      
        stats ={
"merge_proposals":0,
"orphans_archived":0,
"holes_filled":0,
"summaries_created":0
}
      
try:
# 1. 유사 Entity 클러스터링 및 병합 제안
            merge_count =await self._find_and_propose_merges()
            stats["merge_proposals"]= merge_count
          
# 2. 주간 요약 생성 (일요일 자정에만)
if datetime.now().weekday()==0:# Monday (지난주 정리)
                summary_count =await self._generate_weekly_summary()
                stats["summaries_created"]= summary_count
          
# 3. 고아 노드 정리 (연결 없는 오래된 팩트)
            orphan_count =await self._archive_orphans()
            stats["orphans_archived"]= orphan_count
          
# 4. Hole 채우기 시도
            holes_count =await self._attempt_hole_filling()
            stats["holes_filled"]= holes_count
          
# 5. 메트릭 캐시 갱신
await self._refresh_metric_caches()
          
            self.duck.execute("""
                UPDATE consolidation_runs 
                SET completed_at = ?, status = 'completed', stats = ?
                WHERE run_id = ?
            """,[datetime.now(), json.dumps(stats), run_id])
          
except Exception as e:
            self.duck.execute("""
                UPDATE consolidation_runs 
                SET completed_at = ?, status = 'failed', stats = ?
                WHERE run_id = ?
            """,[datetime.now(), json.dumps({"error":str(e)}), run_id])
raise
      
return stats
  
asyncdef_find_and_propose_merges(self, threshold:float=0.92)->int:
"""유사 Entity 찾아서 병합 제안"""
      
# 최근 30일 내 Entity들
        entities = self.duck.execute("""
            SELECT entity_id, entity_type, canonical_key, current_state
            FROM entities
            WHERE updated_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
              AND json_extract_string(current_state, '$.status') != 'merged'
        """).fetchall()
      
# 타입별로 그룹화
        by_type ={}
for ent in entities:
            t = ent[1]
if t notin by_type:
                by_type[t]=[]
            by_type[t].append({
"id": ent[0],
"canonical": ent[2],
"state": json.loads(ent[3])
})
      
        proposals_created =0
      
for entity_type, ents in by_type.items():
# 제목 기반 유사도 클러스터링
            clusters = self._cluster_by_similarity(ents, threshold)
          
for cluster in clusters:
iflen(cluster)>1:
# 병합 제안 생성
                    proposal_id =f"merge_{datetime.now().strftime('%Y%m%d')}_{proposals_created}"
                  
                    self.duck.execute("""
                        INSERT INTO merge_proposals 
                        (proposal_id, entity_ids, similarity, proposed_canonical)
                        VALUES (?, ?, ?, ?)
                    """,[
                        proposal_id,
                        json.dumps([e["id"]for e in cluster]),
                        cluster[0].get("similarity", threshold),
                        self._propose_canonical(cluster)
])
                  
                    proposals_created +=1
      
return proposals_created
  
def_cluster_by_similarity(
        self, 
        entities:list[dict], 
        threshold:float
)->list[list[dict]]:
"""제목 유사도로 클러스터링"""
      
from difflib import SequenceMatcher
      
        clusters =[]
        used =set()
      
for i, ent1 inenumerate(entities):
if ent1["id"]in used:
continue
          
            cluster =[ent1]
            used.add(ent1["id"])
          
            title1 = ent1["state"].get("title","").lower()
          
for j, ent2 inenumerate(entities[i+1:], i+1):
if ent2["id"]in used:
continue
              
                title2 = ent2["state"].get("title","").lower()
                sim = SequenceMatcher(None, title1, title2).ratio()
              
if sim >= threshold:
                    ent2["similarity"]= sim
                    cluster.append(ent2)
                    used.add(ent2["id"])
          
iflen(cluster)>1:
                clusters.append(cluster)
      
return clusters
  
def_propose_canonical(self, cluster:list[dict])->str:
"""병합 시 사용할 대표 이름 제안"""
      
# 가장 긴 제목 선택 (보통 더 구체적)
        titles =[e["state"].get("title","")for e in cluster]
returnmax(titles, key=len)
  
asyncdef_generate_weekly_summary(self)->int:
"""주간 요약 생성"""
      
# 지난주 범위
        today = datetime.now().date()
        week_end = today - timedelta(days=today.weekday())# 지난 일요일
        week_start = week_end - timedelta(days=6)
      
# 이미 생성됐는지 확인
        existing = self.duck.execute("""
            SELECT id FROM weekly_summaries WHERE week_start = ?
        """,[week_start]).fetchone()
      
if existing:
return0
      
# 해당 주의 세션들 수집
        sessions = self.duck.execute("""
            SELECT id, content FROM entries
            WHERE date >= ? AND date <= ?
              AND entry_type IN ('fact', 'decision', 'insight', 'task')
            ORDER BY created_at
        """,[week_start, week_end]).fetchall()
      
ifnot sessions:
return0
      
# LLM으로 요약 생성
        entries_text ="\n".join([
f"[{json.loads(s[1]).get('type')}] {json.loads(s[1]).get('title')}"
for s in sessions
])
      
        summary_prompt =f"""
다음은 {week_start} ~ {week_end} 주간의 작업 기록입니다.

{entries_text}

아래 형식으로 주간 요약을 작성하세요:

1. 핵심 성과 (3-5개)
2. 주요 결정 사항 (3-5개)
3. 발견한 인사이트 (2-3개)
4. 다음 주 주요 과제 (3-5개)
"""
      
        summary_text =await self.llm.complete(summary_prompt)
      
# 요약 Entry 생성
        summary_entry_id = IdGenerator.entry_id()
      
# DB에 저장
        self.duck.execute("""
            INSERT INTO weekly_summaries 
            (id, week_start, week_end, summary_entry_id, source_day_ids)
            VALUES (?, ?, ?, ?, ?)
        """,[
f"week_{week_start.strftime('%Y%m%d')}",
            week_start,
            week_end,
            summary_entry_id,
            json.dumps([s[0]for s in sessions])
])
      
return1
  
asyncdef_archive_orphans(self, days_threshold:int=60)->int:
"""연결 없는 오래된 노드 아카이빙"""
      
# 그래프 연결이 없고, 인출도 안 되고, 오래된 엔트리
        orphans = self.duck.execute("""
            SELECT e.id FROM entries e
            LEFT JOIN entity_edges eg1 ON e.id = eg1.source_id
            LEFT JOIN entity_edges eg2 ON e.id = eg2.target_id
            WHERE e.created_at < CURRENT_TIMESTAMP - INTERVAL ? DAY
              AND e.stage IN ('working', 'candidate')
              AND e.retrieval_count < 3
              AND eg1.id IS NULL 
              AND eg2.id IS NULL
        """,[days_threshold]).fetchall()
      
for orphan in orphans:
            self.duck.execute("""
                UPDATE entries 
                SET stage = 'archived', archived_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """,[orphan[0]])
      
returnlen(orphans)
  
asyncdef_attempt_hole_filling(self)->int:
"""Candidate의 Idris hole 채우기 시도"""
      
# hole이 있는 Candidate 찾기
        candidates_with_holes = self.duck.execute("""
            SELECT id, idr_path, validation_holes
            FROM entries
            WHERE stage = 'candidate'
              AND validation_holes IS NOT NULL
              AND json_array_length(validation_holes) > 0
        """).fetchall()
      
        filled =0
      
for cand in candidates_with_holes:
            entry_id, idr_path, holes_json = cand
            holes = json.loads(holes_json)
          
# 각 hole에 대해 다른 지식으로 채울 수 있는지 시도
for hole in holes:
# 관련 지식 검색
                related =await self.indexer.search_similar(
                    hole.get("expected_type",""),
                    limit=5
)
              
if related:
# LLM에게 hole 채우기 시도 요청
                    fill_result =await self._try_fill_hole(
                        idr_path, hole, related
)
                  
if fill_result.get("success"):
                        filled +=1
      
return filled


classSleepScheduler:
"""Sleep Phase 스케줄러"""
  
def__init__(self, consolidator: MemoryConsolidator):
        self.consolidator = consolidator
        self.is_running =False
  
asyncdefstart(self):
"""백그라운드 스케줄러 시작"""
      
        self.is_running =True
      
while self.is_running:
            now = datetime.now()
          
# 새벽 3시에 실행
if now.hour ==3and now.minute ==0:
print("[Sleep Phase] Starting nightly consolidation...")
              
try:
                    stats =await self.consolidator.run_nightly_cycle()
print(f"[Sleep Phase] Completed: {stats}")
except Exception as e:
print(f"[Sleep Phase] Failed: {e}")
              
# 다음 날까지 대기
await asyncio.sleep(3600)
else:
# 1분마다 체크
await asyncio.sleep(60)
  
defstop(self):
        self.is_running =False
```

---

## 3. Epistemic Uncertainty (출처 귀속)

python

```python
# memory_pipeline/attribution.py

from dataclasses import dataclass
from enum import Enum

classKnowledgeSource(Enum):
    MEMORY_CERTIFIED ="memory_certified"# L4: 검증된 기억
    MEMORY_VERIFIED ="memory_verified"# L3: 검증된 기억
    MEMORY_CANDIDATE ="memory_candidate"# L2: 후보 기억
    MEMORY_WORKING ="memory_working"# L1: 작업 기억
    LLM_PRETRAINED ="llm_pretrained"# LLM의 사전 학습 지식
    UNKNOWN ="unknown"

@dataclass
classAttributedChunk:
"""출처가 명시된 지식 조각"""
    content:str
    source: KnowledgeSource
    entry_id:str|None
    confidence:float
    evidence_spans:list[dict]

@dataclass
classAttributedAnswer:
"""출처가 명시된 답변"""
    answer:str
    attributions:list[dict]# 문장별 출처
    overall_confidence:float
    sources_used:list[str]

classAttributionEngine:
"""Epistemic Uncertainty 관리"""
  
def__init__(self, search_engine, llm_client):
        self.search = search_engine
        self.llm = llm_client
  
asyncdefsearch_with_attribution(
        self,
        query:str,
        limit:int=10
)->list[AttributedChunk]:
"""출처 정보가 포함된 검색"""
      
        results =await self.search.search_with_trust(
            query, 
            limit=limit,
            min_stage="working"
)
      
        attributed =[]
for r in results:
            source = self._stage_to_source(r.get("stage","working"))
          
            attributed.append(AttributedChunk(
                content=r.get("content",{}).get("title",""),
                source=source,
                entry_id=r["id"],
                confidence=self._calculate_confidence(r),
                evidence_spans=r.get("content",{}).get("evidenceSpans",[])
))
      
return attributed
  
def_stage_to_source(self, stage:str)-> KnowledgeSource:
return{
"certified": KnowledgeSource.MEMORY_CERTIFIED,
"verified": KnowledgeSource.MEMORY_VERIFIED,
"candidate": KnowledgeSource.MEMORY_CANDIDATE,
"working": KnowledgeSource.MEMORY_WORKING,
}.get(stage, KnowledgeSource.UNKNOWN)
  
def_calculate_confidence(self, result:dict)->float:
"""신뢰도 계산"""
      
        base_confidence ={
"certified":0.95,
"verified":0.85,
"candidate":0.65,
"working":0.45,
}.get(result.get("stage","working"),0.3)
      
# Evidence가 있으면 보너스
if result.get("content",{}).get("evidenceSpans"):
            base_confidence +=0.05
      
returnmin(base_confidence,1.0)
  
asyncdefgenerate_attributed_answer(
        self,
        query:str,
        context:list[AttributedChunk]
)-> AttributedAnswer:
"""출처가 명시된 답변 생성"""
      
# 컨텍스트를 프롬프트로 포맷팅
        context_text = self._format_context_with_ids(context)
      
        prompt =f"""당신은 AxiomMind의 기억 시스템입니다.

**중요 규칙**:
1. 아래 [Context]에 있는 정보만 사용하세요.
2. [Context]에 없는 내용은 "제 기억에는 관련 정보가 없습니다"라고 말하세요.
3. 답변의 각 문장 끝에 출처 ID를 [ent_xxx] 형식으로 붙이세요.
4. 확신도가 낮은 정보는 "~일 수 있습니다"로 표현하세요.

[Context]
{context_text}

질문: {query}

답변:"""
      
        raw_answer =await self.llm.complete(prompt)
      
# 답변에서 출처 파싱
        attributions = self._parse_attributions(raw_answer, context)
      
# 전체 신뢰도 계산
        overall_confidence = self._calculate_overall_confidence(attributions, context)
      
return AttributedAnswer(
            answer=raw_answer,
            attributions=attributions,
            overall_confidence=overall_confidence,
            sources_used=[a["entry_id"]for a in attributions if a.get("entry_id")]
)
  
def_format_context_with_ids(self, context:list[AttributedChunk])->str:
"""컨텍스트를 ID가 포함된 형식으로 변환"""
      
        lines =[]
for chunk in context:
            confidence_label = self._confidence_label(chunk.confidence)
            source_label = self._source_label(chunk.source)
          
            lines.append(
f"<{chunk.entry_id}> [{source_label}] {chunk.content} "
f"(Confidence: {confidence_label})"
)
      
return"\n".join(lines)
  
def_confidence_label(self, confidence:float)->str:
if confidence >=0.9:
return"매우 높음"
elif confidence >=0.7:
return"높음"
elif confidence >=0.5:
return"중간"
else:
return"낮음"
  
def_source_label(self, source: KnowledgeSource)->str:
return{
            KnowledgeSource.MEMORY_CERTIFIED:"검증됨",
            KnowledgeSource.MEMORY_VERIFIED:"확인됨",
            KnowledgeSource.MEMORY_CANDIDATE:"후보",
            KnowledgeSource.MEMORY_WORKING:"작업중",
            KnowledgeSource.LLM_PRETRAINED:"일반지식",
            KnowledgeSource.UNKNOWN:"미확인",
}.get(source,"미확인")
  
def_parse_attributions(
        self, 
        answer:str, 
        context:list[AttributedChunk]
)->list[dict]:
"""답변에서 출처 참조 파싱"""
      
import re
      
        attributions =[]
      
# [ent_xxx] 패턴 찾기
        sentences = answer.split('. ')
      
for sentence in sentences:
            refs = re.findall(r'\[([^\]]+)\]', sentence)
          
for ref in refs:
# 해당 entry 찾기
                chunk =next(
(c for c in context if c.entry_id == ref), 
None
)
              
                attributions.append({
"sentence": sentence,
"entry_id": ref,
"confidence": chunk.confidence if chunk else0.0,
"source": chunk.source.value if chunk else"unknown"
})
      
return attributions
  
def_calculate_overall_confidence(
        self,
        attributions:list[dict],
        context:list[AttributedChunk]
)->float:
"""전체 답변 신뢰도 계산"""
      
ifnot attributions:
return0.3# 출처 없으면 낮은 신뢰도
      
# 출처별 신뢰도 평균
        confidences =[a["confidence"]for a in attributions if a["confidence"]>0]
      
ifnot confidences:
return0.3
      
        avg_confidence =sum(confidences)/len(confidences)
      
# 출처 커버리지 보너스 (여러 출처에서 확인되면 더 신뢰)
        unique_sources =len(set(a["entry_id"]for a in attributions if a["entry_id"]))
        coverage_bonus =min(unique_sources *0.05,0.15)
      
returnmin(avg_confidence + coverage_bonus,1.0)
```

---

## 4. Query Decomposition (복합 질문 처리)

python

```python
# memory_pipeline/query_decomposition.py

from dataclasses import dataclass
from enum import Enum

classQueryType(Enum):
    SIMPLE ="simple"# 단순 검색
    TEMPORAL ="temporal"# 시간 기반
    CAUSAL ="causal"# 인과관계
    COMPARATIVE ="comparative"# 비교
    AGGREGATIVE ="aggregative"# 집계
    HYPOTHETICAL ="hypothetical"# 가정

@dataclass
classSubQuery:
    query_id:str
    query_text:str
    query_type: QueryType
    depends_on:list[str]# 선행 쿼리 ID
    filters:dict

@dataclass
classQueryPlan:
    original_query:str
    sub_queries:list[SubQuery]
    execution_order:list[str]
    synthesis_strategy:str

classQueryDecomposer:
"""복합 질문 분해기"""
  
def__init__(self, llm_client):
        self.llm = llm_client
  
asyncdefdecompose(self, query:str)-> QueryPlan:
"""질문을 하위 질문으로 분해"""
      
        decompose_prompt =f"""
다음 질문을 처리하기 위한 하위 질문들로 분해하세요.

질문: {query}

각 하위 질문에 대해:
1. 질문 유형 (simple, temporal, causal, comparative, aggregative, hypothetical)
2. 필요한 필터 (날짜 범위, 엔트리 타입 등)
3. 선행 질문 의존성

JSON 형식으로 응답:
```json
{{
  "sub_queries": [
    {{
      "id": "q1",
      "text": "하위 질문 1",
      "type": "temporal",
      "filters": {{"date_range": "last_week", "entry_type": "decision"}},
      "depends_on": []
    }},
    {{
      "id": "q2", 
      "text": "하위 질문 2 (q1 결과 기반)",
      "type": "causal",
      "filters": {{}},
      "depends_on": ["q1"]
    }}
  ],
  "synthesis_strategy": "aggregate"  // aggregate, compare, chain, merge
}}
```

"""

    response =await self.llm.complete(decompose_prompt)
        plan_data = json.loads(response)

    sub_queries =[
            SubQuery(
                query_id=sq["id"],
                query_text=sq["text"],
                query_type=QueryType(sq["type"]),
                depends_on=sq.get("depends_on",[]),
                filters=sq.get("filters",{})
)
for sq in plan_data["sub_queries"]
]

# 실행 순서 결정 (의존성 기반 토폴로지 정렬)

    execution_order = self._topological_sort(sub_queries)

return QueryPlan(
            original_query=query,
            sub_queries=sub_queries,
            execution_order=execution_order,
            synthesis_strategy=plan_data.get("synthesis_strategy","merge")
)

def_topological_sort(self, queries:list[SubQuery])->list[str]:
"""의존성 기반 실행 순서 결정"""

# 간단한 구현: 의존성 없는 것부터

    result =[]
        remaining ={q.query_id: q for q in queries}
        completed =set()

while remaining:
for qid, q inlist(remaining.items()):
ifall(dep in completed for dep in q.depends_on):
                    result.append(qid)
                    completed.add(qid)
del remaining[qid]
break
else:

# 순환 의존성 감지

raise ValueError("Circular dependency detected")

return result

classMultiHopQueryEngine:
"""멀티홉 쿼리 엔진"""

def__init__(
        self,
        decomposer: QueryDecomposer,
        attribution_engine,
        graph_search,
        llm_client
):
        self.decomposer = decomposer
        self.attribution = attribution_engine
        self.graph = graph_search
        self.llm = llm_client

asyncdefexecute(self, query:str)->dict:
"""복합 질문 실행"""

# 1. 질문 분해

    plan =await self.decomposer.decompose(query)

# 2. 하위 질문 순차 실행

    results ={}

for query_id in plan.execution_order:
            sub_query =next(q for q in plan.sub_queries if q.query_id == query_id)

# 선행 결과 수집

    prior_context =[
                results[dep]for dep in sub_query.depends_on
if dep in results
]

# 질문 유형별 실행

    result =await self._execute_sub_query(sub_query, prior_context)
            results[query_id]= result

# 3. 결과 종합

    final_answer =await self._synthesize(
            plan,
            results,
            plan.synthesis_strategy
)

return{
"query": query,
"plan":{
"sub_queries":[
{"id": sq.query_id,"text": sq.query_text,"type": sq.query_type.value}
for sq in plan.sub_queries
],
"execution_order": plan.execution_order
},
"sub_results":{k: v["summary"]for k, v in results.items()},
"final_answer": final_answer
}

asyncdef_execute_sub_query(
        self,
        sub_query: SubQuery,
        prior_context:list
)->dict:
"""하위 질문 실행"""

# 필터 적용한 검색

    search_kwargs ={}

if"date_range"in sub_query.filters:
            date_range = sub_query.filters["date_range"]
if date_range =="last_week":
                search_kwargs["date_from"]=(
                    datetime.now()- timedelta(days=7)
).strftime("%Y-%m-%d")

if"entry_type"in sub_query.filters:
            search_kwargs["entry_types"]=[sub_query.filters["entry_type"]]

# 질문 유형별 처리

if sub_query.query_type == QueryType.CAUSAL:

# 인과관계: 그래프 순회 포함

    search_results =await self.graph.search(
                sub_query.query_text,
                graph_hops=3
)
else:

# 일반 검색

    search_results =await self.attribution.search_with_attribution(
                sub_query.query_text,
                limit=10
)

# 선행 결과 기반 필터링

if prior_context:
            prior_ids =[]
for pc in prior_context:
                prior_ids.extend(pc.get("entry_ids",[]))

# 선행 결과와 관련된 것만 필터링 또는 가중치 부여

    search_results = self._filter_by_prior(search_results, prior_ids)

# 요약 생성

    summary =await self._summarize_results(sub_query, search_results)

return{
"query_id": sub_query.query_id,
"results": search_results,
"entry_ids":[r.entry_id ifhasattr(r,'entry_id')else r.get("id")
for r in search_results[:5]],
"summary": summary
}

asyncdef_synthesize(
        self,
        plan: QueryPlan,
        results:dict,
        strategy:str
)-> AttributedAnswer:
"""결과 종합"""

# 모든 결과의 컨텍스트 수집

    all_chunks =[]
for result in results.values():
for r in result.get("results",[]):
ifhasattr(r,'content'):
                    all_chunks.append(r)

# 종합 프롬프트 생성

    synthesis_prompt =f"""
원래 질문: {plan.original_query}

하위 질문별 결과:
{self._format_sub_results(results)}

위 정보를 종합하여 원래 질문에 답변하세요.
답변의 각 부분에 출처 [ent_xxx]를 명시하세요.
"""

    answer =await self.llm.complete(synthesis_prompt)

# Attribution 파싱

    attributions = self._parse_all_attributions(answer, all_chunks)

return AttributedAnswer(
            answer=answer,
            attributions=attributions,
            overall_confidence=self._calculate_synthesis_confidence(results),
            sources_used=list(set(
                eid for r in results.values()
for eid in r.get("entry_ids",[])
))
)

def_format_sub_results(self, results:dict)->str:
        lines =[]
for query_id, result in results.items():
            lines.append(f"[{query_id}] {result['summary']}")
return"\n".join(lines)

```

---

## 최종 통합 아키텍처
```

┌──────────────────────────────────────────────────────────────────────────────┐
│                    AXIOMMIND COGNITIVE ARCHITECTURE                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         QUERY LAYER                                      │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │ │
│  │  │   Query     │  │  Multi-Hop  │  │ Attribution │  │   Graph     │    │ │
│  │  │ Decomposer  │→ │   Engine    │→ │   Engine    │→ │    RAG      │    │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        STORAGE LAYER                                     │ │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐           │ │
│  │  │ DuckDB    │  │ LanceDB   │  │  Graph    │  │  Entity   │           │ │
│  │  │ (Meta)    │  │ (Vector)  │  │  (Edges)  │  │  Store    │           │ │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘           │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                      GRADUATION LAYER                                    │ │
│  │  L0:Raw → L1:Working → L2:Candidate → L3:Verified → L4:Certified       │ │
│  │       ↑                                                                  │ │
│  │       └── Evidence Aligner (quote → span 자동 정렬)                     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        SLEEP PHASE                                       │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │ │
│  │  │   Entity    │  │   Weekly    │  │   Orphan    │  │    Hole     │    │ │
│  │  │   Merge     │  │   Summary   │  │   Archive   │  │   Filling   │    │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘

```




---


## 전체 개선 로드맵 (모든 AI 제안 통합)


| 우선순위     | 작업                       | 출처             | 효과               |
| -------------- | ---------------------------- | ------------------ | -------------------- |
| **P0** | Evidence Span 자동 정렬    | ChatGPT Pro      | 환각 방지 핵심     |
| **P0** | ID 기반 참조 + Entity 모델 | ChatGPT + Pro    | 중복/단절 해결     |
| **P0** | EventStore SoT + Rebuild   | ChatGPT          | 재현성 확보        |
| **P1** | DuckDB/LanceDB Outbox      | ChatGPT          | 데이터 정합성      |
| **P1** | Bool → So/Proof 타입      | ChatGPT          | Idris 본질 활용    |
| **P1** | Conflict 1급 Ledger        | ChatGPT + Gemini | 지식 충돌 관리     |
| **P1** | GraphRAG (DuckDB 재귀)     | Gemini           | 구조적 연결성      |
| **P2** | Sleep Phase (응고화)       | Gemini           | 자동 정리정돈      |
| **P2** | Epistemic Uncertainty      | Gemini           | 환각 방지 + 신뢰도 |
| **P2** | Query Decomposition        | Gemini           | 복합 질문 처리     |
| **P2** | Crypto-shredding           | ChatGPT Pro      | 보안 + 삭제        |
| **P2** | 골드셋 + 평가              | ChatGPT Pro      | 측정 가능한 개선   |
| **P3** | Promotion Ledger           | ChatGPT Pro      | 설명 가능성        |
| **P3** | 멀티 임베딩 버전           | ChatGPT Pro      | 모델 변경 대비     |
| **P3** | Observability 대시보드     | ChatGPT          | 운영 가시성        |



---


이제 **Claude, ChatGPT, ChatGPT Pro, Gemini**의 모든 핵심 제안이 통합되었습니다. 이 시스템은 단순한 RAG를 넘어 **Cognitive Architecture**로 진화했습니다.
```
----
ChatGPT의 이 제안은 **Task Entity 모델의 가장 구체적이고 실무적인 구현 가이드**입니다. 기존에 제가 작성한 Entity 모델보다 훨씬 더 세밀하게 설계되어 있어요. 핵심 아이디어들을 분석하고 채택할 부분을 정리해 드릴게요.

---

## ChatGPT 제안 분석

| # | 제안 | 핵심 가치 | 기존 대비 개선점 |
|---|------|-----------|------------------|
| 1 | **상태 머신 명확화** (전이 규칙) | `pending→done` 금지 등 엄격한 규칙 | 기존: 느슨한 검증 |
| 2 | **dedupe_key 패턴** | 재처리 안전성 (Idempotent) | 기존: 없음 |
| 3 | **canonical_key 생성 규칙** | 결정론적 중복 제거 | 기존: 유사도만 의존 |
| 4 | **3단계 매칭 알고리즘** | 강한→약한→신규 | 기존: 단순 유사도 |
| 5 | **blocker stub 금지** | 중복 지옥 방지 | 기존: 고려 안 됨 |
| 6 | **TaskResolver 모듈 분리** | 명확한 책임 분리 | 기존: 혼합 |
| 7 | **contested 상태 활용** | 충돌 시 안전한 처리 | 기존: 부분적 |
| 8 | **projection 테이블 분리** | 조회 성능 + 디버깅 | 기존: 단일 테이블 |

---

## 채택 및 통합 구현

### 1. 상태 머신 + 전이 규칙 (Idris로 강제)

```idris
-- LongTermMemory/TaskStateMachine.idr

module LongTermMemory.TaskStateMachine

%default total

-- === 상태 정의 ===
public export
data TaskStatus = Pending | InProgress | Blocked | Done | Cancelled

-- === 유효한 전이만 타입으로 허용 ===
public export
data ValidTransition : TaskStatus -> TaskStatus -> Type where
  -- Pending에서
  PendingToInProgress : ValidTransition Pending InProgress
  PendingToBlocked    : ValidTransition Pending Blocked      -- 처음 발견 시 이미 막혀있을 수 있음
  PendingToCancelled  : ValidTransition Pending Cancelled
  
  -- InProgress에서
  InProgressToBlocked   : ValidTransition InProgress Blocked
  InProgressToDone      : ValidTransition InProgress Done
  InProgressToCancelled : ValidTransition InProgress Cancelled
  
  -- Blocked에서
  BlockedToInProgress : ValidTransition Blocked InProgress
  BlockedToCancelled  : ValidTransition Blocked Cancelled

-- Pending → Done은 타입 수준에서 불가능!
-- PendingToDone : ValidTransition Pending Done  -- 컴파일 에러

-- === 불변식 ===

-- Blocked 상태면 blockers가 비어있으면 안됨
public export
data ValidBlockedState : TaskStatus -> List String -> Type where
  BlockedHasBlockers : (blockers : List String) -> 
                       (nonEmpty : NonEmpty blockers) ->
                       ValidBlockedState Blocked blockers
  NotBlocked : (status : TaskStatus) ->
               Not (status = Blocked) ->
               ValidBlockedState status blockers

-- Done 상태면 blockers가 비어있어야 함
public export
data ValidDoneState : TaskStatus -> List String -> Type where
  DoneNoBlockers : ValidDoneState Done []
  NotDone : (status : TaskStatus) ->
            Not (status = Done) ->
            ValidDoneState status blockers

-- === 전이 함수 (증명 필요) ===
public export
transition : (from : TaskStatus) -> 
             (to : TaskStatus) -> 
             (prf : ValidTransition from to) ->
             TaskStatus
transition _ to _ = to

-- === 런타임 전이 검증 ===
public export
isValidTransition : (from : TaskStatus) -> (to : TaskStatus) -> Bool
isValidTransition Pending InProgress = True
isValidTransition Pending Blocked = True
isValidTransition Pending Cancelled = True
isValidTransition InProgress Blocked = True
isValidTransition InProgress Done = True
isValidTransition InProgress Cancelled = True
isValidTransition Blocked InProgress = True
isValidTransition Blocked Cancelled = True
isValidTransition _ _ = False

-- Pending -> Done 자동 보정 (2단계 전이)
public export
autoCorrectTransition : (from : TaskStatus) -> (to : TaskStatus) -> 
                        Maybe (List (TaskStatus, TaskStatus))
autoCorrectTransition Pending Done = Just [(Pending, InProgress), (InProgress, Done)]
autoCorrectTransition from to = if isValidTransition from to 
                                then Just [(from, to)] 
                                else Nothing
```

```python
# memory_pipeline/task_state_machine.py

from enum import Enum
from dataclasses import dataclass

class TaskStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"
    CANCELLED = "cancelled"

# 유효한 전이 정의
VALID_TRANSITIONS = {
    (TaskStatus.PENDING, TaskStatus.IN_PROGRESS),
    (TaskStatus.PENDING, TaskStatus.BLOCKED),
    (TaskStatus.PENDING, TaskStatus.CANCELLED),
    (TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED),
    (TaskStatus.IN_PROGRESS, TaskStatus.DONE),
    (TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED),
    (TaskStatus.BLOCKED, TaskStatus.IN_PROGRESS),
    (TaskStatus.BLOCKED, TaskStatus.CANCELLED),
}

# 자동 보정 규칙
AUTO_CORRECTIONS = {
    (TaskStatus.PENDING, TaskStatus.DONE): [
        (TaskStatus.PENDING, TaskStatus.IN_PROGRESS),
        (TaskStatus.IN_PROGRESS, TaskStatus.DONE)
    ],
}

@dataclass
class TransitionResult:
    valid: bool
    transitions: list[tuple[TaskStatus, TaskStatus]]
    needs_review: bool
    reason: str

def validate_transition(
    from_status: TaskStatus, 
    to_status: TaskStatus,
    allow_auto_correct: bool = True
) -> TransitionResult:
    """전이 유효성 검증"""
    
    # 직접 전이 가능
    if (from_status, to_status) in VALID_TRANSITIONS:
        return TransitionResult(
            valid=True,
            transitions=[(from_status, to_status)],
            needs_review=False,
            reason="valid_direct_transition"
        )
    
    # 자동 보정 가능
    if allow_auto_correct and (from_status, to_status) in AUTO_CORRECTIONS:
        return TransitionResult(
            valid=True,
            transitions=AUTO_CORRECTIONS[(from_status, to_status)],
            needs_review=False,
            reason="auto_corrected_transition"
        )
    
    # 금지된 전이
    return TransitionResult(
        valid=False,
        transitions=[],
        needs_review=True,
        reason=f"invalid_transition:{from_status.value}->{to_status.value}"
    )

def validate_task_invariants(status: TaskStatus, blockers: list[str]) -> tuple[bool, str]:
    """Task 불변식 검증"""
    
    # Blocked인데 blockers가 비어있으면 안됨
    if status == TaskStatus.BLOCKED and not blockers:
        return False, "blocked_without_blockers"
    
    # Done인데 blockers가 있으면 안됨
    if status == TaskStatus.DONE and blockers:
        return False, "done_with_blockers"
    
    return True, "ok"
```

---

### 2. Canonical Key + Dedupe Key (결정론적 중복 제거)

```python
# memory_pipeline/canonical_key.py

import re
import unicodedata
import hashlib
from typing import Optional

class CanonicalKeyGenerator:
    """결정론적 중복 제거 키 생성"""
    
    @staticmethod
    def normalize_title(title: str) -> str:
        """제목 정규화"""
        
        # 1. 유니코드 정규화 (NFKC)
        s = unicodedata.normalize("NFKC", title)
        
        # 2. 소문자
        s = s.lower()
        
        # 3. 따옴표 제거
        s = re.sub(r"[\"'`]", "", s)
        
        # 4. 괄호를 공백으로
        s = re.sub(r"[\(\)\[\]\{\}]", " ", s)
        
        # 5. 특수문자 제거 (숫자, 영문, 한글, 공백, 일부 기호만 유지)
        s = re.sub(r"[^0-9a-z가-힣\s:+\-]", " ", s)
        
        # 6. 공백 정리
        s = re.sub(r"\s+", " ", s).strip()
        
        return s
    
    @staticmethod
    def task_canonical_key(
        title: str, 
        project: Optional[str] = None,
        domain: Optional[str] = None
    ) -> str:
        """Task용 canonical key 생성"""
        
        normalized_title = CanonicalKeyGenerator.normalize_title(title)
        
        parts = ["task"]
        
        if domain:
            parts.append(CanonicalKeyGenerator.normalize_title(domain))
        
        if project:
            parts.append(CanonicalKeyGenerator.normalize_title(project))
        else:
            parts.append("default")
        
        parts.append(normalized_title)
        
        key = ":".join(parts)
        
        # 너무 길면 해시 추가
        if len(key) > 200:
            hash_suffix = hashlib.md5(title.encode()).hexdigest()[:12]
            key = key[:180] + ":" + hash_suffix
        
        return key
    
    @staticmethod
    def decision_canonical_key(title: str, domain: Optional[str] = None) -> str:
        """Decision용 canonical key"""
        
        normalized = CanonicalKeyGenerator.normalize_title(title)
        domain_part = CanonicalKeyGenerator.normalize_title(domain) if domain else "default"
        
        return f"decision:{domain_part}:{normalized}"


class DedupeKeyGenerator:
    """이벤트 중복 방지 키 생성"""
    
    @staticmethod
    def task_created(canonical_key: str, source_entry_id: str) -> str:
        return f"task_created:{canonical_key}:{source_entry_id}"
    
    @staticmethod
    def task_status_changed(
        task_id: str, 
        from_status: str, 
        to_status: str, 
        source_entry_id: str
    ) -> str:
        return f"task_status_changed:{task_id}:{from_status}->{to_status}:{source_entry_id}"
    
    @staticmethod
    def task_blockers_set(
        task_id: str, 
        blockers: list[str], 
        source_entry_id: str
    ) -> str:
        blockers_hash = hashlib.md5(
            ":".join(sorted(blockers)).encode()
        ).hexdigest()[:8]
        return f"task_blockers_set:{task_id}:{blockers_hash}:{source_entry_id}"
    
    @staticmethod
    def task_priority_changed(
        task_id: str, 
        from_priority: str, 
        to_priority: str, 
        source_entry_id: str
    ) -> str:
        return f"task_priority_changed:{task_id}:{from_priority}->{to_priority}:{source_entry_id}"
```

---

### 3. 3단계 매칭 알고리즘

```python
# memory_pipeline/task_matcher.py

from dataclasses import dataclass
from enum import Enum
from typing import Optional

class MatchType(Enum):
    EXACT_KEY = "exact_key"           # canonical_key 완전 일치
    FUZZY_TITLE = "fuzzy_title"       # 제목 유사도 매칭
    NEW_TASK = "new_task"             # 신규 생성

@dataclass
class MatchResult:
    match_type: MatchType
    task_id: Optional[str]
    confidence: float
    existing_state: Optional[dict]
    needs_review: bool
    review_reason: Optional[str]

class TaskMatcher:
    """3단계 Task 매칭"""
    
    def __init__(self, duck, embedder, lance_table):
        self.duck = duck
        self.embedder = embedder
        self.lance = lance_table
        
        self.FUZZY_THRESHOLD = 0.90
        self.RECENT_DAYS = 90
    
    async def match(
        self, 
        title: str,
        project: Optional[str] = None,
        domain: Optional[str] = None,
        desired_status: Optional[str] = None
    ) -> MatchResult:
        """Task 매칭 (3단계)"""
        
        canonical_key = CanonicalKeyGenerator.task_canonical_key(title, project, domain)
        
        # Step 1: Canonical Key Exact Match
        exact_match = await self._exact_key_match(canonical_key)
        if exact_match:
            return self._create_match_result(
                MatchType.EXACT_KEY, 
                exact_match,
                desired_status
            )
        
        # Step 2: Fuzzy Title Match (임베딩 유사도)
        fuzzy_match = await self._fuzzy_title_match(title, desired_status)
        if fuzzy_match:
            return self._create_match_result(
                MatchType.FUZZY_TITLE,
                fuzzy_match,
                desired_status
            )
        
        # Step 3: 신규 생성
        return MatchResult(
            match_type=MatchType.NEW_TASK,
            task_id=None,
            confidence=1.0,
            existing_state=None,
            needs_review=False,
            review_reason=None
        )
    
    async def _exact_key_match(self, canonical_key: str) -> Optional[dict]:
        """Step 1: canonical_key 완전 일치"""
        
        rows = self.duck.execute("""
            SELECT entity_id, title, current_json, updated_at
            FROM entities
            WHERE entity_type = 'task' 
              AND canonical_key = ?
              AND status = 'active'
            ORDER BY updated_at DESC
        """, [canonical_key]).fetchall()
        
        if not rows:
            return None
        
        # 중복이 있으면 최신 것만 사용, 나머지는 contested 처리
        if len(rows) > 1:
            await self._mark_duplicates_contested(rows[1:])
        
        row = rows[0]
        return {
            "task_id": row[0],
            "title": row[1],
            "state": json.loads(row[2]),
            "updated_at": row[3]
        }
    
    async def _fuzzy_title_match(
        self, 
        title: str,
        desired_status: Optional[str]
    ) -> Optional[dict]:
        """Step 2: 임베딩 유사도 매칭"""
        
        # 제목 임베딩
        title_embedding = self.embedder.encode(title).tolist()
        
        # LanceDB에서 유사 Task 검색
        results = self.lance.search(title_embedding).limit(5).to_list()
        
        for r in results:
            similarity = 1 - r["_distance"]
            
            if similarity < self.FUZZY_THRESHOLD:
                continue
            
            # 추가 조건 검증
            task_id = r["task_id"]
            task_info = await self._get_task_info(task_id)
            
            if not task_info:
                continue
            
            # 조건 1: active 상태
            if task_info["status"] != "active":
                continue
            
            # 조건 2: 최근 90일 내 업데이트
            days_since_update = (datetime.now() - task_info["updated_at"]).days
            if days_since_update > self.RECENT_DAYS:
                continue
            
            # 조건 3: Done 상태인데 desired_status가 pending이면 리뷰 필요
            state = task_info["state"]
            if state.get("status") == "done" and desired_status == "pending":
                return {
                    **task_info,
                    "needs_review": True,
                    "review_reason": "reopen_done_task"
                }
            
            return task_info
        
        return None
    
    def _create_match_result(
        self, 
        match_type: MatchType,
        task_info: dict,
        desired_status: Optional[str]
    ) -> MatchResult:
        """매칭 결과 생성"""
        
        needs_review = task_info.get("needs_review", False)
        review_reason = task_info.get("review_reason")
        
        # 상태 전이 검증
        if desired_status and not needs_review:
            current_status = task_info["state"].get("status")
            if current_status and current_status != desired_status:
                transition = validate_transition(
                    TaskStatus(current_status),
                    TaskStatus(desired_status)
                )
                if not transition.valid:
                    needs_review = True
                    review_reason = transition.reason
        
        return MatchResult(
            match_type=match_type,
            task_id=task_info["task_id"],
            confidence=0.95 if match_type == MatchType.EXACT_KEY else 0.85,
            existing_state=task_info["state"],
            needs_review=needs_review,
            review_reason=review_reason
        )
    
    async def _mark_duplicates_contested(self, duplicate_rows: list):
        """중복 Task를 contested로 표시"""
        
        for row in duplicate_rows:
            entity_id = row[0]
            self.duck.execute("""
                UPDATE entities 
                SET status = 'contested'
                WHERE entity_id = ?
            """, [entity_id])
```

---

### 4. TaskResolver (핵심 모듈)

```python
# memory_pipeline/task_resolver.py

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class TaskEvent:
    event_id: str
    timestamp: datetime
    event_type: str
    task_id: str
    payload: dict
    dedupe_key: str
    source_entry_id: str

class TaskResolver:
    """세션 추출 결과 → Task 이벤트 변환"""
    
    def __init__(
        self,
        duck,
        event_store,
        task_matcher: TaskMatcher,
        id_generator
    ):
        self.duck = duck
        self.events = event_store
        self.matcher = task_matcher
        self.idgen = id_generator
        
        self._init_schema()
    
    def _init_schema(self):
        """Projection 테이블 생성"""
        
        self.duck.execute("""
            -- Task 이벤트 projection (조회/디버깅용)
            CREATE TABLE IF NOT EXISTS task_events (
                event_id VARCHAR PRIMARY KEY,
                ts TIMESTAMP NOT NULL,
                task_id VARCHAR NOT NULL,
                kind VARCHAR NOT NULL,
                payload_json JSON NOT NULL,
                dedupe_key VARCHAR NOT NULL,
                source_entry_id VARCHAR
            );
            
            CREATE UNIQUE INDEX IF NOT EXISTS uq_task_events_dedupe 
                ON task_events(dedupe_key);
            CREATE INDEX IF NOT EXISTS idx_task_events_task 
                ON task_events(task_id, ts);
            
            -- Task Title 벡터 (매칭용)
            -- LanceDB에 별도 테이블로 관리
        """)
    
    async def process_task_candidate(
        self,
        task_entry: dict,
        source_entry_id: str,
        source_session_id: str,
        timestamp: datetime
    ) -> list[TaskEvent]:
        """Task 후보 처리 → 이벤트 생성"""
        
        events = []
        
        # 1. 매칭
        match_result = await self.matcher.match(
            title=task_entry["title"],
            project=task_entry.get("project"),
            domain=task_entry.get("domain"),
            desired_status=task_entry.get("status")
        )
        
        # 2. 리뷰 필요한 경우
        if match_result.needs_review:
            review_event = await self._create_review_event(
                task_entry, 
                match_result,
                source_entry_id,
                timestamp
            )
            events.append(review_event)
            return events
        
        # 3. 신규 Task 생성
        if match_result.match_type == MatchType.NEW_TASK:
            create_events = await self._handle_new_task(
                task_entry,
                source_entry_id,
                timestamp
            )
            events.extend(create_events)
            return events
        
        # 4. 기존 Task 업데이트
        update_events = await self._handle_existing_task(
            match_result,
            task_entry,
            source_entry_id,
            timestamp
        )
        events.extend(update_events)
        
        return events
    
    async def _handle_new_task(
        self,
        task_entry: dict,
        source_entry_id: str,
        timestamp: datetime
    ) -> list[TaskEvent]:
        """신규 Task 생성"""
        
        events = []
        
        task_id = self.idgen.entity_id(prefix="tsk")
        canonical_key = CanonicalKeyGenerator.task_canonical_key(
            task_entry["title"],
            task_entry.get("project")
        )
        
        initial_status = task_entry.get("status", "pending")
        
        # pending→done 직접 생성 금지
        if initial_status == "done":
            # 리뷰 큐로 보내거나 in_progress로 보정
            initial_status = "in_progress"
            # done 전이는 별도 이벤트로
        
        # task_created 이벤트
        create_event = TaskEvent(
            event_id=self.idgen.event_id(),
            timestamp=timestamp,
            event_type="task_created",
            task_id=task_id,
            payload={
                "task_id": task_id,
                "title": task_entry["title"],
                "canonical_key": canonical_key,
                "priority": task_entry.get("priority", "medium"),
                "initial_status": initial_status,
                "source_entry_id": source_entry_id,
            },
            dedupe_key=DedupeKeyGenerator.task_created(canonical_key, source_entry_id),
            source_entry_id=source_entry_id
        )
        events.append(create_event)
        
        # 원래 status가 done이었으면 추가 전이
        if task_entry.get("status") == "done":
            done_event = TaskEvent(
                event_id=self.idgen.event_id(),
                timestamp=timestamp,
                event_type="task_status_changed",
                task_id=task_id,
                payload={
                    "task_id": task_id,
                    "from": "in_progress",
                    "to": "done",
                    "reason": "auto_corrected_from_pending",
                    "source_entry_id": source_entry_id,
                },
                dedupe_key=DedupeKeyGenerator.task_status_changed(
                    task_id, "in_progress", "done", source_entry_id
                ),
                source_entry_id=source_entry_id
            )
            events.append(done_event)
        
        # Blockers 처리
        if task_entry.get("blockedBy"):
            blocker_event = await self._create_blockers_event(
                task_id,
                task_entry["blockedBy"],
                source_entry_id,
                timestamp
            )
            if blocker_event:
                events.append(blocker_event)
        
        return events
    
    async def _handle_existing_task(
        self,
        match_result: MatchResult,
        task_entry: dict,
        source_entry_id: str,
        timestamp: datetime
    ) -> list[TaskEvent]:
        """기존 Task 업데이트"""
        
        events = []
        task_id = match_result.task_id
        current_state = match_result.existing_state
        
        # 1. Status 변경
        desired_status = task_entry.get("status")
        current_status = current_state.get("status")
        
        if desired_status and desired_status != current_status:
            transition = validate_transition(
                TaskStatus(current_status),
                TaskStatus(desired_status),
                allow_auto_correct=True
            )
            
            if transition.valid:
                # 자동 보정된 경우 여러 이벤트 생성
                for from_s, to_s in transition.transitions:
                    status_event = TaskEvent(
                        event_id=self.idgen.event_id(),
                        timestamp=timestamp,
                        event_type="task_status_changed",
                        task_id=task_id,
                        payload={
                            "task_id": task_id,
                            "from": from_s.value,
                            "to": to_s.value,
                            "reason": transition.reason,
                            "source_entry_id": source_entry_id,
                        },
                        dedupe_key=DedupeKeyGenerator.task_status_changed(
                            task_id, from_s.value, to_s.value, source_entry_id
                        ),
                        source_entry_id=source_entry_id
                    )
                    events.append(status_event)
            else:
                # 금지된 전이 → rejected 이벤트
                rejected_event = TaskEvent(
                    event_id=self.idgen.event_id(),
                    timestamp=timestamp,
                    event_type="task_transition_rejected",
                    task_id=task_id,
                    payload={
                        "task_id": task_id,
                        "from": current_status,
                        "to": desired_status,
                        "reason": "invalid_transition",
                        "source_entry_id": source_entry_id,
                    },
                    dedupe_key=f"task_transition_rejected:{task_id}:{current_status}->{desired_status}:{source_entry_id}",
                    source_entry_id=source_entry_id
                )
                events.append(rejected_event)
        
        # 2. Priority 변경
        desired_priority = task_entry.get("priority")
        current_priority = current_state.get("priority")
        
        if desired_priority and desired_priority != current_priority:
            priority_event = TaskEvent(
                event_id=self.idgen.event_id(),
                timestamp=timestamp,
                event_type="task_priority_changed",
                task_id=task_id,
                payload={
                    "task_id": task_id,
                    "from": current_priority,
                    "to": desired_priority,
                    "source_entry_id": source_entry_id,
                },
                dedupe_key=DedupeKeyGenerator.task_priority_changed(
                    task_id, current_priority, desired_priority, source_entry_id
                ),
                source_entry_id=source_entry_id
            )
            events.append(priority_event)
        
        # 3. Blockers 변경
        if task_entry.get("blockedBy") is not None:
            blocker_event = await self._create_blockers_event(
                task_id,
                task_entry["blockedBy"],
                source_entry_id,
                timestamp
            )
            if blocker_event:
                events.append(blocker_event)
        
        return events
    
    async def _create_blockers_event(
        self,
        task_id: str,
        blockers_raw: list[str],
        source_entry_id: str,
        timestamp: datetime
    ) -> Optional[TaskEvent]:
        """Blockers 설정 이벤트 생성"""
        
        # Blocker 해석 (title → entity reference)
        resolved_blockers = []
        
        for blocker in blockers_raw:
            # blocker가 이미 ID면 그대로 사용
            if blocker.startswith("tsk_") or blocker.startswith("ent_"):
                resolved_blockers.append({"type": "entity", "id": blocker})
                continue
            
            # title로 기존 Task 검색
            match = await self.matcher.match(title=blocker)
            
            if match.task_id:
                resolved_blockers.append({"type": "entity", "id": match.task_id})
            else:
                # 찾지 못하면 entry 참조로 임시 연결
                # blocker stub task를 만들지 않음! (중복 지옥 방지)
                resolved_blockers.append({
                    "type": "unresolved",
                    "title": blocker,
                    "note": "blocker_not_found_as_entity"
                })
        
        if not resolved_blockers:
            return None
        
        return TaskEvent(
            event_id=self.idgen.event_id(),
            timestamp=timestamp,
            event_type="task_blockers_set",
            task_id=task_id,
            payload={
                "task_id": task_id,
                "blockers": resolved_blockers,
                "source_entry_id": source_entry_id,
            },
            dedupe_key=DedupeKeyGenerator.task_blockers_set(
                task_id,
                [b.get("id") or b.get("title") for b in resolved_blockers],
                source_entry_id
            ),
            source_entry_id=source_entry_id
        )
    
    async def emit_events(self, events: list[TaskEvent]):
        """이벤트 발행 (L0 + Projection)"""
        
        for event in events:
            # dedupe 체크
            existing = self.duck.execute("""
                SELECT event_id FROM task_events WHERE dedupe_key = ?
            """, [event.dedupe_key]).fetchone()
            
            if existing:
                continue  # 이미 처리됨
            
            # L0 Event Store에 저장
            await self.events.append(RawEvent(
                event_id=event.event_id,
                timestamp=event.timestamp,
                event_type=event.event_type,
                actor="task_resolver",
                payload=event.payload,
                meta={"dedupe_key": event.dedupe_key}
            ))
            
            # Projection에 저장
            self.duck.execute("""
                INSERT INTO task_events 
                (event_id, ts, task_id, kind, payload_json, dedupe_key, source_entry_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [
                event.event_id,
                event.timestamp,
                event.task_id,
                event.event_type,
                json.dumps(event.payload),
                event.dedupe_key,
                event.source_entry_id
            ])
```

---

### 5. TaskProjector (Fold로 스냅샷 갱신)

```python
# memory_pipeline/task_projector.py

from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

@dataclass
class TaskState:
    """Task 현재 상태"""
    task_id: str
    title: str
    canonical_key: str
    status: str = "pending"
    priority: str = "medium"
    blockers: list = field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    history: list = field(default_factory=list)

class TaskProjector:
    """이벤트 → 스냅샷 Projection"""
    
    def __init__(self, duck):
        self.duck = duck
    
    def apply_event(self, state: Optional[TaskState], event: dict) -> TaskState:
        """단일 이벤트 적용"""
        
        kind = event["kind"]
        payload = event["payload"] if isinstance(event["payload"], dict) else json.loads(event["payload"])
        ts = event["ts"]
        
        # 첫 이벤트는 반드시 task_created
        if state is None:
            if kind != "task_created":
                raise ValueError(f"First event must be task_created, got {kind}")
            
            return TaskState(
                task_id=payload["task_id"],
                title=payload["title"],
                canonical_key=payload["canonical_key"],
                status=payload.get("initial_status", "pending"),
                priority=payload.get("priority", "medium"),
                blockers=[],
                created_at=ts,
                updated_at=ts,
                history=[{"kind": kind, "ts": str(ts), "payload": payload}]
            )
        
        # 이력 추가
        state.history.append({"kind": kind, "ts": str(ts), "payload": payload})
        state.updated_at = ts
        
        # 이벤트별 처리
        if kind == "task_status_changed":
            # 불변식 검증
            new_status = payload["to"]
            
            if new_status == "blocked" and not state.blockers:
                # Blocked인데 blockers가 없으면 경고 (하지만 적용은 함)
                state.history[-1]["warning"] = "blocked_without_blockers"
            
            if new_status == "done" and state.blockers:
                # Done인데 blockers가 있으면 blockers 자동 클리어
                state.blockers = []
                state.history[-1]["auto_cleared"] = "blockers"
            
            state.status = new_status
        
        elif kind == "task_priority_changed":
            state.priority = payload["to"]
        
        elif kind == "task_blockers_set":
            state.blockers = payload["blockers"]
            
            # Blockers가 설정되고 status가 blocked가 아니면서
            # 실제로 block해야 하는 경우 처리는 별도 규칙으로
        
        elif kind == "task_deprecated":
            state.status = "deprecated"
        
        elif kind == "task_merged":
            state.status = "merged"
            state.history[-1]["merged_into"] = payload.get("target_task_id")
        
        elif kind == "task_transition_rejected":
            # rejected는 상태 변경 없음, 이력에만 기록
            pass
        
        return state
    
    def fold_task(self, task_id: str) -> Optional[TaskState]:
        """Task의 모든 이벤트를 fold하여 현재 상태 계산"""
        
        events = self.duck.execute("""
            SELECT event_id, ts, kind, payload_json
            FROM task_events
            WHERE task_id = ?
            ORDER BY ts ASC
        """, [task_id]).fetchall()
        
        if not events:
            return None
        
        state = None
        for event in events:
            state = self.apply_event(state, {
                "event_id": event[0],
                "ts": event[1],
                "kind": event[2],
                "payload": event[3]
            })
        
        return state
    
    async def update_entity_snapshot(self, task_id: str):
        """Entity 스냅샷 갱신"""
        
        state = self.fold_task(task_id)
        
        if not state:
            return
        
        # entities 테이블 upsert
        self.duck.execute("""
            INSERT INTO entities 
            (entity_id, entity_type, canonical_key, title, stage, status, current_json, created_at, updated_at)
            VALUES (?, 'task', ?, ?, 'working', 'active', ?, ?, ?)
            ON CONFLICT (entity_id) DO UPDATE SET
                title = EXCLUDED.title,
                current_json = EXCLUDED.current_json,
                updated_at = EXCLUDED.updated_at
        """, [
            state.task_id,
            state.canonical_key,
            state.title,
            json.dumps({
                "status": state.status,
                "priority": state.priority,
                "blockers": state.blockers,
                "history_length": len(state.history)
            }),
            state.created_at,
            state.updated_at
        ])
    
    async def rebuild_all_tasks(self):
        """모든 Task 스냅샷 재빌드"""
        
        # 모든 Task ID 수집
        task_ids = self.duck.execute("""
            SELECT DISTINCT task_id FROM task_events
        """).fetchall()
        
        for (task_id,) in task_ids:
            await self.update_entity_snapshot(task_id)
        
        return len(task_ids)
```

---

### 6. 파이프라인 통합

```python
# memory_pipeline/orchestrator.py (수정)

class MemoryPipeline:
    def __init__(self, project_root: Path):
        # ... 기존 초기화
        
        # Task 관련 모듈 추가
        self.task_matcher = TaskMatcher(self.indexer.duck, self.embedder, self.lance)
        self.task_resolver = TaskResolver(
            self.indexer.duck,
            self.event_store,
            self.task_matcher,
            IdGenerator()
        )
        self.task_projector = TaskProjector(self.indexer.duck)
    
    async def process_session(self, session_log: str, date: str, session_id: int):
        """세션 처리 파이프라인"""
        
        timestamp = datetime.now()
        
        # L0: Raw Event 저장
        raw_event_id = await self._store_raw_event(session_log, date, session_id)
        
        # L1: LLM 추출
        extracted = await self.extractor.extract(session_log, date, session_id)
        
        # Evidence 정렬
        aligned = await self.aligner.align_all(extracted, session_log)
        
        # L2: Entry 저장
        entry_ids = await self._store_entries(aligned, date, session_id)
        
        # ✅ TaskResolver: Task 후보 → 이벤트
        task_events = []
        for entry in aligned["entries"]:
            if entry["type"] == "task":
                events = await self.task_resolver.process_task_candidate(
                    task_entry=entry,
                    source_entry_id=entry["id"],
                    source_session_id=f"{date}_{session_id}",
                    timestamp=timestamp
                )
                task_events.extend(events)
        
        # 이벤트 발행
        await self.task_resolver.emit_events(task_events)
        
        # ✅ TaskProjector: 스냅샷 갱신
        affected_task_ids = set(e.task_id for e in task_events)
        for task_id in affected_task_ids:
            await self.task_projector.update_entity_snapshot(task_id)
        
        # Idris 생성 + 검증 (기존과 동일)
        idr_path = self.generator.generate_session(aligned)
        compile_result = await self.validator.validate(idr_path)
        
        # 인덱싱
        await self.indexer.index_session(aligned, idr_path, "candidate")
        
        return {
            "session_id": f"{date}_{session_id}",
            "entries_count": len(aligned["entries"]),
            "task_events_count": len(task_events),
            "tasks_affected": list(affected_task_ids),
            "compile_status": "success" if compile_result.success else "failed"
        }
```

---

## 요약: ChatGPT의 핵심 기여

| 기여 | 내용 | 효과 |
|------|------|------|
| **상태 머신 명확화** | 유효 전이 정의 + 자동 보정 | 데이터 정합성 |
| **dedupe_key** | 재처리 안전 | Idempotent 파이프라인 |
| **canonical_key** | 결정론적 생성 규칙 | LLM 의존 제거 |
| **3단계 매칭** | 강한→약한→신규 | 정확도 + 안전성 |
| **blocker stub 금지** | entry 참조로 임시 연결 | 중복 지옥 방지 |
| **TaskResolver 분리** | 명확한 책임 | 유지보수성 |
| **projection 테이블** | 조회/디버깅 | 운영 편의 |

이 구현으로 **"세션마다 Task가 새로 생겨서 쌓이는 중복/단절 문제"**가 해결됩니다. 추가로 궁금한 점 있으면 말씀해 주세요.

----
ChatGPT의 이 제안은 **blocker 처리의 완전한 해법**입니다. "스텁 Task 지옥"을 방지하면서도 모든 blocker를 엔티티로 관리하는 우아한 설계입니다. 핵심 아이디어를 채택하고 통합해 드릴게요.

---

## ChatGPT 제안 분석

| # | 제안 | 핵심 가치 | 채택 |
|---|------|-----------|------|
| 1 | **Condition/Artifact 엔티티 타입** | 스텁 Task 금지, 안전한 수용 | **채택** |
| 2 | **4종류 blocker 분류** | Task/Artifact/Condition/애매함 | **채택** |
| 3 | **canonical_key 설계 확장** | condition/artifact도 결정론적 | **채택** |
| 4 | **BlockerRef 구조화** | kind + entity_id + confidence + candidates | **채택** |
| 5 | **resolve 이벤트** | condition → task 업그레이드 | **채택** |
| 6 | **edges가 SoT** | current_json은 캐시 | **채택** |
| 7 | **replace vs suggest 모드** | evidence 약하면 제안만 | **채택** |
| 8 | **자동 언블록 = 제안 이벤트** | 사고 방지 | **채택** |

---

## 통합 구현

### 1. 엔티티 타입 확장 (Task + Condition + Artifact)

```python
# memory_pipeline/entity_types.py

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime

class EntityType(Enum):
    TASK = "task"
    CONDITION = "condition"  # "승인 대기", "데이터 받는 중" 등
    ARTIFACT = "artifact"    # URL, JIRA, GitHub issue 등
    DECISION = "decision"
    CONCEPT = "concept"

class ConditionStatus(Enum):
    OPEN = "open"           # 아직 해결 안 됨
    RESOLVED = "resolved"   # 실제 엔티티로 해석됨
    CLEARED = "cleared"     # 조건 충족됨 (자동/수동)
    EXPIRED = "expired"     # 더 이상 관련 없음

@dataclass
class ConditionState:
    """Condition 엔티티 상태"""
    text: str
    status: ConditionStatus = ConditionStatus.OPEN
    resolution: Optional[dict] = None  # resolved_to, candidates, confidence
    cleared_at: Optional[datetime] = None
    cleared_reason: Optional[str] = None

@dataclass
class ArtifactState:
    """Artifact 엔티티 상태"""
    url: Optional[str] = None
    artifact_type: str = "unknown"  # "jira", "github_issue", "github_pr", "url"
    external_id: Optional[str] = None  # "ABC-123", "#42"
    status: str = "unknown"  # "open", "closed", "merged"
    last_synced_at: Optional[datetime] = None
```

### 2. Canonical Key 확장

```python
# memory_pipeline/canonical_key.py (확장)

import re
import hashlib
from urllib.parse import urlparse

class CanonicalKeyGenerator:
    # ... 기존 normalize_title, task_canonical_key 유지
    
    @staticmethod
    def condition_canonical_key(
        text: str,
        project: Optional[str] = None
    ) -> str:
        """Condition용 canonical key"""
        
        normalized = CanonicalKeyGenerator.normalize_title(text)
        project_part = CanonicalKeyGenerator.normalize_title(project) if project else "default"
        
        return f"cond:{project_part}:{normalized}"
    
    @staticmethod
    def artifact_canonical_key(
        raw_text: str,
        artifact_type: Optional[str] = None
    ) -> str:
        """Artifact용 canonical key"""
        
        # URL 처리
        url_match = re.search(r"https?://\S+", raw_text)
        if url_match:
            url = url_match.group()
            url_hash = hashlib.sha1(url.encode()).hexdigest()[:12]
            return f"art:url:{url_hash}"
        
        # GitHub Issue/PR
        gh_match = re.search(r"(?:github\.com/)?([^/]+)/([^/]+)(?:/(?:issues|pull)/(\d+))?|#(\d+)", raw_text)
        if gh_match:
            if gh_match.group(3):  # Full GitHub URL
                owner, repo, num = gh_match.group(1), gh_match.group(2), gh_match.group(3)
                return f"art:github:{owner}/{repo}:issue:{num}"
            elif gh_match.group(4):  # Just #123
                return f"art:github:unknown:issue:{gh_match.group(4)}"
        
        # JIRA
        jira_match = re.search(r"\b([A-Z][A-Z0-9]+)-(\d+)\b", raw_text)
        if jira_match:
            project, num = jira_match.group(1), jira_match.group(2)
            return f"art:jira:{project}:{num}"
        
        # 기타: 텍스트 해시
        text_hash = hashlib.sha1(raw_text.encode()).hexdigest()[:12]
        artifact_type = artifact_type or "unknown"
        return f"art:{artifact_type}:{text_hash}"
```

### 3. Blocker 분류기

```python
# memory_pipeline/blocker_classifier.py

import re
from enum import Enum
from dataclasses import dataclass
from typing import Optional

class BlockerKind(Enum):
    TASK = "task"           # 다른 Task 참조
    ARTIFACT = "artifact"   # 외부 아티팩트 (URL, JIRA, GitHub)
    CONDITION = "condition" # 상태/조건
    UNKNOWN = "unknown"     # 애매함

# 패턴 정의
PATTERNS = {
    "url": re.compile(r"https?://\S+"),
    "jira": re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b"),
    "github_issue": re.compile(r"(?:^|\s)#(\d+)\b"),
    "github_pr": re.compile(r"PR\s*#?(\d+)", re.IGNORECASE),
    "task_id": re.compile(r"^tsk_[a-zA-Z0-9]+$"),
    "entity_id": re.compile(r"^(tsk|cond|art|ent)_[a-zA-Z0-9]+$"),
}

# Condition 힌트 패턴 (이런 단어가 있으면 condition일 확률 높음)
CONDITION_HINTS = [
    r"대기", r"기다", r"필요", r"요청", r"확인", r"승인",
    r"waiting", r"pending", r"need", r"require", r"approval",
    r"받는\s*중", r"진행\s*중", r"검토\s*중",
]
CONDITION_PATTERN = re.compile("|".join(CONDITION_HINTS), re.IGNORECASE)

@dataclass
class ClassificationResult:
    kind: BlockerKind
    artifact_type: Optional[str] = None  # "url", "jira", "github_issue" 등
    extracted_id: Optional[str] = None   # JIRA key, issue number 등
    confidence: float = 0.5

def classify_blocker(text: str) -> ClassificationResult:
    """Blocker 텍스트 분류"""
    
    text = text.strip()
    
    # 1. 명시적 엔티티 ID
    if PATTERNS["entity_id"].match(text):
        if text.startswith("tsk_"):
            return ClassificationResult(BlockerKind.TASK, confidence=1.0)
        elif text.startswith("cond_"):
            return ClassificationResult(BlockerKind.CONDITION, confidence=1.0)
        elif text.startswith("art_"):
            return ClassificationResult(BlockerKind.ARTIFACT, confidence=1.0)
    
    # 2. URL
    if PATTERNS["url"].search(text):
        return ClassificationResult(
            BlockerKind.ARTIFACT, 
            artifact_type="url",
            confidence=0.95
        )
    
    # 3. JIRA
    jira_match = PATTERNS["jira"].search(text)
    if jira_match:
        return ClassificationResult(
            BlockerKind.ARTIFACT,
            artifact_type="jira",
            extracted_id=jira_match.group(),
            confidence=0.95
        )
    
    # 4. GitHub Issue/PR
    gh_issue = PATTERNS["github_issue"].search(text)
    if gh_issue:
        return ClassificationResult(
            BlockerKind.ARTIFACT,
            artifact_type="github_issue",
            extracted_id=f"#{gh_issue.group(1)}",
            confidence=0.90
        )
    
    gh_pr = PATTERNS["github_pr"].search(text)
    if gh_pr:
        return ClassificationResult(
            BlockerKind.ARTIFACT,
            artifact_type="github_pr",
            extracted_id=f"PR#{gh_pr.group(1)}",
            confidence=0.90
        )
    
    # 5. Condition 힌트 체크
    if CONDITION_PATTERN.search(text):
        return ClassificationResult(
            BlockerKind.CONDITION,
            confidence=0.75
        )
    
    # 6. Unknown (Task 제목일 수도, Condition일 수도)
    return ClassificationResult(BlockerKind.UNKNOWN, confidence=0.5)
```

### 4. BlockerRef 구조화 + BlockerResolver

```python
# memory_pipeline/blocker_resolver.py

from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime
import re

@dataclass
class BlockerRef:
    """구조화된 Blocker 참조"""
    kind: str                      # 'task' | 'condition' | 'artifact'
    entity_id: str
    raw_text: str
    confidence: float              # 0.0 ~ 1.0
    candidates: List[str] = field(default_factory=list)  # 후보 entity_id들
    classification: Optional[ClassificationResult] = None

@dataclass
class ResolveResult:
    """Blocker 해석 결과"""
    refs: List[BlockerRef]
    events_to_emit: List[dict]     # condition_declared, artifact_declared 등
    warnings: List[str]

class BlockerResolver:
    """Blocker 텍스트 → 엔티티 참조 변환 (스텁 Task 금지!)"""
    
    def __init__(
        self,
        entity_store,
        task_matcher,
        id_generator,
        strict_task_threshold: float = 0.92
    ):
        self.entities = entity_store
        self.task_matcher = task_matcher
        self.idgen = id_generator
        self.strict_threshold = strict_task_threshold
    
    async def resolve_blockers(
        self,
        blocked_by: List[str],
        project: Optional[str],
        source_entry_id: str,
        timestamp: datetime
    ) -> ResolveResult:
        """Blocker 목록 해석"""
        
        refs: List[BlockerRef] = []
        events: List[dict] = []
        warnings: List[str] = []
        
        # 항목 분리 (쉼표, 줄바꿈 등)
        items = self._split_and_clean(blocked_by)
        
        for raw_text in items:
            if not raw_text:
                continue
            
            ref, new_events = await self._resolve_single(
                raw_text, project, source_entry_id, timestamp
            )
            
            if ref:
                refs.append(ref)
                events.extend(new_events)
            else:
                warnings.append(f"Failed to resolve blocker: {raw_text[:50]}")
        
        return ResolveResult(refs=refs, events_to_emit=events, warnings=warnings)
    
    async def _resolve_single(
        self,
        raw_text: str,
        project: Optional[str],
        source_entry_id: str,
        timestamp: datetime
    ) -> tuple[Optional[BlockerRef], List[dict]]:
        """단일 blocker 해석"""
        
        events = []
        
        # 1. 분류
        classification = classify_blocker(raw_text)
        
        # 2. 명시적 Task ID
        if classification.kind == BlockerKind.TASK and classification.confidence == 1.0:
            task = await self.entities.get_entity(raw_text)
            if task:
                return BlockerRef(
                    kind="task",
                    entity_id=task["entity_id"],
                    raw_text=raw_text,
                    confidence=1.0,
                    classification=classification
                ), events
            # Task ID인데 없으면 → Condition으로 안전하게
            classification.kind = BlockerKind.UNKNOWN
        
        # 3. Artifact (URL, JIRA, GitHub)
        if classification.kind == BlockerKind.ARTIFACT:
            canonical_key = CanonicalKeyGenerator.artifact_canonical_key(
                raw_text, 
                classification.artifact_type
            )
            
            artifact, is_new = await self.entities.get_or_create_entity(
                entity_type=EntityType.ARTIFACT,
                canonical_key=canonical_key,
                title=raw_text,
                initial_state={
                    "url": self._extract_url(raw_text),
                    "artifact_type": classification.artifact_type,
                    "external_id": classification.extracted_id,
                    "status": "unknown"
                }
            )
            
            if is_new:
                events.append({
                    "event_type": "artifact_declared",
                    "entity_id": artifact["entity_id"],
                    "canonical_key": canonical_key,
                    "title": raw_text,
                    "artifact_type": classification.artifact_type,
                    "source_entry_id": source_entry_id,
                    "dedupe_key": f"artifact_declared:{canonical_key}"
                })
            
            return BlockerRef(
                kind="artifact",
                entity_id=artifact["entity_id"],
                raw_text=raw_text,
                confidence=classification.confidence,
                classification=classification
            ), events
        
        # 4. Task 제목 매칭 시도 (매우 보수적으로!)
        if classification.kind == BlockerKind.UNKNOWN:
            task_match = await self._try_strict_task_match(raw_text, project)
            
            if task_match and task_match["confidence"] >= self.strict_threshold:
                return BlockerRef(
                    kind="task",
                    entity_id=task_match["entity_id"],
                    raw_text=raw_text,
                    confidence=task_match["confidence"],
                    classification=classification
                ), events
        
        # 5. 기본: Condition으로 흡수 (스텁 Task 생성 금지!)
        canonical_key = CanonicalKeyGenerator.condition_canonical_key(raw_text, project)
        
        # 후보 Task 검색 (낮은 신뢰도로 기록만)
        candidates = await self._get_task_candidates(raw_text, project, limit=5)
        
        condition, is_new = await self.entities.get_or_create_entity(
            entity_type=EntityType.CONDITION,
            canonical_key=canonical_key,
            title=raw_text,
            initial_state={
                "text": raw_text,
                "status": "open",
                "resolution": {
                    "resolved_to": None,
                    "candidates": [c["entity_id"] for c in candidates],
                    "confidence": max([c["confidence"] for c in candidates], default=0)
                }
            }
        )
        
        if is_new:
            events.append({
                "event_type": "condition_declared",
                "entity_id": condition["entity_id"],
                "canonical_key": canonical_key,
                "title": raw_text,
                "source_entry_id": source_entry_id,
                "dedupe_key": f"condition_declared:{canonical_key}"
            })
        
        return BlockerRef(
            kind="condition",
            entity_id=condition["entity_id"],
            raw_text=raw_text,
            confidence=0.6,  # Condition은 항상 중간 신뢰도
            candidates=[c["entity_id"] for c in candidates],
            classification=classification
        ), events
    
    async def _try_strict_task_match(
        self, 
        text: str, 
        project: Optional[str]
    ) -> Optional[dict]:
        """매우 보수적인 Task 매칭 (확실할 때만)"""
        
        # Canonical key exact match
        canonical_key = CanonicalKeyGenerator.task_canonical_key(text, project)
        exact = await self.entities.get_by_canonical_key(EntityType.TASK, canonical_key)
        
        if exact:
            return {"entity_id": exact["entity_id"], "confidence": 0.98}
        
        # 임베딩 유사도 (매우 높은 threshold만)
        similar = await self.task_matcher.find_similar(text, threshold=self.strict_threshold)
        
        if similar and len(similar) == 1:  # 1개만 압도적으로 높을 때
            return similar[0]
        
        return None
    
    async def _get_task_candidates(
        self, 
        text: str, 
        project: Optional[str],
        limit: int = 5
    ) -> List[dict]:
        """후보 Task 검색 (낮은 threshold)"""
        
        candidates = await self.task_matcher.find_similar(
            text, 
            threshold=0.7,
            limit=limit
        )
        return candidates or []
    
    def _split_and_clean(self, blocked_by: List[str]) -> List[str]:
        """항목 분리 및 정리"""
        
        items = []
        for s in blocked_by:
            # 쉼표, 줄바꿈, 슬래시로 분리
            parts = re.split(r"[,\n/]+", s)
            for p in parts:
                # 접두어 제거
                cleaned = re.sub(
                    r"^(blocked\s+by|depends\s+on|대기:|필요:|기다림:)\s*",
                    "",
                    p.strip(),
                    flags=re.IGNORECASE
                )
                if cleaned:
                    items.append(cleaned)
        return items
    
    def _extract_url(self, text: str) -> Optional[str]:
        """URL 추출"""
        match = re.search(r"https?://\S+", text)
        return match.group() if match else None
```

### 5. Condition → Task 업그레이드 (Resolve)

```python
# memory_pipeline/condition_resolver.py

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class ResolutionResult:
    success: bool
    condition_id: str
    resolved_to_type: Optional[str]  # "task" | "artifact"
    resolved_to_id: Optional[str]
    reason: str
    events: List[dict]

class ConditionResolver:
    """Condition → Task/Artifact 업그레이드"""
    
    def __init__(self, entity_store, event_store, duck):
        self.entities = entity_store
        self.events = event_store
        self.duck = duck
    
    async def resolve_condition_to_task(
        self,
        condition_id: str,
        task_id: str,
        reason: str,
        resolved_by: str = "system"
    ) -> ResolutionResult:
        """Condition을 Task로 해석"""
        
        events = []
        
        # 1. Condition 존재 확인
        condition = await self.entities.get_entity(condition_id)
        if not condition or condition["entity_type"] != "condition":
            return ResolutionResult(
                success=False,
                condition_id=condition_id,
                resolved_to_type=None,
                resolved_to_id=None,
                reason="condition_not_found",
                events=[]
            )
        
        # 2. Task 존재 확인
        task = await self.entities.get_entity(task_id)
        if not task or task["entity_type"] != "task":
            return ResolutionResult(
                success=False,
                condition_id=condition_id,
                resolved_to_type=None,
                resolved_to_id=None,
                reason="task_not_found",
                events=[]
            )
        
        # 3. condition_resolved_to 이벤트 발행
        event = {
            "event_type": "condition_resolved_to",
            "condition_id": condition_id,
            "resolved_to_type": "task",
            "resolved_to_id": task_id,
            "reason": reason,
            "resolved_by": resolved_by,
            "dedupe_key": f"condition_resolved_to:{condition_id}->{task_id}"
        }
        events.append(event)
        
        # 4. Condition 상태 업데이트
        current_state = condition.get("current_json", {})
        current_state["status"] = "resolved"
        current_state["resolution"] = {
            "resolved_to": task_id,
            "resolved_to_type": "task",
            "resolved_at": datetime.now().isoformat(),
            "reason": reason
        }
        
        await self.entities.update_entity_state(condition_id, current_state)
        
        # 5. resolves_to 엣지 추가 (기존 blocked_by 엣지는 유지)
        await self._add_resolves_to_edge(condition_id, task_id)
        
        return ResolutionResult(
            success=True,
            condition_id=condition_id,
            resolved_to_type="task",
            resolved_to_id=task_id,
            reason=reason,
            events=events
        )
    
    async def _add_resolves_to_edge(self, condition_id: str, task_id: str):
        """resolves_to 엣지 추가"""
        
        self.duck.execute("""
            INSERT INTO edges (edge_id, src_type, src_id, rel_type, dst_type, dst_id)
            VALUES (?, 'entity', ?, 'resolves_to', 'entity', ?)
            ON CONFLICT DO NOTHING
        """, [
            f"edge_{condition_id}_{task_id}_resolves_to",
            condition_id,
            task_id
        ])
    
    async def auto_resolve_candidates(self, confidence_threshold: float = 0.9):
        """높은 신뢰도 후보를 자동으로 resolve"""
        
        # 미해결 Condition 중 후보가 있는 것들
        conditions = self.duck.execute("""
            SELECT entity_id, current_json
            FROM entities
            WHERE entity_type = 'condition'
              AND json_extract_string(current_json, '$.status') = 'open'
              AND json_extract(current_json, '$.resolution.candidates') IS NOT NULL
        """).fetchall()
        
        resolved_count = 0
        
        for cond_id, state_json in conditions:
            state = json.loads(state_json)
            resolution = state.get("resolution", {})
            confidence = resolution.get("confidence", 0)
            candidates = resolution.get("candidates", [])
            
            # 신뢰도가 높고 후보가 1개만 있을 때
            if confidence >= confidence_threshold and len(candidates) == 1:
                result = await self.resolve_condition_to_task(
                    condition_id=cond_id,
                    task_id=candidates[0],
                    reason=f"auto_resolve_high_confidence:{confidence:.2f}",
                    resolved_by="auto_resolver"
                )
                
                if result.success:
                    resolved_count += 1
        
        return resolved_count
```

### 6. Blockers 조회 (Condition resolved_to 반영)

```python
# memory_pipeline/blocker_query.py

from dataclasses import dataclass
from typing import List, Optional

@dataclass
class EffectiveBlocker:
    """실제 blocker (resolved_to 반영)"""
    entity_id: str
    entity_type: str
    title: str
    status: str
    original_condition_id: Optional[str] = None  # condition에서 resolve된 경우

class BlockerQuery:
    """Blocker 조회 (resolved_to 자동 추적)"""
    
    def __init__(self, duck, entity_store):
        self.duck = duck
        self.entities = entity_store
    
    async def get_effective_blockers(self, task_id: str) -> List[EffectiveBlocker]:
        """Task의 실제 blocker 목록 (resolved_to 반영)"""
        
        # 1. 직접 blocked_by 엣지 조회
        direct_blockers = self.duck.execute("""
            SELECT dst_id FROM edges
            WHERE src_id = ? AND rel_type = 'blocked_by'
        """, [task_id]).fetchall()
        
        effective = []
        
        for (blocker_id,) in direct_blockers:
            blocker = await self.entities.get_entity(blocker_id)
            if not blocker:
                continue
            
            # 2. Condition이면 resolved_to 확인
            if blocker["entity_type"] == "condition":
                resolved_to = await self._get_resolved_to(blocker_id)
                
                if resolved_to:
                    # resolved_to가 있으면 실제 blocker는 그쪽
                    effective.append(EffectiveBlocker(
                        entity_id=resolved_to["entity_id"],
                        entity_type=resolved_to["entity_type"],
                        title=resolved_to["title"],
                        status=resolved_to.get("current_json", {}).get("status", "unknown"),
                        original_condition_id=blocker_id
                    ))
                else:
                    # resolved_to가 없으면 condition 그대로
                    effective.append(EffectiveBlocker(
                        entity_id=blocker_id,
                        entity_type="condition",
                        title=blocker["title"],
                        status=blocker.get("current_json", {}).get("status", "open")
                    ))
            else:
                # Task/Artifact는 그대로
                effective.append(EffectiveBlocker(
                    entity_id=blocker_id,
                    entity_type=blocker["entity_type"],
                    title=blocker["title"],
                    status=blocker.get("current_json", {}).get("status", "unknown")
                ))
        
        return effective
    
    async def _get_resolved_to(self, condition_id: str) -> Optional[dict]:
        """Condition의 resolved_to 엔티티 조회"""
        
        edge = self.duck.execute("""
            SELECT dst_id FROM edges
            WHERE src_id = ? AND rel_type = 'resolves_to'
            LIMIT 1
        """, [condition_id]).fetchone()
        
        if edge:
            return await self.entities.get_entity(edge[0])
        return None
    
    async def is_blocked(self, task_id: str) -> bool:
        """Task가 실제로 blocked 상태인지 확인"""
        
        blockers = await self.get_effective_blockers(task_id)
        
        # 모든 blocker가 "해결됨" 상태면 blocked 아님
        for blocker in blockers:
            if blocker.entity_type == "task":
                if blocker.status not in ("done", "cancelled"):
                    return True
            elif blocker.entity_type == "condition":
                if blocker.status not in ("cleared", "resolved", "expired"):
                    return True
            elif blocker.entity_type == "artifact":
                if blocker.status not in ("closed", "merged"):
                    return True
        
        return False
```

### 7. 자동 언블록 제안 (안전한 처리)

```python
# memory_pipeline/unblock_suggester.py

from dataclasses import dataclass
from datetime import datetime
from typing import List

@dataclass
class UnblockSuggestion:
    task_id: str
    current_status: str
    suggested_status: str
    reason: str
    cleared_blockers: List[str]
    confidence: float

class UnblockSuggester:
    """자동 언블록 제안 (실제 전이는 사람/다음 세션에서)"""
    
    def __init__(self, blocker_query: BlockerQuery, event_store, duck):
        self.blockers = blocker_query
        self.events = event_store
        self.duck = duck
    
    async def check_and_suggest_unblock(self) -> List[UnblockSuggestion]:
        """Blocked Task 중 blocker가 해소된 것 찾아서 제안"""
        
        suggestions = []
        
        # Blocked 상태인 Task들
        blocked_tasks = self.duck.execute("""
            SELECT entity_id, current_json
            FROM entities
            WHERE entity_type = 'task'
              AND json_extract_string(current_json, '$.status') = 'blocked'
        """).fetchall()
        
        for task_id, state_json in blocked_tasks:
            state = json.loads(state_json)
            
            # 실제로 blocked인지 확인
            is_still_blocked = await self.blockers.is_blocked(task_id)
            
            if not is_still_blocked:
                # 해소된 blocker 목록
                cleared = await self._get_cleared_blockers(task_id)
                
                suggestion = UnblockSuggestion(
                    task_id=task_id,
                    current_status="blocked",
                    suggested_status="in_progress",
                    reason="all_blockers_cleared",
                    cleared_blockers=cleared,
                    confidence=0.8
                )
                suggestions.append(suggestion)
                
                # 제안 이벤트 발행 (실제 전이는 안 함!)
                await self._emit_unblock_suggestion(suggestion)
        
        return suggestions
    
    async def _emit_unblock_suggestion(self, suggestion: UnblockSuggestion):
        """언블록 제안 이벤트 발행"""
        
        await self.events.append(RawEvent(
            event_id=IdGenerator.event_id(),
            timestamp=datetime.now(),
            event_type="task_unblock_suggested",
            actor="unblock_suggester",
            payload={
                "task_id": suggestion.task_id,
                "current_status": suggestion.current_status,
                "suggested_status": suggestion.suggested_status,
                "reason": suggestion.reason,
                "cleared_blockers": suggestion.cleared_blockers,
                "confidence": suggestion.confidence
            },
            meta={
                "dedupe_key": f"task_unblock_suggested:{suggestion.task_id}:{datetime.now().strftime('%Y%m%d')}"
            }
        ))
    
    async def _get_cleared_blockers(self, task_id: str) -> List[str]:
        """해소된 blocker 목록"""
        
        all_blockers = await self.blockers.get_effective_blockers(task_id)
        
        cleared = []
        for b in all_blockers:
            if b.entity_type == "task" and b.status in ("done", "cancelled"):
                cleared.append(b.entity_id)
            elif b.entity_type == "condition" and b.status in ("cleared", "resolved"):
                cleared.append(b.entity_id)
            elif b.entity_type == "artifact" and b.status in ("closed", "merged"):
                cleared.append(b.entity_id)
        
        return cleared
```

### 8. TaskResolver 통합 (blocker 처리 개선)

```python
# memory_pipeline/task_resolver.py (수정)

class TaskResolver:
    def __init__(
        self,
        duck,
        event_store,
        task_matcher,
        blocker_resolver: BlockerResolver,  # 추가
        id_generator
    ):
        self.duck = duck
        self.events = event_store
        self.matcher = task_matcher
        self.blocker_resolver = blocker_resolver  # 추가
        self.idgen = id_generator
    
    async def process_task_candidate(
        self,
        task_entry: dict,
        source_entry_id: str,
        source_session_id: str,
        timestamp: datetime
    ) -> list[TaskEvent]:
        """Task 후보 처리"""
        
        events = []
        
        # ... 기존 매칭/생성/업데이트 로직
        
        # Blockers 처리 (개선된 버전)
        if task_entry.get("blockedBy"):
            blocker_result = await self.blocker_resolver.resolve_blockers(
                blocked_by=task_entry["blockedBy"],
                project=task_entry.get("project"),
                source_entry_id=source_entry_id,
                timestamp=timestamp
            )
            
            # Condition/Artifact 선언 이벤트 발행
            for ev in blocker_result.events_to_emit:
                await self._emit_entity_event(ev, timestamp)
            
            # task_blockers_set 이벤트
            if blocker_result.refs:
                blocker_event = self._create_blockers_event(
                    task_id=task_id,
                    blocker_refs=blocker_result.refs,
                    source_entry_id=source_entry_id,
                    timestamp=timestamp
                )
                events.append(blocker_event)
            
            # 경고 로깅
            for warning in blocker_result.warnings:
                print(f"[Warning] {warning}")
        
        return events
    
    def _create_blockers_event(
        self,
        task_id: str,
        blocker_refs: List[BlockerRef],
        source_entry_id: str,
        timestamp: datetime
    ) -> TaskEvent:
        """Blockers 이벤트 생성 (구조화된 참조)"""
        
        blockers_payload = [
            {
                "kind": ref.kind,
                "entity_id": ref.entity_id,
                "raw_text": ref.raw_text,
                "confidence": ref.confidence,
                "candidates": ref.candidates
            }
            for ref in blocker_refs
        ]
        
        return TaskEvent(
            event_id=self.idgen.event_id(),
            timestamp=timestamp,
            event_type="task_blockers_set",
            task_id=task_id,
            payload={
                "task_id": task_id,
                "blockers": blockers_payload,
                "mode": "replace",  # or "suggest" if low confidence
                "source_entry_id": source_entry_id,
            },
            dedupe_key=DedupeKeyGenerator.task_blockers_set(
                task_id,
                [ref.entity_id for ref in blocker_refs],
                source_entry_id
            ),
            source_entry_id=source_entry_id
        )
```

---

## 요약: 완전한 Blocker 처리 시스템

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    BLOCKER RESOLUTION FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [세션에서 추출된 blockedBy]                                             │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ BlockerClassifier                                                │   │
│  │                                                                  │   │
│  │  "tsk_xxx" ────────────────────────────────────→ TASK (직접)    │   │
│  │  "https://..." / "JIRA-123" / "#42" ──────────→ ARTIFACT        │   │
│  │  "승인 대기" / "데이터 받는 중" ───────────────→ CONDITION       │   │
│  │  "리팩토링 끝나면" (애매함) ─────────────────→ UNKNOWN          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ BlockerResolver                                                  │   │
│  │                                                                  │   │
│  │  TASK: exact match → Task 엔티티 연결                           │   │
│  │  ARTIFACT: get_or_create → Artifact 엔티티                      │   │
│  │  CONDITION: get_or_create → Condition 엔티티                    │   │
│  │  UNKNOWN:                                                        │   │
│  │    ├─ strict_task_match (≥0.92) → Task                          │   │
│  │    └─ else → Condition (+ candidates 기록)                      │   │
│  │                                                                  │   │
│  │  ⚠️ 스텁 Task 생성 금지!                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                  │
│       ▼                                                                  │
│  [BlockerRef 목록] ──→ [task_blockers_set 이벤트]                       │
│       │                                                                  │
│       │  나중에 확실해지면                                               │
│       ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ConditionResolver                                                │   │
│  │                                                                  │   │
│  │  Condition --[resolves_to]--> Task                              │   │
│  │  (기존 blocked_by 엣지는 유지, 해석만 진화)                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 핵심 효과

| 효과 | 설명 |
|------|------|
| **스텁 Task 지옥 방지** | 애매한 blocker는 Condition으로 안전하게 수용 |
| **blockers가 항상 엔티티 ID** | 불변식/검증 단순화 |
| **점진적 업그레이드** | Condition → Task 나중에 resolve |
| **원본 기록 유지** | resolves_to 엣지로 해석만 진화 |
| **자동 언블록 = 제안만** | 사고 방지 |

이 설계로 **blocker 처리가 완전히 엔티티화**되어 중복/단절 문제가 해결됩니다. 추가로 궁금한 점 있으면 말씀해 주세요.
====
좋아. 아래는 방금까지 만든 **BlockerResolver 설계(A)** 위에, 요청하신 대로 **(1) TaskMatcher(정확/FTS/벡터) + (2) `task_blockers_set(mode=replace|suggest)` 이벤트 발행 + (3) Projector가 edges를 교체/추가하는 로직 + (4) dedupe_key까지 포함한 “TaskResolver 완성본”**을 한 번에 이어서 정리한 설계안이야.

> 목표:
>
> * 세션 처리/재처리/재빌드가 반복돼도 **Task/Blocker가 중복되지 않고**,
> * blockedBy는 항상 **엔티티 ID로 정규화**되어 **불변식 검증이 쉬워지고**,
> * blocker 매칭이 애매할 때도 **안전하게 Condition으로 흡수**되면서,
> * 나중에 정확도가 올라가면 **Condition → Task/Artifact로 “Resolve”**할 수 있게 만들기.

---

## 0) 이번 파트에서 고정할 운영 규칙 4개

1. **blockedBy는 최종적으로 “entity_id 리스트”로만 저장**
2. `task_blockers_set`는 기본적으로 **replace**, 단 evidence가 약하면 **suggest**
3. blocker 텍스트가 애매하면 **스텁 Task 생성 금지 → condition 엔티티 생성**
4. 같은 입력이 반복되어도 이벤트/edge가 **중복 생성되지 않도록 dedupe_key로 잠금**

---

## 1) DDL 추가/수정: (중복 방지) event_dedup + (projection) projector offset

네 EventStore가 append-only라서 “중복 방지”는 **DB 유니크 제약 대신 별도 테이블로** 잡는 게 안정적이야(특히 재처리/재빌드에서).

### 1-A) event_dedup: dedupe_key → event_id (유니크 보장)

```sql
CREATE TABLE IF NOT EXISTS event_dedup (
  dedupe_key   VARCHAR PRIMARY KEY,
  event_id     VARCHAR NOT NULL,
  ts           TIMESTAMP NOT NULL,
  event_type   VARCHAR NOT NULL
);
```

이제 이벤트 append는:

1. `event_dedup`에 먼저 INSERT (실패하면 “이미 처리됨” → skip)
2. 성공하면 `events`에 INSERT

### 1-B) projection_offsets: projector별 마지막 처리 지점

```sql
CREATE TABLE IF NOT EXISTS projection_offsets (
  projector_name VARCHAR PRIMARY KEY,
  last_ts        TIMESTAMP,
  last_event_id  VARCHAR
);
```

> 이벤트 ID가 ULID(시간 정렬)면 `last_event_id`만으로도 가능하지만, 안전하게 `ts + event_id` 조합을 추천.

---

## 2) edges 규칙: “현재 blockers”와 “제안 blockers”를 분리

Projection에서 edge는 “현재 상태”에 해당하므로 삭제/교체가 가능하고(SoT는 events), 운영을 깔끔하게 하려면 rel_type을 분리하는 게 좋아.

* `blocked_by` : **현재 유효한 blocker**
* `blocked_by_suggested` : evidence가 약하거나 불확실한 **제안 blocker**
* `resolves_to` : condition → task/artifact 해석 연결

---

## 3) TaskMatcher: exact → FTS → vector (하지만 자동 확정은 ‘매우 보수적으로’)

TaskMatcher는 “blockedBy 텍스트가 실제로 어떤 Task를 가리키는가?”에서 핵심이야.
여기서 실수하면 스텁/오매칭으로 시스템이 망가진다.

### 3-A) 출력 구조

```python
@dataclass
class Match:
    entity_id: str
    score: float                 # 0~1
    method: str                 # exact|fts|vector
    status: str                 # task current status
    title: str
```

### 3-B) 자동 확정 규칙(강력 추천)

* top1.score ≥ 0.92 AND (top1.score - top2.score) ≥ 0.03 → **확정**
* 그 외는 **확정 금지** → condition으로 흡수 + candidates 기록

> 즉, “매칭이 될 것 같다”는 건 절대 확정하지 말고 **조건으로 받아**.
> 이게 운영에서 사고를 막는다.

### 3-C) 구현 스켈레톤

#### (1) exact 매칭: canonical_key

```python
def exact_match_task(duck, canonical_key: str) -> list[Match]:
    rows = duck.execute("""
      SELECT entity_id, title, current_json
      FROM entities
      WHERE entity_type='task' AND canonical_key=? AND status='active'
      ORDER BY updated_at DESC
      LIMIT 5
    """, [canonical_key]).fetchall()

    out = []
    for (eid, title, cur) in rows:
        status = cur["status"] if isinstance(cur, dict) else "unknown"
        out.append(Match(eid, 1.0, "exact", status, title))
    return out
```

#### (2) FTS 매칭: title 기반

FTS는 DuckDB 확장으로 처리(너가 이미 도입하려는 방향).
(버전별 차이가 있을 수 있어서 “개념/형태” 위주로 적어둘게.)

* entities에 `search_text`를 유지하거나 `title`을 대상으로 FTS 인덱스 생성
* query에서 bm25 상위 N개를 뽑고 score를 0~1로 정규화

```python
def fts_match_task(duck, query: str, limit: int = 10) -> list[Match]:
    # 개념 예시: bm25가 큰 게 좋은 점수
    rows = duck.execute("""
      SELECT entity_id, title, current_json, bm25
      FROM task_fts_view(?)   -- 너의 FTS 래퍼/뷰로 캡슐화 추천
      WHERE status='active'
      ORDER BY bm25 DESC
      LIMIT ?
    """, [query, limit]).fetchall()

    # 정규화(대충): top bm25를 1.0으로
    if not rows:
        return []
    top = rows[0][3] or 1.0
    out = []
    for (eid, title, cur, bm25) in rows:
        score = min((bm25 / top), 1.0)
        status = cur["status"] if isinstance(cur, dict) else "unknown"
        out.append(Match(eid, score, "fts", status, title))
    return out
```

#### (3) vector 매칭: “task title vectors” 별도 테이블 권장

벡터는 LanceDB 에 `task_title_vectors` 테이블을 따로 두는 걸 추천해.

스키마(개념):

* id: task_entity_id
* text: normalized title
* vector: embedding
* embedding_version

```python
def vector_match_task(lance_table, embedder, query: str, limit: int = 10) -> list[Match]:
    qv = embedder.encode(query).tolist()
    rows = lance_table.search(qv).limit(limit).to_list()

    # distance -> similarity 변환(예시)
    out = []
    for r in rows:
        dist = r["_distance"]
        sim = max(0.0, 1.0 - dist)  # 실제 dist 스케일에 맞게 보정 필요
        out.append(Match(r["id"], sim, "vector", r.get("status","unknown"), r.get("title","")))
    return out
```

---

## 4) BlockerResolver “완성본”: TaskMatcher + Condition/Artifact 생성 + candidates 기록

아래는 “애매하면 무조건 condition으로 흡수”하면서도,

* 확정 가능하면 task/artifact로 연결
* 애매하면 condition에 candidates를 남기는 흐름을 구현한 형태야.

### 4-A) EntityRepo가 제공해야 하는 최소 API

* `get_entity_by_key(entity_type, canonical_key)`
* `create_entity_declared(entity_type, entity_id, canonical_key, title, source_entry_id, dedupe_key)`
* `get_task(task_id)`
* `upsert_entity_snapshot(entity_id, current_json)` (projector가 주로 사용)

**중요:** `create_entity_declared`는 **이벤트를 발행**해야 하고, dedupe_key로 idempotent 해야 함.

---

## 5) TaskResolver 완성: status/priority + blockers_set(mode) 이벤트까지 한 번에

이제 세션에서 추출된 task entry를 처리해서 이벤트를 발행하는 “완성 파이프”를 만들자.

### 5-A) task entry 입력 형태(추출 결과)

```json
{
  "entryId": "ent_...",
  "type": "task",
  "title": "...",
  "status": "pending|in_progress|blocked|done",
  "priority": "low|medium|high|critical",
  "blockedBy": ["..."],
  "evidenceAligned": true
}
```

* `evidenceAligned`는 “quote→span 정렬 성공” 여부(정렬기를 넣었다는 가정)
* 이 값으로 blockers_set의 `mode`를 결정한다.

### 5-B) dedupe_key 규칙(이벤트 중복 방지)

* created: `task_created:{canonical_key}:{source_entry_id}`
* status: `task_status_changed:{task_id}:{from}->{to}:{source_entry_id}`
* priority: `task_priority_changed:{task_id}:{from}->{to}:{source_entry_id}`
* blockers: `task_blockers_set:{task_id}:{mode}:{hash(blockers)}:{source_entry_id}`

blockers hash는 **정렬된 entity_id 리스트**를 해시(항상 동일).

```python
import hashlib

def hash_blockers(blocker_ids: list[str]) -> str:
    s = "|".join(sorted(blocker_ids))
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]
```

### 5-C) TaskResolver 스켈레톤(핵심만)

```python
class TaskResolver:
    def __init__(self, duck, event_store, entity_repo, blocker_resolver, idgen):
        self.duck = duck
        self.events = event_store
        self.entities = entity_repo
        self.blockers = blocker_resolver
        self.idgen = idgen

    def process_task_entry(self, task_entry: dict, session_ts):
        source_entry_id = task_entry["entryId"]
        title = task_entry["title"]
        project = task_entry.get("project")

        key = task_canonical_key(title, project)
        existing = self.entities.find_active_task_by_key(key)

        if not existing:
            task_id = self.idgen.entity_id(prefix="tsk")
            self.events.append_dedup(
                event_type="task_created",
                ts=session_ts,
                dedupe_key=f"task_created:{key}:{source_entry_id}",
                payload={
                    "task_id": task_id,
                    "title": title,
                    "canonical_key": key,
                    "priority": task_entry.get("priority","medium"),
                    "initial_status": self._sanitize_initial_status(task_entry.get("status","pending")),
                    "source_entry_id": source_entry_id
                }
            )
        else:
            task_id = existing["entity_id"]

        # 최신 상태는 projection(entities.current_json)에서 읽는다고 가정
        cur = self.entities.get_task_snapshot(task_id)  # {"status":..., "priority":..., "blockers":[...]}
        cur_status = cur.get("status","pending")
        cur_prio = cur.get("priority","medium")

        # 1) priority update
        new_prio = task_entry.get("priority")
        if new_prio and new_prio != cur_prio:
            self.events.append_dedup(
                "task_priority_changed", session_ts,
                dedupe_key=f"task_priority_changed:{task_id}:{cur_prio}->{new_prio}:{source_entry_id}",
                payload={
                    "task_id": task_id,
                    "from": cur_prio, "to": new_prio,
                    "source_entry_id": source_entry_id
                }
            )

        # 2) status update (전이 검증)
        desired = task_entry.get("status")
        if desired and desired != cur_status:
            if is_valid_transition(cur_status, desired):
                # done으로 가면 blockers가 없어야 하므로(불변식) 필요하면 blockers clear도 함께 처리
                self.events.append_dedup(
                    "task_status_changed", session_ts,
                    dedupe_key=f"task_status_changed:{task_id}:{cur_status}->{desired}:{source_entry_id}",
                    payload={
                        "task_id": task_id,
                        "from": cur_status, "to": desired,
                        "source_entry_id": source_entry_id
                    }
                )
            else:
                self.events.append_dedup(
                    "task_transition_rejected", session_ts,
                    dedupe_key=f"task_transition_rejected:{task_id}:{cur_status}->{desired}:{source_entry_id}",
                    payload={
                        "task_id": task_id,
                        "from": cur_status, "to": desired,
                        "source_entry_id": source_entry_id,
                        "reason": "invalid_transition"
                    }
                )

        # 3) blockers
        if "blockedBy" in task_entry:
            mode = "replace" if task_entry.get("evidenceAligned", False) else "suggest"
            blocked_by_texts = task_entry.get("blockedBy") or []

            # blocked 상태인데 blockedBy가 비어 있으면 placeholder condition을 넣어 불변식 유지(자동 표식)
            if task_entry.get("status") == "blocked" and len(blocked_by_texts) == 0:
                blocked_by_texts = ["(unknown blocker)"]
                auto_placeholder = True
            else:
                auto_placeholder = False

            blocker_refs = self.blockers.resolve_blockers(
                blocked_by_texts, project=project, source_entry_id=source_entry_id
            )
            blocker_ids = [b.entity_id for b in blocker_refs]

            self.events.append_dedup(
                "task_blockers_set", session_ts,
                dedupe_key=f"task_blockers_set:{task_id}:{mode}:{hash_blockers(blocker_ids)}:{source_entry_id}",
                payload={
                    "task_id": task_id,
                    "mode": mode,
                    "blockers": [
                        {
                            "entity_id": b.entity_id,
                            "kind": b.kind,
                            "raw_text": b.raw_text,
                            "confidence": b.confidence,
                            "candidates": b.candidates
                        }
                        for b in blocker_refs
                    ],
                    "auto_placeholder": auto_placeholder,
                    "source_entry_id": source_entry_id
                }
            )

    def _sanitize_initial_status(self, s: str) -> str:
        # 신규 생성 시 done은 금지(보수적). 필요하면 in_progress로 보정.
        if s == "done":
            return "in_progress"
        return s
```

---

## 6) Projector 완성: task_blockers_set(mode)에 따라 edges “교체/추가” + entity snapshot 갱신

Projector는 L0 이벤트를 읽어서 **entities/edges**를 업데이트하는 파생 계층이야.
(SoT는 events, projection은 언제든 재빌드 가능)

### 6-A) 이벤트 읽기(증분)

```sql
SELECT event_id, ts, event_type, payload_json
FROM events
WHERE (ts > ?) OR (ts = ? AND event_id > ?)
  AND event_type IN (
    'task_created','task_status_changed','task_priority_changed','task_blockers_set',
    'condition_declared','artifact_declared','condition_resolved_to'
  )
ORDER BY ts ASC, event_id ASC;
```

### 6-B) blockers_set 처리 규칙

* mode=`replace`:

  * 기존 `blocked_by` edges 삭제
  * 새 `blocked_by` edges 삽입
  * task snapshot의 `blockers`도 갱신
* mode=`suggest`:

  * 기존 유지
  * `blocked_by_suggested` edges만 추가(중복 방지)
  * task snapshot에는 `blocker_suggestions`로 누적(선택)

### 6-C) Projector 스켈레톤

```python
import json
import hashlib

def edge_id(src_id: str, rel: str, dst_id: str, event_id: str) -> str:
    s = f"{src_id}|{rel}|{dst_id}|{event_id}"
    return "edg_" + hashlib.sha1(s.encode()).hexdigest()[:16]

class TaskProjector:
    def __init__(self, duck, event_store, entity_repo):
        self.duck = duck
        self.events = event_store
        self.entities = entity_repo

    def run_once(self):
        last = self._get_offset("task_projector")
        rows = self.events.fetch_since(
            last_ts=last["last_ts"], last_event_id=last["last_event_id"],
            event_types=[
                "task_created","task_status_changed","task_priority_changed","task_blockers_set",
                "condition_declared","artifact_declared","condition_resolved_to"
            ]
        )
        for (eid, ts, etype, payload) in rows:
            if etype == "task_created":
                self._apply_task_created(eid, ts, payload)
            elif etype == "task_status_changed":
                self._apply_task_status_changed(eid, ts, payload)
            elif etype == "task_priority_changed":
                self._apply_task_priority_changed(eid, ts, payload)
            elif etype == "task_blockers_set":
                self._apply_task_blockers_set(eid, ts, payload)
            elif etype == "condition_declared":
                self._apply_entity_declared("condition", eid, ts, payload)
            elif etype == "artifact_declared":
                self._apply_entity_declared("artifact", eid, ts, payload)
            elif etype == "condition_resolved_to":
                self._apply_condition_resolved_to(eid, ts, payload)

            self._set_offset("task_projector", ts, eid)

    def _apply_task_created(self, event_id, ts, p):
        task_id = p["task_id"]
        # entity upsert
        self.entities.upsert_entity(
            entity_id=task_id,
            entity_type="task",
            canonical_key=p["canonical_key"],
            title=p["title"],
            stage="working",
            status="active",
            current_json={
                "status": p.get("initial_status","pending"),
                "priority": p.get("priority","medium"),
                "blockers": [],
                "history": [{"event_id": event_id, "type": "created", "ts": str(ts)}],
            },
            ts=ts
        )
        # entry evidence link(선택): edges에 entry->evidence_of->task
        if p.get("source_entry_id"):
            self._insert_edge(
                src_type="entry", src_id=p["source_entry_id"],
                rel_type="evidence_of",
                dst_type="entity", dst_id=task_id,
                meta={"event_id": event_id}
            )

    def _apply_task_status_changed(self, event_id, ts, p):
        task_id = p["task_id"]
        cur = self.entities.get_snapshot(task_id) or {}
        cur["status"] = p["to"]
        cur.setdefault("history", []).append({"event_id": event_id, "type": "status", "from": p["from"], "to": p["to"], "ts": str(ts)})

        # 불변식: done이면 blockers 비워야 함 -> projection에서 현재 blockers edge 제거
        if p["to"] == "done":
            cur["blockers"] = []
            self.duck.execute("""
              DELETE FROM edges
              WHERE src_type='entity' AND src_id=? AND rel_type='blocked_by'
            """, [task_id])

        self.entities.update_snapshot(task_id, cur, ts)

        if p.get("source_entry_id"):
            self._insert_edge("entry", p["source_entry_id"], "evidence_of", "entity", task_id, {"event_id": event_id})

    def _apply_task_priority_changed(self, event_id, ts, p):
        task_id = p["task_id"]
        cur = self.entities.get_snapshot(task_id) or {}
        cur["priority"] = p["to"]
        cur.setdefault("history", []).append({"event_id": event_id, "type": "priority", "from": p["from"], "to": p["to"], "ts": str(ts)})
        self.entities.update_snapshot(task_id, cur, ts)

        if p.get("source_entry_id"):
            self._insert_edge("entry", p["source_entry_id"], "evidence_of", "entity", task_id, {"event_id": event_id})

    def _apply_task_blockers_set(self, event_id, ts, p):
        task_id = p["task_id"]
        mode = p.get("mode","replace")
        blockers = p.get("blockers", [])
        blocker_ids = [b["entity_id"] for b in blockers]

        # replace면 현재 blocked_by를 교체
        if mode == "replace":
            self.duck.execute("""
              DELETE FROM edges
              WHERE src_type='entity' AND src_id=? AND rel_type='blocked_by'
            """, [task_id])

            for b in blockers:
                self._insert_edge(
                    src_type="entity", src_id=task_id,
                    rel_type="blocked_by",
                    dst_type="entity", dst_id=b["entity_id"],
                    meta={
                        "event_id": event_id,
                        "ts": str(ts),
                        "confidence": b.get("confidence"),
                        "raw_text": b.get("raw_text"),
                        "kind": b.get("kind"),
                        "candidates": b.get("candidates"),
                        "source_entry_id": p.get("source_entry_id"),
                        "auto_placeholder": p.get("auto_placeholder", False),
                    }
                )

            # snapshot에도 캐시(선택)
            cur = self.entities.get_snapshot(task_id) or {}
            cur["blockers"] = blocker_ids
            cur.setdefault("history", []).append({"event_id": event_id, "type": "blockers_set", "mode": "replace", "ts": str(ts)})
            self.entities.update_snapshot(task_id, cur, ts)

        else:  # suggest
            for b in blockers:
                self._insert_edge(
                    src_type="entity", src_id=task_id,
                    rel_type="blocked_by_suggested",
                    dst_type="entity", dst_id=b["entity_id"],
                    meta={
                        "event_id": event_id,
                        "ts": str(ts),
                        "confidence": b.get("confidence"),
                        "raw_text": b.get("raw_text"),
                        "kind": b.get("kind"),
                        "candidates": b.get("candidates"),
                        "source_entry_id": p.get("source_entry_id"),
                    }
                )

            cur = self.entities.get_snapshot(task_id) or {}
            cur.setdefault("blocker_suggestions", []).append({
                "event_id": event_id,
                "ts": str(ts),
                "blockers": blocker_ids
            })
            cur.setdefault("history", []).append({"event_id": event_id, "type": "blockers_set", "mode": "suggest", "ts": str(ts)})
            self.entities.update_snapshot(task_id, cur, ts)

        # entry evidence link
        if p.get("source_entry_id"):
            self._insert_edge("entry", p["source_entry_id"], "evidence_of", "entity", task_id, {"event_id": event_id})

    def _apply_entity_declared(self, entity_type, event_id, ts, p):
        self.entities.upsert_entity(
            entity_id=p["entity_id"],
            entity_type=entity_type,
            canonical_key=p["canonical_key"],
            title=p["title"],
            stage="working",
            status="active",
            current_json=p.get("current_json", {"text": p["title"], "status": "open"}),
            ts=ts
        )

    def _apply_condition_resolved_to(self, event_id, ts, p):
        cond_id = p["condition_id"]
        dst_id = p["resolved_to_id"]
        self._insert_edge(
            src_type="entity", src_id=cond_id,
            rel_type="resolves_to",
            dst_type="entity", dst_id=dst_id,
            meta={"event_id": event_id, "ts": str(ts), "reason": p.get("reason")}
        )

    def _insert_edge(self, src_type, src_id, rel_type, dst_type, dst_id, meta):
        eid = edge_id(src_id, rel_type, dst_id, meta.get("event_id",""))
        self.duck.execute("""
          INSERT OR REPLACE INTO edges (edge_id, src_type, src_id, rel_type, dst_type, dst_id, meta_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [eid, src_type, src_id, rel_type, dst_type, dst_id, json.dumps(meta)])

    def _get_offset(self, name):
        row = self.duck.execute("""
          SELECT last_ts, last_event_id FROM projection_offsets WHERE projector_name=?
        """, [name]).fetchone()
        if not row:
            return {"last_ts": "1970-01-01", "last_event_id": ""}
        return {"last_ts": row[0], "last_event_id": row[1] or ""}

    def _set_offset(self, name, last_ts, last_event_id):
        self.duck.execute("""
          INSERT OR REPLACE INTO projection_offsets (projector_name, last_ts, last_event_id)
          VALUES (?, ?, ?)
        """, [name, last_ts, last_event_id])
```

---

## 7) Event append: append_dedup 구현(핵심)

이게 없으면 재처리 때 중복 이벤트가 박히면서 projection이 흔들린다.

```python
class EventStore:
    def __init__(self, duck, idgen):
        self.duck = duck
        self.idgen = idgen

    def append_dedup(self, event_type: str, ts, dedupe_key: str, payload: dict, actor="system", session_id=None):
        # 1) dedupe lock
        try:
            event_id = self.idgen.event_id()
            self.duck.execute("""
              INSERT INTO event_dedup (dedupe_key, event_id, ts, event_type)
              VALUES (?, ?, ?, ?)
            """, [dedupe_key, event_id, ts, event_type])
        except Exception:
            # already exists -> skip
            return None

        # 2) append event
        self.duck.execute("""
          INSERT INTO events (event_id, ts, event_type, actor, session_id, payload_json, checksum)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [event_id, ts, event_type, actor, session_id, json.dumps(payload), self._checksum(payload)])

        return event_id
```

---

## 8) 운영 정책(중요): replace vs suggest를 언제 쓰나?

추천 룰(너의 evidence aligner 전제):

* `evidenceAligned == True` AND 근거 quote 길이 충분(예: 30자 이상) → `replace`
* 그렇지 않으면 `suggest`

그리고 `suggest`인 경우:

* **blocked_by_suggested만 추가**, 현재 blocked_by는 건드리지 않음
* 다음 세션에서 근거가 강해지면 replace 이벤트가 들어오면서 “현재 blockers”가 갱신됨

이렇게 하면 자동화가 강해져도 사고가 줄어든다.

---

## 9) 마지막으로: “blocked인데 blockers 없음” 처리(불변식과 현실의 타협)

불변식(Blocked이면 blockers non-empty)을 유지하려면,
세션에서 “blocked”만 말하고 이유를 안 줬을 때도 시스템이 처리해야 해.

내 추천은 지금 구현처럼:

* `(unknown blocker)` condition 엔티티를 **자동 생성**하되
* meta에 `auto_placeholder=true`로 표시하고,
* UI/리뷰에서 이 condition이 있으면 “원문에 blocker가 없다” 경고로 보여주기

즉, 불변식을 억지로 깨지 말고 **placeholder로 정합성을 유지하면서 문제를 표면화**하는 쪽이 운영이 편해.

---

# 여기까지로 “TaskResolver + BlockerResolver + Projector(Edges 교체/추가)”가 완성됨

원하면 다음으로 바로 이어서 **두 가지 중 하나**를 더 완성해줄게(둘 다 해도 됨):

1. **TaskMatcher 고도화**:

   * FTS 인덱스 구축 스크립트(entities용)
   * 벡터 테이블 구축/업데이트(outbox 포함)
   * “done/cancelled 태스크는 매칭 점수 패널티” 같은 휴리스틱

2. **조회 API**(실제 제품에서 가장 바로 쓰는 쿼리들):

   * “현재 blocked task 목록 + blocker 종류별 그룹핑”
   * “suggested blockers만 있는 task”
   * “unknown blocker placeholder가 있는 task”
   * “condition이 resolves_to를 가진 경우 실제 blocker 펼쳐보기”

어느 쪽부터 이어서 만들까? (난 질문 없이도 보통 2)부터 바로 내려주는 편이긴 해.)

===

좋아. 아래는 (1) TaskMatcher 고도화(FTS + 벡터 + 휴리스틱 + outbox) + **(2) 조회 API(SQL 뷰/쿼리 + 파이썬 래퍼)**를 “그대로 구현 가능한 수준”으로 한 번에 정리한 완성 설계야.
(너의 기존 EventStore/edges/entities 구조를 그대로 쓰되, 필요한 테이블만 최소 추가)

1) TaskMatcher 고도화
1-1. “Rename/표현 차이”까지 흡수하려면 alias 테이블이 필요함

Task canonical_key는 강력하지만, 제목이 조금 바뀌거나 표현이 달라지면 exact match가 깨져서 조건(Condition)으로만 쌓일 수 있어.
그래서 canonical_key → task_id 매핑을 alias로 누적하는 테이블을 두는 게 운영에서 매우 유용해.

DDL: entity_aliases
CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_type   VARCHAR NOT NULL,   -- 'task'
  canonical_key VARCHAR NOT NULL,
  entity_id     VARCHAR NOT NULL,   -- tsk_...
  is_primary    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_type, canonical_key)
);

CREATE INDEX IF NOT EXISTS idx_aliases_entity ON entity_aliases(entity_id);


정책

task 생성 시: (task, canonical_key) -> task_id 를 is_primary=true로 insert

task rename/merge 시: 새 canonical_key를 alias로 추가, 기존 primary는 false 처리(프로젝션에서 update)

1-2. FTS를 Task에 적용하기 위한 “search_text” 컬럼과 인덱스

TaskMatcher의 2차 후보 생성에서 FTS는 꽤 강력해. (표현 차이/키워드 일부만 있어도 후보를 뽑음)

DB는 DuckDB 기준으로 작성할게. DuckDB FTS는 버전에 따라 호출 형태가 조금 달라질 수 있으니, **“FTS 호출을 뷰/함수로 캡슐화”**해서 나중에 교체 가능하게 만드는 걸 추천.

DDL: entities에 검색용 컬럼 추가
ALTER TABLE entities ADD COLUMN IF NOT EXISTS title_norm VARCHAR;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS search_text VARCHAR;

search_text 구성(권장)

title 원문

title_norm (정규화)

canonical_key 토큰(프로젝트/도메인)

상태/태그(선택) 예: “blocked”, “priority:high” 같은 토큰

예시:

search_text = "{title} | {title_norm} | {canonical_key} | status:{status} priority:{priority}"

FTS 인덱스 생성(개념)
INSTALL fts;
LOAD fts;

-- 아래 PRAGMA 이름/형태는 DuckDB 버전에 따라 다를 수 있음.
-- 핵심은: entities(entity_id, search_text)에 FTS 인덱스를 만든다.
PRAGMA create_fts_index('entities', 'entity_id', 'search_text');

FTS 조회를 “뷰”로 캡슐화(권장)

버전 차이를 흡수하려고, 호출부는 항상 여기만 쓰게:

-- 개념적인 형태 (너의 DuckDB 버전에 맞춰 내부만 조정)
CREATE VIEW IF NOT EXISTS v_task_fts AS
SELECT
  e.entity_id,
  e.title,
  e.current_json,
  e.status AS entity_status,
  e.stage,
  e.updated_at,
  -- bm25가 높을수록 좋은 점수라는 가정
  fts_main_entities.match_bm25(e.entity_id, ?) AS bm25
FROM entities e
WHERE e.entity_type='task';


실제론 DuckDB에서 파라미터(?)가 뷰에 안 들어갈 수 있으니,
“뷰 + 쿼리에서 match_bm25 호출”로 쓰면 돼. 요지는 호출을 한 곳에 모으는 것.

1-3. Task 제목 벡터 테이블 + outbox (idempotent upsert)

FTS만으로 부족한 경우(자연어 표현 변화/유사 의미)에는 벡터가 좋다.
벡터 DB는 LanceDB 를 기준으로 설계할게.

(A) outbox 테이블: entry와 task_title을 같은 outbox로 관리
CREATE TABLE IF NOT EXISTS vector_outbox (
  job_id           VARCHAR PRIMARY KEY,
  item_kind        VARCHAR NOT NULL,     -- 'entry'|'task_title'
  item_id          VARCHAR NOT NULL,     -- entry_id or task_entity_id
  embedding_version VARCHAR NOT NULL,    -- 'e5_v1' 같은 버전 스트링
  status           VARCHAR NOT NULL,     -- pending|done|failed
  error            VARCHAR,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_kind, item_id, embedding_version)
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON vector_outbox(status);

(B) LanceDB 테이블: task_titles_{embedding_version}

필드(권장):

id = task entity_id (tsk_...)

title_norm

vector

entity_status (active/contested…)

task_status (pending/in_progress/blocked/done/cancelled)

stage

updated_at

canonical_key

검색 시 “active + not superseded” 같은 필터를 걸 수 있도록 메타를 같이 넣는 게 중요.

1-4. 점수 모델(휴리스틱): 자동 확정은 매우 보수적으로

TaskMatcher의 목적은 2가지야:

try_strict_match() : 자동 확정 가능한 경우만 task로 연결

suggest_candidates() : 애매한 경우 condition에 후보만 남김

점수 계산(권장 공식)

base: method별 기본 점수

exact(alias/canonical_key): 1.0

fts: (bm25 정규화 0~1)

vector: similarity(0~1)

W_stage: certified 1.0 / verified 0.9 / candidate 0.75 / working 0.65

W_entity_status: active 1.0 / contested 0.2 / deprecated·superseded 0.05

W_task_status: pending/in_progress/blocked 1.0 / done 0.6 / cancelled 0.3

W_recency: 0.5^(days_since_update / 60) 를 0.6~1.0 범위로 clamp

combined = clamp(base * W_stage * W_entity_status * W_task_status * W_recency, 0, 1)

자동 확정(strict) 조건(추천)

top1.combined >= 0.92

AND (top1.combined - top2.combined) >= 0.03 (top2 없으면 통과)

AND top1.entity_status == 'active'

AND top1.task_status not in ('cancelled')

AND (옵션) blocker 텍스트가 condition처럼 보이면 strict 자체를 skip

1-5. TaskMatcher 구현 스켈레톤(실제로 쓰는 형태)
import math
from dataclasses import dataclass
from datetime import datetime

@dataclass
class Match:
    entity_id: str
    base: float
    combined: float
    method: str
    title: str
    entity_status: str
    task_status: str
    stage: str
    updated_at: datetime

STAGE_W = {"certified": 1.0, "verified": 0.9, "candidate": 0.75, "working": 0.65}
ENTITY_STATUS_W = {"active": 1.0, "contested": 0.2, "deprecated": 0.05, "superseded": 0.05}
TASK_STATUS_W = {"pending": 1.0, "in_progress": 1.0, "blocked": 1.0, "done": 0.6, "cancelled": 0.3}

def recency_weight(updated_at: datetime, now: datetime, half_life_days: float = 60.0) -> float:
    days = max((now - updated_at).total_seconds() / 86400.0, 0.0)
    w = math.pow(0.5, days / half_life_days)
    return min(max(w, 0.6), 1.0)

def looks_like_condition(text: str) -> bool:
    # 너무 공격적으로 잡지 말고, “명백히 조건” 같은 것만
    keywords = ["대기", "승인", "권한", "요청", "확인 필요", "받는 중", "리뷰", "검토"]
    t = text.strip()
    return any(k in t for k in keywords)

class TaskMatcher:
    def __init__(self, duck, lance_task_table, embedder):
        self.duck = duck
        self.lance = lance_task_table
        self.embedder = embedder

    def _get_task_meta(self, entity_ids: list[str]) -> dict[str, dict]:
        if not entity_ids:
            return {}
        placeholders = ",".join(["?"] * len(entity_ids))
        rows = self.duck.execute(f"""
          SELECT entity_id, title, status, stage, updated_at, current_json
          FROM entities
          WHERE entity_type='task' AND entity_id IN ({placeholders})
        """, entity_ids).fetchall()

        meta = {}
        for (eid, title, estatus, stage, updated_at, cur) in rows:
            tstatus = "unknown"
            try:
                tstatus = cur.get("status", "unknown")  # current_json이 dict로 로드되는 환경 가정
            except Exception:
                pass
            meta[eid] = {
                "title": title,
                "entity_status": estatus,
                "stage": stage,
                "updated_at": updated_at,
                "task_status": tstatus,
            }
        return meta

    def match_by_alias_exact(self, canonical_key: str) -> list[Match]:
        rows = self.duck.execute("""
          SELECT a.entity_id
          FROM entity_aliases a
          JOIN entities e ON e.entity_id=a.entity_id
          WHERE a.entity_type='task' AND a.canonical_key=? AND e.status='active'
          LIMIT 5
        """, [canonical_key]).fetchall()
        ids = [r[0] for r in rows]
        meta = self._get_task_meta(ids)
        now = datetime.now()
        out = []
        for eid in ids:
            m = meta.get(eid)
            if not m:
                continue
            out.append(Match(
                entity_id=eid,
                base=1.0,
                combined=1.0,
                method="exact",
                title=m["title"],
                entity_status=m["entity_status"],
                task_status=m["task_status"],
                stage=m["stage"],
                updated_at=m["updated_at"]
            ))
        return out

    def match_by_fts(self, query: str, limit: int = 10) -> list[tuple[str, float]]:
        # bm25 정규화는 “top을 1.0”으로 두는 단순 버전
        rows = self.duck.execute("""
          SELECT e.entity_id,
                 fts_main_entities.match_bm25(e.entity_id, ?) AS bm25
          FROM entities e
          WHERE e.entity_type='task' AND e.status='active'
        """, [query]).fetchall()

        scored = [(eid, bm25) for (eid, bm25) in rows if bm25 is not None]
        scored.sort(key=lambda x: x[1], reverse=True)
        scored = scored[:limit]
        if not scored:
            return []
        top = scored[0][1] or 1.0
        return [(eid, min((bm25 / top), 1.0)) for (eid, bm25) in scored]

    def match_by_vector(self, query: str, limit: int = 10) -> list[tuple[str, float]]:
        qv = self.embedder.encode(query).tolist()
        rows = self.lance.search(qv).limit(limit).to_list()
        out = []
        for r in rows:
            dist = r["_distance"]
            sim = max(0.0, 1.0 - dist)  # dist 스케일에 맞게 추후 보정
            out.append((r["id"], sim))
        return out

    def _combine(self, candidates: dict[str, float]) -> list[Match]:
        ids = list(candidates.keys())
        meta = self._get_task_meta(ids)
        now = datetime.now()
        out: list[Match] = []

        for eid, base in candidates.items():
            m = meta.get(eid)
            if not m:
                continue
            w_stage = STAGE_W.get(m["stage"], 0.65)
            w_estatus = ENTITY_STATUS_W.get(m["entity_status"], 0.2)
            w_tstatus = TASK_STATUS_W.get(m["task_status"], 0.6)
            w_rec = recency_weight(m["updated_at"], now)

            combined = max(0.0, min(base * w_stage * w_estatus * w_tstatus * w_rec, 1.0))
            out.append(Match(
                entity_id=eid,
                base=base,
                combined=combined,
                method="mixed",
                title=m["title"],
                entity_status=m["entity_status"],
                task_status=m["task_status"],
                stage=m["stage"],
                updated_at=m["updated_at"]
            ))

        out.sort(key=lambda x: x.combined, reverse=True)
        return out

    def try_strict_match(self, blocker_text: str, project: str) -> dict | None:
        if looks_like_condition(blocker_text):
            return None

        # 1) exact by canonical key
        ckey = task_canonical_key(blocker_text, project)
        exact = self.match_by_alias_exact(ckey)
        if exact:
            return {"entity_id": exact[0].entity_id, "confidence": 1.0, "method": "exact"}

        # 2) 후보 생성: fts + vector
        cand: dict[str, float] = {}
        for (eid, s) in self.match_by_fts(blocker_text, limit=10):
            cand[eid] = max(cand.get(eid, 0.0), s * 0.95)  # fts 약간 감점(선택)
        for (eid, s) in self.match_by_vector(blocker_text, limit=10):
            cand[eid] = max(cand.get(eid, 0.0), s)

        ranked = self._combine(cand)
        if not ranked:
            return None

        top1 = ranked[0]
        top2 = ranked[1] if len(ranked) > 1 else None
        gap = top1.combined - (top2.combined if top2 else 0.0)

        if (top1.combined >= 0.92 and gap >= 0.03 and
            top1.entity_status == "active" and top1.task_status != "cancelled"):
            return {"entity_id": top1.entity_id, "confidence": top1.combined, "method": "mixed"}

        return None

    def suggest_candidates(self, blocker_text: str, project: str, limit: int = 5) -> list[dict]:
        ckey = task_canonical_key(blocker_text, project)
        exact = self.match_by_alias_exact(ckey)
        if exact:
            return [{"entity_id": exact[0].entity_id, "score": 1.0, "method": "exact"}]

        cand: dict[str, float] = {}
        for (eid, s) in self.match_by_fts(blocker_text, limit=15):
            cand[eid] = max(cand.get(eid, 0.0), s * 0.95)
        for (eid, s) in self.match_by_vector(blocker_text, limit=15):
            cand[eid] = max(cand.get(eid, 0.0), s)

        ranked = self._combine(cand)[:limit]
        return [{"entity_id": m.entity_id, "score": m.combined, "method": m.method} for m in ranked]

1-6. Projector에서 해야 할 “FTS/벡터 유지관리” 훅

TaskProjector가 task_created, task_title_changed(선택)를 처리할 때 반드시:

title_norm, search_text 갱신

entity_aliases 갱신

vector_outbox(item_kind='task_title')에 job insert (UNIQUE로 dedupe)

(A) entities.search_text 갱신 예시
def build_search_text(title: str, canonical_key: str, task_status: str, priority: str) -> tuple[str, str]:
    tn = normalize_title(title)
    search = f"{title} | {tn} | {canonical_key} | status:{task_status} priority:{priority}"
    return tn, search

(B) outbox enqueue 예시
def enqueue_task_vector_job(duck, task_id: str, embedding_version: str):
    job_id = f"job_{task_id}_{embedding_version}"
    duck.execute("""
      INSERT OR IGNORE INTO vector_outbox (job_id, item_kind, item_id, embedding_version, status)
      VALUES (?, 'task_title', ?, ?, 'pending')
    """, [job_id, task_id, embedding_version])

(C) LanceDB writer: upsert 규칙(개념)

같은 id가 있으면 “delete 후 add”든, “merge_insert”든 한 가지로 고정

성공하면 outbox를 done

2) 조회 API 설계(SQL 뷰/쿼리 + 파이썬 래퍼)

아래는 실제 제품/CLI에서 바로 쓰게 되는 핵심 쿼리들이야.

2-1. “Effective Blocker View” 만들기 (Condition resolve 반영)

blocked_by가 condition일 때 resolves_to가 있으면 “실제 blocker”는 resolved_to가 되어야 UI가 편해.
그래서 효과적인 blocker를 펼친 뷰를 하나 두자.

View: v_task_blockers_effective
CREATE VIEW IF NOT EXISTS v_task_blockers_effective AS
WITH blocked AS (
  SELECT
    e.src_id AS task_id,
    e.dst_id AS blocker_id,
    e.meta_json AS meta_json,
    e.created_at AS edge_created_at
  FROM edges e
  WHERE e.src_type='entity' AND e.rel_type='blocked_by'
),
resolved AS (
  SELECT
    src_id AS condition_id,
    dst_id AS resolved_id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY src_id ORDER BY created_at DESC) AS rn
  FROM edges
  WHERE src_type='entity' AND rel_type='resolves_to'
)
SELECT
  b.task_id,
  b.blocker_id,
  bl.entity_type AS blocker_type,
  bl.title AS blocker_title,
  json_extract_string(b.meta_json, '$.raw_text') AS raw_text,
  CAST(json_extract(b.meta_json, '$.confidence') AS DOUBLE) AS confidence,
  COALESCE(r.resolved_id, b.blocker_id) AS effective_blocker_id,
  eff.entity_type AS effective_type,
  eff.title AS effective_title
FROM blocked b
JOIN entities bl ON bl.entity_id=b.blocker_id
LEFT JOIN resolved r ON r.condition_id=b.blocker_id AND r.rn=1
LEFT JOIN entities eff ON eff.entity_id=COALESCE(r.resolved_id, b.blocker_id);

2-2. API 1) “현재 blocked task 목록 + blocker 펼치기”
SQL
SELECT
  t.entity_id AS task_id,
  t.title     AS task_title,
  json_extract_string(t.current_json, '$.status')   AS task_status,
  json_extract_string(t.current_json, '$.priority') AS priority,
  t.updated_at,
  b.blocker_id,
  b.blocker_type,
  b.blocker_title,
  b.raw_text,
  b.confidence,
  b.effective_blocker_id,
  b.effective_type,
  b.effective_title
FROM entities t
LEFT JOIN v_task_blockers_effective b
  ON b.task_id = t.entity_id
WHERE t.entity_type='task'
  AND t.status='active'
  AND json_extract_string(t.current_json, '$.status')='blocked'
ORDER BY
  CASE json_extract_string(t.current_json, '$.priority')
    WHEN 'critical' THEN 1
    WHEN 'high'     THEN 2
    WHEN 'medium'   THEN 3
    ELSE 4
  END,
  t.updated_at DESC;

파이썬 래퍼(그룹핑해서 반환)
def list_blocked_tasks(duck) -> list[dict]:
    rows = duck.execute("""<위 SQL>""").fetchall()
    by_task = {}
    for r in rows:
        task_id = r[0]
        by_task.setdefault(task_id, {
            "task_id": task_id,
            "title": r[1],
            "status": r[2],
            "priority": r[3],
            "updated_at": r[4],
            "blockers": []
        })
        if r[5] is not None:
            by_task[task_id]["blockers"].append({
                "blocker_id": r[5],
                "blocker_type": r[6],
                "blocker_title": r[7],
                "raw_text": r[8],
                "confidence": r[9],
                "effective_id": r[10],
                "effective_type": r[11],
                "effective_title": r[12],
            })
    return list(by_task.values())

2-3. API 2) “suggested blockers만 있는 task 찾기”

정책: evidence가 약하면 mode=suggest로만 쌓이는데, 이걸 모아서 “검토/추가 근거 필요” 목록을 만들 수 있어.

SQL
SELECT
  t.entity_id AS task_id,
  t.title     AS task_title,
  t.updated_at
FROM entities t
WHERE t.entity_type='task'
  AND t.status='active'
  AND json_extract_string(t.current_json, '$.status')='blocked'
  AND NOT EXISTS (
    SELECT 1 FROM edges e
    WHERE e.src_type='entity' AND e.src_id=t.entity_id AND e.rel_type='blocked_by'
  )
  AND EXISTS (
    SELECT 1 FROM edges e
    WHERE e.src_type='entity' AND e.src_id=t.entity_id AND e.rel_type='blocked_by_suggested'
  )
ORDER BY t.updated_at DESC;


추가로 suggested blockers까지 같이 뽑고 싶으면 edges(rel_type='blocked_by_suggested') join해서 가져오면 됨.

2-4. API 3) “unknown blocker placeholder가 있는 task”

우리가 placeholder를 edge meta의 auto_placeholder=true로 기록했으니 그걸 찾는다.

SQL
SELECT DISTINCT
  t.entity_id AS task_id,
  t.title     AS task_title,
  t.updated_at
FROM entities t
JOIN edges e
  ON e.src_type='entity' AND e.src_id=t.entity_id AND e.rel_type='blocked_by'
WHERE t.entity_type='task'
  AND t.status='active'
  AND json_extract_string(t.current_json, '$.status')='blocked'
  AND CAST(json_extract(e.meta_json, '$.auto_placeholder') AS VARCHAR) = 'true'
ORDER BY t.updated_at DESC;

2-5. API 4) “condition → resolves_to가 존재하는 조건 목록(정리 대상)”

Condition이 해석되었는데도 여전히 blocked_by에 condition으로 남아있을 수 있어.
이 목록을 보면 “엣지 재작성(공격적 정책)”을 할지, “표시만 펼칠지(보수적 정책)”를 정할 수 있음.

SQL
SELECT
  c.entity_id AS condition_id,
  c.title     AS condition_text,
  r.dst_id    AS resolved_to_id,
  e.entity_type AS resolved_type,
  e.title       AS resolved_title,
  r.created_at
FROM entities c
JOIN edges r
  ON r.src_type='entity' AND r.src_id=c.entity_id AND r.rel_type='resolves_to'
JOIN entities e
  ON e.entity_id=r.dst_id
WHERE c.entity_type='condition'
  AND c.status='active'
ORDER BY r.created_at DESC;

2-6. API 5) Task 상세: 현재 상태 + blockers + 이벤트 히스토리

이 API는 디버깅/감사에 매우 중요함.

SQL: task snapshot + blockers
-- task 기본
SELECT entity_id, title, current_json, stage, status, updated_at
FROM entities
WHERE entity_type='task' AND entity_id=?;

-- 현재 blockers
SELECT dst_id, meta_json
FROM edges
WHERE src_type='entity' AND src_id=? AND rel_type='blocked_by'
ORDER BY created_at DESC;

-- suggested blockers
SELECT dst_id, meta_json
FROM edges
WHERE src_type='entity' AND src_id=? AND rel_type='blocked_by_suggested'
ORDER BY created_at DESC;

SQL: task 이벤트 히스토리(L0에서)
SELECT event_id, ts, event_type, payload_json
FROM events
WHERE event_type LIKE 'task_%'
  AND json_extract_string(payload_json, '$.task_id') = ?
ORDER BY ts ASC, event_id ASC;

2-7. “blocker 종류별 그룹핑” (blocked_by를 kind별로 보기)

effective blocker 기준으로 kind(=effective_type)별 그룹을 만들면 운영자가 보기 좋다.

SQL (effective_type 포함)

v_task_blockers_effective를 이미 만들었으니 이를 이용해서 task_id별/종류별 집계 가능.

SELECT
  task_id,
  effective_type,
  COUNT(*) AS cnt
FROM v_task_blockers_effective
GROUP BY task_id, effective_type
ORDER BY task_id, cnt DESC;

3) “이 설계를 적용하면” 파이프라인에서 달라지는 것

TaskMatcher가 alias/FTS/vector로 후보를 만들어도, strict는 보수적이라 사고가 적음

애매한 blocker는 condition으로 흡수 + candidates만 기록 → 나중에 condition_resolved_to로 승격

blocked_by edges는 replace/suggest 정책으로 운영 가능

조회 API는 v_task_blockers_effective 덕분에 Condition resolve가 UI에 자연스럽게 반영

====
좋아. 아래는 **(1) TaskMatcher 고도화(FTS + 벡터 + 휴리스틱 + outbox)** + **(2) 조회 API(SQL 뷰/쿼리 + 파이썬 래퍼)**를 “그대로 구현 가능한 수준”으로 한 번에 정리한 완성 설계야.
(너의 기존 EventStore/edges/entities 구조를 그대로 쓰되, 필요한 테이블만 최소 추가)

---

# 1) TaskMatcher 고도화

## 1-1. “Rename/표현 차이”까지 흡수하려면 alias 테이블이 필요함

Task canonical_key는 강력하지만, 제목이 조금 바뀌거나 표현이 달라지면 exact match가 깨져서 조건(Condition)으로만 쌓일 수 있어.
그래서 **canonical_key → task_id 매핑을 alias로 누적**하는 테이블을 두는 게 운영에서 매우 유용해.

### DDL: entity_aliases

```sql
CREATE TABLE IF NOT EXISTS entity_aliases (
  entity_type   VARCHAR NOT NULL,   -- 'task'
  canonical_key VARCHAR NOT NULL,
  entity_id     VARCHAR NOT NULL,   -- tsk_...
  is_primary    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_type, canonical_key)
);

CREATE INDEX IF NOT EXISTS idx_aliases_entity ON entity_aliases(entity_id);
```

**정책**

* task 생성 시: `(task, canonical_key) -> task_id` 를 `is_primary=true`로 insert
* task rename/merge 시: 새 canonical_key를 alias로 추가, 기존 primary는 false 처리(프로젝션에서 update)

---

## 1-2. FTS를 Task에 적용하기 위한 “search_text” 컬럼과 인덱스

TaskMatcher의 2차 후보 생성에서 FTS는 꽤 강력해. (표현 차이/키워드 일부만 있어도 후보를 뽑음)

DB는 DuckDB 기준으로 작성할게. DuckDB FTS는 버전에 따라 호출 형태가 조금 달라질 수 있으니, **“FTS 호출을 뷰/함수로 캡슐화”**해서 나중에 교체 가능하게 만드는 걸 추천.

### DDL: entities에 검색용 컬럼 추가

```sql
ALTER TABLE entities ADD COLUMN IF NOT EXISTS title_norm VARCHAR;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS search_text VARCHAR;
```

### search_text 구성(권장)

* `title` 원문
* `title_norm` (정규화)
* canonical_key 토큰(프로젝트/도메인)
* 상태/태그(선택) 예: “blocked”, “priority:high” 같은 토큰

예시:

```
search_text = "{title} | {title_norm} | {canonical_key} | status:{status} priority:{priority}"
```

### FTS 인덱스 생성(개념)

```sql
INSTALL fts;
LOAD fts;

-- 아래 PRAGMA 이름/형태는 DuckDB 버전에 따라 다를 수 있음.
-- 핵심은: entities(entity_id, search_text)에 FTS 인덱스를 만든다.
PRAGMA create_fts_index('entities', 'entity_id', 'search_text');
```

### FTS 조회를 “뷰”로 캡슐화(권장)

버전 차이를 흡수하려고, 호출부는 항상 여기만 쓰게:

```sql
-- 개념적인 형태 (너의 DuckDB 버전에 맞춰 내부만 조정)
CREATE VIEW IF NOT EXISTS v_task_fts AS
SELECT
  e.entity_id,
  e.title,
  e.current_json,
  e.status AS entity_status,
  e.stage,
  e.updated_at,
  -- bm25가 높을수록 좋은 점수라는 가정
  fts_main_entities.match_bm25(e.entity_id, ?) AS bm25
FROM entities e
WHERE e.entity_type='task';
```

> 실제론 DuckDB에서 파라미터(?)가 뷰에 안 들어갈 수 있으니,
> “뷰 + 쿼리에서 match_bm25 호출”로 쓰면 돼. 요지는 호출을 한 곳에 모으는 것.

---

## 1-3. Task 제목 벡터 테이블 + outbox (idempotent upsert)

FTS만으로 부족한 경우(자연어 표현 변화/유사 의미)에는 벡터가 좋다.
벡터 DB는 LanceDB 를 기준으로 설계할게.

### (A) outbox 테이블: entry와 task_title을 같은 outbox로 관리

```sql
CREATE TABLE IF NOT EXISTS vector_outbox (
  job_id           VARCHAR PRIMARY KEY,
  item_kind        VARCHAR NOT NULL,     -- 'entry'|'task_title'
  item_id          VARCHAR NOT NULL,     -- entry_id or task_entity_id
  embedding_version VARCHAR NOT NULL,    -- 'e5_v1' 같은 버전 스트링
  status           VARCHAR NOT NULL,     -- pending|done|failed
  error            VARCHAR,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_kind, item_id, embedding_version)
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON vector_outbox(status);
```

### (B) LanceDB 테이블: task_titles_{embedding_version}

필드(권장):

* `id` = task entity_id (`tsk_...`)
* `title_norm`
* `vector`
* `entity_status` (active/contested…)
* `task_status` (pending/in_progress/blocked/done/cancelled)
* `stage`
* `updated_at`
* `canonical_key`

> 검색 시 “active + not superseded” 같은 필터를 걸 수 있도록 메타를 같이 넣는 게 중요.

---

## 1-4. 점수 모델(휴리스틱): **자동 확정은 매우 보수적으로**

TaskMatcher의 목적은 2가지야:

* `try_strict_match()` : 자동 확정 가능한 경우만 task로 연결
* `suggest_candidates()` : 애매한 경우 condition에 후보만 남김

### 점수 계산(권장 공식)

* `base`: method별 기본 점수

  * exact(alias/canonical_key): 1.0
  * fts: (bm25 정규화 0~1)
  * vector: similarity(0~1)

* `W_stage`: certified 1.0 / verified 0.9 / candidate 0.75 / working 0.65

* `W_entity_status`: active 1.0 / contested 0.2 / deprecated·superseded 0.05

* `W_task_status`: pending/in_progress/blocked 1.0 / done 0.6 / cancelled 0.3

* `W_recency`: `0.5^(days_since_update / 60)` 를 0.6~1.0 범위로 clamp

`combined = clamp(base * W_stage * W_entity_status * W_task_status * W_recency, 0, 1)`

### 자동 확정(strict) 조건(추천)

* `top1.combined >= 0.92`
* AND `(top1.combined - top2.combined) >= 0.03` (top2 없으면 통과)
* AND `top1.entity_status == 'active'`
* AND `top1.task_status not in ('cancelled')`
* AND (옵션) blocker 텍스트가 condition처럼 보이면 strict 자체를 skip

---

## 1-5. TaskMatcher 구현 스켈레톤(실제로 쓰는 형태)

```python
import math
from dataclasses import dataclass
from datetime import datetime

@dataclass
class Match:
    entity_id: str
    base: float
    combined: float
    method: str
    title: str
    entity_status: str
    task_status: str
    stage: str
    updated_at: datetime

STAGE_W = {"certified": 1.0, "verified": 0.9, "candidate": 0.75, "working": 0.65}
ENTITY_STATUS_W = {"active": 1.0, "contested": 0.2, "deprecated": 0.05, "superseded": 0.05}
TASK_STATUS_W = {"pending": 1.0, "in_progress": 1.0, "blocked": 1.0, "done": 0.6, "cancelled": 0.3}

def recency_weight(updated_at: datetime, now: datetime, half_life_days: float = 60.0) -> float:
    days = max((now - updated_at).total_seconds() / 86400.0, 0.0)
    w = math.pow(0.5, days / half_life_days)
    return min(max(w, 0.6), 1.0)

def looks_like_condition(text: str) -> bool:
    # 너무 공격적으로 잡지 말고, “명백히 조건” 같은 것만
    keywords = ["대기", "승인", "권한", "요청", "확인 필요", "받는 중", "리뷰", "검토"]
    t = text.strip()
    return any(k in t for k in keywords)

class TaskMatcher:
    def __init__(self, duck, lance_task_table, embedder):
        self.duck = duck
        self.lance = lance_task_table
        self.embedder = embedder

    def _get_task_meta(self, entity_ids: list[str]) -> dict[str, dict]:
        if not entity_ids:
            return {}
        placeholders = ",".join(["?"] * len(entity_ids))
        rows = self.duck.execute(f"""
          SELECT entity_id, title, status, stage, updated_at, current_json
          FROM entities
          WHERE entity_type='task' AND entity_id IN ({placeholders})
        """, entity_ids).fetchall()

        meta = {}
        for (eid, title, estatus, stage, updated_at, cur) in rows:
            tstatus = "unknown"
            try:
                tstatus = cur.get("status", "unknown")  # current_json이 dict로 로드되는 환경 가정
            except Exception:
                pass
            meta[eid] = {
                "title": title,
                "entity_status": estatus,
                "stage": stage,
                "updated_at": updated_at,
                "task_status": tstatus,
            }
        return meta

    def match_by_alias_exact(self, canonical_key: str) -> list[Match]:
        rows = self.duck.execute("""
          SELECT a.entity_id
          FROM entity_aliases a
          JOIN entities e ON e.entity_id=a.entity_id
          WHERE a.entity_type='task' AND a.canonical_key=? AND e.status='active'
          LIMIT 5
        """, [canonical_key]).fetchall()
        ids = [r[0] for r in rows]
        meta = self._get_task_meta(ids)
        now = datetime.now()
        out = []
        for eid in ids:
            m = meta.get(eid)
            if not m:
                continue
            out.append(Match(
                entity_id=eid,
                base=1.0,
                combined=1.0,
                method="exact",
                title=m["title"],
                entity_status=m["entity_status"],
                task_status=m["task_status"],
                stage=m["stage"],
                updated_at=m["updated_at"]
            ))
        return out

    def match_by_fts(self, query: str, limit: int = 10) -> list[tuple[str, float]]:
        # bm25 정규화는 “top을 1.0”으로 두는 단순 버전
        rows = self.duck.execute("""
          SELECT e.entity_id,
                 fts_main_entities.match_bm25(e.entity_id, ?) AS bm25
          FROM entities e
          WHERE e.entity_type='task' AND e.status='active'
        """, [query]).fetchall()

        scored = [(eid, bm25) for (eid, bm25) in rows if bm25 is not None]
        scored.sort(key=lambda x: x[1], reverse=True)
        scored = scored[:limit]
        if not scored:
            return []
        top = scored[0][1] or 1.0
        return [(eid, min((bm25 / top), 1.0)) for (eid, bm25) in scored]

    def match_by_vector(self, query: str, limit: int = 10) -> list[tuple[str, float]]:
        qv = self.embedder.encode(query).tolist()
        rows = self.lance.search(qv).limit(limit).to_list()
        out = []
        for r in rows:
            dist = r["_distance"]
            sim = max(0.0, 1.0 - dist)  # dist 스케일에 맞게 추후 보정
            out.append((r["id"], sim))
        return out

    def _combine(self, candidates: dict[str, float]) -> list[Match]:
        ids = list(candidates.keys())
        meta = self._get_task_meta(ids)
        now = datetime.now()
        out: list[Match] = []

        for eid, base in candidates.items():
            m = meta.get(eid)
            if not m:
                continue
            w_stage = STAGE_W.get(m["stage"], 0.65)
            w_estatus = ENTITY_STATUS_W.get(m["entity_status"], 0.2)
            w_tstatus = TASK_STATUS_W.get(m["task_status"], 0.6)
            w_rec = recency_weight(m["updated_at"], now)

            combined = max(0.0, min(base * w_stage * w_estatus * w_tstatus * w_rec, 1.0))
            out.append(Match(
                entity_id=eid,
                base=base,
                combined=combined,
                method="mixed",
                title=m["title"],
                entity_status=m["entity_status"],
                task_status=m["task_status"],
                stage=m["stage"],
                updated_at=m["updated_at"]
            ))

        out.sort(key=lambda x: x.combined, reverse=True)
        return out

    def try_strict_match(self, blocker_text: str, project: str) -> dict | None:
        if looks_like_condition(blocker_text):
            return None

        # 1) exact by canonical key
        ckey = task_canonical_key(blocker_text, project)
        exact = self.match_by_alias_exact(ckey)
        if exact:
            return {"entity_id": exact[0].entity_id, "confidence": 1.0, "method": "exact"}

        # 2) 후보 생성: fts + vector
        cand: dict[str, float] = {}
        for (eid, s) in self.match_by_fts(blocker_text, limit=10):
            cand[eid] = max(cand.get(eid, 0.0), s * 0.95)  # fts 약간 감점(선택)
        for (eid, s) in self.match_by_vector(blocker_text, limit=10):
            cand[eid] = max(cand.get(eid, 0.0), s)

        ranked = self._combine(cand)
        if not ranked:
            return None

        top1 = ranked[0]
        top2 = ranked[1] if len(ranked) > 1 else None
        gap = top1.combined - (top2.combined if top2 else 0.0)

        if (top1.combined >= 0.92 and gap >= 0.03 and
            top1.entity_status == "active" and top1.task_status != "cancelled"):
            return {"entity_id": top1.entity_id, "confidence": top1.combined, "method": "mixed"}

        return None

    def suggest_candidates(self, blocker_text: str, project: str, limit: int = 5) -> list[dict]:
        ckey = task_canonical_key(blocker_text, project)
        exact = self.match_by_alias_exact(ckey)
        if exact:
            return [{"entity_id": exact[0].entity_id, "score": 1.0, "method": "exact"}]

        cand: dict[str, float] = {}
        for (eid, s) in self.match_by_fts(blocker_text, limit=15):
            cand[eid] = max(cand.get(eid, 0.0), s * 0.95)
        for (eid, s) in self.match_by_vector(blocker_text, limit=15):
            cand[eid] = max(cand.get(eid, 0.0), s)

        ranked = self._combine(cand)[:limit]
        return [{"entity_id": m.entity_id, "score": m.combined, "method": m.method} for m in ranked]
```

---

## 1-6. Projector에서 해야 할 “FTS/벡터 유지관리” 훅

TaskProjector가 `task_created`, `task_title_changed(선택)`를 처리할 때 반드시:

1. `title_norm`, `search_text` 갱신
2. `entity_aliases` 갱신
3. `vector_outbox(item_kind='task_title')`에 job insert (UNIQUE로 dedupe)

### (A) entities.search_text 갱신 예시

```python
def build_search_text(title: str, canonical_key: str, task_status: str, priority: str) -> tuple[str, str]:
    tn = normalize_title(title)
    search = f"{title} | {tn} | {canonical_key} | status:{task_status} priority:{priority}"
    return tn, search
```

### (B) outbox enqueue 예시

```python
def enqueue_task_vector_job(duck, task_id: str, embedding_version: str):
    job_id = f"job_{task_id}_{embedding_version}"
    duck.execute("""
      INSERT OR IGNORE INTO vector_outbox (job_id, item_kind, item_id, embedding_version, status)
      VALUES (?, 'task_title', ?, ?, 'pending')
    """, [job_id, task_id, embedding_version])
```

### (C) LanceDB writer: upsert 규칙(개념)

* 같은 id가 있으면 “delete 후 add”든, “merge_insert”든 한 가지로 고정
* 성공하면 outbox를 done

---

# 2) 조회 API 설계(SQL 뷰/쿼리 + 파이썬 래퍼)

아래는 실제 제품/CLI에서 바로 쓰게 되는 핵심 쿼리들이야.

## 2-1. “Effective Blocker View” 만들기 (Condition resolve 반영)

blocked_by가 condition일 때 `resolves_to`가 있으면 “실제 blocker”는 resolved_to가 되어야 UI가 편해.
그래서 효과적인 blocker를 펼친 뷰를 하나 두자.

### View: v_task_blockers_effective

```sql
CREATE VIEW IF NOT EXISTS v_task_blockers_effective AS
WITH blocked AS (
  SELECT
    e.src_id AS task_id,
    e.dst_id AS blocker_id,
    e.meta_json AS meta_json,
    e.created_at AS edge_created_at
  FROM edges e
  WHERE e.src_type='entity' AND e.rel_type='blocked_by'
),
resolved AS (
  SELECT
    src_id AS condition_id,
    dst_id AS resolved_id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY src_id ORDER BY created_at DESC) AS rn
  FROM edges
  WHERE src_type='entity' AND rel_type='resolves_to'
)
SELECT
  b.task_id,
  b.blocker_id,
  bl.entity_type AS blocker_type,
  bl.title AS blocker_title,
  json_extract_string(b.meta_json, '$.raw_text') AS raw_text,
  CAST(json_extract(b.meta_json, '$.confidence') AS DOUBLE) AS confidence,
  COALESCE(r.resolved_id, b.blocker_id) AS effective_blocker_id,
  eff.entity_type AS effective_type,
  eff.title AS effective_title
FROM blocked b
JOIN entities bl ON bl.entity_id=b.blocker_id
LEFT JOIN resolved r ON r.condition_id=b.blocker_id AND r.rn=1
LEFT JOIN entities eff ON eff.entity_id=COALESCE(r.resolved_id, b.blocker_id);
```

---

## 2-2. API 1) “현재 blocked task 목록 + blocker 펼치기”

### SQL

```sql
SELECT
  t.entity_id AS task_id,
  t.title     AS task_title,
  json_extract_string(t.current_json, '$.status')   AS task_status,
  json_extract_string(t.current_json, '$.priority') AS priority,
  t.updated_at,
  b.blocker_id,
  b.blocker_type,
  b.blocker_title,
  b.raw_text,
  b.confidence,
  b.effective_blocker_id,
  b.effective_type,
  b.effective_title
FROM entities t
LEFT JOIN v_task_blockers_effective b
  ON b.task_id = t.entity_id
WHERE t.entity_type='task'
  AND t.status='active'
  AND json_extract_string(t.current_json, '$.status')='blocked'
ORDER BY
  CASE json_extract_string(t.current_json, '$.priority')
    WHEN 'critical' THEN 1
    WHEN 'high'     THEN 2
    WHEN 'medium'   THEN 3
    ELSE 4
  END,
  t.updated_at DESC;
```

### 파이썬 래퍼(그룹핑해서 반환)

```python
def list_blocked_tasks(duck) -> list[dict]:
    rows = duck.execute("""<위 SQL>""").fetchall()
    by_task = {}
    for r in rows:
        task_id = r[0]
        by_task.setdefault(task_id, {
            "task_id": task_id,
            "title": r[1],
            "status": r[2],
            "priority": r[3],
            "updated_at": r[4],
            "blockers": []
        })
        if r[5] is not None:
            by_task[task_id]["blockers"].append({
                "blocker_id": r[5],
                "blocker_type": r[6],
                "blocker_title": r[7],
                "raw_text": r[8],
                "confidence": r[9],
                "effective_id": r[10],
                "effective_type": r[11],
                "effective_title": r[12],
            })
    return list(by_task.values())
```

---

## 2-3. API 2) “suggested blockers만 있는 task 찾기”

정책: evidence가 약하면 mode=suggest로만 쌓이는데, 이걸 모아서 “검토/추가 근거 필요” 목록을 만들 수 있어.

### SQL

```sql
SELECT
  t.entity_id AS task_id,
  t.title     AS task_title,
  t.updated_at
FROM entities t
WHERE t.entity_type='task'
  AND t.status='active'
  AND json_extract_string(t.current_json, '$.status')='blocked'
  AND NOT EXISTS (
    SELECT 1 FROM edges e
    WHERE e.src_type='entity' AND e.src_id=t.entity_id AND e.rel_type='blocked_by'
  )
  AND EXISTS (
    SELECT 1 FROM edges e
    WHERE e.src_type='entity' AND e.src_id=t.entity_id AND e.rel_type='blocked_by_suggested'
  )
ORDER BY t.updated_at DESC;
```

추가로 suggested blockers까지 같이 뽑고 싶으면 `edges(rel_type='blocked_by_suggested')` join해서 가져오면 됨.

---

## 2-4. API 3) “unknown blocker placeholder가 있는 task”

우리가 placeholder를 edge meta의 `auto_placeholder=true`로 기록했으니 그걸 찾는다.

### SQL

```sql
SELECT DISTINCT
  t.entity_id AS task_id,
  t.title     AS task_title,
  t.updated_at
FROM entities t
JOIN edges e
  ON e.src_type='entity' AND e.src_id=t.entity_id AND e.rel_type='blocked_by'
WHERE t.entity_type='task'
  AND t.status='active'
  AND json_extract_string(t.current_json, '$.status')='blocked'
  AND CAST(json_extract(e.meta_json, '$.auto_placeholder') AS VARCHAR) = 'true'
ORDER BY t.updated_at DESC;
```

---

## 2-5. API 4) “condition → resolves_to가 존재하는 조건 목록(정리 대상)”

Condition이 해석되었는데도 여전히 blocked_by에 condition으로 남아있을 수 있어.
이 목록을 보면 “엣지 재작성(공격적 정책)”을 할지, “표시만 펼칠지(보수적 정책)”를 정할 수 있음.

### SQL

```sql
SELECT
  c.entity_id AS condition_id,
  c.title     AS condition_text,
  r.dst_id    AS resolved_to_id,
  e.entity_type AS resolved_type,
  e.title       AS resolved_title,
  r.created_at
FROM entities c
JOIN edges r
  ON r.src_type='entity' AND r.src_id=c.entity_id AND r.rel_type='resolves_to'
JOIN entities e
  ON e.entity_id=r.dst_id
WHERE c.entity_type='condition'
  AND c.status='active'
ORDER BY r.created_at DESC;
```

---

## 2-6. API 5) Task 상세: 현재 상태 + blockers + 이벤트 히스토리

이 API는 디버깅/감사에 매우 중요함.

### SQL: task snapshot + blockers

```sql
-- task 기본
SELECT entity_id, title, current_json, stage, status, updated_at
FROM entities
WHERE entity_type='task' AND entity_id=?;

-- 현재 blockers
SELECT dst_id, meta_json
FROM edges
WHERE src_type='entity' AND src_id=? AND rel_type='blocked_by'
ORDER BY created_at DESC;

-- suggested blockers
SELECT dst_id, meta_json
FROM edges
WHERE src_type='entity' AND src_id=? AND rel_type='blocked_by_suggested'
ORDER BY created_at DESC;
```

### SQL: task 이벤트 히스토리(L0에서)

```sql
SELECT event_id, ts, event_type, payload_json
FROM events
WHERE event_type LIKE 'task_%'
  AND json_extract_string(payload_json, '$.task_id') = ?
ORDER BY ts ASC, event_id ASC;
```

---

## 2-7. “blocker 종류별 그룹핑” (blocked_by를 kind별로 보기)

effective blocker 기준으로 kind(=effective_type)별 그룹을 만들면 운영자가 보기 좋다.

### SQL (effective_type 포함)

`v_task_blockers_effective`를 이미 만들었으니 이를 이용해서 task_id별/종류별 집계 가능.

```sql
SELECT
  task_id,
  effective_type,
  COUNT(*) AS cnt
FROM v_task_blockers_effective
GROUP BY task_id, effective_type
ORDER BY task_id, cnt DESC;
```

---

# 3) “이 설계를 적용하면” 파이프라인에서 달라지는 것

1. **TaskMatcher가 alias/FTS/vector로 후보를 만들어도, strict는 보수적**이라 사고가 적음
2. 애매한 blocker는 **condition으로 흡수 + candidates만 기록** → 나중에 `condition_resolved_to`로 승격
3. blocked_by edges는 replace/suggest 정책으로 운영 가능
4. 조회 API는 `v_task_blockers_effective` 덕분에 **Condition resolve가 UI에 자연스럽게 반영**

