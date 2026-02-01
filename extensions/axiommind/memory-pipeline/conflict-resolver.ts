/**
 * Conflict Resolver
 *
 * 메모리 엔트리 간 충돌을 감지하고 해결
 */

import type * as duckdb from "duckdb";
import type { AnyEntry, Conflict, ConflictType } from "./types.js";

// 충돌 해결 결과
export interface Resolution {
  conflictId: string;
  action: "keep_newer" | "keep_older" | "merge" | "manual";
  resolvedEntryId?: string;
  notes?: string;
}

// 유사도 결과
export interface SimilarityResult {
  entryId: string;
  similarity: number;
  entry: AnyEntry;
}

export class ConflictResolver {
  private db: duckdb.Database;

  constructor(db: duckdb.Database) {
    this.db = db;
  }

  /**
   * 새 엔트리와 기존 엔트리 간 충돌 감지
   */
  async detectConflicts(entry: AnyEntry, entryId: string): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // 같은 타입의 유사한 엔트리 검색
    const similarEntries = await this.findSimilarEntries(entry);

    for (const similar of similarEntries) {
      if (similar.entryId === entryId) continue; // 자기 자신 제외

      const conflictType = this.classifyConflict(entry, similar.entry, similar.similarity);

      if (conflictType) {
        const conflict: Conflict = {
          id: `conflict-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          entryId1: entryId,
          entryId2: similar.entryId,
          conflictType: conflictType,
          detectedAt: new Date().toISOString(),
        };

        conflicts.push(conflict);

        // DB에 충돌 기록
        await this.recordConflict(conflict);
      }
    }

    return conflicts;
  }

  /**
   * 충돌 유형 분류
   */
  classifyConflict(
    entry1: AnyEntry,
    entry2: AnyEntry,
    similarity: number
  ): ConflictType | null {
    // 타입이 다르면 충돌 아님
    if (entry1.type !== entry2.type) return null;

    // 높은 유사도 (>0.9): 중복일 가능성
    if (similarity > 0.9) {
      return "duplicate";
    }

    // 중간 유사도 (0.7-0.9): 내용 비교 필요
    if (similarity > 0.7) {
      // Fact 또는 Decision인 경우 contradiction 체크
      if (entry1.type === "fact" || entry1.type === "decision") {
        const title1 = (entry1 as { title: string }).title.toLowerCase();
        const title2 = (entry2 as { title: string }).title.toLowerCase();

        // 제목이 유사하지만 내용이 다른 경우
        if (this.calculateSimpleSimilarity(title1, title2) > 0.8) {
          // 날짜 비교로 outdated 판단
          // (실제로는 entry의 created_at을 비교해야 함)
          return "outdated";
        }

        // 상반되는 키워드 체크
        if (this.hasContradictoryContent(entry1, entry2)) {
          return "contradiction";
        }
      }

      return "duplicate";
    }

    return null;
  }

  /**
   * 상반되는 내용 체크
   */
  private hasContradictoryContent(entry1: AnyEntry, entry2: AnyEntry): boolean {
    const contradictionPairs = [
      ["좋아", "싫어"],
      ["like", "dislike"],
      ["prefer", "avoid"],
      ["선호", "기피"],
      ["긍정", "부정"],
      ["positive", "negative"],
      ["always", "never"],
      ["항상", "절대"],
      ["true", "false"],
      ["yes", "no"],
    ];

    const text1 = JSON.stringify(entry1).toLowerCase();
    const text2 = JSON.stringify(entry2).toLowerCase();

    for (const [word1, word2] of contradictionPairs) {
      if (
        (text1.includes(word1) && text2.includes(word2)) ||
        (text1.includes(word2) && text2.includes(word1))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 자동 해결 시도
   */
  async autoResolve(conflict: Conflict): Promise<Resolution | null> {
    // 중복인 경우: 최신 것 유지
    if (conflict.conflictType === "duplicate") {
      return {
        conflictId: conflict.id,
        action: "keep_newer",
        notes: "Automatically resolved: keeping newer duplicate",
      };
    }

    // outdated인 경우: 최신 것 유지
    if (conflict.conflictType === "outdated") {
      return {
        conflictId: conflict.id,
        action: "keep_newer",
        notes: "Automatically resolved: keeping updated information",
      };
    }

    // contradiction은 자동 해결 불가
    if (conflict.conflictType === "contradiction") {
      return null;
    }

    return null;
  }

  /**
   * 수동 해결 대기열에 추가
   */
  async queueForManualResolution(conflict: Conflict): Promise<void> {
    // 이미 DB에 기록되어 있으므로 추가 처리 불필요
    // UI에서 미해결 충돌 목록을 조회하여 표시
  }

  /**
   * 충돌 해결 기록
   */
  async resolveConflict(
    conflictId: string,
    resolution: string,
    keepEntryId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        UPDATE conflicts
        SET resolved_at = CURRENT_TIMESTAMP, resolution = ?
        WHERE id = ?
      `,
        resolution,
        conflictId,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 유사한 엔트리 검색
   */
  async findSimilarEntries(entry: AnyEntry, minSimilarity: number = 0.6): Promise<SimilarityResult[]> {
    const results: SimilarityResult[] = [];

    // 같은 타입의 엔트리만 검색
    const rows = await this.runSelect(
      `
      SELECT id, content, title
      FROM entries
      WHERE entry_type = ?
      ORDER BY created_at DESC
      LIMIT 100
    `,
      [entry.type]
    );

    const entryText = this.entryToText(entry);

    for (const row of rows) {
      const storedEntry = JSON.parse(row.content as string) as AnyEntry;
      const storedText = this.entryToText(storedEntry);

      const similarity = this.calculateSimpleSimilarity(entryText, storedText);

      if (similarity >= minSimilarity) {
        results.push({
          entryId: row.id as string,
          similarity,
          entry: storedEntry,
        });
      }
    }

    // 유사도 내림차순 정렬
    return results.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * 단순 유사도 계산 (Jaccard similarity)
   */
  private calculateSimpleSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * 엔트리를 텍스트로 변환
   */
  private entryToText(entry: AnyEntry): string {
    switch (entry.type) {
      case "fact":
        return `${entry.title} ${entry.evidence || ""}`;
      case "decision":
        return `${entry.title} ${entry.rationale || ""}`;
      case "insight":
        return `${entry.observation} ${entry.implication}`;
      case "task":
        return entry.title;
      case "reference":
        return `${entry.path} ${entry.description || ""}`;
      default:
        return JSON.stringify(entry);
    }
  }

  /**
   * 충돌 기록
   */
  private async recordConflict(conflict: Conflict): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        INSERT INTO conflicts (id, entry_id_1, entry_id_2, conflict_type, detected_at)
        VALUES (?, ?, ?, ?, ?)
      `,
        conflict.id,
        conflict.entryId1,
        conflict.entryId2,
        conflict.conflictType,
        conflict.detectedAt,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 미해결 충돌 목록 조회
   */
  async getUnresolvedConflicts(): Promise<Conflict[]> {
    const rows = await this.runSelect(`
      SELECT id, entry_id_1, entry_id_2, conflict_type, detected_at
      FROM conflicts
      WHERE resolved_at IS NULL
      ORDER BY detected_at DESC
    `);

    return rows.map((row) => ({
      id: row.id as string,
      entryId1: row.entry_id_1 as string,
      entryId2: row.entry_id_2 as string,
      conflictType: row.conflict_type as ConflictType,
      detectedAt: row.detected_at as string,
    }));
  }

  private runSelect(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, ...params, (err: Error | null, rows: Record<string, unknown>[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}
