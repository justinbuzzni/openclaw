"use client";

import { memo } from "react";
import { useAtomValue } from "jotai";
import { connectionStatusAtom, sessionKeyAtom, chatRunIdAtom } from "./_stores/chat";
import { useGateway } from "./_hooks/useGateway";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import { cn } from "@/lib/utils";
import { Brain, Wifi, WifiOff, Loader2, Sparkles, PanelLeft } from "lucide-react";

type ChatWindowProps = {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
};

/**
 * ChatWindow Component
 * Main container for the chat interface.
 */
const ChatWindow = ({ sidebarOpen, onToggleSidebar }: ChatWindowProps) => {
  const { connected } = useGateway();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const sessionKey = useAtomValue(sessionKeyAtom);
  const chatRunId = useAtomValue(chatRunIdAtom);

  const isStreaming = chatRunId !== null;

  // 세션 이름 추출 (agent:axiommind:xxx → xxx)
  const sessionName = sessionKey?.split(":").pop() || "New Chat";

  return (
    <div className="flex flex-col h-full w-full bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-white/5 bg-white/5 backdrop-blur-md shrink-0 z-20">
        <div className="flex items-center gap-3">
          {/* Sidebar Toggle (Mobile) */}
          {!sidebarOpen && onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors md:hidden"
            >
              <PanelLeft className="w-5 h-5 text-white/60" />
            </button>
          )}

          {/* Logo & Title */}
          <div className="relative group">
            <div className="absolute inset-0 bg-primary-500/20 rounded-xl blur-lg group-hover:bg-primary-500/30 transition-all duration-500" />
            <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 border border-white/10 shadow-lg">
              <Brain className="w-5 h-5 text-primary-400" />
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white/90 flex items-center gap-2">
              AxiomMind{" "}
              <span className="text-xs font-normal text-white/40 px-2 py-0.5 rounded-full border border-white/5 bg-white/5">
                Beta
              </span>
            </h1>
            <p className="text-xs text-white/40 mt-0.5 truncate max-w-[200px]">{sessionName}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Streaming Status */}
          {isStreaming && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span className="text-xs font-medium text-blue-300 hidden sm:inline">
                Generating...
              </span>
            </div>
          )}

          {/* Connection Status */}
          <div className="h-4 w-[1px] bg-white/10 mx-1 hidden sm:block" />

          <div
            className="flex items-center gap-2"
            title={`Status: ${connectionStatus}`}
          >
            {connectionStatus === "connected" && (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <Wifi className="w-4 h-4" />
                <span className="text-xs hidden sm:inline">Connected</span>
              </div>
            )}
            {connectionStatus === "connecting" && (
              <div className="flex items-center gap-1.5 text-amber-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs hidden sm:inline">Connecting...</span>
              </div>
            )}
            {connectionStatus === "disconnected" && (
              <div className="flex items-center gap-1.5 text-rose-400">
                <WifiOff className="w-4 h-4" />
                <span className="text-xs hidden sm:inline">Disconnected</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Message List Area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/20 pointer-events-none z-10" />
        <MessageList />
      </div>

      {/* Input Area */}
      <div className="p-4 md:p-6 pb-6 z-20">
        <MessageInput disabled={!connected} />
      </div>
    </div>
  );
};

export default memo(ChatWindow);
