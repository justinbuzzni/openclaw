"use client";

import { memo, useCallback, type KeyboardEvent, type ChangeEvent, useRef, useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { inputMessageAtom, sendMessageAtom, chatRunIdAtom, connectionStatusAtom, attachmentsAtom } from "./_stores/chat";
import { useGateway } from "./_hooks/useGateway";
import { cn } from "@/lib/utils";
import { ArrowUp, StopCircle, Loader2 } from "lucide-react";
import ThinkingModeToggle from "./ThinkingModeToggle";
import FileAttachment from "./FileAttachment";

type MessageInputProps = {
  disabled?: boolean;
};

const MessageInput = ({ disabled = false }: MessageInputProps) => {
  const [inputMessage, setInputMessage] = useAtom(inputMessageAtom);
  const [attachments, setAttachments] = useAtom(attachmentsAtom);
  const sendMessageAction = useSetAtom(sendMessageAtom);
  const chatRunId = useAtomValue(chatRunIdAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const { send, abort, connected } = useGateway();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = chatRunId !== null;
  const isDisabled = disabled || !connected;
  const isConnecting = connectionStatus === "connecting";

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputMessage]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setInputMessage(e.target.value);
    },
    [setInputMessage]
  );

  const handleSend = useCallback(async () => {
    if (!inputMessage.trim() || isDisabled || isStreaming) return;

    sendMessageAction(inputMessage);
    await send(inputMessage);

    // Reset height
    if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
    }

    // Clear attachments after send
    if (attachments.length > 0) {
      // Revoke object URLs to avoid memory leaks
      attachments.forEach((a) => {
        if (a.preview) URL.revokeObjectURL(a.preview);
      });
      setAttachments([]);
    }
  }, [inputMessage, isDisabled, isStreaming, sendMessageAction, send, attachments, setAttachments]);

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
    <div className="w-full max-w-4xl mx-auto">
      <div className="relative group">
        {/* Glow effect */}
        <div className={cn(
            "absolute inset-0 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500",
            "bg-gradient-to-r from-primary-500/20 via-blue-500/20 to-primary-500/20 blur-xl"
        )} />
        
        <div className={cn(
            "relative flex items-end gap-2 p-2 pr-3 rounded-2xl transition-all duration-300",
            "bg-white/80 dark:bg-[#1a1b22]/90 backdrop-blur-xl",
            "border border-gray-200 dark:border-white/10",
            "hover:border-gray-300 dark:hover:border-white/20",
            "focus-within:border-primary-500/50 dark:focus-within:border-primary-500/50",
            "shadow-lg dark:shadow-black/20"
        )}>
          {/* Connecting Overlay */}
          {isConnecting && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-[1px] rounded-2xl">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-full shadow-sm">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                      <span className="text-xs text-gray-500">Connecting to Brain...</span>
                  </div>
              </div>
          )}

          {/* Input Area */}
          <div className="flex-1 flex flex-col">
            {/* Toolbar Row */}
            <div className="flex items-center gap-2 px-2 pt-2 pb-1 border-b border-gray-100 dark:border-white/5">
              <ThinkingModeToggle />
              <FileAttachment />
            </div>

            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={
                !connected
                  ? "Waiting for connection..."
                  : isStreaming
                    ? "AxiomMind is thinking..."
                    : "Ask anything about your memory..."
              }
              disabled={isDisabled || isStreaming}
              rows={1}
              className={cn(
                "w-full bg-transparent border-none outline-none resize-none",
                "text-base text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500",
                "px-4 py-3 max-h-48 min-h-[52px]",
                "scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
              )}
            />
          </div>
          
          <div className="pb-2">
            {isStreaming ? (
              <button
                onClick={handleAbort}
                className={cn(
                  "p-2 rounded-xl flex items-center justify-center transition-all duration-200",
                  "bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700",
                  "border border-gray-200 dark:border-gray-700 shadow-sm"
                )}
                title="Stop Interaction"
              >
                 <StopCircle className="w-5 h-5 animate-pulse text-red-500" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={isDisabled || !inputMessage.trim()}
                className={cn(
                  "p-2 rounded-xl flex items-center justify-center transition-all duration-200",
                  inputMessage.trim() && !isDisabled
                    ? "bg-primary-600 hover:bg-primary-700 text-white shadow-md shadow-primary-500/20 transform hover:scale-105 active:scale-95"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"
                )}
              >
                <ArrowUp className="w-5 h-5 font-bold" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="mt-3 text-center">
         <p className="text-[10px] text-gray-400 dark:text-gray-600">
            AxiomMind AI can make mistakes. Verify important information.
         </p>
      </div>
    </div>
  );
};

export default memo(MessageInput);
