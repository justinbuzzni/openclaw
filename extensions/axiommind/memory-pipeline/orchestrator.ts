/**
 * Memory Pipeline Orchestrator
 *
 * 전체 메모리 파이프라인을 조율하는 메인 클래스
 */
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { SessionExtractor } from "./extractor.js";
import { IdrisGenerator } from "./idris-generator.js";
import { IdrisValidator } from "./validator.js";
import { MemoryIndexer } from "./indexer.js";
import { MemorySearch } from "./search.js";
import { GraduationManager } from "./graduation.js";
import { extractSessionFromContext } from "./context-extractor.js";
import { ConflictResolver, type Resolution } from "./conflict-resolver.js";
import { SimilarityChecker, type SimilarEntry } from "./similarity.js";
import type {
  Session,
  ProcessResult,
  AnyEntry,
  CompileStatus,
  MemoryStage,
  PromotionResult,
  GraduationStats,
  PromotionRecord,
  DemotionReason,
  Conflict,
} from "./types.js";

// 메모리 작업 단계 타입
export type MemoryPhase =
  | "extracting"
  | "generating"
  | "validating"
  | "indexing"
  | "promoting"
  | "searching"
  | "retrieving"
  | "complete"
  | "error";

// 메모리 작업 이벤트 타입
export interface MemoryProgressEvent {
  operationId: string;
  type: "save" | "recall" | "search";
  phase: MemoryPhase;
  sessionId?: string;
  entriesCount?: number;
  results?: unknown[];
  error?: string;
}

export class MemoryPipeline extends EventEmitter {
  private api: OpenClawPluginApi;
  private dataDir: string;

  private extractor: SessionExtractor;
  private generator: IdrisGenerator;
  private validator: IdrisValidator;
  private indexer: MemoryIndexer;
  public search: MemorySearch;
  public graduation: GraduationManager | null = null;
  public conflictResolver: ConflictResolver | null = null;
  public similarityChecker: SimilarityChecker | null = null;

  private idrisAvailable: boolean = false;

  constructor(api: OpenClawPluginApi) {
    super();
    this.api = api;
    this.dataDir = path.join(os.homedir(), ".openclaw", "axiommind");

    // 컴포넌트 초기화
    this.extractor = new SessionExtractor();
    this.generator = new IdrisGenerator(this.dataDir);
    this.validator = new IdrisValidator(this.dataDir);
    this.indexer = new MemoryIndexer(this.dataDir);
    this.search = new MemorySearch(this.indexer);
  }

  /**
   * 메모리 작업 진행 이벤트 발생
   */
  private emitProgress(event: MemoryProgressEvent): void {
    this.emit("progress", event);
  }

  async initialize(): Promise<void> {
    const logger = this.api.logger;

    // Idris2 가용성 확인
    this.idrisAvailable = await this.validator.isAvailable();
    if (!this.idrisAvailable) {
      logger.warn("Idris2 not available. Type verification will be skipped.");
    }

    // 컴포넌트 초기화
    await this.generator.initialize();
    await this.indexer.initialize();

    // GraduationManager 초기화 (DB 공유)
    const db = this.indexer.getDatabase();
    if (db) {
      this.graduation = new GraduationManager(db);
      this.conflictResolver = new ConflictResolver(db);
      this.similarityChecker = new SimilarityChecker(db);
      logger.info("GraduationManager, ConflictResolver, SimilarityChecker initialized");
    } else {
      logger.warn("Database not available for GraduationManager");
    }

    logger.info(`AxiomMind data directory: ${this.dataDir}`);
  }

  /**
   * 세션 로그를 처리하여 메모리에 저장
   */
  async processSession(sessionLog: string, date?: string, sessionId?: number, operationId?: string): Promise<ProcessResult> {
    const logger = this.api.logger;
    const opId = operationId || `save-${Date.now()}`;

    const effectiveDate = date || new Date().toISOString().split("T")[0];
    const effectiveSessionId = sessionId || (await this.indexer.getNextSessionId(effectiveDate));
    const sessionIdStr = `${effectiveDate}_${String(effectiveSessionId).padStart(2, "0")}`;

    // Phase 1: Extracting
    logger.info(`[1/5] Extracting session ${sessionIdStr}...`);
    this.emitProgress({
      operationId: opId,
      type: "save",
      phase: "extracting",
      sessionId: sessionIdStr,
    });

    // 1. LLM으로 구조화 추출
    let data: Session;
    try {
      data = await this.extractor.extract(sessionLog, effectiveDate, effectiveSessionId);
    } catch (error) {
      logger.error(`Extraction failed: ${error}`);
      this.emitProgress({
        operationId: opId,
        type: "save",
        phase: "error",
        sessionId: sessionIdStr,
        error: String(error),
      });
      throw error;
    }

    // Phase 2: Generating
    logger.info(`[2/5] Generating Idris code...`);
    this.emitProgress({
      operationId: opId,
      type: "save",
      phase: "generating",
      sessionId: sessionIdStr,
      entriesCount: data.entries.length,
    });

    // 2. Idris 파일 생성
    const idrPath = await this.generator.generateSession(data);

    // 3. 타입 체크 (Idris2가 있는 경우에만)
    let compileStatus: CompileStatus = "pending";

    if (this.idrisAvailable) {
      // Phase 3: Validating
      logger.info(`[3/5] Validating with Idris2...`);
      this.emitProgress({
        operationId: opId,
        type: "save",
        phase: "validating",
        sessionId: sessionIdStr,
        entriesCount: data.entries.length,
      });

      const compileResult = await this.validator.validate(idrPath);

      if (!compileResult.success) {
        logger.warn(`[!] Compilation failed: ${compileResult.errors.join(", ")}`);

        // 에러 시 재시도
        try {
          data = await this.extractor.retryWithFeedback(
            sessionLog,
            effectiveDate,
            effectiveSessionId,
            compileResult.errors
          );
          await this.generator.generateSession(data);
          const retryResult = await this.validator.validate(idrPath);
          compileStatus = retryResult.success ? "success" : "failed";
        } catch {
          compileStatus = "failed";
        }
      } else {
        compileStatus = "success";
      }
    } else {
      logger.info(`[3/5] Skipping Idris validation (Idris2 not available)`);
      compileStatus = "pending";
    }

    // Phase 4: Indexing
    logger.info(`[4/6] Indexing to search DB...`);
    this.emitProgress({
      operationId: opId,
      type: "save",
      phase: "indexing",
      sessionId: sessionIdStr,
      entriesCount: data.entries.length,
    });

    // 4. 검색 인덱스에 저장
    await this.indexer.indexSession(data, idrPath, compileStatus);

    // Phase 5: Auto-Promotion (if compile succeeded)
    let promotedCount = 0;
    if (compileStatus === "success" && this.graduation) {
      logger.info(`[5/6] Auto-promoting entries (L1 -> L2)...`);
      this.emitProgress({
        operationId: opId,
        type: "save",
        phase: "promoting",
        sessionId: sessionIdStr,
        entriesCount: data.entries.length,
      });

      // 각 엔트리를 Working -> Candidate로 승격
      for (let i = 0; i < data.entries.length; i++) {
        const entryId = `${sessionIdStr}_${String(i).padStart(3, "0")}`;
        try {
          const result = await this.graduation.promoteToCandidate(entryId);
          if (result.success) {
            promotedCount++;
          }
        } catch (promoteErr) {
          logger.warn(`Failed to promote entry ${entryId}: ${promoteErr}`);
        }
      }
      logger.info(`Promoted ${promotedCount}/${data.entries.length} entries to Candidate`);
    } else {
      logger.info(`[5/6] Skipping auto-promotion (compile status: ${compileStatus})`);
    }

    // Phase 6: Complete
    logger.info(`[6/6] Done! Session ${sessionIdStr}`);
    this.emitProgress({
      operationId: opId,
      type: "save",
      phase: "complete",
      sessionId: sessionIdStr,
      entriesCount: data.entries.length,
    });

    return {
      sessionId: sessionIdStr,
      idrPath,
      compileStatus,
      entriesCount: data.entries.length,
    };
  }

  /**
   * OpenClaw 세션 컨텍스트에서 세션 로그 추출 후 처리
   */
  async processSessionFromContext(sessionId: string, ctx: unknown): Promise<ProcessResult | null> {
    const logger = this.api.logger;

    // 컨텍스트에서 세션 로그 추출
    const extracted = extractSessionFromContext(ctx);

    if (!extracted) {
      logger.debug(`No valid context for session: ${sessionId}`);
      return null;
    }

    // 메모리에 저장할 가치가 없으면 스킵
    if (!extracted.memorizable) {
      logger.debug(`Session ${sessionId} not memorizable (too short or no valuable content)`);
      return null;
    }

    // 세션 로그가 비어있으면 스킵
    if (!extracted.sessionLog || extracted.sessionLog.trim().length < 50) {
      logger.debug(`Session ${sessionId} has empty or too short log`);
      return null;
    }

    logger.info(`Processing memorizable session: ${sessionId}`);
    logger.debug(`Session log length: ${extracted.sessionLog.length} chars`);

    try {
      // 세션 처리
      const date = new Date().toISOString().split("T")[0];
      const result = await this.processSession(extracted.sessionLog, date);

      logger.info(`Session ${sessionId} processed successfully: ${result.entriesCount} entries`);
      return result;
    } catch (error) {
      logger.error(`Failed to process session ${sessionId}: ${error}`);
      return null;
    }
  }

  /**
   * 수동으로 엔트리 저장
   */
  async saveEntry(entry: AnyEntry, date?: string, operationId?: string): Promise<ProcessResult> {
    const opId = operationId || `save-${Date.now()}`;
    const effectiveDate = date || new Date().toISOString().split("T")[0];
    const sessionId = await this.indexer.getNextSessionId(effectiveDate);
    const sessionIdStr = `${effectiveDate}_${String(sessionId).padStart(2, "0")}`;

    // Phase: Generating
    this.emitProgress({
      operationId: opId,
      type: "save",
      phase: "generating",
      sessionId: sessionIdStr,
      entriesCount: 1,
    });

    const session: Session = {
      date: effectiveDate,
      sessionId,
      timeRange: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
      title: `Manual entry: ${this.getEntryTitle(entry)}`,
      entries: [entry],
    };

    const idrPath = await this.generator.generateSession(session);

    let compileStatus: CompileStatus = "pending";
    if (this.idrisAvailable) {
      // Phase: Validating
      this.emitProgress({
        operationId: opId,
        type: "save",
        phase: "validating",
        sessionId: sessionIdStr,
        entriesCount: 1,
      });

      const result = await this.validator.validate(idrPath);
      compileStatus = result.success ? "success" : "failed";
    }

    // Phase: Indexing
    this.emitProgress({
      operationId: opId,
      type: "save",
      phase: "indexing",
      sessionId: sessionIdStr,
      entriesCount: 1,
    });

    await this.indexer.indexSession(session, idrPath, compileStatus);

    // Phase: Auto-Promotion (if compile succeeded)
    if (compileStatus === "success" && this.graduation) {
      this.emitProgress({
        operationId: opId,
        type: "save",
        phase: "promoting",
        sessionId: sessionIdStr,
        entriesCount: 1,
      });

      const entryId = `${sessionIdStr}_000`;
      try {
        await this.graduation.promoteToCandidate(entryId);
      } catch {
        // 승격 실패해도 저장은 성공으로 처리
      }
    }

    // Phase: Complete
    this.emitProgress({
      operationId: opId,
      type: "save",
      phase: "complete",
      sessionId: sessionIdStr,
      entriesCount: 1,
    });

    return {
      sessionId: sessionIdStr,
      idrPath,
      compileStatus,
      entriesCount: 1,
    };
  }

  /**
   * 메모리 검색 (진행 상황 이벤트 포함)
   */
  async searchWithProgress(query: string, limit?: number, operationId?: string): Promise<unknown[]> {
    const opId = operationId || `search-${Date.now()}`;

    // Phase: Searching
    this.emitProgress({
      operationId: opId,
      type: "search",
      phase: "searching",
    });

    const results = await this.search.keywordSearch({ query, limit: limit ?? 5 });

    // Phase: Complete
    this.emitProgress({
      operationId: opId,
      type: "search",
      phase: "complete",
      results,
      entriesCount: results.length,
    });

    return results;
  }

  /**
   * 세션별 메모리 조회 (진행 상황 이벤트 포함)
   */
  async recallWithProgress(sessionId: string, operationId?: string): Promise<unknown[]> {
    const opId = operationId || `recall-${Date.now()}`;

    // Phase: Retrieving
    this.emitProgress({
      operationId: opId,
      type: "recall",
      phase: "retrieving",
      sessionId,
    });

    const results = await this.search.getSessionEntries(sessionId);

    // Phase: Complete
    this.emitProgress({
      operationId: opId,
      type: "recall",
      phase: "complete",
      sessionId,
      results,
      entriesCount: results.length,
    });

    return results;
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
    }
  }

  // === Graduation Pipeline API ===

  /**
   * 수동 승격
   */
  async promoteEntry(entryId: string, targetStage: MemoryStage): Promise<PromotionResult> {
    if (!this.graduation) {
      return {
        success: false,
        entryId,
        fromStage: "working",
        toStage: targetStage,
        reason: "user_action",
        message: "GraduationManager not initialized",
      };
    }
    return this.graduation.promoteManually(entryId, targetStage);
  }

  /**
   * 수동 강등
   */
  async demoteEntry(entryId: string, reason: DemotionReason): Promise<PromotionResult> {
    if (!this.graduation) {
      return {
        success: false,
        entryId,
        fromStage: "working",
        toStage: "working",
        reason: "user_action",
        message: "GraduationManager not initialized",
      };
    }
    return this.graduation.demote(entryId, reason);
  }

  /**
   * Graduation 통계 조회
   */
  async getGraduationStats(): Promise<GraduationStats> {
    if (!this.graduation) {
      return { raw: 0, working: 0, candidate: 0, verified: 0, certified: 0, total: 0 };
    }
    return this.graduation.getStats();
  }

  /**
   * 최근 승격 이력 조회
   */
  async getPromotionHistory(limit: number = 10): Promise<PromotionRecord[]> {
    if (!this.graduation) {
      return [];
    }
    return this.graduation.getRecentPromotions(limit);
  }

  /**
   * 자동 승격 체크 실행 (스케줄러에서 호출)
   */
  async runAutoPromotions(): Promise<PromotionResult[]> {
    if (!this.graduation) {
      return [];
    }
    const logger = this.api.logger;
    logger.info("Running auto-promotion check...");
    const results = await this.graduation.checkAutoPromotions();
    const successCount = results.filter((r) => r.success).length;
    logger.info(`Auto-promotion complete: ${successCount}/${results.length} promotions`);
    return results;
  }

  /**
   * 접근 기록 업데이트
   */
  async recordAccess(entryId: string): Promise<void> {
    if (this.graduation) {
      await this.graduation.recordAccess(entryId);
    }
  }

  /**
   * confirmation 카운트 증가
   */
  async incrementConfirmation(entryId: string): Promise<void> {
    if (this.graduation) {
      await this.graduation.incrementConfirmation(entryId);
    }
  }

  // === Conflict Resolution API ===

  /**
   * 미해결 충돌 목록 조회
   */
  async getUnresolvedConflicts(): Promise<Conflict[]> {
    if (!this.conflictResolver) {
      return [];
    }
    return this.conflictResolver.getUnresolvedConflicts();
  }

  /**
   * 충돌 해결
   */
  async resolveConflict(
    conflictId: string,
    resolution: string,
    keepEntryId?: string
  ): Promise<void> {
    if (this.conflictResolver) {
      await this.conflictResolver.resolveConflict(conflictId, resolution, keepEntryId);
    }
  }

  /**
   * 엔트리 충돌 검사
   */
  async checkConflicts(entry: AnyEntry, entryId: string): Promise<Conflict[]> {
    if (!this.conflictResolver) {
      return [];
    }
    return this.conflictResolver.detectConflicts(entry, entryId);
  }

  // === Similarity API ===

  /**
   * 유사 엔트리 확인 및 confirmation 증가
   */
  async checkAndConfirmSimilar(entry: AnyEntry): Promise<SimilarEntry[]> {
    if (!this.similarityChecker) {
      return [];
    }
    return this.similarityChecker.checkAndConfirm(entry);
  }

  /**
   * 유사 엔트리 검색 (UI용)
   */
  async findSimilarEntries(entry: AnyEntry, threshold?: number): Promise<SimilarEntry[]> {
    if (!this.similarityChecker) {
      return [];
    }
    return this.similarityChecker.findSimilar(entry, threshold);
  }
}

// Re-export types for external use
export type { Conflict, Resolution, SimilarEntry };
