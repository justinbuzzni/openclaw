/**
 * Auto Promotion Scheduler
 *
 * 백그라운드에서 메모리 승격/강등을 자동으로 처리하는 스케줄러
 *
 * 기능:
 * - 주기적 승격 체크 (L2→L3→L4)
 * - 미사용 메모리 강등 (L4→L3)
 * - 메모리 통합 (ephemeral → profile 패턴 감지)
 * - 그래프 정리 (orphan 노드 제거)
 */

import type { Database } from "better-sqlite3";
import type { GraduationManager } from "./graduation.js";
import type { MemoryGraphManager } from "./memory-graph.js";
import type { MemoryPipeline } from "./orchestrator.js";
import type { PromotionResult } from "./types.js";

// === Types ===

export interface SchedulerConfig {
  // 승격 체크 주기 (ms) - 기본 1시간
  promotionCheckInterval: number;
  // 메모리 통합 주기 (ms) - 기본 6시간
  consolidationInterval: number;
  // 그래프 정리 주기 (ms) - 기본 24시간
  graphCleanupInterval: number;
  // 최대 동시 작업 수
  maxConcurrentJobs: number;
  // 활성화 여부
  enabled: boolean;
}

export interface SchedulerStats {
  lastPromotionCheck: Date | null;
  lastConsolidation: Date | null;
  lastGraphCleanup: Date | null;
  totalPromotions: number;
  totalDemotions: number;
  totalConsolidations: number;
  isRunning: boolean;
}

export interface ConsolidationCandidate {
  pattern: string;
  entries: Array<{ id: string; content: string }>;
  confidence: number;
}

// === Default Config ===

const DEFAULT_CONFIG: SchedulerConfig = {
  promotionCheckInterval: 60 * 60 * 1000, // 1시간
  consolidationInterval: 6 * 60 * 60 * 1000, // 6시간
  graphCleanupInterval: 24 * 60 * 60 * 1000, // 24시간
  maxConcurrentJobs: 3,
  enabled: true,
};

// === Auto Promotion Scheduler ===

export class AutoPromotionScheduler {
  private pipeline: MemoryPipeline;
  private config: SchedulerConfig;
  private stats: SchedulerStats;

  // Timer handles
  private promotionTimer: NodeJS.Timeout | null = null;
  private consolidationTimer: NodeJS.Timeout | null = null;
  private graphCleanupTimer: NodeJS.Timeout | null = null;

  // Lock flags
  private isPromotionRunning = false;
  private isConsolidationRunning = false;
  private isGraphCleanupRunning = false;

  constructor(pipeline: MemoryPipeline, config: Partial<SchedulerConfig> = {}) {
    this.pipeline = pipeline;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      lastPromotionCheck: null,
      lastConsolidation: null,
      lastGraphCleanup: null,
      totalPromotions: 0,
      totalDemotions: 0,
      totalConsolidations: 0,
      isRunning: false,
    };
  }

  /**
   * 스케줄러 시작
   */
  start(): void {
    if (!this.config.enabled) {
      console.log("[AutoScheduler] Scheduler is disabled");
      return;
    }

    if (this.stats.isRunning) {
      console.log("[AutoScheduler] Scheduler is already running");
      return;
    }

    console.log("[AutoScheduler] Starting scheduler...");
    this.stats.isRunning = true;

    // 승격 체크 스케줄
    this.promotionTimer = setInterval(
      () => this.runPromotionCheck(),
      this.config.promotionCheckInterval
    );

    // 메모리 통합 스케줄
    this.consolidationTimer = setInterval(
      () => this.runConsolidation(),
      this.config.consolidationInterval
    );

    // 그래프 정리 스케줄
    this.graphCleanupTimer = setInterval(
      () => this.runGraphCleanup(),
      this.config.graphCleanupInterval
    );

    // 시작 시 즉시 한 번 실행 (5초 후)
    setTimeout(() => this.runPromotionCheck(), 5000);

    console.log("[AutoScheduler] Scheduler started with intervals:", {
      promotionCheck: `${this.config.promotionCheckInterval / 1000 / 60}min`,
      consolidation: `${this.config.consolidationInterval / 1000 / 60 / 60}h`,
      graphCleanup: `${this.config.graphCleanupInterval / 1000 / 60 / 60}h`,
    });
  }

  /**
   * 스케줄러 중지
   */
  stop(): void {
    console.log("[AutoScheduler] Stopping scheduler...");

    if (this.promotionTimer) {
      clearInterval(this.promotionTimer);
      this.promotionTimer = null;
    }
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
    if (this.graphCleanupTimer) {
      clearInterval(this.graphCleanupTimer);
      this.graphCleanupTimer = null;
    }

    this.stats.isRunning = false;
    console.log("[AutoScheduler] Scheduler stopped");
  }

  /**
   * 통계 조회
   */
  getStats(): SchedulerStats {
    return { ...this.stats };
  }

  /**
   * 수동으로 승격 체크 실행
   */
  async triggerPromotionCheck(): Promise<PromotionResult[]> {
    return this.runPromotionCheck();
  }

  /**
   * 수동으로 메모리 통합 실행
   */
  async triggerConsolidation(): Promise<number> {
    return this.runConsolidation();
  }

  // === Private Methods ===

  /**
   * 승격 체크 실행
   */
  private async runPromotionCheck(): Promise<PromotionResult[]> {
    if (this.isPromotionRunning) {
      console.log("[AutoScheduler] Promotion check already running, skipping");
      return [];
    }

    this.isPromotionRunning = true;
    const startTime = Date.now();

    try {
      console.log("[AutoScheduler] Running promotion check...");

      const graduation = this.pipeline.graduation;
      if (!graduation) {
        console.warn("[AutoScheduler] GraduationManager not available");
        return [];
      }

      const results = await graduation.checkAutoPromotions();

      // 통계 업데이트
      this.stats.lastPromotionCheck = new Date();
      for (const result of results) {
        if (result.success) {
          if (this.isPromotion(result)) {
            this.stats.totalPromotions++;
          } else {
            this.stats.totalDemotions++;
          }
        }
      }

      const successCount = results.filter((r) => r.success).length;
      console.log(
        `[AutoScheduler] Promotion check completed in ${Date.now() - startTime}ms: ` +
          `${successCount}/${results.length} successful`
      );

      return results;
    } catch (error) {
      console.error("[AutoScheduler] Promotion check failed:", error);
      return [];
    } finally {
      this.isPromotionRunning = false;
    }
  }

  /**
   * 메모리 통합 실행
   * ephemeral 메모리들 중 반복되는 패턴을 profile로 승격
   */
  private async runConsolidation(): Promise<number> {
    if (this.isConsolidationRunning) {
      console.log("[AutoScheduler] Consolidation already running, skipping");
      return 0;
    }

    this.isConsolidationRunning = true;
    const startTime = Date.now();

    try {
      console.log("[AutoScheduler] Running memory consolidation...");

      const candidates = this.findConsolidationCandidates();
      let consolidatedCount = 0;

      for (const candidate of candidates) {
        if (candidate.confidence >= 0.7) {
          const success = this.consolidateMemories(candidate);
          if (success) {
            consolidatedCount++;
          }
        }
      }

      this.stats.lastConsolidation = new Date();
      this.stats.totalConsolidations += consolidatedCount;

      console.log(
        `[AutoScheduler] Consolidation completed in ${Date.now() - startTime}ms: ` +
          `${consolidatedCount} patterns consolidated`
      );

      return consolidatedCount;
    } catch (error) {
      console.error("[AutoScheduler] Consolidation failed:", error);
      return 0;
    } finally {
      this.isConsolidationRunning = false;
    }
  }

  /**
   * 그래프 정리 실행
   */
  private async runGraphCleanup(): Promise<void> {
    if (this.isGraphCleanupRunning) {
      console.log("[AutoScheduler] Graph cleanup already running, skipping");
      return;
    }

    this.isGraphCleanupRunning = true;
    const startTime = Date.now();

    try {
      console.log("[AutoScheduler] Running graph cleanup...");

      const db = this.pipeline.indexer?.getDatabase?.() as Database | undefined;
      if (!db) {
        console.warn("[AutoScheduler] Database not available for graph cleanup");
        return;
      }

      // Orphan 노드 제거 (연결된 엣지가 없고 30일 이상 된 노드)
      this.removeOrphanNodes(db);

      // 약한 엣지 정리 (strength < 0.1이고 30일 이상 미사용)
      this.removeWeakEdges(db);

      this.stats.lastGraphCleanup = new Date();

      console.log(`[AutoScheduler] Graph cleanup completed in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error("[AutoScheduler] Graph cleanup failed:", error);
    } finally {
      this.isGraphCleanupRunning = false;
    }
  }

  /**
   * 통합 후보 찾기
   */
  private findConsolidationCandidates(): ConsolidationCandidate[] {
    const db = this.pipeline.indexer?.getDatabase?.() as Database | undefined;
    if (!db) {
      return [];
    }

    // 유사한 ephemeral 메모리들을 그룹화
    const rows = db
      .prepare(
        `
        SELECT
          e1.id as id1,
          e1.content as content1,
          e2.id as id2,
          e2.content as content2
        FROM entries e1
        JOIN entries e2 ON e1.id < e2.id
        WHERE e1.entry_type = 'fact'
          AND e2.entry_type = 'fact'
          AND COALESCE(e1.memory_stage, 'working') IN ('working', 'candidate')
          AND COALESCE(e2.memory_stage, 'working') IN ('working', 'candidate')
          AND e1.created_at > datetime('now', '-30 days')
          AND e2.created_at > datetime('now', '-30 days')
        LIMIT 100
      `
      )
      .all() as Array<Record<string, unknown>>;

    // 간단한 유사도 기반 그룹화
    return this.groupSimilarEntries(rows);
  }

  /**
   * 유사한 엔트리들을 그룹화
   */
  private groupSimilarEntries(rows: Array<Record<string, unknown>>): ConsolidationCandidate[] {
    const groups = new Map<string, Set<string>>();
    const contents = new Map<string, string>();

    for (const row of rows) {
      const id1 = row.id1 as string;
      const id2 = row.id2 as string;
      const content1 = row.content1 as string;
      const content2 = row.content2 as string;

      contents.set(id1, content1);
      contents.set(id2, content2);

      // 간단한 키워드 유사도 체크
      const similarity = this.calculateSimilarity(content1, content2);
      if (similarity >= 0.6) {
        // 그룹 찾기 또는 생성
        let foundGroup: string | null = null;
        for (const [key, group] of groups.entries()) {
          if (group.has(id1) || group.has(id2)) {
            foundGroup = key;
            break;
          }
        }

        if (foundGroup) {
          groups.get(foundGroup)!.add(id1);
          groups.get(foundGroup)!.add(id2);
        } else {
          const newGroup = new Set([id1, id2]);
          groups.set(id1, newGroup);
        }
      }
    }

    // 그룹을 ConsolidationCandidate로 변환
    const candidates: ConsolidationCandidate[] = [];
    for (const group of groups.values()) {
      if (group.size >= 3) {
        // 최소 3개 이상의 유사 메모리
        const entries = Array.from(group).map((id) => ({
          id,
          content: contents.get(id) || "",
        }));

        // 패턴 추출 (가장 많이 나타나는 키워드)
        const pattern = this.extractPattern(entries.map((e) => e.content));

        candidates.push({
          pattern,
          entries,
          confidence: Math.min(1, group.size / 5), // 5개 이상이면 confidence 1
        });
      }
    }

    return candidates;
  }

  /**
   * 간단한 유사도 계산 (Jaccard)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const tokens1 = this.tokenize(text1);
    const tokens2 = this.tokenize(text2);

    const intersection = new Set([...tokens1].filter((x) => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 토큰화
   */
  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s가-힣]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1)
    );
  }

  /**
   * 패턴 추출
   */
  private extractPattern(contents: string[]): string {
    const wordCounts = new Map<string, number>();

    for (const content of contents) {
      const tokens = this.tokenize(content);
      for (const token of tokens) {
        wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
      }
    }

    // 가장 많이 나타나는 단어들
    const sortedWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    return sortedWords.join(" ");
  }

  /**
   * 메모리 통합 실행
   */
  private consolidateMemories(candidate: ConsolidationCandidate): boolean {
    const db = this.pipeline.indexer?.getDatabase?.() as Database | undefined;
    if (!db) {
      return false;
    }

    try {
      // 가장 최근 엔트리를 대표로 선택하고 나머지는 연결
      const representativeId = candidate.entries[0].id;
      const otherIds = candidate.entries.slice(1).map((e) => e.id);

      // 트랜잭션으로 처리
      const transaction = db.transaction(() => {
        // 대표 엔트리를 profile 카테고리로 업그레이드
        db.prepare(
          `
          UPDATE entries
          SET memory_stage = 'verified',
              promotion_reason = 'consolidation',
              promoted_at = datetime('now')
          WHERE id = ?
        `
        ).run(representativeId);

        // 다른 엔트리들은 대표 엔트리를 참조하도록 표시
        const updateOther = db.prepare(
          `
          UPDATE entries
          SET consolidated_into = ?,
              memory_stage = 'archived'
          WHERE id = ?
        `
        );

        for (const otherId of otherIds) {
          updateOther.run(representativeId, otherId);
        }
      });

      transaction();

      console.log(
        `[AutoScheduler] Consolidated ${candidate.entries.length} memories into ${representativeId}`
      );
      return true;
    } catch (error) {
      console.error("[AutoScheduler] Failed to consolidate:", error);
      return false;
    }
  }

  /**
   * Orphan 노드 제거
   */
  private removeOrphanNodes(db: Database): number {
    const result = db
      .prepare(
        `
        DELETE FROM memory_nodes
        WHERE id NOT IN (
          SELECT source_id FROM memory_edges
          UNION
          SELECT target_id FROM memory_edges
        )
        AND created_at < datetime('now', '-30 days')
      `
      )
      .run();

    return result.changes;
  }

  /**
   * 약한 엣지 제거
   */
  private removeWeakEdges(db: Database): number {
    const result = db
      .prepare(
        `
        DELETE FROM memory_edges
        WHERE strength < 0.1
        AND last_confirmed < datetime('now', '-30 days')
      `
      )
      .run();

    return result.changes;
  }

  /**
   * 승격인지 강등인지 확인
   */
  private isPromotion(result: PromotionResult): boolean {
    const stageOrder = ["raw", "working", "candidate", "verified", "certified"];
    const fromIndex = stageOrder.indexOf(result.fromStage);
    const toIndex = stageOrder.indexOf(result.toStage);
    return toIndex > fromIndex;
  }
}

// === Factory ===

let globalScheduler: AutoPromotionScheduler | null = null;

export function getAutoScheduler(
  pipeline: MemoryPipeline,
  config?: Partial<SchedulerConfig>
): AutoPromotionScheduler {
  if (!globalScheduler) {
    globalScheduler = new AutoPromotionScheduler(pipeline, config);
  }
  return globalScheduler;
}

export function stopAutoScheduler(): void {
  if (globalScheduler) {
    globalScheduler.stop();
    globalScheduler = null;
  }
}
