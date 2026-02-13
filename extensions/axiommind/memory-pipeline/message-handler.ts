/**
 * Message Handler
 *
 * 통합 메시지 처리 플로우
 * - Intent 분류 → 스코어링 → 캐시 체크 → 메모리 검색 → 안전성 검증
 */

import type { MemoryPipeline } from "./orchestrator.js";
import type { MemoryCategory, SearchStrategy } from "./intent-router.js";
import type { MemoryCandidate, SemanticFact } from "./memory-tiers.js";
import type { ValidatedMemory } from "./safety-filter.js";
import type { CacheableMemory } from "./semantic-cache.js";
import type { GraphSearchResult } from "./memory-graph.js";
import {
  classifyIntent,
  calculateMemoryScore,
  getSearchStrategy,
  getSearchPriority,
  determineAction,
  MEMORY_THRESHOLDS,
  type MemoryIntent,
  type EnhancedMemoryScore,
} from "./intent-router.js";
import { getSemanticCache } from "./semantic-cache.js";
import { getSafetyFilter } from "./safety-filter.js";
import { MemoryGraphManager } from "./memory-graph.js";

// === Types ===

export interface MessageContext {
  messages?: Array<{ role: string; content: string }>;
  sessionId?: string;
  userId?: string;
}

export interface MemoryRetrievalResult {
  memories: ValidatedMemory[];
  intent: MemoryIntent;
  score: EnhancedMemoryScore;
  action: "skip" | "cache_check" | "search" | "graph_search";
  cacheHit: boolean;
  timing: {
    total: number;
    intentClassification: number;
    cacheCheck: number;
    memorySearch: number;
    validation: number;
  };
}

export interface PreloadedContext {
  memoryCandidates: MemoryCandidate[];
  userProfile?: {
    preferences: Array<{ category: string; preference: string }>;
    communicationStyle?: {
      language: "ko" | "en" | "mixed";
      formality: "casual" | "formal" | "mixed";
    };
  };
  activeProjects?: Array<{ id: string; name: string }>;
}

// === Message Handler ===

export class MessageHandler {
  private pipeline: MemoryPipeline;
  private graphManager: MemoryGraphManager | null = null;
  private cache = getSemanticCache();
  private safetyFilter = getSafetyFilter();

  // 세션별 프리로드된 컨텍스트
  private preloadedContexts: Map<string, PreloadedContext> = new Map();

  constructor(pipeline: MemoryPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Graph Manager 설정
   */
  setGraphManager(manager: MemoryGraphManager): void {
    this.graphManager = manager;
  }

  /**
   * 세션 시작 시 메모리 메타데이터 프리로드
   */
  async onSessionStart(sessionId: string, userId?: string): Promise<PreloadedContext> {
    const startTime = Date.now();

    // 최근 메모리 메타데이터만 가져오기 (본문 X)
    const candidates = await this.getRecentMemoryCandidates(userId, 10);

    // 사용자 프로필 요약
    const userProfile = await this.getUserProfileSummary(userId);

    // 활성 프로젝트
    const activeProjects = await this.getActiveProjects(userId);

    const context: PreloadedContext = {
      memoryCandidates: candidates,
      userProfile,
      activeProjects,
    };

    this.preloadedContexts.set(sessionId, context);

    console.log(`[AxiomMind] Session ${sessionId} preloaded in ${Date.now() - startTime}ms`);

    return context;
  }

  /**
   * 세션 종료 시 정리
   */
  async onSessionEnd(sessionId: string): Promise<void> {
    this.preloadedContexts.delete(sessionId);
  }

  /**
   * 메시지 처리 - 메모리 검색 필요 여부 판단 및 검색
   */
  async handleMessage(
    message: string,
    context: MessageContext
  ): Promise<MemoryRetrievalResult> {
    const timing = {
      total: 0,
      intentClassification: 0,
      cacheCheck: 0,
      memorySearch: 0,
      validation: 0,
    };
    const totalStart = Date.now();

    // Phase 1: Intent Classification + Scoring
    const intentStart = Date.now();
    const intent = classifyIntent(message);
    const score = calculateMemoryScore(message, context);
    timing.intentClassification = Date.now() - intentStart;

    // Phase 2: Action Determination
    const action = determineAction(score, intent);

    // 메모리 불필요
    if (action === "skip") {
      timing.total = Date.now() - totalStart;
      return {
        memories: [],
        intent,
        score,
        action,
        cacheHit: false,
        timing,
      };
    }

    // Phase 3: Cache Check
    const cacheStart = Date.now();
    const cacheResult = await this.cache.get(message, context);
    timing.cacheCheck = Date.now() - cacheStart;

    if (cacheResult.hit && cacheResult.results) {
      // 캐시 히트 - 바로 검증 단계로
      const validationStart = Date.now();
      const validated = await this.validateMemories(cacheResult.results, message, context);
      timing.validation = Date.now() - validationStart;
      timing.total = Date.now() - totalStart;

      return {
        memories: validated,
        intent,
        score,
        action: "cache_check",
        cacheHit: true,
        timing,
      };
    }

    // Phase 4: Memory Search
    const searchStart = Date.now();
    let memories: CacheableMemory[];

    if (action === "graph_search" && this.graphManager) {
      memories = await this.searchWithGraph(message, intent, context);
    } else {
      memories = await this.searchMemories(message, intent, context);
    }
    timing.memorySearch = Date.now() - searchStart;

    // 캐시 업데이트
    if (memories.length > 0) {
      await this.cache.set(message, memories, context);
    }

    // Phase 5: Validation
    const validationStart = Date.now();
    const validated = await this.validateMemories(memories, message, context);
    timing.validation = Date.now() - validationStart;

    timing.total = Date.now() - totalStart;

    return {
      memories: validated,
      intent,
      score,
      action,
      cacheHit: false,
      timing,
    };
  }

  /**
   * 메모리 검색 (키워드/시맨틱)
   */
  private async searchMemories(
    message: string,
    intent: MemoryIntent,
    context: MessageContext
  ): Promise<CacheableMemory[]> {
    const strategy = getSearchStrategy(intent);
    const priorities = getSearchPriority(intent);

    if (priorities.length === 0) {
      return [];
    }

    // 키워드 추출
    const keywords = this.extractKeywords(message);

    // 파이프라인을 통해 검색
    const results = await this.pipeline.search.keywordSearch({
      query: keywords.join(" "),
      limit: strategy.maxResults,
    });

    return results.map((r) => ({
      id: r.id,
      content: r.title,
      category: this.inferCategory(r.entryType),
      confidence: r.score,
      source: "semantic" as const,
    }));
  }

  /**
   * 그래프 기반 검색
   */
  private async searchWithGraph(
    message: string,
    intent: MemoryIntent,
    context: MessageContext
  ): Promise<CacheableMemory[]> {
    if (!this.graphManager) {
      return this.searchMemories(message, intent, context);
    }

    const strategy = getSearchStrategy(intent);
    const keywords = this.extractKeywords(message);

    const results = await this.graphManager.traverse({
      startNodes: keywords,
      maxHops: strategy.maxHops || 2,
      limit: strategy.maxResults,
    });

    return results.map((r) => ({
      id: r.node.id,
      content: r.node.content,
      category: r.node.category,
      confidence: r.totalStrength,
      source: "graph" as const,
    }));
  }

  /**
   * 메모리 안전성 검증
   */
  private async validateMemories(
    memories: CacheableMemory[],
    message: string,
    context: MessageContext
  ): Promise<ValidatedMemory[]> {
    const validated: ValidatedMemory[] = [];

    for (const memory of memories) {
      const result = await this.safetyFilter.validateMemoryUse(
        {
          id: memory.id,
          content: memory.content,
          category: memory.category,
          createdAt: new Date(), // TODO: 실제 생성일 가져오기
          confidence: memory.confidence,
        },
        message,
        context
      );

      // skip이 아닌 것만 포함
      if (result.action !== "skip") {
        validated.push(result);
      }
    }

    // 접근 기록 업데이트
    for (const v of validated) {
      if (v.action === "use" || v.action === "soft_hint") {
        await this.pipeline.recordAccess(v.id).catch(() => {});
      }
    }

    return validated;
  }

  /**
   * 최근 메모리 후보 가져오기 (메타데이터만)
   */
  private async getRecentMemoryCandidates(
    userId: string | undefined,
    limit: number
  ): Promise<MemoryCandidate[]> {
    // TODO: 실제 구현에서는 DB에서 메타데이터만 가져오기
    // 현재는 빈 배열 반환
    return [];
  }

  /**
   * 사용자 프로필 요약 가져오기
   */
  private async getUserProfileSummary(
    userId: string | undefined
  ): Promise<PreloadedContext["userProfile"]> {
    // TODO: 실제 구현
    return undefined;
  }

  /**
   * 활성 프로젝트 가져오기
   */
  private async getActiveProjects(
    userId: string | undefined
  ): Promise<PreloadedContext["activeProjects"]> {
    // TODO: 실제 구현
    return [];
  }

  /**
   * 키워드 추출
   */
  private extractKeywords(message: string): string[] {
    const stopWords = new Set([
      "이", "그", "저", "것", "수", "등", "들", "및", "에", "의", "를", "을",
      "은", "는", "가", "이다", "있다", "하다", "되다",
      "a", "an", "the", "is", "are", "was", "were", "be", "to", "of", "in",
      "for", "on", "with", "at", "by", "from", "as",
    ]);

    return message
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !stopWords.has(word))
      .slice(0, 5);
  }

  /**
   * Entry 타입에서 카테고리 추론
   */
  private inferCategory(entryType: string): MemoryCategory {
    switch (entryType) {
      case "fact":
        return "profile";
      case "decision":
      case "task":
      case "reference":
        return "project";
      case "insight":
        return "ephemeral";
      default:
        return "ephemeral";
    }
  }

  /**
   * 프리로드된 컨텍스트에서 관련 메모리 찾기
   */
  getPreloadedContext(sessionId: string): PreloadedContext | undefined {
    return this.preloadedContexts.get(sessionId);
  }

  /**
   * 프리로드된 후보에서 빠른 매칭
   */
  findInPreloaded(
    sessionId: string,
    keywords: string[]
  ): MemoryCandidate[] {
    const context = this.preloadedContexts.get(sessionId);
    if (!context) return [];

    return context.memoryCandidates.filter((candidate) =>
      candidate.tags.some((tag) =>
        keywords.some((kw) => tag.toLowerCase().includes(kw.toLowerCase()))
      )
    );
  }
}

// === Light Context Generator ===

export interface LightContextOptions {
  /** 첫 메시지에만 도구 목록 포함 (기본: false) */
  includeToolsList?: boolean;
}

/**
 * 경량 메모리 컨텍스트 생성
 * 무거운 instruction 대신 필요시에만 도구 언급
 */
export function generateLightMemoryContext(
  preloaded?: PreloadedContext,
  recentMemories?: ValidatedMemory[],
  options?: LightContextOptions
): string {
  const parts: string[] = [];

  // 도구 존재 알림 (세션 첫 메시지에만)
  if (options?.includeToolsList) {
    parts.push(`## Memory Tools Available
- \`axiom_search\`: Search past memories when user asks about previous conversations
- \`axiom_save\`: Save important information when user explicitly requests
- \`axiom_recall\`: Recall specific session memories`);
  }

  // 프리로드된 프로필이 있으면 간단히 포함
  if (preloaded?.userProfile?.preferences && preloaded.userProfile.preferences.length > 0) {
    const prefs = preloaded.userProfile.preferences
      .slice(0, 5)
      .map((p) => `- ${p.preference}`)
      .join("\n");
    parts.push(`\n## User Context\n${prefs}`);
  }

  // 활성 프로젝트
  if (preloaded?.activeProjects && preloaded.activeProjects.length > 0) {
    const projects = preloaded.activeProjects
      .slice(0, 3)
      .map((p) => `- ${p.name}`)
      .join("\n");
    parts.push(`\n## Active Projects\n${projects}`);
  }

  // 현재 메시지에서 찾은 관련 메모리
  if (recentMemories && recentMemories.length > 0) {
    const memories = recentMemories
      .filter((m) => m.action === "use" || m.action === "soft_hint")
      .slice(0, 3)
      .map((m) => {
        if (m.action === "soft_hint" && m.useHint) {
          return `- ${m.content} ${m.useHint}`;
        }
        return `- ${m.content}`;
      })
      .join("\n");

    if (memories) {
      parts.push(`\n## Relevant Context\n${memories}`);
    }
  }

  return parts.join("\n");
}

/**
 * 확인 질문 생성
 */
export function generateConfirmationQuestions(memories: ValidatedMemory[]): string[] {
  return memories
    .filter((m) => m.action === "confirm" && m.confirmationQuestion)
    .map((m) => m.confirmationQuestion!);
}
