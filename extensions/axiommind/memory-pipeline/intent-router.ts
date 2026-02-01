/**
 * Intent Router
 *
 * 메시지 분석을 통해 메모리 검색 필요 여부를 판단
 * - Intent 분류 (8가지)
 * - 스코어링 시스템
 * - 검색 전략 결정
 */

// === Intent Types ===

export type MemoryIntent =
  | "direct_recall" // "기억나?", "지난번에 뭐라고 했지?"
  | "preference_query" // "추천해줘", "뭐 마실까?"
  | "project_resume" // "그거 이어서", "아까 설계안"
  | "reference_resolve" // "그거", "저번에 말한 방식"
  | "temporal_query" // "언제", "얼마나 오래 전에"
  | "multi_hop_query" // "A가 추천한 B의 C" (관계 추론)
  | "contradiction_check" // "전에는 다르게 말했던 것 같은데"
  | "no_memory_needed"; // 일반 질문

export type MemoryCategory = "profile" | "project" | "ephemeral";

export type SearchType =
  | "semantic"
  | "graph_traversal"
  | "temporal_semantic"
  | "graph_reasoning"
  | "conflict_scan";

// === Scoring Interfaces ===

export interface EnhancedMemoryScore {
  // 기존 스코어
  explicitness: number; // 명시적 메모리 요청 (0-3)
  anaphora: number; // 지시어 사용 (0-2)
  preference: number; // 선호도 질문 (0-2)
  continuity: number; // 연속성 표현 (0-2)

  // 새로운 스코어
  temporalSignal: number; // "지난주", "어제", "예전에" (0-2)
  multiHopSignal: number; // 관계 추론 필요 (0-2)
  contradictionSignal: number; // "다르게", "바뀐", "틀린" (0-2)

  // 감점 요소
  sessionSufficiency: number; // 세션 내 답 있으면 (-3-0)
  recentlyCached: number; // 이미 캐시에 있으면 (-2-0)

  // 총점
  total: number;
}

export interface SearchStrategy {
  searchType: SearchType;
  tiers: Array<"core" | "recall" | "archival">;
  useGraph: boolean;
  maxHops?: number;
  recencyWeight?: number;
  maxResults: number;
  startNode?: string;
  requireChain?: boolean;
  findConflicts?: boolean;
}

// === Keyword Patterns ===

const EXPLICIT_MEMORY_KEYWORDS = {
  ko: [
    "기억", "기억나", "기억해", "생각나", "잊지마", "잊어버리지마",
    "전에", "지난번", "예전에", "과거에", "이전에",
    "말했던", "얘기했던", "언급했던", "알려줬던",
    "내가 뭐라고", "뭐라고 했지", "뭐라 했더라",
  ],
  en: [
    "remember", "recall", "forgot", "mentioned", "told you",
    "last time", "before", "previously", "earlier",
    "what did i say", "what was it", "do you remember",
  ],
};

const ANAPHORA_KEYWORDS = {
  ko: [
    "그거", "그것", "저거", "저것", "이거", "이것",
    "그때", "저때", "그 방식", "저 방식", "그 방법", "저 방법",
    "그 프로젝트", "그 설계", "그 결정", "그 아이디어",
    "아까", "방금", "조금 전",
  ],
  en: [
    "that", "this", "those", "these",
    "that thing", "that way", "that method", "that approach",
    "the one", "the project", "the design",
    "earlier", "just now", "a moment ago",
  ],
};

const PREFERENCE_KEYWORDS = {
  ko: [
    "추천", "추천해", "골라줘", "선택해줘", "뭐가 좋", "뭐 좋아",
    "어떤 게 나", "뭐 마실", "뭐 먹을", "뭐 할",
    "좋아하", "싫어하", "선호", "취향",
    "내 스타일", "내 취향",
  ],
  en: [
    "recommend", "suggest", "pick", "choose", "which one",
    "what should i", "what do i like", "my preference",
    "favorite", "prefer", "like better",
  ],
};

const CONTINUITY_KEYWORDS = {
  ko: [
    "이어서", "계속해서", "마저", "다시", "이어",
    "그거 계속", "계속하자", "이어하자", "더 해줘",
    "아까 거", "아까 하던", "진행 중이던",
    "마무리", "완성", "끝내자",
  ],
  en: [
    "continue", "resume", "keep going", "pick up where",
    "finish", "complete", "wrap up",
    "what we were doing", "the thing we started",
  ],
};

const TEMPORAL_KEYWORDS = {
  ko: [
    "언제", "얼마나", "며칠", "몇 주", "몇 달",
    "지난주", "지난달", "작년", "어제", "그저께",
    "최근", "요즘", "요새",
    "오래", "얼마 전", "한참 전",
  ],
  en: [
    "when", "how long", "days ago", "weeks ago", "months ago",
    "last week", "last month", "yesterday",
    "recently", "lately", "a while ago",
  ],
};

const MULTI_HOP_PATTERNS = {
  ko: [
    /(.+)가 (.+)한 (.+)/,
    /(.+)에서 (.+)한 (.+)/,
    /(.+)랑 관련된 (.+)/,
    /(.+)와 연결된 (.+)/,
  ],
  en: [
    /(.+) that (.+) mentioned/,
    /(.+) related to (.+)/,
    /(.+) connected to (.+)/,
    /the (.+) from (.+)/,
  ],
};

const CONTRADICTION_KEYWORDS = {
  ko: [
    "다르게", "바뀌", "바뀐", "변경", "변했", "틀린",
    "전에는", "원래는", "처음에는",
    "아닌 것 같", "맞나", "확실해",
    "충돌", "모순", "상반",
  ],
  en: [
    "different", "changed", "wrong", "incorrect",
    "used to", "originally", "before it was",
    "conflict", "contradict", "inconsistent",
    "are you sure", "is that right",
  ],
};

// === Session Sufficiency Keywords (감점 요소) ===

const SESSION_REFERENCE_KEYWORDS = {
  ko: [
    "방금", "지금", "이번 대화에서", "아까 말한",
    "위에서", "앞에서",
  ],
  en: [
    "just now", "right now", "in this conversation",
    "above", "earlier in this chat",
  ],
};

// === Core Functions ===

/**
 * 메시지에서 Intent 분류
 */
export function classifyIntent(message: string): MemoryIntent {
  const lowerMessage = message.toLowerCase();

  // 1. Contradiction Check (충돌 확인)
  if (matchesKeywords(lowerMessage, CONTRADICTION_KEYWORDS)) {
    return "contradiction_check";
  }

  // 2. Multi-hop Query (관계 추론)
  if (matchesPatterns(message, MULTI_HOP_PATTERNS)) {
    return "multi_hop_query";
  }

  // 3. Direct Recall (명시적 기억 요청)
  if (matchesKeywords(lowerMessage, EXPLICIT_MEMORY_KEYWORDS)) {
    return "direct_recall";
  }

  // 4. Temporal Query (시간 관련)
  if (matchesKeywords(lowerMessage, TEMPORAL_KEYWORDS)) {
    return "temporal_query";
  }

  // 5. Project Resume (프로젝트 이어서)
  if (matchesKeywords(lowerMessage, CONTINUITY_KEYWORDS)) {
    return "project_resume";
  }

  // 6. Reference Resolve (지시어 해결)
  if (matchesKeywords(lowerMessage, ANAPHORA_KEYWORDS)) {
    return "reference_resolve";
  }

  // 7. Preference Query (선호도 질문)
  if (matchesKeywords(lowerMessage, PREFERENCE_KEYWORDS)) {
    return "preference_query";
  }

  // 8. No Memory Needed
  return "no_memory_needed";
}

/**
 * 강화된 메모리 필요성 스코어 계산
 */
export function calculateMemoryScore(
  message: string,
  sessionContext?: { messages?: Array<{ content: string }> }
): EnhancedMemoryScore {
  const lowerMessage = message.toLowerCase();

  const explicitness = countKeywordMatches(lowerMessage, EXPLICIT_MEMORY_KEYWORDS);
  const anaphora = Math.min(2, countKeywordMatches(lowerMessage, ANAPHORA_KEYWORDS));
  const preference = Math.min(2, countKeywordMatches(lowerMessage, PREFERENCE_KEYWORDS));
  const continuity = Math.min(2, countKeywordMatches(lowerMessage, CONTINUITY_KEYWORDS));
  const temporalSignal = Math.min(2, countKeywordMatches(lowerMessage, TEMPORAL_KEYWORDS));
  const multiHopSignal = matchesPatterns(message, MULTI_HOP_PATTERNS) ? 2 : 0;
  const contradictionSignal = Math.min(2, countKeywordMatches(lowerMessage, CONTRADICTION_KEYWORDS));

  // 감점 요소
  const sessionSufficiency = calculateSessionSufficiency(message, sessionContext);
  const recentlyCached = 0; // 캐시 체크는 별도 레이어에서

  const total =
    Math.min(3, explicitness) +
    anaphora +
    preference +
    continuity +
    temporalSignal +
    multiHopSignal +
    contradictionSignal +
    sessionSufficiency +
    recentlyCached;

  return {
    explicitness: Math.min(3, explicitness),
    anaphora,
    preference,
    continuity,
    temporalSignal,
    multiHopSignal,
    contradictionSignal,
    sessionSufficiency,
    recentlyCached,
    total,
  };
}

/**
 * 세션 내에서 답을 찾을 수 있는지 확인 (감점)
 */
function calculateSessionSufficiency(
  message: string,
  sessionContext?: { messages?: Array<{ content: string }> }
): number {
  const lowerMessage = message.toLowerCase();

  // 현재 세션 참조 키워드가 있으면 감점
  if (matchesKeywords(lowerMessage, SESSION_REFERENCE_KEYWORDS)) {
    return -2;
  }

  // 세션 컨텍스트가 있고, 관련 내용이 있으면 감점
  if (sessionContext?.messages) {
    const sessionText = sessionContext.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join(" ")
      .toLowerCase();

    // 메시지의 핵심 키워드가 세션에 이미 있으면 감점
    const coreKeywords = extractCoreKeywords(message);
    const foundInSession = coreKeywords.filter((kw) => sessionText.includes(kw.toLowerCase()));

    if (foundInSession.length >= coreKeywords.length * 0.7) {
      return -3;
    } else if (foundInSession.length >= coreKeywords.length * 0.4) {
      return -1;
    }
  }

  return 0;
}

/**
 * Intent별 검색 전략 반환
 */
export function getSearchStrategy(intent: MemoryIntent): SearchStrategy {
  const strategies: Record<MemoryIntent, SearchStrategy> = {
    direct_recall: {
      searchType: "semantic",
      tiers: ["recall", "archival"],
      useGraph: false,
      maxResults: 5,
    },
    preference_query: {
      searchType: "graph_traversal",
      tiers: ["core", "recall"],
      useGraph: true,
      startNode: "user_preferences",
      maxHops: 2,
      maxResults: 3,
    },
    project_resume: {
      searchType: "temporal_semantic",
      tiers: ["core", "recall"],
      useGraph: true,
      recencyWeight: 0.7,
      maxResults: 3,
    },
    reference_resolve: {
      searchType: "temporal_semantic",
      tiers: ["recall"],
      useGraph: false,
      recencyWeight: 0.8,
      maxResults: 3,
    },
    temporal_query: {
      searchType: "temporal_semantic",
      tiers: ["recall", "archival"],
      useGraph: false,
      recencyWeight: 0.5,
      maxResults: 5,
    },
    multi_hop_query: {
      searchType: "graph_reasoning",
      tiers: ["recall"],
      useGraph: true,
      maxHops: 3,
      requireChain: true,
      maxResults: 5,
    },
    contradiction_check: {
      searchType: "conflict_scan",
      tiers: ["recall", "archival"],
      useGraph: true,
      findConflicts: true,
      maxResults: 5,
    },
    no_memory_needed: {
      searchType: "semantic",
      tiers: [],
      useGraph: false,
      maxResults: 0,
    },
  };

  return strategies[intent];
}

/**
 * Intent별 검색 우선순위 (Memory Category)
 */
export function getSearchPriority(intent: MemoryIntent): MemoryCategory[] {
  const priorities: Record<MemoryIntent, MemoryCategory[]> = {
    direct_recall: ["project", "profile", "ephemeral"],
    preference_query: ["profile", "ephemeral"],
    project_resume: ["project"],
    reference_resolve: ["project", "ephemeral"],
    temporal_query: ["project", "ephemeral", "profile"],
    multi_hop_query: ["project", "profile"],
    contradiction_check: ["project", "profile", "ephemeral"],
    no_memory_needed: [],
  };

  return priorities[intent];
}

// === Thresholds ===

export const MEMORY_THRESHOLDS = {
  SEARCH: 3, // 이 점수 이상이면 메모리 검색
  CACHE_CHECK: 1, // 이 점수 이상이면 캐시 확인
  GRAPH_REQUIRED: 5, // 이 점수 이상이면 그래프 검색 필요
};

/**
 * 스코어 기반 액션 결정
 */
export function determineAction(
  score: EnhancedMemoryScore,
  intent: MemoryIntent
): "skip" | "cache_check" | "search" | "graph_search" {
  if (intent === "no_memory_needed" || score.total < MEMORY_THRESHOLDS.CACHE_CHECK) {
    return "skip";
  }

  if (score.total < MEMORY_THRESHOLDS.SEARCH) {
    return "cache_check";
  }

  if (score.total >= MEMORY_THRESHOLDS.GRAPH_REQUIRED || score.multiHopSignal > 0) {
    return "graph_search";
  }

  return "search";
}

// === Helper Functions ===

function matchesKeywords(
  text: string,
  keywords: { ko: string[]; en: string[] }
): boolean {
  const allKeywords = [...keywords.ko, ...keywords.en];
  return allKeywords.some((kw) => text.includes(kw.toLowerCase()));
}

function matchesPatterns(
  text: string,
  patterns: { ko: RegExp[]; en: RegExp[] }
): boolean {
  const allPatterns = [...patterns.ko, ...patterns.en];
  return allPatterns.some((pattern) => pattern.test(text));
}

function countKeywordMatches(
  text: string,
  keywords: { ko: string[]; en: string[] }
): number {
  const allKeywords = [...keywords.ko, ...keywords.en];
  return allKeywords.filter((kw) => text.includes(kw.toLowerCase())).length;
}

function extractCoreKeywords(message: string): string[] {
  // 불용어 제거 후 핵심 키워드 추출
  const stopWords = new Set([
    "이", "그", "저", "것", "수", "등", "들", "및", "에", "의", "를", "을",
    "은", "는", "가", "이다", "있다", "하다", "되다", "않다", "없다",
    "a", "an", "the", "is", "are", "was", "were", "be", "been",
    "to", "of", "in", "for", "on", "with", "at", "by", "from",
  ]);

  return message
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stopWords.has(word));
}

/**
 * LLM 기반 검색 쿼리 생성을 위한 컨텍스트
 */
export function generateSearchQueryContext(
  message: string,
  intent: MemoryIntent
): { query: string; hints: string[] } {
  const coreKeywords = extractCoreKeywords(message);

  // Intent별 힌트 추가
  const hints: string[] = [];

  switch (intent) {
    case "preference_query":
      hints.push("user preferences", "likes", "favorites");
      break;
    case "project_resume":
      hints.push("recent project", "ongoing work", "last session");
      break;
    case "temporal_query":
      hints.push("date", "time", "when");
      break;
    case "contradiction_check":
      hints.push("previous statement", "earlier claim", "conflict");
      break;
  }

  return {
    query: coreKeywords.join(" "),
    hints,
  };
}
