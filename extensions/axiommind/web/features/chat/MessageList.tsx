"use client";

import { memo, useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { messagesAtom, type Message } from "./_stores/chat";
import { cn } from "@/lib/utils";

type MessageItemProps = {
  message: Message;
};

const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex w-full mb-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2",
          isUser
            ? "bg-blue-500 text-white"
            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <span className="text-xs opacity-60 mt-1 block">
          {message.timestamp.toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
});

const MessageList = () => {
  const messages = useAtomValue(messagesAtom);
  const containerRef = useRef<HTMLDivElement>(null);

  // 새 메시지가 추가되면 스크롤
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <p className="text-lg mb-2">🧠 AxiomMind</p>
          <p className="text-sm">메시지를 입력하여 대화를 시작하세요</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  );
};

export default memo(MessageList);
