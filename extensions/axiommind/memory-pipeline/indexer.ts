/**
 * Memory Indexer
 *
 * SQLite (better-sqlite3)를 사용하여 세션과 엔트리를 인덱싱
 * WAL 모드로 동시 접근 지원
 */
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Session, AnyEntry, CompileStatus } from "./types.js";

export class MemoryIndexer {
  private db: DatabaseType | null = null;
  private dbPath: string;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, "data", "memory.sqlite");
  }

  async initialize(): Promise<void> {
    // 데이터 디렉토리 생성
    await fs.mkdir(path.join(this.dataDir, "data"), { recursive: true });

    // SQLite 연결 (WAL 모드로 동시 접근 지원)
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000"); // 5초 대기

    // 스키마 초기화
    this.initSchema();

    // 기존 DB 마이그레이션 (새 컬럼 추가)
    this.migrateSchema();
  }

  private initSchema(): void {
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec(`
      -- Sessions 테이블
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        session_id INTEGER NOT NULL,
        time_range TEXT,
        title TEXT NOT NULL,
        idr_path TEXT NOT NULL,
        compiled_at TEXT,
        compile_status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(date, session_id)
      );

      -- Entries 테이블 (Graduation Pipeline 지원)
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        entry_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        text_for_search TEXT,
        -- Graduation Pipeline 컬럼
        memory_stage TEXT DEFAULT 'working',
        promoted_at TEXT,
        promotion_reason TEXT,
        last_accessed_at TEXT,
        access_count INTEGER DEFAULT 0,
        confirmation_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      -- 승격 이력 테이블
      CREATE TABLE IF NOT EXISTS promotion_history (
        id TEXT PRIMARY KEY,
        entry_id TEXT,
        from_stage TEXT NOT NULL,
        to_stage TEXT NOT NULL,
        reason TEXT,
        promoted_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (entry_id) REFERENCES entries(id)
      );

      -- 충돌 기록 테이블
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        entry_id_1 TEXT,
        entry_id_2 TEXT,
        conflict_type TEXT NOT NULL,
        detected_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT,
        resolution TEXT,
        FOREIGN KEY (entry_id_1) REFERENCES entries(id),
        FOREIGN KEY (entry_id_2) REFERENCES entries(id)
      );

      -- Import 추적 테이블
      CREATE TABLE IF NOT EXISTS imported_sessions (
        session_file_id TEXT PRIMARY KEY,
        imported_at TEXT DEFAULT (datetime('now')),
        entry_count INTEGER DEFAULT 0
      );

      -- 인덱스
      CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type);
      CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_entries_stage ON entries(memory_stage);
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
      CREATE INDEX IF NOT EXISTS idx_promotion_history_entry ON promotion_history(entry_id);
      CREATE INDEX IF NOT EXISTS idx_conflicts_entries ON conflicts(entry_id_1, entry_id_2);
    `);
  }

  /**
   * 기존 DB 마이그레이션 (memory_stage 컬럼 추가)
   */
  private migrateSchema(): void {
    if (!this.db) throw new Error("Database not initialized");

    // 기존 entries 테이블에 새 컬럼이 없으면 추가
    const columns = [
      { name: "memory_stage", type: "TEXT DEFAULT 'working'" },
      { name: "promoted_at", type: "TEXT" },
      { name: "promotion_reason", type: "TEXT" },
      { name: "last_accessed_at", type: "TEXT" },
      { name: "access_count", type: "INTEGER DEFAULT 0" },
      { name: "confirmation_count", type: "INTEGER DEFAULT 0" },
    ];

    for (const col of columns) {
      try {
        this.db.exec(`ALTER TABLE entries ADD COLUMN ${col.name} ${col.type}`);
      } catch {
        // 컬럼이 이미 존재하면 무시
      }
    }
  }

  async indexSession(data: Session, idrPath: string, compileStatus: CompileStatus): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const sessionId = `${data.date}_${String(data.sessionId).padStart(2, "0")}`;

    // 1. 세션 메타데이터 저장
    const insertSession = this.db.prepare(`
      INSERT INTO sessions
      (id, date, session_id, time_range, title, idr_path, compile_status, compiled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (id) DO UPDATE SET
        time_range = excluded.time_range,
        title = excluded.title,
        idr_path = excluded.idr_path,
        compile_status = excluded.compile_status,
        compiled_at = datetime('now')
    `);
    insertSession.run(sessionId, data.date, data.sessionId, data.timeRange, data.title, idrPath, compileStatus);

    // 2. 엔트리 인덱싱
    const insertEntry = this.db.prepare(`
      INSERT INTO entries
      (id, session_id, entry_type, title, content, text_for_search)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        session_id = excluded.session_id,
        entry_type = excluded.entry_type,
        title = excluded.title,
        content = excluded.content,
        text_for_search = excluded.text_for_search
    `);

    for (let i = 0; i < data.entries.length; i++) {
      const entry = data.entries[i];
      const entryId = `${sessionId}_${String(i).padStart(3, "0")}`;
      const textForSearch = this.entryToText(entry);
      const title = this.getEntryTitle(entry);
      insertEntry.run(entryId, sessionId, entry.type, title, JSON.stringify(entry), textForSearch);
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
      .map((kw) => `(e.title LIKE '%${kw}%' COLLATE NOCASE OR e.text_for_search LIKE '%${kw}%' COLLATE NOCASE)`)
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

    return this.db.prepare(query).all() as SearchRowResult[];
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

    const decisions = this.db.prepare(query).all() as Record<string, unknown>[];
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
        const factRows = this.db.prepare(factQuery).all() as Record<string, unknown>[];
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
      SELECT e.id, e.content, s.date, s.title as session_title
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.entry_type = 'task'
        AND json_extract(e.content, '$.status') IN ('pending', 'in_progress', 'blocked')
      ORDER BY
        CASE json_extract(e.content, '$.priority')
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        s.date DESC
    `;

    const rows = this.db.prepare(query).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      task: JSON.parse(r.content as string),
      date: r.date as string,
      session: r.session_title as string,
    }));
  }

  async getNextSessionId(date: string): Promise<number> {
    if (!this.db) throw new Error("Database not initialized");

    const query = `
      SELECT COALESCE(MAX(session_id), 0) + 1 as next_id
      FROM sessions WHERE date = ?
    `;

    const row = this.db.prepare(query).get(date) as { next_id: number } | undefined;
    return row?.next_id || 1;
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

    const row = this.db.prepare(query).get(entryId) as Record<string, unknown> | undefined;
    if (!row) return null;

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

    const whereConditions: string[] = [];

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
      SELECT COUNT(*) as total
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      ${whereClause}
    `;
    const countRow = this.db.prepare(countQuery).get() as { total: number };
    const total = countRow?.total || 0;

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

    const rows = this.db.prepare(query).all() as Record<string, unknown>[];
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

    this.db.prepare(query).run(...params);
    return true;
  }

  /**
   * 엔트리 삭제
   */
  async deleteEntry(entryId: string): Promise<boolean> {
    if (!this.db) throw new Error("Database not initialized");

    // 먼저 관련된 promotion_history와 conflicts 삭제
    this.db.prepare("DELETE FROM promotion_history WHERE entry_id = ?").run(entryId);
    this.db.prepare("DELETE FROM conflicts WHERE entry_id_1 = ? OR entry_id_2 = ?").run(entryId, entryId);

    // 엔트리 삭제
    this.db.prepare("DELETE FROM entries WHERE id = ?").run(entryId);

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

  /**
   * 타입별 엔트리 수 조회 (Dashboard용)
   */
  async getEntriesByType(): Promise<Record<string, number>> {
    if (!this.db) return {};

    const rows = this.db
      .prepare(
        `
      SELECT entry_type, COUNT(*) as count
      FROM entries
      GROUP BY entry_type
    `
      )
      .all() as { entry_type: string; count: number }[];

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.entry_type] = row.count;
    }
    return result;
  }

  /**
   * 가장 많이 접근된 엔트리 조회 (Dashboard용)
   */
  async getTopAccessedEntries(limit = 10): Promise<EntryWithMeta[]> {
    if (!this.db) return [];

    const rows = this.db
      .prepare(
        `
      SELECT e.*, s.date as session_date, s.title as session_title, s.idr_path
      FROM entries e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.access_count > 0
      ORDER BY e.access_count DESC, e.last_accessed_at DESC
      LIMIT ?
      `
      )
      .all(limit) as Record<string, unknown>[];

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

  /**
   * 세션 목록 조회 (페이징)
   */
  async listSessions(options: ListSessionsOptions = {}): Promise<{ sessions: SessionSummary[]; total: number }> {
    if (!this.db) throw new Error("Database not initialized");

    const { limit = 50, offset = 0, dateFrom, dateTo } = options;

    const whereConditions: string[] = [];
    if (dateFrom) {
      whereConditions.push(`s.date >= '${dateFrom}'`);
    }
    if (dateTo) {
      whereConditions.push(`s.date <= '${dateTo}'`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // 총 개수 조회
    const countQuery = `SELECT COUNT(*) as total FROM sessions s ${whereClause}`;
    const countRow = this.db.prepare(countQuery).get() as { total: number };
    const total = countRow?.total || 0;

    // 세션 목록 조회 (엔트리 수 포함)
    const query = `
      SELECT
        s.id,
        s.date,
        s.session_id,
        s.title,
        s.time_range,
        s.compile_status,
        s.created_at,
        (SELECT COUNT(*) FROM entries e WHERE e.session_id = s.id) as entry_count
      FROM sessions s
      ${whereClause}
      ORDER BY s.date DESC, s.session_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = this.db.prepare(query).all() as Record<string, unknown>[];
    const sessions: SessionSummary[] = rows.map((row) => ({
      id: row.id as string,
      date: row.date as string,
      sessionId: row.session_id as number,
      title: row.title as string,
      timeRange: row.time_range as string | null,
      compileStatus: row.compile_status as string,
      createdAt: row.created_at as string,
      entryCount: (row.entry_count as number) || 0,
    }));

    return { sessions, total };
  }

  // === Import Tracking ===

  isSessionImported(sessionFileId: string): boolean {
    if (!this.db) return false;
    const row = this.db.prepare("SELECT 1 FROM imported_sessions WHERE session_file_id = ?").get(sessionFileId);
    return !!row;
  }

  markSessionImported(sessionFileId: string, entryCount: number): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.prepare(
      "INSERT OR IGNORE INTO imported_sessions (session_file_id, entry_count) VALUES (?, ?)"
    ).run(sessionFileId, entryCount);
  }

  getImportStatuses(sessionFileIds: string[]): Map<string, boolean> {
    if (!this.db) return new Map();
    const result = new Map<string, boolean>();
    const stmt = this.db.prepare("SELECT session_file_id FROM imported_sessions WHERE session_file_id = ?");
    for (const id of sessionFileIds) {
      result.set(id, !!stmt.get(id));
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * DB 인스턴스 반환 (GraduationManager 등과 공유)
   */
  getDatabase(): DatabaseType | null {
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
  id: string;
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

type ListSessionsOptions = {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
};

type SessionSummary = {
  id: string;
  date: string;
  sessionId: number;
  title: string;
  timeRange: string | null;
  compileStatus: string;
  createdAt: string;
  entryCount: number;
};

export type { SearchRowResult, DecisionWithEvidence, TaskWithContext, EntryWithMeta, ListEntriesOptions, EntryUpdates, ListSessionsOptions, SessionSummary };
