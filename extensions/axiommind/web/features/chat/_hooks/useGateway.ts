"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import {
  connectionStatusAtom,
  sessionKeyAtom,
  chatRunIdAtom,
  messagesAtom,
  loadHistoryAtom,
  startStreamingAtom,
  updateStreamingDeltaAtom,
  finishStreamingAtom,
  streamingErrorAtom,
  updateToolProgressAtom,
  type ToolProgress,
  type Message,
} from "../_stores/chat";

// OpenClaw 게이트웨이 프로토콜 타입 정의
type GatewayClientId = "openclaw-control-ui";
type GatewayClientMode = "webchat" | "ui";

type ConnectParams = {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: GatewayClientId;
    version: string;
    platform: string;
    mode: GatewayClientMode;
    instanceId?: string;
  };
  role?: string;
  scopes?: string[];
  auth?: {
    token?: string;
  };
  userAgent?: string;
  locale?: string;
};

type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "aborted" | "error";
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
    timestamp: number;
  };
  errorMessage?: string;
};

type AgentEventPayload = {
  runId: string;
  stream: "assistant" | "tool" | "lifecycle" | "error";
  seq: number;
  ts: number;
  sessionKey?: string;
  data?: {
    text?: string;
    phase?: string;
    name?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
  };
};

type UseGatewayOptions = {
  url?: string;
  autoConnect?: boolean;
  token?: string;
};

// URL에서 token 파라미터 읽기
function getTokenFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || undefined;
}

// URL에서 session 파라미터 읽기
function getSessionFromUrl(): string {
  if (typeof window === "undefined") return "agent:main:main";
  const params = new URLSearchParams(window.location.search);
  return params.get("session") || "agent:main:main";
}

// UUID 생성
function generateUUID(): string {
  return crypto.randomUUID();
}

// content에서 텍스트 추출
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

// 기본 토큰 (개발용 - 실제로는 URL 파라미터나 설정에서 가져와야 함)
const DEFAULT_DEV_TOKEN = "58a362bc29faaeff7c11422bcfeb79c4";

// 현재 페이지 host 기반으로 WebSocket URL 생성 (origin 불일치 방지)
function getDefaultWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:18789/";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/`;
}

export function useGateway(options: UseGatewayOptions = {}) {
  const { url = getDefaultWsUrl(), autoConnect = true } = options;
  const token = options.token || getTokenFromUrl() || DEFAULT_DEV_TOKEN;

  // sessionKey를 즉시 계산 (useEffect 대신)
  const initialSessionKey = typeof window !== "undefined" ? getSessionFromUrl() : "agent:main:main";

  const [connectionStatus, setConnectionStatus] = useAtom(connectionStatusAtom);
  const [sessionKey, setSessionKey] = useAtom(sessionKeyAtom);
  const chatRunId = useAtomValue(chatRunIdAtom);
  const currentMessages = useAtomValue(messagesAtom);

  const loadHistory = useSetAtom(loadHistoryAtom);
  const startStreaming = useSetAtom(startStreamingAtom);
  const updateStreamingDelta = useSetAtom(updateStreamingDeltaAtom);
  const finishStreaming = useSetAtom(finishStreamingAtom);
  const streamingError = useSetAtom(streamingErrorAtom);
  const updateToolProgress = useSetAtom(updateToolProgressAtom);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const requestIdCounter = useRef(0);
  const pendingRequests = useRef<
    Map<string, { resolve: (value: any) => void; reject: (err: any) => void }>
  >(new Map());

  // Track if connect was sent (prevent double sends)
  const connectSentRef = useRef(false);

  // sessionKey를 ref로도 저장 (콜백에서 최신값 접근용)
  const sessionKeyRef = useRef(initialSessionKey);
  // messages ref (send에서 최신 메시지 접근용)
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = currentMessages;

  // 이벤트 핸들러를 ref로 저장 (stale closure 방지)
  const handleChatEventRef = useRef<(payload: ChatEventPayload) => void>(() => {});
  const handleAgentEventRef = useRef<(payload: AgentEventPayload) => void>(() => {});

  // 초기 sessionKey 설정
  useEffect(() => {
    const session = getSessionFromUrl();
    setSessionKey(session);
    sessionKeyRef.current = session;
  }, [setSessionKey]);

  const sendRequest = useCallback((method: string, params?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = `req-${++requestIdCounter.current}`;
      pendingRequests.current.set(id, { resolve, reject });

      wsRef.current.send(
        JSON.stringify({
          type: "req",
          id,
          method,
          params,
        })
      );

      // 타임아웃 설정 (30초)
      setTimeout(() => {
        const pending = pendingRequests.current.get(id);
        if (pending) {
          pendingRequests.current.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    });
  }, []);

  // 히스토리 로드
  const fetchHistory = useCallback(async () => {
    const currentSessionKey = sessionKeyRef.current;
    if (!currentSessionKey) return;
    try {
      const res = await sendRequest("chat.history", {
        sessionKey: currentSessionKey,
        limit: 200,
      });
      loadHistory({
        messages: res.messages ?? [],
        thinkingLevel: res.thinkingLevel,
      });
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  }, [sendRequest, loadHistory]);

  // chat 이벤트 처리
  const handleChatEvent = useCallback(
    (payload: ChatEventPayload) => {
      const currentSessionKey = sessionKeyRef.current;
      if (payload.sessionKey !== currentSessionKey) {
        // Gateway가 세션키를 리다이렉트한 경우 (예: UUID → main) 수용
        const currentId = currentSessionKey.split(":").pop() || "";
        const isCurrentUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentId);
        const isCurrentNew = currentId.startsWith("new-");
        if (isCurrentUuid || isCurrentNew) {
          console.log("[chat event] sessionKey redirect accepted:", payload.sessionKey);
          setSessionKey(payload.sessionKey);
          sessionKeyRef.current = payload.sessionKey;
          // URL도 업데이트
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("session", payload.sessionKey);
            window.history.replaceState({}, "", url.toString());
          }
        } else {
          console.log("[chat event] sessionKey mismatch:", payload.sessionKey, "vs", currentSessionKey);
          return;
        }
      }

      console.log("[chat event]", payload.state, payload);

      switch (payload.state) {
        case "delta": {
          const text = extractTextFromContent(payload.message?.content);
          if (text) {
            updateStreamingDelta({ runId: payload.runId, text });
          }
          break;
        }
        case "final": {
          finishStreaming({ runId: payload.runId, message: payload.message });
          // 히스토리 리로드해서 최신 상태 반영
          fetchHistory();
          break;
        }
        case "aborted": {
          finishStreaming({ runId: payload.runId });
          break;
        }
        case "error": {
          streamingError({ runId: payload.runId, error: payload.errorMessage });
          break;
        }
      }
    },
    [setSessionKey, updateStreamingDelta, finishStreaming, streamingError, fetchHistory]
  );

  // agent 이벤트 처리 (도구 진행 상황)
  const handleAgentEvent = useCallback(
    (payload: AgentEventPayload) => {
      const currentSessionKey = sessionKeyRef.current;
      if (payload.sessionKey && payload.sessionKey !== currentSessionKey) {
        // sessionKey 리다이렉트 수용 (chat event에서 이미 업데이트됨)
        // 아직 업데이트 안된 경우 무시하지 않고 통과
        const currentId = currentSessionKey.split(":").pop() || "";
        const isCurrentUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentId);
        const isCurrentNew = currentId.startsWith("new-");
        if (!isCurrentUuid && !isCurrentNew) return;
      }

      console.log("[agent event]", payload.stream, payload);

      switch (payload.stream) {
        case "tool": {
          const data = payload.data;
          if (data?.name) {
            const progress: ToolProgress = {
              name: data.name,
              status: data.output ? "done" : "running",
              input: data.input,
              output: data.output,
            };
            updateToolProgress(progress);
          }
          break;
        }
        case "lifecycle": {
          // lifecycle 이벤트는 start/end 등의 상태 변화
          console.log("[lifecycle]", payload.data?.phase);
          break;
        }
        case "assistant": {
          // assistant 스트림은 chat delta로도 오므로 여기서는 무시해도 됨
          break;
        }
      }
    },
    [updateToolProgress]
  );

  // 핸들러 refs 업데이트
  useEffect(() => {
    handleChatEventRef.current = handleChatEvent;
    handleAgentEventRef.current = handleAgentEvent;
  }, [handleChatEvent, handleAgentEvent]);

  // sendConnect를 ref로 저장하여 onmessage에서 호출 가능하게 함
  const sendConnectRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const doSendConnect = useCallback(async () => {
    if (connectSentRef.current) return;
    connectSentRef.current = true;

    const params: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "openclaw-control-ui",
        version: "1.0.0",
        platform: typeof navigator !== "undefined" ? navigator.platform : "web",
        mode: "webchat",
      },
      role: "operator",
      scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
      auth: token ? { token } : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
    };

    try {
      console.log("Sending connect params:", JSON.stringify(params, null, 2));
      const response = await sendRequest("connect", params);
      setConnectionStatus("connected");
      console.log("Gateway connected", response);

      // 연결 성공 후 히스토리 로드
      fetchHistory();
    } catch (error) {
      console.error("Connect failed:", error);
      wsRef.current?.close();
    }
  }, [token, sendRequest, setConnectionStatus, fetchHistory]);

  // Update ref when callback changes
  useEffect(() => {
    sendConnectRef.current = doSendConnect;
  }, [doSendConnect]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Reset connect state
    connectSentRef.current = false;

    setConnectionStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket opened, waiting for challenge...");
        // Don't send connect immediately - wait for challenge
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // 응답 처리
          if (data.type === "res") {
            const pending = pendingRequests.current.get(data.id);
            if (pending) {
              pendingRequests.current.delete(data.id);
              if (data.ok) {
                pending.resolve(data.payload);
              } else {
                pending.reject(new Error(data.error?.message || "Request failed"));
              }
            }
          }

          // 이벤트 처리
          if (data.type === "event") {
            switch (data.event) {
              case "connect.challenge": {
                // Gateway sends challenge - respond with connect (nonce only used for device auth)
                console.log("Received challenge, sending connect...");
                sendConnectRef.current();
                break;
              }
              case "chat":
                handleChatEventRef.current(data.payload);
                break;
              case "agent":
                handleAgentEventRef.current(data.payload);
                break;
              case "tick":
              case "health":
                // 무시 (heartbeat/health check)
                break;
              default:
                console.log("Unknown event:", data.event, data.payload);
            }
          }
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
      };

      ws.onclose = (event) => {
        setConnectionStatus("disconnected");
        console.log("Gateway disconnected", event.code, event.reason);
        wsRef.current = null;

        // 대기 중인 요청 모두 거부
        pendingRequests.current.forEach((pending) => {
          pending.reject(new Error("Connection closed"));
        });
        pendingRequests.current.clear();

        // 자동 재연결
        if (autoConnect && !event.wasClean) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error("Gateway error:", error);
      };
    } catch (error) {
      console.error("Failed to connect:", error);
      setConnectionStatus("disconnected");
    }
  }, [url, autoConnect, setConnectionStatus]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus("disconnected");
  }, [setConnectionStatus]);

  // 메시지 전송 (chat.send 사용)
  const send = useCallback(
    async (message: string): Promise<string | null> => {
      const currentSessionKey = sessionKeyRef.current;
      if (!currentSessionKey || !message.trim()) return null;

      const runId = generateUUID();

      // 스트리밍 시작 상태 설정
      startStreaming(runId);

      // 이전 대화가 있는 세션에서 보내는 경우, 대화 컨텍스트를 메시지에 포함
      let effectiveMessage = message.trim();
      const msgs = messagesRef.current;
      if (msgs.length > 0) {
        // 현재 메시지를 제외한 이전 메시지들로 컨텍스트 생성
        const prevMessages = msgs.filter(m => m.role === "user" || m.role === "assistant");
        if (prevMessages.length > 0) {
          const contextLines = prevMessages.slice(-20).map(m => {
            const role = m.role === "user" ? "User" : "Assistant";
            const text = (m.content || "").slice(0, 300);
            return `${role}: ${text}`;
          });
          effectiveMessage = `[Previous conversation context]\n${contextLines.join("\n")}\n[End of context]\n\n${effectiveMessage}`;
        }
      }

      try {
        const res = await sendRequest("chat.send", {
          sessionKey: currentSessionKey,
          message: effectiveMessage,
          idempotencyKey: runId,
          deliver: false,
        });

        console.log("chat.send response:", res);
        return runId;
      } catch (error) {
        console.error("Failed to send message:", error);
        streamingError({ runId, error: String(error) });
        return null;
      }
    },
    [sendRequest, startStreaming, streamingError]
  );

  // 실행 중지
  const abort = useCallback(async (): Promise<boolean> => {
    const currentSessionKey = sessionKeyRef.current;
    if (!currentSessionKey) return false;

    try {
      await sendRequest("chat.abort", {
        sessionKey: currentSessionKey,
        runId: chatRunId ?? undefined,
      });
      return true;
    } catch (error) {
      console.error("Failed to abort:", error);
      return false;
    }
  }, [chatRunId, sendRequest]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // 세션 전환
  const switchSession = useCallback(
    async (newSessionKey: string) => {
      // 1. URL 파라미터 업데이트
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("session", newSessionKey);
        window.history.pushState({}, "", url.toString());
      }

      // 2. 상태 업데이트
      setSessionKey(newSessionKey);
      sessionKeyRef.current = newSessionKey;

      // 3. 세션 히스토리 로드
      // UUID 형식인지 확인 (예: agent:axiommind:73571139-e1a1-4351-ac97-6c99fcb9c8b7)
      const sessionId = newSessionKey.split(":").pop() || "";
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);

      if (isUuid) {
        // JSONL 파일에서 직접 히스토리 로드
        try {
          const response = await fetch(`/ax/api/sessions/${sessionId}`);
          if (response.ok) {
            const data = await response.json();
            if (data.messages && data.messages.length > 0) {
              loadHistory({
                messages: data.messages,
                thinkingLevel: null,
              });
              return;
            }
          }
        } catch (error) {
          console.error("Failed to load session from JSONL:", error);
        }
      }

      // 기존 방식으로 히스토리 로드 (게이트웨이 API)
      await fetchHistory();
    },
    [setSessionKey, fetchHistory, loadHistory]
  );

  // 새 세션 생성
  const createNewSession = useCallback(() => {
    const timestamp = Date.now();
    const newSessionKey = `agent:axiommind:new-${timestamp}`;
    switchSession(newSessionKey);
  }, [switchSession]);

  return {
    connectionStatus,
    connected: connectionStatus === "connected",
    sessionKey,
    connect,
    disconnect,
    send,
    abort,
    refetchHistory: fetchHistory,
    switchSession,
    createNewSession,
  };
}
