/**
 * Memory Graduation Manager
 *
 * Memory Graduation Pipeline의 승격/강등 로직 관리
 * L0 (Raw) -> L1 (Working) -> L2 (Candidate) -> L3 (Verified) -> L4 (Certified)
 *
 * Idris GraduationSchema.idr과 동기화
 */
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  MemoryStage,
  PromotionReason,
  DemotionReason,
  PromotionResult,
  PromotionRecord,
  GraduationStats,
  Conflict,
  ConflictType,
  AnyEntry,
} from "./types.js";
import { canPromote, canDemote, isValidForStage } from "./types.js";

// 승격 조건 상수
const PROMOTION_CONFIG = {
  // L2 -> L3: 일수 경과
  DAYS_FOR_VERIFIED: 7,
  // L2 -> L3: 확인 횟수
  CONFIRMATION_COUNT_FOR_VERIFIED: 3,
  // L3 -> L4: 일수 경과
  DAYS_FOR_CERTIFIED: 30,
  // L4 -> L3: 미사용 일수
  DAYS_FOR_DEMOTION: 90,
};

export class GraduationManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // === 승격 메서드 ===

  /**
   * L1 (Working) -> L2 (Candidate): Idris 컴파일 성공 시
   */
  async promoteToCandidate(entryId: string): Promise<PromotionResult> {
    return this.promote(entryId, "working", "candidate", "compile_success");
  }

  /**
   * L2 (Candidate) -> L3 (Verified): 확인 조건 충족 시
   */
  async promoteToVerified(entryId: string, reason: PromotionReason): Promise<PromotionResult> {
    // 추가 검증: Verified 레벨 요구사항 확인
    const entry = this.getEntry(entryId);
    if (entry) {
      const content = JSON.parse(entry.content as string) as AnyEntry;
      const validation = isValidForStage("verified", content);
      if (!validation.valid) {
        return {
          success: false,
          entryId,
          fromStage: "candidate",
          toStage: "verified",
          reason,
          message: validation.error,
        };
      }
    }

    return this.promote(entryId, "candidate", "verified", reason);
  }

  /**
   * L3 (Verified) -> L4 (Certified): 장기 안정 조건 충족 시
   */
  async promoteToCertified(entryId: string): Promise<PromotionResult> {
    // 충돌 확인
    const hasConflict = this.hasUnresolvedConflict(entryId);
    if (hasConflict) {
      return {
        success: false,
        entryId,
        fromStage: "verified",
        toStage: "certified",
        reason: "time_elapsed",
        message: "Entry has unresolved conflicts",
      };
    }

    return this.promote(entryId, "verified", "certified", "time_elapsed");
  }

  /**
   * 수동 승격 (사용자 액션)
   */
  async promoteManually(entryId: string, targetStage: MemoryStage): Promise<PromotionResult> {
    const entry = this.getEntry(entryId);
    if (!entry) {
      return {
        success: false,
        entryId,
        fromStage: "working",
        toStage: targetStage,
        reason: "user_action",
        message: "Entry not found",
      };
    }

    const currentStage = entry.memory_stage as MemoryStage;
    if (!canPromote(currentStage, targetStage)) {
      return {
        success: false,
        entryId,
        fromStage: currentStage,
        toStage: targetStage,
        reason: "user_action",
        message: `Cannot promote from ${currentStage} to ${targetStage}`,
      };
    }

    // 타겟 Stage 유효성 검증
    const content = JSON.parse(entry.content as string) as AnyEntry;
    const validation = isValidForStage(targetStage, content);
    if (!validation.valid) {
      return {
        success: false,
        entryId,
        fromStage: currentStage,
        toStage: targetStage,
        reason: "user_action",
        message: validation.error,
      };
    }

    return this.promote(entryId, currentStage, targetStage, "user_action");
  }

  // === 강등 메서드 ===

  /**
   * 역방향 강등
   */
  async demote(entryId: string, reason: DemotionReason): Promise<PromotionResult> {
    const entry = this.getEntry(entryId);
    if (!entry) {
      return {
        success: false,
        entryId,
        fromStage: "working",
        toStage: "working",
        reason: "user_action",
        message: "Entry not found",
      };
    }

    const currentStage = entry.memory_stage as MemoryStage;
    let targetStage: MemoryStage;

    // 강등 경로 결정
    switch (currentStage) {
      case "certified":
        targetStage = "verified";
        break;
      case "verified":
        targetStage = "candidate";
        break;
      case "candidate":
        targetStage = "working";
        break;
      default:
        return {
          success: false,
          entryId,
          fromStage: currentStage,
          toStage: currentStage,
          reason: "user_action",
          message: `Cannot demote from ${currentStage}`,
        };
    }

    return this.updateStage(entryId, currentStage, targetStage, reason as unknown as PromotionReason);
  }

  // === 자동 승격 체크 ===

  /**
   * 자동 승격 대상 확인 및 승격 실행
   * 스케줄러에서 주기적으로 호출
   */
  async checkAutoPromotions(): Promise<PromotionResult[]> {
    const results: PromotionResult[] = [];

    // L2 -> L3: 7일 경과 또는 confirmation_count >= 3
    const candidatesForVerified = this.getCandidatesForVerified();
    for (const entry of candidatesForVerified) {
      const result = await this.promoteToVerified(entry.id as string, entry.reason);
      results.push(result);
    }

    // L3 -> L4: 30일 경과 및 충돌 없음
    const verifiedForCertified = this.getVerifiedForCertified();
    for (const entry of verifiedForCertified) {
      const result = await this.promoteToCertified(entry.id as string);
      results.push(result);
    }

    // L4 -> L3: 90일 미사용
    const certifiedForDemotion = this.getCertifiedForDemotion();
    for (const entry of certifiedForDemotion) {
      const result = await this.demote(entry.id as string, "unused");
      results.push(result);
    }

    return results;
  }

  // === 통계 ===

  /**
   * Stage별 통계 조회
   */
  async getStats(): Promise<GraduationStats> {
    const rows = this.db
      .prepare(
        `
      SELECT
        COALESCE(memory_stage, 'working') as stage,
        COUNT(*) as count
      FROM entries
      GROUP BY memory_stage
    `
      )
      .all() as Array<{ stage: string; count: number }>;

    const stats: GraduationStats = {
      raw: 0,
      working: 0,
      candidate: 0,
      verified: 0,
      certified: 0,
      total: 0,
    };

    for (const row of rows) {
      const stage = row.stage as MemoryStage;
      if (stage in stats) {
        stats[stage] = row.count;
        stats.total += row.count;
      }
    }

    return stats;
  }

  /**
   * 최근 승격 이력 조회
   */
  async getRecentPromotions(limit: number = 10): Promise<PromotionRecord[]> {
    const rows = this.db
      .prepare(
        `
      SELECT id, entry_id, from_stage, to_stage, reason, promoted_at
      FROM promotion_history
      ORDER BY promoted_at DESC
      LIMIT ?
    `
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      entryId: row.entry_id as string,
      fromStage: row.from_stage as MemoryStage,
      toStage: row.to_stage as MemoryStage,
      reason: row.reason as PromotionReason,
      promotedAt: row.promoted_at as string,
    }));
  }

  // === 충돌 관리 ===

  /**
   * 미해결 충돌 확인
   */
  hasUnresolvedConflict(entryId: string): boolean {
    const row = this.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM conflicts
      WHERE (entry_id_1 = ? OR entry_id_2 = ?)
      AND resolved_at IS NULL
    `
      )
      .get(entryId, entryId) as { count: number } | undefined;

    return (row?.count ?? 0) > 0;
  }

  /**
   * 충돌 기록
   */
  recordConflict(entryId1: string, entryId2: string, conflictType: ConflictType): Conflict {
    const conflict: Conflict = {
      id: randomUUID(),
      entryId1,
      entryId2,
      conflictType,
      detectedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `
      INSERT INTO conflicts (id, entry_id_1, entry_id_2, conflict_type, detected_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(conflict.id, conflict.entryId1, conflict.entryId2, conflict.conflictType, conflict.detectedAt);

    return conflict;
  }

  /**
   * 충돌 해결
   */
  resolveConflict(conflictId: string, resolution: string): void {
    this.db
      .prepare(
        `
      UPDATE conflicts
      SET resolved_at = datetime('now'), resolution = ?
      WHERE id = ?
    `
      )
      .run(resolution, conflictId);
  }

  // === Private 헬퍼 메서드 ===

  private async promote(
    entryId: string,
    fromStage: MemoryStage,
    toStage: MemoryStage,
    reason: PromotionReason
  ): Promise<PromotionResult> {
    // 승격 경로 검증
    if (!canPromote(fromStage, toStage)) {
      return {
        success: false,
        entryId,
        fromStage,
        toStage,
        reason,
        message: `Invalid promotion path: ${fromStage} -> ${toStage}`,
      };
    }

    // 현재 stage 확인
    const entry = this.getEntry(entryId);
    if (!entry) {
      return {
        success: false,
        entryId,
        fromStage,
        toStage,
        reason,
        message: "Entry not found",
      };
    }

    const currentStage = (entry.memory_stage as MemoryStage) || "working";
    if (currentStage !== fromStage) {
      return {
        success: false,
        entryId,
        fromStage,
        toStage,
        reason,
        message: `Entry is not in ${fromStage} stage (current: ${currentStage})`,
      };
    }

    return this.updateStage(entryId, fromStage, toStage, reason);
  }

  private updateStage(
    entryId: string,
    fromStage: MemoryStage,
    toStage: MemoryStage,
    reason: PromotionReason
  ): PromotionResult {
    // 트랜잭션으로 처리
    const transaction = this.db.transaction(() => {
      // entries 업데이트
      this.db
        .prepare(
          `
        UPDATE entries
        SET memory_stage = ?,
            promoted_at = datetime('now'),
            promotion_reason = ?
        WHERE id = ?
      `
        )
        .run(toStage, reason, entryId);

      // 승격 이력 기록
      const historyId = randomUUID();
      this.db
        .prepare(
          `
        INSERT INTO promotion_history (id, entry_id, from_stage, to_stage, reason, promoted_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `
        )
        .run(historyId, entryId, fromStage, toStage, reason);
    });

    transaction();

    return {
      success: true,
      entryId,
      fromStage,
      toStage,
      reason,
    };
  }

  private getEntry(entryId: string): Record<string, unknown> | null {
    const row = this.db.prepare(`SELECT * FROM entries WHERE id = ?`).get(entryId) as
      | Record<string, unknown>
      | undefined;
    return row ?? null;
  }

  private getCandidatesForVerified(): Array<{ id: unknown; reason: PromotionReason }> {
    const daysAgo = PROMOTION_CONFIG.DAYS_FOR_VERIFIED;
    const confirmCount = PROMOTION_CONFIG.CONFIRMATION_COUNT_FOR_VERIFIED;

    const rows = this.db
      .prepare(
        `
      SELECT id,
        CASE
          WHEN COALESCE(confirmation_count, 0) >= ? THEN 'confirmation_reached'
          ELSE 'time_elapsed'
        END as reason
      FROM entries
      WHERE COALESCE(memory_stage, 'working') = 'candidate'
      AND (
        datetime(created_at) < datetime('now', '-${daysAgo} days')
        OR COALESCE(confirmation_count, 0) >= ?
      )
    `
      )
      .all(confirmCount, confirmCount) as Array<{ id: unknown; reason: string }>;

    return rows.map((r) => ({
      id: r.id,
      reason: r.reason as PromotionReason,
    }));
  }

  private getVerifiedForCertified(): Array<{ id: unknown }> {
    const daysAgo = PROMOTION_CONFIG.DAYS_FOR_CERTIFIED;

    return this.db
      .prepare(
        `
      SELECT e.id FROM entries e
      WHERE COALESCE(e.memory_stage, 'working') = 'verified'
      AND datetime(e.created_at) < datetime('now', '-${daysAgo} days')
      AND NOT EXISTS (
        SELECT 1 FROM conflicts c
        WHERE (c.entry_id_1 = e.id OR c.entry_id_2 = e.id)
        AND c.resolved_at IS NULL
      )
    `
      )
      .all() as Array<{ id: unknown }>;
  }

  private getCertifiedForDemotion(): Array<{ id: unknown }> {
    const daysAgo = PROMOTION_CONFIG.DAYS_FOR_DEMOTION;

    return this.db
      .prepare(
        `
      SELECT id FROM entries
      WHERE COALESCE(memory_stage, 'working') = 'certified'
      AND (
        last_accessed_at IS NULL
        OR datetime(last_accessed_at) < datetime('now', '-${daysAgo} days')
      )
    `
      )
      .all() as Array<{ id: unknown }>;
  }

  /**
   * 접근 기록 업데이트
   */
  recordAccess(entryId: string): void {
    this.db
      .prepare(
        `
      UPDATE entries
      SET last_accessed_at = datetime('now'),
          access_count = COALESCE(access_count, 0) + 1
      WHERE id = ?
    `
      )
      .run(entryId);
  }

  /**
   * confirmation_count 증가
   */
  incrementConfirmation(entryId: string): void {
    this.db
      .prepare(
        `
      UPDATE entries
      SET confirmation_count = COALESCE(confirmation_count, 0) + 1
      WHERE id = ?
    `
      )
      .run(entryId);
  }
}

export default GraduationManager;
