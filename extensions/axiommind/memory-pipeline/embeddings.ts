/**
 * Vector Embeddings Module
 *
 * 다양한 임베딩 프로바이더 지원:
 * - OpenAI (text-embedding-3-small, text-embedding-ada-002)
 * - Cohere (embed-english-v3.0, embed-multilingual-v3.0)
 * - Local fallback (TF-IDF 기반)
 *
 * 기능:
 * - 임베딩 캐싱 (중복 API 호출 방지)
 * - 배치 처리 (여러 텍스트 한 번에 임베딩)
 * - 자동 폴백 (API 실패 시 로컬 임베딩)
 * - 코사인 유사도 계산
 */

// === Types ===

export interface EmbeddingVector {
  vector: number[];
  dimensions: number;
  model: string;
  tokens?: number;
}

export interface EmbeddingConfig {
  provider: "openai" | "cohere" | "local";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  cacheTTL: number; // ms
  maxBatchSize: number;
  enableFallback: boolean;
  dimensions?: number; // for dimension reduction
}

export interface EmbeddingProvider {
  name: string;
  embed(text: string): Promise<EmbeddingVector>;
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;
  isAvailable(): boolean;
}

export interface EmbeddingCacheEntry {
  vector: number[];
  model: string;
  timestamp: number;
  hash: string;
}

// === Constants ===

const DEFAULT_CONFIG: EmbeddingConfig = {
  provider: "local",
  cacheTTL: 24 * 60 * 60 * 1000, // 24시간
  maxBatchSize: 100,
  enableFallback: true,
};

const OPENAI_MODELS = {
  "text-embedding-3-small": { dimensions: 1536, maxTokens: 8191 },
  "text-embedding-3-large": { dimensions: 3072, maxTokens: 8191 },
  "text-embedding-ada-002": { dimensions: 1536, maxTokens: 8191 },
};

const COHERE_MODELS = {
  "embed-english-v3.0": { dimensions: 1024, maxTokens: 512 },
  "embed-multilingual-v3.0": { dimensions: 1024, maxTokens: 512 },
};

// === OpenAI Provider ===

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = "openai";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.model = config.model || "text-embedding-3-small";
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (!this.isAvailable()) {
      throw new Error("OpenAI API key not configured");
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      model: string;
      usage: { total_tokens: number };
    };

    const modelInfo = OPENAI_MODELS[this.model as keyof typeof OPENAI_MODELS] || {
      dimensions: 1536,
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => ({
        vector: item.embedding,
        dimensions: modelInfo.dimensions,
        model: data.model,
        tokens: Math.floor(data.usage.total_tokens / texts.length),
      }));
  }
}

// === Cohere Provider ===

class CohereEmbeddingProvider implements EmbeddingProvider {
  name = "cohere";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey || process.env.COHERE_API_KEY || "";
    this.model = config.model || "embed-multilingual-v3.0";
    this.baseUrl = config.baseUrl || "https://api.cohere.ai/v1";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (!this.isAvailable()) {
      throw new Error("Cohere API key not configured");
    }

    const response = await fetch(`${this.baseUrl}/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "Cohere-Version": "2024-01-01",
      },
      body: JSON.stringify({
        model: this.model,
        texts,
        input_type: "search_document",
        embedding_types: ["float"],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      embeddings: { float: number[][] };
      meta: { billed_units: { input_tokens: number } };
    };

    const modelInfo = COHERE_MODELS[this.model as keyof typeof COHERE_MODELS] || {
      dimensions: 1024,
    };

    return data.embeddings.float.map((embedding) => ({
      vector: embedding,
      dimensions: modelInfo.dimensions,
      model: this.model,
      tokens: Math.floor(data.meta.billed_units.input_tokens / texts.length),
    }));
  }
}

// === Local TF-IDF Provider (Fallback) ===

class LocalEmbeddingProvider implements EmbeddingProvider {
  name = "local";
  private vocabulary: Map<string, number> = new Map();
  private idfScores: Map<string, number> = new Map();
  private documentCount = 0;
  private dimensions = 256; // 고정 차원수

  constructor(config: EmbeddingConfig) {
    this.dimensions = config.dimensions || 256;
  }

  isAvailable(): boolean {
    return true; // 항상 사용 가능
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const vector = this.computeTfIdf(text);
    return {
      vector,
      dimensions: this.dimensions,
      model: "local-tfidf",
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    // 어휘 업데이트
    this.updateVocabulary(texts);

    return texts.map((text) => ({
      vector: this.computeTfIdf(text),
      dimensions: this.dimensions,
      model: "local-tfidf",
    }));
  }

  /**
   * 어휘 및 IDF 스코어 업데이트
   */
  private updateVocabulary(texts: string[]): void {
    const docFreq = new Map<string, number>();

    for (const text of texts) {
      const tokens = this.tokenize(text);
      const uniqueTokens = new Set(tokens);

      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);

        if (!this.vocabulary.has(token)) {
          const index = this.vocabulary.size % this.dimensions;
          this.vocabulary.set(token, index);
        }
      }
    }

    this.documentCount += texts.length;

    // IDF 스코어 업데이트
    for (const [token, freq] of docFreq) {
      const currentFreq = (this.idfScores.get(token) || 0) + freq;
      this.idfScores.set(token, Math.log(this.documentCount / (currentFreq + 1)) + 1);
    }
  }

  /**
   * TF-IDF 벡터 계산
   */
  private computeTfIdf(text: string): number[] {
    const tokens = this.tokenize(text);
    const vector = new Array(this.dimensions).fill(0);

    // Term Frequency 계산
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // TF-IDF 계산
    for (const [token, freq] of tf) {
      const index = this.vocabulary.get(token);
      if (index !== undefined) {
        const idf = this.idfScores.get(token) || 1;
        vector[index] += (freq / tokens.length) * idf;
      }
    }

    // L2 정규화
    return this.normalizeL2(vector);
  }

  /**
   * 토큰화
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  /**
   * L2 정규화
   */
  private normalizeL2(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vector;
    return vector.map((v) => v / magnitude);
  }
}

// === Embedding Manager ===

export class EmbeddingManager {
  private config: EmbeddingConfig;
  private provider: EmbeddingProvider;
  private fallbackProvider: LocalEmbeddingProvider;
  private cache: Map<string, EmbeddingCacheEntry> = new Map();

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 프로바이더 초기화
    switch (this.config.provider) {
      case "openai":
        this.provider = new OpenAIEmbeddingProvider(this.config);
        break;
      case "cohere":
        this.provider = new CohereEmbeddingProvider(this.config);
        break;
      case "local":
      default:
        this.provider = new LocalEmbeddingProvider(this.config);
    }

    // 폴백 프로바이더
    this.fallbackProvider = new LocalEmbeddingProvider(this.config);
  }

  /**
   * 단일 텍스트 임베딩
   */
  async embed(text: string): Promise<EmbeddingVector> {
    // 캐시 체크
    const hash = this.hashText(text);
    const cached = this.cache.get(hash);

    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return {
        vector: cached.vector,
        dimensions: cached.vector.length,
        model: cached.model,
      };
    }

    try {
      if (!this.provider.isAvailable() && this.config.enableFallback) {
        return this.fallbackProvider.embed(text);
      }

      const result = await this.provider.embed(text);

      // 캐시 저장
      this.cache.set(hash, {
        vector: result.vector,
        model: result.model,
        timestamp: Date.now(),
        hash,
      });

      return result;
    } catch (error) {
      if (this.config.enableFallback) {
        console.warn(`[Embeddings] Provider failed, using fallback: ${error}`);
        return this.fallbackProvider.embed(text);
      }
      throw error;
    }
  }

  /**
   * 배치 임베딩
   */
  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return [];

    // 캐시된 것과 아닌 것 분리
    const cached: Map<number, EmbeddingVector> = new Map();
    const uncached: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const hash = this.hashText(texts[i]);
      const entry = this.cache.get(hash);

      if (entry && Date.now() - entry.timestamp < this.config.cacheTTL) {
        cached.set(i, {
          vector: entry.vector,
          dimensions: entry.vector.length,
          model: entry.model,
        });
      } else {
        uncached.push({ index: i, text: texts[i] });
      }
    }

    // 캐시 안 된 것들 임베딩
    if (uncached.length > 0) {
      const uncachedTexts = uncached.map((u) => u.text);

      try {
        let results: EmbeddingVector[];

        if (!this.provider.isAvailable() && this.config.enableFallback) {
          results = await this.fallbackProvider.embedBatch(uncachedTexts);
        } else {
          // 배치 크기 제한
          const batches: string[][] = [];
          for (let i = 0; i < uncachedTexts.length; i += this.config.maxBatchSize) {
            batches.push(uncachedTexts.slice(i, i + this.config.maxBatchSize));
          }

          results = [];
          for (const batch of batches) {
            const batchResults = await this.provider.embedBatch(batch);
            results.push(...batchResults);
          }
        }

        // 결과 캐시 및 매핑
        for (let i = 0; i < uncached.length; i++) {
          const { index, text } = uncached[i];
          const result = results[i];

          cached.set(index, result);

          // 캐시 저장
          const hash = this.hashText(text);
          this.cache.set(hash, {
            vector: result.vector,
            model: result.model,
            timestamp: Date.now(),
            hash,
          });
        }
      } catch (error) {
        if (this.config.enableFallback) {
          console.warn(`[Embeddings] Provider failed, using fallback: ${error}`);
          const fallbackResults = await this.fallbackProvider.embedBatch(uncachedTexts);

          for (let i = 0; i < uncached.length; i++) {
            cached.set(uncached[i].index, fallbackResults[i]);
          }
        } else {
          throw error;
        }
      }
    }

    // 원래 순서대로 결과 반환
    return texts.map((_, i) => cached.get(i)!);
  }

  /**
   * 코사인 유사도 계산
   */
  cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error("Vectors must have same dimensions");
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * 유사한 텍스트 찾기
   */
  async findSimilar(
    query: string,
    candidates: string[],
    threshold: number = 0.7
  ): Promise<Array<{ text: string; similarity: number; index: number }>> {
    if (candidates.length === 0) return [];

    const [queryEmbedding, ...candidateEmbeddings] = await this.embedBatch([
      query,
      ...candidates,
    ]);

    const results: Array<{ text: string; similarity: number; index: number }> = [];

    for (let i = 0; i < candidateEmbeddings.length; i++) {
      const similarity = this.cosineSimilarity(
        queryEmbedding.vector,
        candidateEmbeddings[i].vector
      );

      if (similarity >= threshold) {
        results.push({
          text: candidates[i],
          similarity,
          index: i,
        });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * 캐시 클리어
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 캐시 통계
   */
  getCacheStats(): { size: number; oldestEntry: Date | null } {
    let oldestTimestamp = Infinity;

    for (const entry of this.cache.values()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      oldestEntry: oldestTimestamp !== Infinity ? new Date(oldestTimestamp) : null,
    };
  }

  /**
   * 프로바이더 정보
   */
  getProviderInfo(): { name: string; available: boolean; model?: string } {
    return {
      name: this.provider.name,
      available: this.provider.isAvailable(),
      model: this.config.model,
    };
  }

  // === Private Methods ===

  private hashText(text: string): string {
    const normalized = text.toLowerCase().trim();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `emb_${Math.abs(hash).toString(36)}`;
  }
}

// === Factory ===

let globalEmbeddingManager: EmbeddingManager | null = null;

export function getEmbeddingManager(config?: Partial<EmbeddingConfig>): EmbeddingManager {
  if (!globalEmbeddingManager) {
    globalEmbeddingManager = new EmbeddingManager(config);
  }
  return globalEmbeddingManager;
}

export function resetEmbeddingManager(): void {
  globalEmbeddingManager = null;
}
