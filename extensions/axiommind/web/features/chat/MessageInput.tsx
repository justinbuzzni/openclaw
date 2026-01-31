"use client";

import { memo, useCallback, type KeyboardEvent, type ChangeEvent } from "react";
import { useAtom, useSetAtom } from "jotai";
import { inputMessageAtom, sendMessageAtom } from "./_stores/chat";
import { cn } from "@/lib/utils";

type MessageInputProps = {
  disabled?: boolean;
};

const MessageInput = ({ disabled = false }: MessageInputProps) => {
  const [inputMessage, setInputMessage] = useAtom(inputMessageAtom);
  const sendMessage = useSetAtom(sendMessageAtom);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setInputMessage(e.target.value);
    },
    [setInputMessage]
  );

  const handleSend = useCallback(() => {
    if (inputMessage.trim() && !disabled) {
      sendMessage(inputMessage);
    }
  }, [inputMessage, disabled, sendMessage]);

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
          placeholder={disabled ? "연결 중..." : "메시지를 입력하세요..."}
          disabled={disabled}
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
        <button
          onClick={handleSend}
          disabled={disabled || !inputMessage.trim()}
          className={cn(
            "px-4 py-2 rounded-lg font-medium",
            "bg-blue-500 text-white",
            "hover:bg-blue-600 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          전송
        </button>
      </div>
    </div>
  );
};

export default memo(MessageInput);
