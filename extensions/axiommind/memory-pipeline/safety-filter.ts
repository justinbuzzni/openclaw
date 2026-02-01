/**
 * Safety Filter (Anti-Creepy Filter)
 *
 * 메모리 사용의 안전성 검증
 * - 관련성 체크
 * - 민감도 체크
 * - 오래된 정보 체크
 * - 충돌 체크
 * - "갑툭튀 개인화" 방지
 */

import type { MemoryCategory } from "./intent-router.js";
import type { SemanticFact, MemoryNode } from "./memory-tiers.js";
import { MEMORY_TTL } from "./memory-tiers.js";

// === Types ===

export type MemoryUseAction = "use" | "confirm" | "soft_hint" | "skip";

export interface SafetyValidation {
  relevance: RelevanceScore;
  staleness: StalenessCheck;
  sensitivity: SensitivityLevel;
  conflict: ConflictCheck;
  creepiness: CreepinessScore;
}

export interface RelevanceScore {
  isRelevant: boolean;
  score: number; // 0-1
  reason?: string;
}

export interface StalenessCheck {
  isStale: boolean;
  daysSinceLastConfirm: number;
  daysSinceCreated: number;
  lastConfirmDate?: Date;
}

export interface SensitivityLevel {
  level: "low" | "medium" | "high";
  categories: string[];
  requiresConfirmation: boolean;
}

export interface ConflictCheck {
  hasConflict: boolean;
  conflictingMemoryId?: string;
  conflictType?: "contradiction" | "outdated" | "duplicate";
}

export interface CreepinessScore {
  unexpectedPersonalization: number; // 0-1
  inferredKnowledge: number; // 0-1
  sensitiveTopicMention: number; // 0-1
  total: number;
}

export interface ValidatedMemory {
  id: string;
  content: string;
  category: MemoryCategory;
  action: MemoryUseAction;
  validation: SafetyValidation;
  // 사용 시 참고할 힌트
  useHint?: string;
  confirmationQuestion?: string;
}

// === Sensitive Topics ===

const SENSITIVE_TOPICS = {
  health: ["병", "아프", "치료", "약", "건강", "병원", "수술", "진단", "illness", "sick", "medicine", "hospital"],
  finance: ["돈", "월급", "연봉", "빚", "대출", "투자", "손실", "money", "salary", "debt", "loan", "investment"],
  relationship: ["이혼", "헤어", "연애", "결혼", "불륜", "divorce", "breakup", "dating", "affair"],
  personal: ["비밀", "부끄러", "창피", "개인적", "secret", "embarrassing", "private", "personal"],
  politics: ["정치", "선거", "투표", "정당", "politics", "election", "vote", "party"],
  religion: ["종교", "신", "교회", "절", "religion", "god", "church", "temple"],
};

const INFERRED_KNOWLEDGE_PATTERNS = [
  // 직접 말하지 않았을 가능성이 있는 추론
  /아마.*것 같/,
  /probably.*seems/,
  /추측하건대/,
  /based on.*assume/,
  /직접 말씀하시진 않았지만/,
  /you didn't mention.*but/,
];

// === Safety Filter Class ===

export class SafetyFilter {
  private sensitiveTopicCache: Map<string, string[]> = new Map();

  /**
   * 메모리 사용 여부 검증
   */
  async validateMemoryUse(
    memory: {
      id: string;
      content: string;
      category: MemoryCategory;
      createdAt: Date;
      lastConfirmed?: Date;
      confidence: number;
    },
    currentQuery: string,
    conversationContext?: { messages?: Array<{ role: string; content: string }> }
  ): Promise<ValidatedMemory> {
    // 전체 검증 실행
    const validation = await this.runFullValidation(memory, currentQuery, conversationContext);

    // 액션 결정
    const action = this.determineAction(validation);

    // 힌트 및 확인 질문 생성
    const hints = this.generateHints(memory, validation, action);

    return {
      id: memory.id,
      content: memory.content,
      category: memory.category,
      action,
      validation,
      ...hints,
    };
  }

  /**
   * 전체 검증 실행
   */
  private async runFullValidation(
    memory: {
      id: string;
      content: string;
      category: MemoryCategory;
      createdAt: Date;
      lastConfirmed?: Date;
      confidence: number;
    },
    currentQuery: string,
    conversationContext?: { messages?: Array<{ role: string; content: string }> }
  ): Promise<SafetyValidation> {
    return {
      relevance: this.checkRelevance(memory.content, currentQuery),
      staleness: this.checkStaleness(memory),
      sensitivity: this.checkSensitivity(memory.content),
      conflict: await this.checkConflict(memory.id, conversationContext),
      creepiness: this.checkCreepiness(memory.content, currentQuery, conversationContext),
    };
  }

  /**
   * 관련성 체크
   */
  private checkRelevance(memoryContent: string, currentQuery: string): RelevanceScore {
    const memoryTokens = this.tokenize(memoryContent);
    const queryTokens = this.tokenize(currentQuery);

    // Jaccard similarity
    const intersection = new Set([...memoryTokens].filter((x) => queryTokens.has(x)));
    const union = new Set([...memoryTokens, ...queryTokens]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;

    // 키워드 매칭 보너스
    const importantKeywords = this.extractImportantKeywords(currentQuery);
    const keywordMatches = importantKeywords.filter((kw) => memoryContent.toLowerCase().includes(kw.toLowerCase()));
    const keywordBonus = keywordMatches.length / Math.max(importantKeywords.length, 1) * 0.3;

    const score = Math.min(1, similarity + keywordBonus);

    return {
      isRelevant: score >= 0.15,
      score,
      reason: score < 0.15 ? "Low relevance to current query" : undefined,
    };
  }

  /**
   * 오래된 정보 체크
   */
  private checkStaleness(memory: {
    createdAt: Date;
    lastConfirmed?: Date;
    category: MemoryCategory;
  }): StalenessCheck {
    const now = Date.now();
    const createdAt = memory.createdAt.getTime();
    const lastConfirmed = memory.lastConfirmed?.getTime() ?? createdAt;

    const daysSinceCreated = (now - createdAt) / (24 * 60 * 60 * 1000);
    const daysSinceLastConfirm = (now - lastConfirmed) / (24 * 60 * 60 * 1000);

    // 카테고리별 stale 기준
    const staleThresholds: Record<MemoryCategory, number> = {
      profile: 90, // 프로필은 90일
      project: 30, // 프로젝트는 30일
      ephemeral: 7, // 일시적은 7일
    };

    const threshold = staleThresholds[memory.category];
    const isStale = daysSinceLastConfirm > threshold;

    return {
      isStale,
      daysSinceLastConfirm: Math.floor(daysSinceLastConfirm),
      daysSinceCreated: Math.floor(daysSinceCreated),
      lastConfirmDate: memory.lastConfirmed,
    };
  }

  /**
   * 민감도 체크
   */
  private checkSensitivity(content: string): SensitivityLevel {
    const lowerContent = content.toLowerCase();
    const matchedCategories: string[] = [];

    for (const [category, keywords] of Object.entries(SENSITIVE_TOPICS)) {
      if (keywords.some((kw) => lowerContent.includes(kw))) {
        matchedCategories.push(category);
      }
    }

    if (matchedCategories.length >= 2) {
      return {
        level: "high",
        categories: matchedCategories,
        requiresConfirmation: true,
      };
    } else if (matchedCategories.length === 1) {
      return {
        level: "medium",
        categories: matchedCategories,
        requiresConfirmation: matchedCategories.includes("health") || matchedCategories.includes("finance"),
      };
    }

    return {
      level: "low",
      categories: [],
      requiresConfirmation: false,
    };
  }

  /**
   * 충돌 체크
   */
  private async checkConflict(
    memoryId: string,
    conversationContext?: { messages?: Array<{ role: string; content: string }> }
  ): Promise<ConflictCheck> {
    // 대화 컨텍스트에서 충돌 확인
    if (conversationContext?.messages) {
      // 현재 대화에서 반대되는 정보가 언급되었는지 확인
      // (실제 구현에서는 더 정교한 충돌 감지 로직 필요)
      const recentMessages = conversationContext.messages.slice(-5);
      const contradictionIndicators = [
        "아니", "틀려", "바뀌", "더 이상", "이제는",
        "no", "wrong", "changed", "not anymore", "now",
      ];

      for (const msg of recentMessages) {
        if (typeof msg.content === "string") {
          const hasContradiction = contradictionIndicators.some((ind) =>
            msg.content.toLowerCase().includes(ind)
          );
          if (hasContradiction) {
            return {
              hasConflict: true,
              conflictType: "outdated",
            };
          }
        }
      }
    }

    return { hasConflict: false };
  }

  /**
   * Creepiness 체크
   */
  private checkCreepiness(
    memoryContent: string,
    currentQuery: string,
    conversationContext?: { messages?: Array<{ role: string; content: string }> }
  ): CreepinessScore {
    let unexpectedPersonalization = 0;
    let inferredKnowledge = 0;
    let sensitiveTopicMention = 0;

    // 1. 갑작스러운 개인화 체크
    // 현재 쿼리가 일반적인데 개인 정보를 언급하려는 경우
    const queryIsGeneral = !this.containsPersonalReference(currentQuery);
    const memoryIsPersonal = this.containsPersonalReference(memoryContent);
    if (queryIsGeneral && memoryIsPersonal) {
      unexpectedPersonalization = 0.7;
    }

    // 대화 컨텍스트에서 개인 정보 언급이 없었는데 갑자기 언급하려는 경우
    if (conversationContext?.messages) {
      const contextHasPersonal = conversationContext.messages.some(
        (m) => typeof m.content === "string" && this.containsPersonalReference(m.content)
      );
      if (!contextHasPersonal && memoryIsPersonal) {
        unexpectedPersonalization = Math.max(unexpectedPersonalization, 0.8);
      }
    }

    // 2. 추론된 지식 체크
    for (const pattern of INFERRED_KNOWLEDGE_PATTERNS) {
      if (pattern.test(memoryContent)) {
        inferredKnowledge = 0.6;
        break;
      }
    }

    // 3. 민감한 주제 체크
    const sensitivity = this.checkSensitivity(memoryContent);
    if (sensitivity.level === "high") {
      sensitiveTopicMention = 0.8;
    } else if (sensitivity.level === "medium") {
      sensitiveTopicMention = 0.4;
    }

    const total = (unexpectedPersonalization + inferredKnowledge + sensitiveTopicMention) / 3;

    return {
      unexpectedPersonalization,
      inferredKnowledge,
      sensitiveTopicMention,
      total,
    };
  }

  /**
   * 액션 결정
   */
  private determineAction(validation: SafetyValidation): MemoryUseAction {
    // Skip cases
    if (!validation.relevance.isRelevant) {
      return "skip";
    }
    if (validation.sensitivity.level === "high") {
      return "skip";
    }
    if (validation.creepiness.unexpectedPersonalization > 0.7) {
      return "skip";
    }

    // Confirm cases
    if (validation.staleness.daysSinceLastConfirm > 30) {
      return "confirm";
    }
    if (validation.conflict.hasConflict) {
      return "confirm";
    }
    if (validation.creepiness.inferredKnowledge > 0.5) {
      return "confirm";
    }
    if (validation.sensitivity.requiresConfirmation) {
      return "confirm";
    }

    // Soft hint cases
    if (validation.staleness.daysSinceLastConfirm > 7) {
      return "soft_hint";
    }
    if (validation.creepiness.total > 0.3) {
      return "soft_hint";
    }

    return "use";
  }

  /**
   * 힌트 및 확인 질문 생성
   */
  private generateHints(
    memory: { content: string; category: MemoryCategory },
    validation: SafetyValidation,
    action: MemoryUseAction
  ): { useHint?: string; confirmationQuestion?: string } {
    if (action === "skip") {
      return {};
    }

    if (action === "confirm") {
      // 확인 질문 생성
      const contentSummary = memory.content.slice(0, 50);
      const reasons: string[] = [];

      if (validation.staleness.daysSinceLastConfirm > 30) {
        reasons.push("오래된 정보");
      }
      if (validation.conflict.hasConflict) {
        reasons.push("최근 대화와 다를 수 있음");
      }
      if (validation.creepiness.inferredKnowledge > 0.5) {
        reasons.push("추론된 정보");
      }

      const reasonText = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";

      return {
        confirmationQuestion:
          memory.category === "profile"
            ? `예전에 "${contentSummary}..."라고 하셨던 것 같은데, 지금도 그러세요?${reasonText}`
            : `"${contentSummary}..." 이 정보가 아직 유효한가요?${reasonText}`,
      };
    }

    if (action === "soft_hint") {
      // 부드러운 힌트
      return {
        useHint: `(참고: ${memory.content.slice(0, 30)}...)`,
      };
    }

    return {};
  }

  // === Helper Methods ===

  private tokenize(text: string): Set<string> {
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    return new Set(tokens);
  }

  private extractImportantKeywords(text: string): string[] {
    const stopWords = new Set([
      "이", "그", "저", "것", "수", "등", "들", "및", "에", "의", "를", "을",
      "a", "an", "the", "is", "are", "was", "were", "be", "to", "of", "in",
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopWords.has(t));
  }

  private containsPersonalReference(text: string): boolean {
    const personalPatterns = [
      // 한국어
      /내가|나는|저는|제가/,
      /좋아해|싫어해|선호해/,
      /살고|다니|일해/,
      /가족|친구|동료/,
      // 영어
      /\bi\b|\bmy\b|\bme\b/i,
      /\blike\b|\bhate\b|\bprefer\b/i,
      /\blive\b|\bwork\b|\bstudy\b/i,
      /family|friend|colleague/i,
    ];

    return personalPatterns.some((pattern) => pattern.test(text));
  }
}

// === Factory ===

let globalFilter: SafetyFilter | null = null;

export function getSafetyFilter(): SafetyFilter {
  if (!globalFilter) {
    globalFilter = new SafetyFilter();
  }
  return globalFilter;
}
