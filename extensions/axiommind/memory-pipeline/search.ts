/**
 * Memory Search
 *
 * 키워드 검색 및 시맨틱 검색 API
 */
import type { MemoryIndexer, SearchRowResult, DecisionWithEvidence, TaskWithContext } from "./indexer.js";
import type { SearchResult, SearchOptions, EntryType, AnyEntry, MemoryStage } from "./types.js";

export class MemorySearch {
  private indexer: MemoryIndexer;

  constructor(indexer: MemoryIndexer) {
    this.indexer = indexer;
  }

  /**
   * 키워드 기반 검색
   */
  async keywordSearch(options: SearchOptions): Promise<SearchResult[]> {
    const keywords = options.query.split(/\s+/).filter((k) => k.length > 0);
    if (keywords.length === 0) {
      return [];
    }

    const rows = await this.indexer.searchByKeyword(
      keywords,
      options.entryTypes,
      options.memoryStages
    );

    return rows.slice(0, options.limit || 10).map((row) => this.rowToSearchResult(row));
  }

  /**
   * 시맨틱 검색 (TODO: 벡터 검색 구현)
   *
   * 현재는 키워드 검색으로 대체
   */
  async semanticSearch(options: SearchOptions): Promise<SearchResult[]> {
    // TODO: LanceDB 또는 OpenAI 임베딩을 사용한 벡터 검색 구현
    // 현재는 키워드 검색으로 대체
    return this.keywordSearch(options);
  }

  /**
   * Decision과 연결된 Fact 조회
   */
  async getDecisionsWithEvidence(dateFrom?: string): Promise<DecisionWithEvidence[]> {
    return this.indexer.getDecisionsWithEvidence(dateFrom);
  }

  /**
   * 미완료 Task 조회
   */
  async getPendingTasks(): Promise<TaskWithContext[]> {
    return this.indexer.getPendingTasks();
  }

  /**
   * 특정 세션의 엔트리 조회
   */
  async getSessionEntries(sessionId: string): Promise<SearchResult[]> {
    const results = await this.indexer.searchByKeyword([sessionId]);
    return results
      .filter((r) => r.session_id === sessionId)
      .map((row) => this.rowToSearchResult(row));
  }

  private rowToSearchResult(row: SearchRowResult): SearchResult {
    const content = typeof row.content === "string" ? JSON.parse(row.content) : row.content;

    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      date: (row.session_date || row.date) as string,
      entryType: row.entry_type as EntryType,
      title: row.title as string,
      content: content as AnyEntry,
      score: 1.0, // 키워드 검색에서는 고정 점수
      idrPath: row.idr_path as string | undefined,
      memoryStage: (row.memory_stage as MemoryStage) || "working",
    };
  }
}
