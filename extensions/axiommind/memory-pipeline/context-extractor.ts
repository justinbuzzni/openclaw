/**
 * Context Extractor
 *
 * OpenClaw 에이전트 컨텍스트에서 세션 로그를 추출
 */

import type { Session, AnyEntry } from "./types.js";

// OpenClaw Agent Context 타입 (간소화)
export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
  timestamp?: number;
  name?: string;
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

export interface AgentContext {
  sessionId: string;
  agentId: string;
  messages: AgentMessage[];
  metadata?: {
    startedAt?: number;
    endedAt?: number;
    totalTokens?: number;
  };
}

/**
 * 컨텍스트에서 텍스트 추출
 */
function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is ContentBlock & { type: "text" } => block.type === "text")
      .map((block) => block.text || "")
      .join("\n");
  }
  return "";
}

/**
 * 메시지 배열을 세션 로그 텍스트로 변환
 */
export function messagesToSessionLog(messages: AgentMessage[]): string {
  if (!messages || messages.length === 0) return "";

  return messages
    .filter((msg) => msg.role !== "system") // 시스템 메시지 제외
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      const text = extractTextFromContent(msg.content);
      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
        : "";
      return `[${timestamp}] ${role}: ${text}`;
    })
    .join("\n\n");
}

/**
 * 컨텍스트에서 메모리에 저장할 가치가 있는지 판단
 */
export function isMemorizable(messages: AgentMessage[]): boolean {
  if (!messages || messages.length < 2) return false;

  // 최소 대화 길이 체크 (왕복 대화가 있어야 함)
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  if (userMessages.length === 0 || assistantMessages.length === 0) return false;

  // 총 텍스트 길이 체크 (너무 짧은 대화 제외)
  const totalText = messages
    .map((m) => extractTextFromContent(m.content))
    .join(" ");

  if (totalText.length < 100) return false;

  // 메모리 관련 키워드 체크 (이미 메모리에 저장한 내용은 제외)
  const hasMemoryTool = messages.some((m) => {
    if (typeof m.content !== "string" && Array.isArray(m.content)) {
      return m.content.some(
        (block: ContentBlock) =>
          block.type === "tool_use" &&
          (block.name === "axiom_save" || block.name === "axiom_search")
      );
    }
    return false;
  });

  // 이미 axiom_save를 사용한 경우, 중복 저장 방지
  if (hasMemoryTool) return false;

  // 저장할 가치가 있는 키워드 체크
  const memorableKeywords = [
    // 한국어
    "결정", "선택", "계획", "할 일", "예정", "기억해", "잊지마",
    "좋아해", "싫어해", "선호", "중요", "배웠", "깨달",
    // 영어
    "decided", "decision", "plan", "prefer", "remember", "important",
    "learned", "realized", "task", "todo", "scheduled",
  ];

  const lowerText = totalText.toLowerCase();
  return memorableKeywords.some((kw) => lowerText.includes(kw.toLowerCase()));
}

/**
 * 컨텍스트에서 시간 범위 추출
 */
export function extractTimeRange(messages: AgentMessage[]): string {
  if (!messages || messages.length === 0) return "";

  const timestamps = messages
    .filter((m) => m.timestamp)
    .map((m) => m.timestamp!);

  if (timestamps.length === 0) return "";

  const start = new Date(Math.min(...timestamps));
  const end = new Date(Math.max(...timestamps));

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return `${formatTime(start)}-${formatTime(end)}`;
}

/**
 * 세션 메타데이터 생성
 */
export function createSessionMetadata(
  ctx: AgentContext,
  date: string,
  sessionId: number
): Omit<Session, "entries"> {
  return {
    date,
    sessionId,
    timeRange: extractTimeRange(ctx.messages),
    title: `Session ${sessionId} - ${ctx.agentId}`,
  };
}

/**
 * OpenClaw 컨텍스트에서 세션 로그 추출
 */
export function extractSessionFromContext(ctx: unknown): {
  sessionLog: string;
  metadata: { agentId: string; sessionId: string; timeRange: string };
  memorizable: boolean;
} | null {
  // 타입 체크
  if (!ctx || typeof ctx !== "object") return null;

  const context = ctx as Partial<AgentContext>;

  // 필수 필드 체크
  if (!context.messages || !Array.isArray(context.messages)) return null;
  if (!context.sessionId || !context.agentId) return null;

  const memorizable = isMemorizable(context.messages);
  const sessionLog = messagesToSessionLog(context.messages);
  const timeRange = extractTimeRange(context.messages);

  return {
    sessionLog,
    metadata: {
      agentId: context.agentId,
      sessionId: context.sessionId,
      timeRange,
    },
    memorizable,
  };
}
