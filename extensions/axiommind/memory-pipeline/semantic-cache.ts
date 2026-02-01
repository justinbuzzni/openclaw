/**
 * Semantic Cache
 *
 * 시맨틱 유사도 기반 캐싱으로 비용 최적화
 * - Vector similarity (cosine) 기반 캐시 히트
 * - Context-aware caching (대화 컨텍스트 포함)
 * - TTL 정책 (category별)
 *
 * v2.1 - Vector Embedding 통합
 * - OpenAI/Cohere 임베딩 지원
 * - 로컬 TF-IDF 폴백
 * - 임베딩 캐싱
 */

import type { MemoryCategory } from "./intent-router.js";
import type { SemanticFact, MemoryNode } from "./memory-tiers.js";
import { CACHE_TTL } from "./memory-tiers.js";
import { getEmbeddingManager, type EmbeddingConfig } from "./embeddings.js";

// === Types ===

export interface CachedResult {
  queryHash: string;
  queryText: string;
  contextHash: string;
  results: CacheableMemory[];
  category: MemoryCategory;
  timestamp: Date;
  hitCount: number;
  lastHit?: Date;
}

export interface CacheableMemory {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  source: "semantic" | "graph" | "episodic";
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  avgResponseTime: number;
  memorySizeBytes: number;
}

export interface SemanticCacheConfig {
  similarityThreshold: number; // 0.88 recommended
  maxEntries: number;
  cleanupIntervalMs: number;
  enableContextHashing: boolean;
  // v2.1: Vector Embedding 설정
  useVectorEmbeddings: boolean;
  embeddingConfig?: Partial<EmbeddingConfig>;
}

// === Semantic Cache Implementation ===

export class SemanticCache {
  private cache: Map<string, CachedResult> = new Map();
  private config: SemanticCacheConfig;
  private stats: CacheStats = {
    totalEntries: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: 0,
    avgResponseTime: 0,
    memorySizeBytes: 0,
  };
  private cleanupTimer?: ReturnType<typeof setInterval>;

  // v2.1: 쿼리 임베딩 캐시 (벡터 유사도용)
  private queryEmbeddings: Map<string, number[]> = new Map();

  constructor(config?: Partial<SemanticCacheConfig>) {
    this.config = {
      similarityThreshold: config?.similarityThreshold ?? 0.88,
      maxEntries: config?.maxEntries ?? 1000,
      cleanupIntervalMs: config?.cleanupIntervalMs ?? 60 * 60 * 1000, // 1시간
      enableContextHashing: config?.enableContextHashing ?? true,
      useVectorEmbeddings: config?.useVectorEmbeddings ?? false,
      embeddingConfig: config?.embeddingConfig,
    };

    // 정기 정리 시작
    this.startCleanupTimer();
  }

  /**
   * 캐시에서 유사한 쿼리 결과 검색
   */
  async get(
    query: string,
    context?: { messages?: Array<{ content: string }> }
  ): Promise<{ hit: boolean; results?: CacheableMemory[]; similarity?: number }> {
    const startTime = Date.now();
    const queryHash = this.hashQuery(query);
    const contextHash = this.hashContext(context);

    // 정확한 매치 먼저 시도
    const exactKey = `${queryHash}:${contextHash}`;
    if (this.cache.has(exactKey)) {
      const cached = this.cache.get(exactKey)!;

      // TTL 체크
      if (!this.isExpired(cached)) {
        cached.hitCount++;
        cached.lastHit = new Date();
        this.stats.hitCount++;
        this.updateStats(startTime);

        return { hit: true, results: cached.results, similarity: 1.0 };
      } else {
        // 만료된 캐시 삭제
        this.cache.delete(exactKey);
      }
    }

    // 시맨틱 유사도 기반 검색
    const similarMatch = await this.findSimilarQuery(query, contextHash);
    if (similarMatch) {
      similarMatch.cached.hitCount++;
      similarMatch.cached.lastHit = new Date();
      this.stats.hitCount++;
      this.updateStats(startTime);

      return {
        hit: true,
        results: similarMatch.cached.results,
        similarity: similarMatch.similarity,
      };
    }

    this.stats.missCount++;
    this.updateStats(startTime);
    return { hit: false };
  }

  /**
   * 캐시에 결과 저장
   */
  async set(
    query: string,
    results: CacheableMemory[],
    context?: { messages?: Array<{ content: string }> }
  ): Promise<void> {
    const queryHash = this.hashQuery(query);
    const contextHash = this.hashContext(context);
    const key = `${queryHash}:${contextHash}`;

    // 결과에서 카테고리 추출 (가장 빈번한 카테고리 사용)
    const category = this.getMostCommonCategory(results);

    const cached: CachedResult = {
      queryHash,
      queryText: query,
      contextHash,
      results,
      category,
      timestamp: new Date(),
      hitCount: 0,
    };

    // 최대 용량 체크
    if (this.cache.size >= this.config.maxEntries) {
      await this.evictLRU();
    }

    this.cache.set(key, cached);
    this.stats.totalEntries = this.cache.size;
    this.updateMemorySize();
  }

  /**
   * 특정 쿼리 캐시 무효화
   */
  invalidate(query: string, context?: { messages?: Array<{ content: string }> }): boolean {
    const queryHash = this.hashQuery(query);
    const contextHash = this.hashContext(context);
    const key = `${queryHash}:${contextHash}`;

    const existed = this.cache.has(key);
    this.cache.delete(key);
    this.stats.totalEntries = this.cache.size;

    return existed;
  }

  /**
   * 카테고리별 캐시 무효화
   */
  invalidateByCategory(category: MemoryCategory): number {
    let count = 0;
    for (const [key, cached] of this.cache.entries()) {
      if (cached.category === category) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.totalEntries = this.cache.size;
    return count;
  }

  /**
   * 전체 캐시 클리어
   */
  clear(): void {
    this.cache.clear();
    this.stats.totalEntries = 0;
    this.stats.hitCount = 0;
    this.stats.missCount = 0;
    this.stats.hitRate = 0;
    this.stats.memorySizeBytes = 0;
  }

  /**
   * 캐시 통계 조회
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 캐시 정리 (만료된 항목 제거)
   */
  async cleanup(): Promise<number> {
    let removed = 0;

    for (const [key, cached] of this.cache.entries()) {
      if (this.isExpired(cached)) {
        this.cache.delete(key);
        removed++;
      }
    }

    this.stats.totalEntries = this.cache.size;
    this.updateMemorySize();

    return removed;
  }

  /**
   * 리소스 정리
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cache.clear();
    this.queryEmbeddings.clear();
  }

  // === Private Methods ===

  /**
   * 시맨틱 유사도 기반 캐시 검색
   */
  private async findSimilarQuery(
    query: string,
    contextHash: string
  ): Promise<{ cached: CachedResult; similarity: number } | null> {
    // v2.1: Vector Embedding 사용 시
    if (this.config.useVectorEmbeddings) {
      return this.findSimilarQueryWithEmbeddings(query, contextHash);
    }

    // 기존 Jaccard 기반 검색
    const queryTokens = this.tokenize(query);

    let bestMatch: { cached: CachedResult; similarity: number } | null = null;

    for (const cached of this.cache.values()) {
      // 컨텍스트 해시가 다르면 스킵 (옵션에 따라)
      if (this.config.enableContextHashing && cached.contextHash !== contextHash) {
        continue;
      }

      // TTL 체크
      if (this.isExpired(cached)) {
        continue;
      }

      // 시맨틱 유사도 계산
      const cachedTokens = this.tokenize(cached.queryText);
      const similarity = this.calculateJaccardSimilarity(queryTokens, cachedTokens);

      if (similarity >= this.config.similarityThreshold) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { cached, similarity };
        }
      }
    }

    return bestMatch;
  }

  /**
   * v2.1: Vector Embedding 기반 유사 쿼리 검색
   */
  private async findSimilarQueryWithEmbeddings(
    query: string,
    contextHash: string
  ): Promise<{ cached: CachedResult; similarity: number } | null> {
    try {
      const embeddingManager = getEmbeddingManager(this.config.embeddingConfig);

      // 쿼리 임베딩 가져오기
      const queryEmbedding = await embeddingManager.embed(query);

      let bestMatch: { cached: CachedResult; similarity: number } | null = null;

      for (const [key, cached] of this.cache.entries()) {
        // 컨텍스트 해시가 다르면 스킵 (옵션에 따라)
        if (this.config.enableContextHashing && cached.contextHash !== contextHash) {
          continue;
        }

        // TTL 체크
        if (this.isExpired(cached)) {
          continue;
        }

        // 캐시된 쿼리의 임베딩 가져오기 (캐시에서 또는 계산)
        let cachedEmbedding = this.queryEmbeddings.get(key);
        if (!cachedEmbedding) {
          const embedding = await embeddingManager.embed(cached.queryText);
          cachedEmbedding = embedding.vector;
          this.queryEmbeddings.set(key, cachedEmbedding);
        }

        // 코사인 유사도 계산
        const similarity = embeddingManager.cosineSimilarity(
          queryEmbedding.vector,
          cachedEmbedding
        );

        if (similarity >= this.config.similarityThreshold) {
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { cached, similarity };
          }
        }
      }

      return bestMatch;
    } catch (error) {
      // 임베딩 실패 시 Jaccard 폴백
      console.warn(`[SemanticCache] Embedding failed, falling back to Jaccard: ${error}`);
      const queryTokens = this.tokenize(query);
      let bestMatch: { cached: CachedResult; similarity: number } | null = null;

      for (const cached of this.cache.values()) {
        if (this.config.enableContextHashing && cached.contextHash !== contextHash) {
          continue;
        }
        if (this.isExpired(cached)) {
          continue;
        }

        const cachedTokens = this.tokenize(cached.queryText);
        const similarity = this.calculateJaccardSimilarity(queryTokens, cachedTokens);

        if (similarity >= this.config.similarityThreshold) {
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { cached, similarity };
          }
        }
      }

      return bestMatch;
    }
  }

  /**
   * 쿼리 해시 생성
   */
  private hashQuery(query: string): string {
    // 간단한 해시 함수 (실제 프로덕션에서는 더 강력한 해시 사용)
    const normalized = query.toLowerCase().trim();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit integer로 변환
    }
    return `q_${Math.abs(hash).toString(36)}`;
  }

  /**
   * 컨텍스트 해시 생성
   */
  private hashContext(context?: { messages?: Array<{ content: string }> }): string {
    if (!context?.messages || context.messages.length === 0) {
      return "no_context";
    }

    // 최근 3개 메시지만 사용
    const recentMessages = context.messages.slice(-3);
    const contextText = recentMessages
      .map((m) => (typeof m.content === "string" ? m.content.slice(0, 100) : ""))
      .join("|");

    let hash = 0;
    for (let i = 0; i < contextText.length; i++) {
      const char = contextText.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `c_${Math.abs(hash).toString(36)}`;
  }

  /**
   * 토큰화
   */
  private tokenize(text: string): Set<string> {
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    return new Set(tokens);
  }

  /**
   * Jaccard 유사도 계산
   */
  private calculateJaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 1;
    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * 캐시 만료 여부 확인
   */
  private isExpired(cached: CachedResult): boolean {
    const ttl = CACHE_TTL[cached.category];
    if (ttl === Infinity) return false;

    const age = Date.now() - cached.timestamp.getTime();
    return age > ttl;
  }

  /**
   * LRU 기반 eviction
   */
  private async evictLRU(): Promise<void> {
    // 마지막 히트 시간 기준으로 가장 오래된 항목 찾기
    let oldest: { key: string; time: number } | null = null;

    for (const [key, cached] of this.cache.entries()) {
      const time = cached.lastHit?.getTime() ?? cached.timestamp.getTime();
      if (!oldest || time < oldest.time) {
        oldest = { key, time };
      }
    }

    if (oldest) {
      this.cache.delete(oldest.key);
    }
  }

  /**
   * 가장 빈번한 카테고리 추출
   */
  private getMostCommonCategory(results: CacheableMemory[]): MemoryCategory {
    if (results.length === 0) return "ephemeral";

    const counts: Record<MemoryCategory, number> = {
      profile: 0,
      project: 0,
      ephemeral: 0,
    };

    for (const result of results) {
      counts[result.category]++;
    }

    let max: MemoryCategory = "ephemeral";
    let maxCount = 0;

    for (const [category, count] of Object.entries(counts)) {
      if (count > maxCount) {
        max = category as MemoryCategory;
        maxCount = count;
      }
    }

    return max;
  }

  /**
   * 통계 업데이트
   */
  private updateStats(startTime: number): void {
    const elapsed = Date.now() - startTime;
    const total = this.stats.hitCount + this.stats.missCount;

    if (total > 0) {
      this.stats.hitRate = this.stats.hitCount / total;
      // Exponential moving average for response time
      this.stats.avgResponseTime = this.stats.avgResponseTime * 0.9 + elapsed * 0.1;
    }
  }

  /**
   * 메모리 사용량 추정
   */
  private updateMemorySize(): void {
    let size = 0;
    for (const cached of this.cache.values()) {
      size += cached.queryText.length * 2; // UTF-16
      size += cached.contextHash.length * 2;
      size += JSON.stringify(cached.results).length * 2;
      size += 100; // 메타데이터 추정
    }
    this.stats.memorySizeBytes = size;
  }

  /**
   * 정기 정리 타이머 시작
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(() => {
        // 정리 실패 무시
      });
    }, this.config.cleanupIntervalMs);
  }
}

// === Factory ===

let globalCache: SemanticCache | null = null;

/**
 * 전역 캐시 인스턴스 가져오기
 */
export function getSemanticCache(config?: Partial<SemanticCacheConfig>): SemanticCache {
  if (!globalCache) {
    globalCache = new SemanticCache(config);
  }
  return globalCache;
}

/**
 * 전역 캐시 리셋 (테스트용)
 */
export function resetSemanticCache(): void {
  if (globalCache) {
    globalCache.destroy();
    globalCache = null;
  }
}
