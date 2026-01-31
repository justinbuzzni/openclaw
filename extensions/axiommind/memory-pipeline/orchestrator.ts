/**
 * Memory Pipeline Orchestrator
 *
 * 전체 메모리 파이프라인을 조율하는 메인 클래스
 */
import * as os from "node:os";
import * as path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { SessionExtractor } from "./extractor.js";
import { IdrisGenerator } from "./idris-generator.js";
import { IdrisValidator } from "./validator.js";
import { MemoryIndexer } from "./indexer.js";
import { MemorySearch } from "./search.js";
import type { Session, ProcessResult, AnyEntry, CompileStatus } from "./types.js";

export class MemoryPipeline {
  private api: OpenClawPluginApi;
  private dataDir: string;

  private extractor: SessionExtractor;
  private generator: IdrisGenerator;
  private validator: IdrisValidator;
  private indexer: MemoryIndexer;
  public search: MemorySearch;

  private idrisAvailable: boolean = false;

  constructor(api: OpenClawPluginApi) {
    this.api = api;
    this.dataDir = path.join(os.homedir(), ".openclaw", "axiommind");

    // 컴포넌트 초기화
    this.extractor = new SessionExtractor();
    this.generator = new IdrisGenerator(this.dataDir);
    this.validator = new IdrisValidator(this.dataDir);
    this.indexer = new MemoryIndexer(this.dataDir);
    this.search = new MemorySearch(this.indexer);
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

    logger.info(`AxiomMind data directory: ${this.dataDir}`);
  }

  /**
   * 세션 로그를 처리하여 메모리에 저장
   */
  async processSession(sessionLog: string, date?: string, sessionId?: number): Promise<ProcessResult> {
    const logger = this.api.logger;

    const effectiveDate = date || new Date().toISOString().split("T")[0];
    const effectiveSessionId = sessionId || (await this.indexer.getNextSessionId(effectiveDate));

    logger.info(`[1/5] Extracting session ${effectiveDate}_${String(effectiveSessionId).padStart(2, "0")}...`);

    // 1. LLM으로 구조화 추출
    let data: Session;
    try {
      data = await this.extractor.extract(sessionLog, effectiveDate, effectiveSessionId);
    } catch (error) {
      logger.error(`Extraction failed: ${error}`);
      throw error;
    }

    logger.info(`[2/5] Generating Idris code...`);

    // 2. Idris 파일 생성
    const idrPath = await this.generator.generateSession(data);

    // 3. 타입 체크 (Idris2가 있는 경우에만)
    let compileStatus: CompileStatus = "pending";

    if (this.idrisAvailable) {
      logger.info(`[3/5] Validating with Idris2...`);

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

    logger.info(`[4/5] Indexing to search DB...`);

    // 4. 검색 인덱스에 저장
    await this.indexer.indexSession(data, idrPath, compileStatus);

    const sessionIdStr = `${effectiveDate}_${String(effectiveSessionId).padStart(2, "0")}`;
    logger.info(`[5/5] Done! Session ${sessionIdStr}`);

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

    // TODO: OpenClaw 세션 컨텍스트에서 대화 로그 추출
    // 현재는 플레이스홀더
    logger.debug(`Processing session from context: ${sessionId}`);

    // 세션 로그가 없으면 스킵
    return null;
  }

  /**
   * 수동으로 엔트리 저장
   */
  async saveEntry(entry: AnyEntry, date?: string): Promise<ProcessResult> {
    const effectiveDate = date || new Date().toISOString().split("T")[0];
    const sessionId = await this.indexer.getNextSessionId(effectiveDate);

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
      const result = await this.validator.validate(idrPath);
      compileStatus = result.success ? "success" : "failed";
    }

    await this.indexer.indexSession(session, idrPath, compileStatus);

    return {
      sessionId: `${effectiveDate}_${String(sessionId).padStart(2, "0")}`,
      idrPath,
      compileStatus,
      entriesCount: 1,
    };
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
}
