/**
 * Memory Indexer
 *
 * DuckDB를 사용하여 세션과 엔트리를 인덱싱
 * 벡터 검색을 위한 임베딩 저장
 */
import * as duckdb from "duckdb";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Session, AnyEntry, CompileStatus } from "./types.js";

export class MemoryIndexer {
  private db: duckdb.Database | null = null;
  private dbPath: string;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, "data", "memory.duckdb");
  }

  async initialize(): Promise<void> {
    // 데이터 디렉토리 생성
    await fs.mkdir(path.join(this.dataDir, "data"), { recursive: true });

    // DuckDB 연결
    this.db = new duckdb.Database(this.dbPath);

    // 스키마 초기화
    await this.initSchema();

    // 기존 DB 마이그레이션 (새 컬럼 추가)
    await this.migrateSchema();
  }

  private async initSchema(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      this.db!.run(
        `
        -- Sessions 테이블
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR PRIMARY KEY,
          date DATE NOT NULL,
          session_id INTEGER NOT NULL,
          time_range VARCHAR,
          title VARCHAR NOT NULL,
          idr_path VARCHAR NOT NULL,
          compiled_at TIMESTAMP,
          compile_status VARCHAR DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT now(),
          UNIQUE(date, session_id)
        );

        -- Entries 테이블 (Graduation Pipeline 지원)
        CREATE TABLE IF NOT EXISTS entries (
          id VARCHAR PRIMARY KEY,
          session_id VARCHAR,
          entry_type VARCHAR NOT NULL,
          title VARCHAR NOT NULL,
          content JSON,
          text_for_search VARCHAR,
          -- Graduation Pipeline 컬럼
          memory_stage VARCHAR DEFAULT 'working',
          promoted_at TIMESTAMP,
          promotion_reason VARCHAR,
          last_accessed_at TIMESTAMP,
          access_count INTEGER DEFAULT 0,
          confirmation_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT now(),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        -- 승격 이력 테이블
        CREATE TABLE IF NOT EXISTS promotion_history (
          id VARCHAR PRIMARY KEY,
          entry_id VARCHAR,
          from_stage VARCHAR NOT NULL,
          to_stage VARCHAR NOT NULL,
          reason VARCHAR,
          promoted_at TIMESTAMP DEFAULT now(),
          FOREIGN KEY (entry_id) REFERENCES entries(id)
        );

        -- 충돌 기록 테이블
        CREATE TABLE IF NOT EXISTS conflicts (
          id VARCHAR PRIMARY KEY,
          entry_id_1 VARCHAR,
          entry_id_2 VARCHAR,
          conflict_type VARCHAR NOT NULL,
          detected_at TIMESTAMP DEFAULT now(),
          resolved_at TIMESTAMP,
          resolution VARCHAR,
          FOREIGN KEY (entry_id_1) REFERENCES entries(id),
          FOREIGN KEY (entry_id_2) REFERENCES entries(id)
        );

        -- 인덱스
        CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type);
        CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);
        CREATE INDEX IF NOT EXISTS idx_entries_stage ON entries(memory_stage);
        CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
        CREATE INDEX IF NOT EXISTS idx_promotion_history_entry ON promotion_history(entry_id);
        CREATE INDEX IF NOT EXISTS idx_conflicts_entries ON conflicts(entry_id_1, entry_id_2);
      `,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 기존 DB 마이그레이션 (memory_stage 컬럼 추가)
   */
  async migrateSchema(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // 기존 entries 테이블에 새 컬럼이 없으면 추가
    const columns = [
      { name: "memory_stage", type: "VARCHAR DEFAULT 'working'" },
      { name: "promoted_at", type: "TIMESTAMP" },
      { name: "promotion_reason", type: "VARCHAR" },
      { name: "last_accessed_at", type: "TIMESTAMP" },
      { name: "access_count", type: "INTEGER DEFAULT 0" },
      { name: "confirmation_count", type: "INTEGER DEFAULT 0" },
    ];

    for (const col of columns) {
      try {
        await this.runQuery(`ALTER TABLE entries ADD COLUMN ${col.name} ${col.type}`);
      } catch {
        // 컬럼이 이미 존재하면 무시
      }
    }
  }

  async indexSession(data: Session, idrPath: string, compileStatus: CompileStatus): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const sessionId = `${data.date}_${String(data.sessionId).padStart(2, "0")}`;

    // 1. 세션 메타데이터 저장
    await this.runQuery(
      `
      INSERT INTO sessions
      (id, date, session_id, time_range, title, idr_path, compile_status, compiled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, now())
      ON CONFLICT (id) DO UPDATE SET
        time_range = EXCLUDED.time_range,
        title = EXCLUDED.title,
        idr_path = EXCLUDED.idr_path,
        compile_status = EXCLUDED.compile_status,
        compiled_at = now()
    `,
      [sessionId, data.date, data.sessionId, data.timeRange, data.title, idrPath, compileStatus]
    );

    // 2. 엔트리 인덱싱
    for (let i = 0; i < data.entries.length; i++) {
      const entry = data.entries[i];
      const entryId = `${sessionId}_${String(i).padStart(3, "0")}`;
      const textForSearch = this.entryToText(entry);
      const title = this.getEntryTitle(entry);

      await this.runQuery(
        `
        INSERT INTO entries
        (id, session_id, entry_type, title, content, text_for_search)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          session_id = EXCLUDED.session_id,
          entry_type = EXCLUDED.entry_type,
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          text_for_search = EXCLUDED.text_for_search
      `,
        [entryId, sessionId, entry.type, title, JSON.stringify(entry), textForSearch]
      );
    }
  }

  async searchByKeyword(keywords: string[], entryTypes?: string[], memoryStages?: string[]): Promise<SearchRowResult[]> {
    if (!this.db) throw new Error("Database not initialized");

    let typeFilter = "";
    if (entryTypes && entryTypes.length > 0) {
      const types = entryTypes.map((t) => `'${t}'`).join(", ");
      typeFilter = `AND e.entry_type IN (${types})`;
    }

    let stageFilter = "";
    if (memoryStages && memoryStages.length > 0) {
      const stages = memoryStages.map((s) => `'${s}'`).join(", ");
      stageFilter = `AND COALESCE(e.memory_stage, 'working') IN (${stages})`;
    }

    const keywordConditions = keywords
      .map((kw) => `(e.title ILIKE '%${kw}%' OR e.text_for_search ILIKE '%${kw}%')`)
      .join(" OR ");

    const query = `
      SELECT e.*, s.idr_path, s.date as session_date
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      WHERE (${keywordConditions})
      ${typeFilter}
      ${stageFilter}
      ORDER BY s.date DESC, e.id
      LIMIT 20
    `;

    return this.runSelect(query);
  }

  async getDecisionsWithEvidence(dateFrom?: string): Promise<DecisionWithEvidence[]> {
    if (!this.db) throw new Error("Database not initialized");

    const dateFilter = dateFrom ? `AND s.date >= '${dateFrom}'` : "";

    const query = `
      SELECT e.id, e.content, s.date, s.idr_path
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.entry_type = 'decision'
      ${dateFilter}
      ORDER BY s.date DESC
    `;

    const decisions = await this.runSelect(query);
    const results: DecisionWithEvidence[] = [];

    for (const d of decisions) {
      const content = JSON.parse(d.content as string);
      const basedOn = content.basedOn || [];

      // 연결된 Fact 찾기
      const facts: AnyEntry[] = [];
      if (basedOn.length > 0) {
        const factTitles = basedOn.map((f: string) => `'${f}'`).join(", ");
        const factQuery = `
          SELECT content FROM entries
          WHERE entry_type = 'fact' AND title IN (${factTitles})
        `;
        const factRows = await this.runSelect(factQuery);
        for (const f of factRows) {
          facts.push(JSON.parse(f.content as string));
        }
      }

      results.push({
        decision: content,
        date: d.date as string,
        evidenceFacts: facts,
        idrPath: d.idr_path as string,
      });
    }

    return results;
  }

  async getPendingTasks(): Promise<TaskWithContext[]> {
    if (!this.db) throw new Error("Database not initialized");

    const query = `
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
    `;

    const rows = await this.runSelect(query);
    return rows.map((r) => ({
      task: JSON.parse(r.content as string),
      date: r.date as string,
      session: r.session_title as string,
    }));
  }

  async getNextSessionId(date: string): Promise<number> {
    if (!this.db) throw new Error("Database not initialized");

    const query = `
      SELECT CAST(COALESCE(MAX(session_id), 0) + 1 AS INTEGER) as next_id
      FROM sessions WHERE date = ?
    `;

    const rows = await this.runSelect(query, [date]);
    const nextId = rows[0]?.next_id;
    return typeof nextId === "number" ? nextId : 1;
  }

  /**
   * 개별 엔트리 조회
   */
  async getEntry(entryId: string): Promise<EntryWithMeta | null> {
    if (!this.db) throw new Error("Database not initialized");

    const query = `
      SELECT e.*, s.date as session_date, s.title as session_title, s.idr_path
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.id = ?
    `;

    const rows = await this.runSelect(query, [entryId]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      entryType: row.entry_type as string,
      title: row.title as string,
      content: JSON.parse(row.content as string),
      textForSearch: row.text_for_search as string,
      memoryStage: (row.memory_stage as string) || "working",
      promotedAt: row.promoted_at as string | null,
      promotionReason: row.promotion_reason as string | null,
      lastAccessedAt: row.last_accessed_at as string | null,
      accessCount: (row.access_count as number) || 0,
      confirmationCount: (row.confirmation_count as number) || 0,
      createdAt: row.created_at as string,
      sessionDate: row.session_date as string,
      sessionTitle: row.session_title as string,
      idrPath: row.idr_path as string,
    };
  }

  /**
   * 엔트리 목록 조회 (페이징)
   */
  async listEntries(options: ListEntriesOptions = {}): Promise<{ entries: EntryWithMeta[]; total: number }> {
    if (!this.db) throw new Error("Database not initialized");

    const {
      limit = 20,
      offset = 0,
      entryTypes,
      memoryStages,
      dateFrom,
      dateTo,
      sortBy = "created_at",
      sortOrder = "DESC",
    } = options;

    let whereConditions: string[] = [];
    const params: unknown[] = [];

    if (entryTypes && entryTypes.length > 0) {
      const types = entryTypes.map((t) => `'${t}'`).join(", ");
      whereConditions.push(`e.entry_type IN (${types})`);
    }

    if (memoryStages && memoryStages.length > 0) {
      const stages = memoryStages.map((s) => `'${s}'`).join(", ");
      whereConditions.push(`COALESCE(e.memory_stage, 'working') IN (${stages})`);
    }

    if (dateFrom) {
      whereConditions.push(`s.date >= '${dateFrom}'`);
    }

    if (dateTo) {
      whereConditions.push(`s.date <= '${dateTo}'`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // 총 개수 조회
    const countQuery = `
      SELECT CAST(COUNT(*) AS INTEGER) as total
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      ${whereClause}
    `;
    const countRows = await this.runSelect(countQuery);
    const total = (countRows[0]?.total as number) || 0;

    // 엔트리 조회
    const validSortColumns = ["created_at", "title", "entry_type", "memory_stage", "access_count"];
    const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : "created_at";
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const query = `
      SELECT e.*, s.date as session_date, s.title as session_title, s.idr_path
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      ${whereClause}
      ORDER BY e.${safeSortBy} ${safeSortOrder}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = await this.runSelect(query);
    const entries: EntryWithMeta[] = rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      entryType: row.entry_type as string,
      title: row.title as string,
      content: JSON.parse(row.content as string),
      textForSearch: row.text_for_search as string,
      memoryStage: (row.memory_stage as string) || "working",
      promotedAt: row.promoted_at as string | null,
      promotionReason: row.promotion_reason as string | null,
      lastAccessedAt: row.last_accessed_at as string | null,
      accessCount: (row.access_count as number) || 0,
      confirmationCount: (row.confirmation_count as number) || 0,
      createdAt: row.created_at as string,
      sessionDate: row.session_date as string,
      sessionTitle: row.session_title as string,
      idrPath: row.idr_path as string,
    }));

    return { entries, total };
  }

  /**
   * 엔트리 수정
   */
  async updateEntry(entryId: string, updates: EntryUpdates): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized");

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      setClauses.push("title = ?");
      params.push(updates.title);
    }

    if (updates.content !== undefined) {
      setClauses.push("content = ?");
      params.push(JSON.stringify(updates.content));

      // text_for_search도 업데이트
      const entry = updates.content as AnyEntry;
      setClauses.push("text_for_search = ?");
      params.push(this.entryToText(entry));
    }

    if (setClauses.length === 0) {
      return false; // 업데이트할 내용 없음
    }

    params.push(entryId);

    const query = `
      UPDATE entries
      SET ${setClauses.join(", ")}
      WHERE id = ?
    `;

    await this.runQuery(query, params);
    return true;
  }

  /**
   * 엔트리 삭제
   */
  async deleteEntry(entryId: string): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized");

    // 먼저 관련된 promotion_history와 conflicts 삭제
    await this.runQuery("DELETE FROM promotion_history WHERE entry_id = ?", [entryId]);
    await this.runQuery("DELETE FROM conflicts WHERE entry_id_1 = ? OR entry_id_2 = ?", [entryId, entryId]);

    // 엔트리 삭제
    await this.runQuery("DELETE FROM entries WHERE id = ?", [entryId]);

    return true;
  }

  private entryToText(entry: AnyEntry): string {
    switch (entry.type) {
      case "fact":
        return `[사실] ${entry.title}. ${entry.evidence || ""}`;
      case "decision":
        return `[결정] ${entry.title}. 이유: ${entry.rationale || ""}`;
      case "insight":
        return `[인사이트] ${entry.observation}. 시사점: ${entry.implication}`;
      case "task":
        return `[할일] ${entry.title}. 상태: ${entry.status}`;
      case "reference":
        return `[파일] ${entry.path}. ${entry.description || ""}`;
      default:
        return JSON.stringify(entry);
    }
  }

  private getEntryTitle(entry: AnyEntry): string {
    switch (entry.type) {
      case "fact":
      case "decision":
      case "task":
        return entry.title;
      case "insight":
        return entry.observation;
      case "reference":
        return entry.path;
      default:
        return "Unknown";
    }
  }

  private runQuery(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(sql, ...params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private runSelect(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      this.db!.all(sql, ...params, (err: Error | null, rows: Record<string, unknown>[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * 타입별 엔트리 수 조회 (Dashboard용)
   */
  async getEntriesByType(): Promise<Record<string, number>> {
    if (!this.db) return {};

    const rows = await this.runSelect(`
      SELECT entry_type, CAST(COUNT(*) AS INTEGER) as count
      FROM entries
      GROUP BY entry_type
    `);

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.entry_type as string] = row.count as number;
    }
    return result;
  }

  /**
   * 가장 많이 접근된 엔트리 조회 (Dashboard용)
   */
  async getTopAccessedEntries(limit = 10): Promise<EntryWithMeta[]> {
    if (!this.db) return [];

    const rows = await this.runSelect(
      `
      SELECT e.*, s.date as session_date, s.title as session_title, s.idr_path
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.access_count > 0
      ORDER BY e.access_count DESC, e.last_accessed_at DESC
      LIMIT ?
      `,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      entryType: row.entry_type as string,
      title: row.title as string,
      content: JSON.parse(row.content as string) as AnyEntry,
      textForSearch: row.text_for_search as string,
      memoryStage: row.memory_stage as string,
      promotedAt: row.promoted_at as string | null,
      promotionReason: row.promotion_reason as string | null,
      lastAccessedAt: row.last_accessed_at as string | null,
      accessCount: (row.access_count as number) || 0,
      confirmationCount: (row.confirmation_count as number) || 0,
      createdAt: row.created_at as string,
      sessionDate: row.session_date as string,
      sessionTitle: row.session_title as string,
      idrPath: row.idr_path as string,
    }));
  }

  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve) => {
        this.db!.close(() => {
          this.db = null;
          resolve();
        });
      });
    }
  }

  /**
   * DB 인스턴스 반환 (GraduationManager 등과 공유)
   */
  getDatabase(): duckdb.Database | null {
    return this.db;
  }
}

// 타입 정의
type SearchRowResult = Record<string, unknown>;

type DecisionWithEvidence = {
  decision: AnyEntry;
  date: string;
  evidenceFacts: AnyEntry[];
  idrPath: string;
};

type TaskWithContext = {
  task: AnyEntry;
  date: string;
  session: string;
};

type EntryWithMeta = {
  id: string;
  sessionId: string;
  entryType: string;
  title: string;
  content: AnyEntry;
  textForSearch: string;
  memoryStage: string;
  promotedAt: string | null;
  promotionReason: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  confirmationCount: number;
  createdAt: string;
  sessionDate: string;
  sessionTitle: string;
  idrPath: string;
};

type ListEntriesOptions = {
  limit?: number;
  offset?: number;
  entryTypes?: string[];
  memoryStages?: string[];
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: "ASC" | "DESC";
};

type EntryUpdates = {
  title?: string;
  content?: AnyEntry;
};

export type { SearchRowResult, DecisionWithEvidence, TaskWithContext, EntryWithMeta, ListEntriesOptions, EntryUpdates };
