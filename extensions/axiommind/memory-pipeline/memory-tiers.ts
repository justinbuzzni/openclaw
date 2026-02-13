/**
 * Memory Tiers Architecture
 *
 * MemGPT 영감의 3-Tier 메모리 구조
 * - Tier 1: Core (In-Context) - 항상 접근 가능
 * - Tier 2: Recall - 시맨틱 검색 가능
 * - Tier 3: Archival - 장기 저장, 필요시 복원
 */

import type { AnyEntry, MemoryStage, EntryType } from "./types.js";
import type { MemoryCategory } from "./intent-router.js";

// === Core Memory (Tier 1: In-Context) ===

/**
 * 압축된 사용자 프로필
 * 항상 컨텍스트에 포함됨
 */
export interface CompressedProfile {
  userId: string;
  // 핵심 선호도 (최대 10개)
  preferences: PreferenceSummary[];
  // 커뮤니케이션 스타일
  communicationStyle?: {
    language: "ko" | "en" | "mixed";
    formality: "casual" | "formal" | "mixed";
    preferredResponseLength: "brief" | "detailed" | "adaptive";
  };
  // 마지막 업데이트
  lastUpdated: Date;
}

export interface PreferenceSummary {
  category: string; // "food", "tech", "music", etc.
  preference: string; // "likes coffee", "prefers TypeScript"
  confidence: number; // 0-1
  confirmedAt?: Date;
}

/**
 * 최근 확인된 핵심 사실
 * 세션 시작 시 로드 (최대 10개)
 */
export interface FactSummary {
  id: string;
  title: string;
  category: MemoryCategory;
  lastConfirmed: Date;
  accessCount: number;
}

/**
 * 현재 진행 중인 프로젝트 메타
 */
export interface ProjectMeta {
  id: string;
  name: string;
  lastActiveSession: string;
  status: "active" | "paused" | "completed";
  keyDecisions: string[]; // Decision IDs
  lastUpdated: Date;
}

/**
 * Tier 1: Core Memory
 * 항상 컨텍스트에 포함됨 (~500-1000 tokens)
 */
export interface CoreMemory {
  userProfile: CompressedProfile;
  recentFacts: FactSummary[]; // 최대 10개
  activeProjects: ProjectMeta[]; // 최대 5개
}

// === Recall Memory (Tier 2: Searchable) ===

/**
 * 에피소드 메모리
 * 세션별 대화 요약
 */
export interface EpisodicMemory {
  id: string;
  sessionId: string;
  date: string;
  summary: string;
  keyTopics: string[];
  emotionalTone?: "positive" | "neutral" | "negative";
  entries: string[]; // Entry IDs
  createdAt: Date;
}

/**
 * 시맨틱 사실
 * 에피소드에서 추출된 핵심 사실
 */
export interface SemanticFact {
  id: string;
  content: string;
  category: MemoryCategory;
  entryType: EntryType;
  sourceEpisodes: string[]; // EpisodicMemory IDs
  confidence: number;
  confirmations: number;
  lastConfirmed: Date;
  tags: string[];
  // Embedding for semantic search
  embedding?: Float32Array;
}

/**
 * Tier 2: Recall Memory
 * 시맨틱 검색 가능
 */
export interface RecallMemory {
  episodic: EpisodicMemory[];
  semantic: SemanticFact[];
  relations: MemoryGraph;
}

// === Archival Memory (Tier 3: Long-term) ===

/**
 * 통합된 장기 메모리
 * 여러 에피소드/사실이 병합됨
 */
export interface ConsolidatedMemory {
  id: string;
  content: string;
  category: MemoryCategory;
  sources: string[]; // Original entry/episode IDs
  confirmations: number;
  firstMentioned: Date;
  lastConfirmed: Date;
  confidence: number;
  stage: MemoryStage;
}

/**
 * 압축된 세션 데이터
 * 원본 대화의 압축 버전
 */
export interface CompressedSession {
  id: string;
  date: string;
  summary: string;
  entryCount: number;
  compressedAt: Date;
  originalSize: number; // bytes
  compressedSize: number; // bytes
}

/**
 * Tier 3: Archival Memory
 * 장기 저장, 필요시 복원
 */
export interface ArchivalMemory {
  consolidatedMemories: ConsolidatedMemory[];
  rawSessions: CompressedSession[];
}

// === Memory Graph ===

export interface MemoryNode {
  id: string;
  type: "entity" | "concept" | "event" | "preference" | "project" | "person";
  content: string;
  category: MemoryCategory;
  // Temporal weight (최근일수록 높음)
  temporalWeight: number;
  accessCount: number;
  lastAccessed: Date;
  confidence: number;
  // Embedding for similarity
  embedding?: Float32Array;
  // Metadata
  createdAt: Date;
  sourceEntries: string[]; // Original entry IDs
}

export type RelationType =
  | "prefers" // 사용자가 선호
  | "dislikes" // 사용자가 싫어함
  | "decided" // 결정을 내림
  | "mentioned" // 언급함
  | "relates_to" // 관련됨
  | "contradicts" // 모순됨
  | "confirms" // 확인함
  | "part_of" // 일부임
  | "uses" // 사용함
  | "created" // 생성함
  | "worked_on"; // 작업함

export interface MemoryEdge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  relation: RelationType;
  strength: number; // 0-1, 반복 확인 시 증가
  createdAt: Date;
  lastConfirmed?: Date;
  confirmations: number;
  // Context where this relation was established
  context?: string;
}

export interface MemoryGraph {
  nodes: Map<string, MemoryNode>;
  edges: MemoryEdge[];
}

// === Full 3-Tier Structure ===

/**
 * 전체 메모리 구조
 */
export interface AxiomMemoryTiers {
  core: CoreMemory;
  recall: RecallMemory;
  archival: ArchivalMemory;
}

// === Memory Candidate (Pre-load) ===

/**
 * 세션 시작 시 프리로드되는 메모리 후보
 * 본문 없이 메타데이터만 포함
 */
export interface MemoryCandidate {
  id: string;
  title: string;
  category: MemoryCategory;
  entryType: EntryType;
  tags: string[];
  confidence: number;
  lastAccessed: Date;
  accessCount: number;
  // Content는 여기서 안 가져옴! (비용 최적화)
}

// === TTL Configuration ===

export const MEMORY_TTL = {
  profile: Infinity, // 프로필은 영구
  project: 90 * 24 * 60 * 60 * 1000, // 90일
  ephemeral: 7 * 24 * 60 * 60 * 1000, // 7일
} as const;

export const CACHE_TTL = {
  profile: Infinity,
  project: 7 * 24 * 60 * 60 * 1000, // 7일
  ephemeral: 60 * 60 * 1000, // 1시간
} as const;

// === Type Guards ===

export function isCoreMemory(obj: unknown): obj is CoreMemory {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "userProfile" in obj &&
    "recentFacts" in obj &&
    "activeProjects" in obj
  );
}

export function isEpisodicMemory(obj: unknown): obj is EpisodicMemory {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "sessionId" in obj &&
    "summary" in obj &&
    "keyTopics" in obj
  );
}

export function isSemanticFact(obj: unknown): obj is SemanticFact {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "content" in obj &&
    "category" in obj &&
    "confidence" in obj
  );
}

export function isMemoryNode(obj: unknown): obj is MemoryNode {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    "content" in obj &&
    "temporalWeight" in obj
  );
}

// === Factory Functions ===

export function createEmptyCoreMemory(userId: string): CoreMemory {
  return {
    userProfile: {
      userId,
      preferences: [],
      lastUpdated: new Date(),
    },
    recentFacts: [],
    activeProjects: [],
  };
}

export function createEmptyRecallMemory(): RecallMemory {
  return {
    episodic: [],
    semantic: [],
    relations: {
      nodes: new Map(),
      edges: [],
    },
  };
}

export function createEmptyArchivalMemory(): ArchivalMemory {
  return {
    consolidatedMemories: [],
    rawSessions: [],
  };
}

export function createEmptyMemoryTiers(userId: string): AxiomMemoryTiers {
  return {
    core: createEmptyCoreMemory(userId),
    recall: createEmptyRecallMemory(),
    archival: createEmptyArchivalMemory(),
  };
}

// === Utility Functions ===

/**
 * 메모리 카테고리별 TTL 계산
 */
export function isMemoryExpired(
  memory: { category: MemoryCategory; createdAt: Date } | { category: MemoryCategory; lastConfirmed: Date }
): boolean {
  const ttl = MEMORY_TTL[memory.category];
  if (ttl === Infinity) return false;

  const timestamp = "lastConfirmed" in memory ? memory.lastConfirmed : memory.createdAt;
  const age = Date.now() - timestamp.getTime();
  return age > ttl;
}

/**
 * Temporal weight 계산 (최근일수록 높음)
 * 지수 감쇠: e^(-λt) where t is days since last access
 */
export function calculateTemporalWeight(lastAccessed: Date, decayRate = 0.1): number {
  const daysSinceAccess = (Date.now() - lastAccessed.getTime()) / (24 * 60 * 60 * 1000);
  return Math.exp(-decayRate * daysSinceAccess);
}

/**
 * 노드 relevance 점수 계산
 */
export function calculateNodeRelevance(node: MemoryNode): number {
  const temporalFactor = node.temporalWeight;
  const accessFactor = Math.log(node.accessCount + 1) / 10; // log scale
  const confidenceFactor = node.confidence;

  return temporalFactor * 0.4 + accessFactor * 0.3 + confidenceFactor * 0.3;
}
