"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

type ThinkingBlockProps = {
  content: string;
  isStreaming?: boolean;
  initialCollapsed?: boolean;
};

const ThinkingBlock = ({
  content,
  isStreaming = false,
  initialCollapsed = true,
}: ThinkingBlockProps) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  if (!content) return null;

  const lines = content.split("\n");
  const preview = lines.slice(0, 3).join("\n");
  const hasMore = lines.length > 3;

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition-all duration-200",
        "bg-purple-500/5 border-purple-500/20",
        isStreaming && "animate-pulse"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          "hover:bg-purple-500/10"
        )}
      >
        <Brain className="w-4 h-4 text-purple-400" />
        <span className="flex-1 text-xs font-medium text-purple-300">
          {isStreaming ? "Thinking..." : "Thought Process"}
        </span>
        {hasMore && (
          isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-purple-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-purple-400" />
          )
        )}
      </button>

      {/* Content */}
      <div
        className={cn(
          "px-3 pb-3 text-xs text-purple-200/80 whitespace-pre-wrap",
          "transition-all duration-200 overflow-hidden",
          isCollapsed && hasMore ? "max-h-24" : "max-h-none"
        )}
      >
        {isCollapsed && hasMore ? (
          <>
            {preview}
            <span className="text-purple-400/60">...</span>
          </>
        ) : (
          content
        )}
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="h-0.5 bg-gradient-to-r from-purple-500/50 via-purple-400/50 to-purple-500/50 animate-shimmer" />
      )}
    </div>
  );
};

export default memo(ThinkingBlock);
