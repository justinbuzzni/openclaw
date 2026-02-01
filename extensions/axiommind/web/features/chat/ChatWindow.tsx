"use client";

import { memo } from "react";
import { useAtomValue } from "jotai";
import { connectionStatusAtom, sessionKeyAtom, chatRunIdAtom } from "./_stores/chat";
import { useGateway } from "./_hooks/useGateway";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import { cn } from "@/lib/utils";
import { Brain, Wifi, WifiOff, Loader2, Sparkles } from "lucide-react";

/**
 * ChatWindow Component
 * Main container for the chat interface.
 */
const ChatWindow = () => {
  const { connected } = useGateway();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const sessionKey = useAtomValue(sessionKeyAtom);
  const chatRunId = useAtomValue(chatRunIdAtom);

  const isStreaming = chatRunId !== null;

  return (
    <div className="flex flex-col h-full w-full bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5 backdrop-blur-md shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="relative group">
             <div className="absolute inset-0 bg-primary-500/20 rounded-xl blur-lg group-hover:bg-primary-500/30 transition-all duration-500" />
             <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 border border-white/10 shadow-lg">
                <Brain className="w-5 h-5 text-primary-400" />
             </div>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white/90 flex items-center gap-2">
              AxiomMind <span className="text-xs font-normal text-white/40 px-2 py-0.5 rounded-full border border-white/5 bg-white/5">Beta</span>
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
               {sessionKey ? (
                 <span className="text-[10px] uppercase tracking-wider font-semibold text-white/30 truncate max-w-[150px]">
                   SESSION: {sessionKey}
                 </span>
               ) : (
                 <span className="text-[10px] text-white/30">Ready to Initialize</span>
               )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Streaming Status */}
          {isStreaming && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span className="text-xs font-medium text-blue-300">Generating...</span>
            </div>
          )}

          {/* Connection Status */}
          <div className="h-4 w-[1px] bg-white/10 mx-1" />
          
          <div className="flex items-center gap-2" title={`Status: ${connectionStatus}`}>
            {connectionStatus === "connected" && (
                <div className="flex items-center gap-1.5 text-emerald-400">
                    <Wifi className="w-4 h-4" />
                </div>
            )}
             {connectionStatus === "connecting" && (
                <div className="flex items-center gap-1.5 text-amber-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                </div>
            )}
             {connectionStatus === "disconnected" && (
                <div className="flex items-center gap-1.5 text-rose-400">
                    <WifiOff className="w-4 h-4" />
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
