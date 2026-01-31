/**
 * Idris Generator
 *
 * JSON 세션 데이터를 Idris 소스 코드로 변환
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Session, AnyEntry, TaskStatus, Priority } from "./types.js";

export class IdrisGenerator {
  private outputDir: string;

  constructor(dataDir: string) {
    this.outputDir = path.join(dataDir, "src", "LongTermMemory");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });

    // MemorySchema.idr이 없으면 생성
    const schemaPath = path.join(this.outputDir, "MemorySchema.idr");
    try {
      await fs.access(schemaPath);
    } catch {
      await this.createMemorySchema(schemaPath);
    }
  }

  async generateSession(data: Session): Promise<string> {
    const dateFormatted = data.date.replace(/-/g, "_");
    const moduleName = `Session_${dateFormatted}_${String(data.sessionId).padStart(2, "0")}`;

    const idrisCode = this.buildSessionCode(data, moduleName);

    const outputPath = path.join(this.outputDir, `${moduleName}.idr`);
    await fs.writeFile(outputPath, idrisCode, "utf-8");

    return outputPath;
  }

  private buildSessionCode(data: Session, moduleName: string): string {
    const entriesCode = this.generateEntries(data.entries);

    return `-- Auto-generated from chat session
-- Date: ${data.date}, Session: ${data.sessionId}
-- Time: ${data.timeRange}

module LongTermMemory.${moduleName}

import LongTermMemory.MemorySchema

%default total

public export
session : Session
session = MkSession
  "${data.date}"
  ${data.sessionId}
  "${this.escape(data.timeRange)}"
  "${this.escape(data.title)}"
  [${entriesCode}
  ]
`;
  }

  private generateEntries(entries: AnyEntry[]): string {
    const lines: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const prefix = i === 0 ? "\n    " : "\n  , ";
      lines.push(prefix + this.entryToIdris(entries[i]));
    }

    return lines.join("");
  }

  private entryToIdris(entry: AnyEntry): string {
    switch (entry.type) {
      case "fact":
        return `AFact $ MkFact
      "${this.escape(entry.title)}"
      ${this.maybeStr(entry.evidence)}`;

      case "decision":
        const basedOnStr = "[" + entry.basedOn.map((b) => `"${this.escape(b)}"`).join(", ") + "]";
        return `ADecision $ MkDecision
      "${this.escape(entry.title)}"
      ${this.maybeStr(entry.rationale)}
      ${basedOnStr}`;

      case "insight":
        return `AInsight $ MkInsight
      "${this.escape(entry.observation)}"
      "${this.escape(entry.implication)}"`;

      case "task":
        const statusIdris = this.statusToIdris(entry.status);
        const priorityIdris = this.priorityToIdris(entry.priority);
        const blockedByStr =
          "[" + entry.blockedBy.map((b) => `"${this.escape(b)}"`).join(", ") + "]";
        return `ATask $ MkTask
      "${this.escape(entry.title)}"
      ${statusIdris}
      ${priorityIdris}
      ${blockedByStr}`;

      case "reference":
        return `AReference $ MkReference
      "${this.escape(entry.path)}"
      ${this.maybeStr(entry.description)}`;

      default:
        return "-- Unknown entry type";
    }
  }

  private escape(s: string | undefined): string {
    if (s === undefined || s === null) {
      return "";
    }
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }

  private maybeStr(s: string | undefined): string {
    if (s === undefined || s === null || s === "") {
      return "Nothing";
    }
    return `(Just "${this.escape(s)}")`;
  }

  private statusToIdris(status: TaskStatus): string {
    const map: Record<TaskStatus, string> = {
      pending: "Pending",
      in_progress: "InProgress",
      done: "Done",
      blocked: "Blocked",
      cancelled: "Cancelled",
    };
    return map[status] || "Pending";
  }

  private priorityToIdris(priority: Priority): string {
    const map: Record<Priority, string> = {
      low: "Low",
      medium: "Medium",
      high: "High",
      critical: "Critical",
    };
    return map[priority] || "Medium";
  }

  private async createMemorySchema(schemaPath: string): Promise<void> {
    const schema = `-- LongTermMemory/MemorySchema.idr
-- Base types for Memory Graduation Pipeline

module LongTermMemory.MemorySchema

%default total

-- === 기본 타입 ===
public export
DateStr : Type
DateStr = String -- "2026-01-31"

public export
SessionId : Type
SessionId = Nat -- 1, 2, 3...

public export
data Priority = Low | Medium | High | Critical

public export
data TaskStatus = Pending | InProgress | Done | Blocked | Cancelled

-- === 엔트리 타입들 ===
public export
record Fact where
  constructor MkFact
  title : String
  evidence : Maybe String

public export
record Decision where
  constructor MkDecision
  title : String
  rationale : Maybe String
  basedOn : List String -- Fact 참조

public export
record Insight where
  constructor MkInsight
  observation : String
  implication : String

public export
record Task where
  constructor MkTask
  title : String
  status : TaskStatus
  priority : Priority
  blockedBy : List String -- 다른 Task 참조

public export
record Reference where
  constructor MkReference
  path : String
  description : Maybe String

-- === 통합 엔트리 ===
public export
data AnyEntry
  = AFact Fact
  | ADecision Decision
  | AInsight Insight
  | ATask Task
  | AReference Reference

-- === 세션 레코드 ===
public export
record Session where
  constructor MkSession
  date : DateStr
  sessionId : SessionId
  timeRange : String -- "22:30~22:50"
  title : String
  entries : List AnyEntry

-- === 일일 메모리 ===
public export
record MemoryDay where
  constructor MkMemoryDay
  date : DateStr
  summary : Maybe String
  sessions : List Session

-- === 검증 함수 (불변식) ===

-- Task가 Done인데 blockedBy가 있으면 안됨
public export
validTask : Task -> Bool
validTask t = case t.status of
  Done => isNil t.blockedBy
  _ => True

-- Decision은 반드시 근거가 있어야 함
public export
validDecision : Decision -> Bool
validDecision d = not (isNothing d.rationale)
`;

    await fs.writeFile(schemaPath, schema, "utf-8");
  }
}
