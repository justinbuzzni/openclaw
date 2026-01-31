"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAtom, useSetAtom } from "jotai";
import { connectionStatusAtom, addMessageAtom, type ConnectionStatus } from "../_stores/chat";

type UseGatewayOptions = {
  url?: string;
  autoConnect?: boolean;
};

export function useGateway(options: UseGatewayOptions = {}) {
  const { url = "ws://localhost:18789/", autoConnect = true } = options;

  const [connectionStatus, setConnectionStatus] = useAtom(connectionStatusAtom);
  const addMessage = useSetAtom(addMessageAtom);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus("connected");
        console.log("Gateway connected");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // OpenClaw 게이트웨이 프로토콜에 따른 메시지 처리
          if (data.type === "message" && data.message) {
            addMessage({
              role: data.message.role || "assistant",
              content: data.message.content || "",
            });
          }
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
      };

      ws.onclose = () => {
        setConnectionStatus("disconnected");
        console.log("Gateway disconnected");

        // 자동 재연결
        if (autoConnect) {
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
  }, [url, autoConnect, setConnectionStatus, addMessage]);

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

  const send = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "message",
          content: message,
        })
      );
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    connectionStatus,
    connected: connectionStatus === "connected",
    connect,
    disconnect,
    send,
  };
}
