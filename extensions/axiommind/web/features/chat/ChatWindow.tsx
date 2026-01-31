"use client";

import { memo } from "react";
import { useAtomValue } from "jotai";
import { connectionStatusAtom } from "./_stores/chat";
import { useGateway } from "./_hooks/useGateway";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import { cn } from "@/lib/utils";

const ChatWindow = () => {
  const { connected } = useGateway();
  const connectionStatus = useAtomValue(connectionStatusAtom);

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <h1 className="text-lg font-semibold">🧠 AxiomMind Chat</h1>
        <div className="flex items-center gap-2">
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
