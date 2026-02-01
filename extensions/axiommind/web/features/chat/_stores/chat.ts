import { atom } from "jotai";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string | ContentBlock[];
  timestamp: Date;
  isStreaming?: boolean;
  thinkingContent?: string;
  isThinkingStreaming?: boolean;
};

export type ContentBlock = {
  type: "text" | "image";
  text?: string;
  source?: unknown;
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// Agent 이벤트 스트림 타입
export type AgentStreamEvent = {
  stream: "assistant" | "tool" | "lifecycle" | "error";
  ts: number;
  data?: unknown;
};

// 도구 실행 상태
export type ToolProgress = {
  name: string;
  status: "running" | "done" | "error";
  input?: unknown;
  output?: unknown;
};

// 메모리 작업 타입
export type MemoryOperationType = "save" | "recall" | "search";
export type MemoryOperationPhase =
  | "extracting"      // 세션에서 정보 추출 중
  | "generating"      // Idris 코드 생성 중
  | "validating"      // 타입 검증 중
  | "indexing"        // 검색 인덱스 저장 중
  | "searching"       // 메모리 검색 중
  | "retrieving"      // 결과 조회 중
  | "complete"        // 완료
  | "error";          // 오류

export type MemoryOperation = {
  id: string;
  type: MemoryOperationType;
  phase: MemoryOperationPhase;
  query?: string;           // 검색/조회 쿼리
  sessionId?: string;       // 저장된 세션 ID
  entriesCount?: number;    // 저장/조회된 엔트리 수
  results?: unknown[];      // 검색 결과
  error?: string;           // 에러 메시지
  startedAt: number;        // 시작 시간
  completedAt?: number;     // 완료 시간
};

// 파일 첨부
export type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;       // base64 encoded
  preview?: string;   // object URL for images
};

// 메시지 목록
export const messagesAtom = atom<Message[]>([]);

// 연결 상태
export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");

// 입력 중인 메시지
export const inputMessageAtom = atom<string>("");

// 현재 세션 키 (URL에서 읽음)
export const sessionKeyAtom = atom<string>("");

// 현재 실행 중인 run ID
export const chatRunIdAtom = atom<string | null>(null);

// 스트리밍 텍스트 (delta 이벤트에서 누적)
export const streamingTextAtom = atom<string>("");

// 스트리밍 시작 시간
export const streamingStartedAtAtom = atom<number | null>(null);

// 도구 진행 상태 목록
export const toolProgressListAtom = atom<ToolProgress[]>([]);

// 메모리 작업 목록
export const memoryOperationsAtom = atom<MemoryOperation[]>([]);

// thinking 레벨
export const thinkingLevelAtom = atom<string | null>(null);

// 첨부 파일 목록
export const attachmentsAtom = atom<Attachment[]>([]);

// 메시지 추가 액션
export const addMessageAtom = atom(
  null,
  (get, set, message: Omit<Message, "id" | "timestamp"> & { id?: string; timestamp?: Date }) => {
    const messages = get(messagesAtom);
    const newMessage: Message = {
      ...message,
      id: message.id ?? crypto.randomUUID(),
      timestamp: message.timestamp ?? new Date(),
    };
    set(messagesAtom, [...messages, newMessage]);
    return newMessage.id;
  }
);

// 메시지 업데이트 액션 (스트리밍용)
export const updateMessageAtom = atom(
  null,
  (get, set, params: {
    id: string;
    content?: string | ContentBlock[];
    isStreaming?: boolean;
    thinkingContent?: string;
    isThinkingStreaming?: boolean;
  }) => {
    const messages = get(messagesAtom);
    const idx = messages.findIndex((m) => m.id === params.id);
    if (idx === -1) return;

    const updated = [...messages];
    updated[idx] = {
      ...updated[idx],
      ...(params.content !== undefined && { content: params.content }),
      ...(params.isStreaming !== undefined && { isStreaming: params.isStreaming }),
      ...(params.thinkingContent !== undefined && { thinkingContent: params.thinkingContent }),
      ...(params.isThinkingStreaming !== undefined && { isThinkingStreaming: params.isThinkingStreaming }),
    };
    set(messagesAtom, updated);
  }
);

// 메시지 전송 액션 (UI 상태만 업데이트, 실제 전송은 useGateway에서)
export const sendMessageAtom = atom(null, (get, set, content: string) => {
  if (!content.trim()) return null;

  // 사용자 메시지 추가
  const messageId = crypto.randomUUID();
  set(addMessageAtom, {
    id: messageId,
    role: "user",
    content,
  });

  // 입력 초기화
  set(inputMessageAtom, "");

  return messageId;
});

// 히스토리 로드 액션
export const loadHistoryAtom = atom(
  null,
  (
    _get,
    set,
    params: { messages: unknown[]; thinkingLevel?: string | null }
  ) => {
    const normalized: Message[] = params.messages.map((msg: any, idx: number) => ({
      id: msg.id ?? `hist-${idx}`,
      role: msg.role ?? "assistant",
      content: extractTextFromContent(msg.content),
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    }));
    set(messagesAtom, normalized);
    if (params.thinkingLevel !== undefined) {
      set(thinkingLevelAtom, params.thinkingLevel);
    }
  }
);

// 스트리밍 시작
export const startStreamingAtom = atom(null, (get, set, runId: string) => {
  set(chatRunIdAtom, runId);
  set(streamingTextAtom, "");
  set(streamingStartedAtAtom, Date.now());
  set(toolProgressListAtom, []);

  // 스트리밍 메시지 자리표시자 추가
  set(addMessageAtom, {
    id: runId,
    role: "assistant",
    content: "",
    isStreaming: true,
  });
});

// 스트리밍 델타 업데이트
export const updateStreamingDeltaAtom = atom(null, (get, set, params: { runId: string; text: string }) => {
  const currentRunId = get(chatRunIdAtom);
  if (currentRunId !== params.runId) return;

  set(streamingTextAtom, params.text);
  set(updateMessageAtom, {
    id: params.runId,
    content: params.text,
    isStreaming: true,
  });
});

// 스트리밍 완료
export const finishStreamingAtom = atom(
  null,
  (get, set, params: { runId: string; message?: unknown }) => {
    const currentRunId = get(chatRunIdAtom);
    if (currentRunId !== params.runId) return;

    const finalText = params.message
      ? extractTextFromContent((params.message as any).content)
      : get(streamingTextAtom);

    set(updateMessageAtom, {
      id: params.runId,
      content: finalText,
      isStreaming: false,
    });

    set(chatRunIdAtom, null);
    set(streamingTextAtom, "");
    set(streamingStartedAtAtom, null);
    set(toolProgressListAtom, []);
    set(memoryOperationsAtom, []);
  }
);

// 스트리밍 에러
export const streamingErrorAtom = atom(null, (get, set, params: { runId: string; error?: string }) => {
  const currentRunId = get(chatRunIdAtom);
  if (currentRunId !== params.runId) return;

  set(updateMessageAtom, {
    id: params.runId,
    content: `Error: ${params.error ?? "Unknown error"}`,
    isStreaming: false,
  });

  set(chatRunIdAtom, null);
  set(streamingTextAtom, "");
  set(streamingStartedAtAtom, null);
  set(toolProgressListAtom, []);
  set(memoryOperationsAtom, []);
});

// 도구 진행 상태 업데이트
export const updateToolProgressAtom = atom(null, (get, set, progress: ToolProgress) => {
  const list = get(toolProgressListAtom);
  const idx = list.findIndex((t) => t.name === progress.name);
  if (idx >= 0) {
    const updated = [...list];
    updated[idx] = progress;
    set(toolProgressListAtom, updated);
  } else {
    set(toolProgressListAtom, [...list, progress]);
  }
});

// 메모리 작업 시작
export const startMemoryOperationAtom = atom(
  null,
  (get, set, params: { id: string; type: MemoryOperationType; query?: string }) => {
    const operation: MemoryOperation = {
      id: params.id,
      type: params.type,
      phase: params.type === "save" ? "extracting" : "searching",
      query: params.query,
      startedAt: Date.now(),
    };
    set(memoryOperationsAtom, [...get(memoryOperationsAtom), operation]);
  }
);

// 메모리 작업 단계 업데이트
export const updateMemoryOperationAtom = atom(
  null,
  (get, set, params: { id: string; phase?: MemoryOperationPhase; sessionId?: string; entriesCount?: number; results?: unknown[]; error?: string }) => {
    const list = get(memoryOperationsAtom);
    const idx = list.findIndex((op) => op.id === params.id);
    if (idx === -1) return;

    const updated = [...list];
    updated[idx] = {
      ...updated[idx],
      ...(params.phase && { phase: params.phase }),
      ...(params.sessionId && { sessionId: params.sessionId }),
      ...(params.entriesCount !== undefined && { entriesCount: params.entriesCount }),
      ...(params.results && { results: params.results }),
      ...(params.error && { error: params.error }),
      ...(params.phase === "complete" || params.phase === "error" ? { completedAt: Date.now() } : {}),
    };
    set(memoryOperationsAtom, updated);
  }
);

// 스트리밍 완료시 메모리 작업 초기화
export const clearMemoryOperationsAtom = atom(null, (_get, set) => {
  set(memoryOperationsAtom, []);
});

// 헬퍼: content에서 텍스트 추출
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block.type === "text" && typeof block.text === "string") {
          return block.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
