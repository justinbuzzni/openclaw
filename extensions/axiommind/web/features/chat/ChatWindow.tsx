"use client";

import { memo } from "react";
import { useAtomValue } from "jotai";
import { connectionStatusAtom, sessionKeyAtom, chatRunIdAtom } from "./_stores/chat";
import { useGateway } from "./_hooks/useGateway";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import { cn } from "@/lib/utils";

const ChatWindow = () => {
  const { connected } = useGateway();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const sessionKey = useAtomValue(sessionKeyAtom);
  const chatRunId = useAtomValue(chatRunIdAtom);

  const isStreaming = chatRunId !== null;

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">🧠 AxiomMind Chat</h1>
          {sessionKey && (
            <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
              {sessionKey}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 스트리밍 상태 */}
          {isStreaming && (
            <span className="text-xs text-blue-500 flex items-center gap-1">
              <span className="animate-pulse">●</span>
              응답 중
            </span>
          )}
          {/* 연결 상태 */}
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              connectionStatus === "connected" && "bg-green-500",
              connectionStatus === "connecting" && "bg-yellow-500 animate-pulse",
              connectionStatus === "disconnected" && "bg-red-500"
            )}
          />
          <span className="text-sm text-gray-500">
            {connectionStatus === "connected" && "연결됨"}
            {connectionStatus === "connecting" && "연결 중..."}
            {connectionStatus === "disconnected" && "연결 끊김"}
          </span>
        </div>
      </div>

      {/* 메시지 목록 */}
      <MessageList />

      {/* 입력 영역 */}
      <MessageInput disabled={!connected} />
    </div>
  );
};

export default memo(ChatWindow);
