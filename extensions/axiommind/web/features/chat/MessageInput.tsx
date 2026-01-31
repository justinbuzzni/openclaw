"use client";

import { memo, useCallback, type KeyboardEvent, type ChangeEvent } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { inputMessageAtom, sendMessageAtom, chatRunIdAtom } from "./_stores/chat";
import { useGateway } from "./_hooks/useGateway";
import { cn } from "@/lib/utils";

type MessageInputProps = {
  disabled?: boolean;
};

const MessageInput = ({ disabled = false }: MessageInputProps) => {
  const [inputMessage, setInputMessage] = useAtom(inputMessageAtom);
  const sendMessageAction = useSetAtom(sendMessageAtom);
  const chatRunId = useAtomValue(chatRunIdAtom);
  const { send, abort, connected } = useGateway();

  const isStreaming = chatRunId !== null;
  const isDisabled = disabled || !connected;

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setInputMessage(e.target.value);
    },
    [setInputMessage]
  );

  const handleSend = useCallback(async () => {
    if (!inputMessage.trim() || isDisabled || isStreaming) return;

    // UI에 사용자 메시지 추가
    sendMessageAction(inputMessage);

    // 게이트웨이로 전송
    await send(inputMessage);
  }, [inputMessage, isDisabled, isStreaming, sendMessageAction, send]);

  const handleAbort = useCallback(async () => {
    await abort();
  }, [abort]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-end gap-2">
        <textarea
          value={inputMessage}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            !connected
              ? "연결 중..."
              : isStreaming
                ? "응답 생성 중..."
                : "메시지를 입력하세요..."
          }
          disabled={isDisabled || isStreaming}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-700",
            "bg-white dark:bg-gray-900 px-4 py-2",
            "focus:outline-none focus:ring-2 focus:ring-blue-500",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "max-h-32"
          )}
          style={{
            height: "auto",
            minHeight: "40px",
          }}
        />
        {isStreaming ? (
          <button
            onClick={handleAbort}
            className={cn(
              "px-4 py-2 rounded-lg font-medium",
              "bg-red-500 text-white",
              "hover:bg-red-600 transition-colors"
            )}
          >
            중지
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={isDisabled || !inputMessage.trim()}
            className={cn(
              "px-4 py-2 rounded-lg font-medium",
              "bg-blue-500 text-white",
              "hover:bg-blue-600 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            전송
          </button>
        )}
      </div>
    </div>
  );
};

export default memo(MessageInput);
