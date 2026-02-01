"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import {
  messagesAtom,
  toolProgressListAtom,
  chatRunIdAtom,
  memoryOperationsAtom,
  type Message,
  type ToolProgress,
} from "./_stores/chat";
import MemoryOperationIndicator from "./MemoryOperationIndicator";
import ThinkingBlock from "./ThinkingBlock";
import { cn } from "@/lib/utils";
import { Bot, User, ChevronRight, CheckCircle2, XCircle, Loader2, Code2, Terminal } from "lucide-react";

// Tool Progress Indicator (Collapsible)
const ToolProgressIndicator = memo(function ToolProgressIndicator({
  tools,
  isStreaming,
}: {
  tools: ToolProgress[];
  isStreaming?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (tools.length === 0) return null;

  const runningCount = tools.filter((t) => t.status === "running").length;
  const doneCount = tools.filter((t) => t.status === "done").length;

  return (
    <div className="mt-3 mb-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg",
          "bg-white/5 hover:bg-white/10 border border-white/5",
          "transition-all duration-200 cursor-pointer w-full text-left group"
        )}
      >
        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform text-gray-500", isExpanded ? "rotate-90" : "")} />
        
        {isStreaming && runningCount > 0 ? (
          <span className="flex items-center gap-2 text-blue-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="font-medium">{runningCount} tools executing...</span>
            {doneCount > 0 && <span className="text-gray-500 font-normal">({doneCount} completed)</span>}
          </span>
        ) : (
          <span className="text-gray-400 group-hover:text-gray-300">{tools.length} ecosystem tools used</span>
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1.5 mt-2 pl-2 border-l border-white/10 ml-2">
              {tools.map((tool, idx) => (
                <div
                  key={`${tool.name}-${idx}`}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-md flex items-center justify-between gap-2 border",
                    tool.status === "running" && "bg-blue-500/10 border-blue-500/20 text-blue-200",
                    tool.status === "done" && "bg-emerald-500/5 border-emerald-500/10 text-emerald-300",
                    tool.status === "error" && "bg-rose-500/10 border-rose-500/20 text-rose-300"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {tool.status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
                    {tool.status === "done" && <CheckCircle2 className="w-3 h-3" />}
                    {tool.status === "error" && <XCircle className="w-3 h-3" />}
                    <span className="font-mono">{tool.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// Streaming typing indicator
const StreamingIndicator = memo(function StreamingIndicator() {
  return (
    <span className="inline-flex gap-1 ml-1 translate-y-[2px]">
      <span className="w-1.5 h-1.5 bg-current opacity-40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 bg-current opacity-40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 bg-current opacity-40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
});

function getMessageText(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block.type === "text" && typeof block.text === "string") {
          return block.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function isToolResultJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return (
      parsed.query !== undefined ||
      parsed.results !== undefined ||
      parsed.output !== undefined ||
      parsed.tookMs !== undefined ||
      parsed.provider !== undefined
    );
  } catch {
    return false;
  }
}

const CollapsibleToolResult = memo(function CollapsibleToolResult({
  content,
}: {
  content: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  let parsed: any = null;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return <span className="whitespace-pre-wrap font-mono text-xs">{content}</span>;
  }

  const summary = parsed.query
    ? `Searching: "${parsed.query}"`
    : parsed.results
      ? `Found ${parsed.results?.length || 0} results`
      : "Tool Output";

  return (
    <div className="my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 text-xs px-3 py-2 rounded-lg w-full text-left",
          "bg-black/20 hover:bg-black/30 border border-white/5",
          "text-gray-300 font-mono transition-colors"
        )}
      >
        <Terminal className="w-3.5 h-3.5 text-gray-500" />
        <span className="flex-1 truncate">{summary}</span>
        {parsed.tookMs && (
          <span className="text-[10px] text-gray-600">({parsed.tookMs}ms)</span>
        )}
        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", isExpanded ? "rotate-90" : "")} />
      </button>

      {isExpanded && (
        <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-white/5 text-[10px] text-gray-400 overflow-x-auto font-mono scrollbar-thin">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
});

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !className;

            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono text-[0.9em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <div className="relative my-3 rounded-lg overflow-hidden border border-white/10 bg-[#1e1e1e] shadow-lg">
                <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
                  <div className="flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-gray-500" />
                      <span className="text-xs text-gray-400 font-mono">{match?.[1] || 'code'}</span>
                  </div>
                </div>
                <pre className="p-4 overflow-x-auto">
                  <code className={cn("text-sm font-mono text-gray-200", className)} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300 underline underline-offset-4 decoration-primary-400/50 hover:decoration-primary-300">
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc list-outside ml-4 space-y-1 marker:text-gray-500">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-outside ml-4 space-y-1 marker:text-gray-500">{children}</ol>,
        blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary-500/50 pl-4 my-2 italic text-gray-400 bg-primary-500/5 py-2 pr-2 rounded-r-lg">
              {children}
            </blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
});

type MessageItemProps = {
  message: Message;
  showToolProgress?: boolean;
};

const MessageItem = memo(function MessageItem({ message, showToolProgress }: MessageItemProps) {
  const isUser = message.role === "user";
  const tools = useAtomValue(toolProgressListAtom);
  const memoryOps = useAtomValue(memoryOperationsAtom);
  const text = getMessageText(message.content);
  const hasMemoryOps = memoryOps.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "flex w-full mb-8 gap-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
        {!isUser && (
            <div className="w-8 h-8 rounded-full bg-surface border border-white/10 flex items-center justify-center shrink-0 mt-1 shadow-lg">
                <Bot className="w-5 h-5 text-primary-400" />
            </div>
        )}

      <div
        className={cn(
          "max-w-[85%] lg:max-w-[75%] rounded-2xl px-6 py-4 shadow-md",
          isUser
            ? "bg-gradient-to-br from-primary-600 to-primary-700 text-white rounded-tr-sm"
            : "bg-surface/80 dark:bg-[#1a1b22] border border-white/5 text-gray-100 rounded-tl-sm backdrop-blur-md"
        )}
      >
        {/* Thinking Block (Extended Thinking / Chain-of-Thought) */}
        {!isUser && message.thinkingContent && (
          <div className="mb-4">
            <ThinkingBlock
              content={message.thinkingContent}
              isStreaming={message.isThinkingStreaming}
            />
          </div>
        )}

        <div className="break-words leading-relaxed">
          {text ? (
            isUser ? (
              <span className="whitespace-pre-wrap text-[15px]">{text}</span>
            ) : isToolResultJson(text) ? (
              <CollapsibleToolResult content={text} />
            ) : (
              <MarkdownContent content={text} />
            )
          ) : (
            message.isStreaming && <span className="text-gray-400 italic">Thinking...</span>
          )}
          {message.isStreaming && <StreamingIndicator />}
        </div>

        {/* Memory Operation Progress (shows save/recall/search operations) */}
        {showToolProgress && message.isStreaming && hasMemoryOps && (
          <MemoryOperationIndicator isStreaming={message.isStreaming} />
        )}

        {/* Tool Progress (Only for active streaming message or last assistant message if relevant) */}
        {showToolProgress && message.isStreaming && (
          <ToolProgressIndicator tools={tools} isStreaming={message.isStreaming} />
        )}

        <div className={cn("text-[10px] mt-2 opacity-40 uppercase tracking-widest font-medium", isUser ? "text-blue-100" : "text-gray-500")}>
           AxiomMind &bull; {message.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

       {isUser && (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center shrink-0 mt-1 shadow-lg border border-white/10">
                <User className="w-5 h-5 text-gray-300" />
            </div>
        )}
    </motion.div>
  );
});

const MessageList = () => {
  const messages = useAtomValue(messagesAtom);
  const chatRunId = useAtomValue(chatRunIdAtom);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
        // Smooth scroll
      containerRef.current.scrollTo({
          top: containerRef.current.scrollHeight,
          behavior: "smooth"
      });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center space-y-4 max-w-md px-6">
            <div className="w-20 h-20 bg-primary-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6 backdrop-blur-xl border border-primary-500/20 shadow-[0_0_40px_-10px_rgba(99,102,241,0.3)]">
                 <Bot className="w-10 h-10 text-primary-400" />
            </div>
            <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
                Welcome to AxiomMind
            </h2>
            <p className="text-gray-400 leading-relaxed">
                Your advanced memory graduation pipeline is ready. Start a conversation to explore your knowledge base.
            </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-y-auto p-4 md:p-6 scrollbar-thin scrollbar-thumb-gray-700/50 scrollbar-track-transparent">
        <div className="max-w-4xl mx-auto pb-4">
            {messages.map((message) => (
                <MessageItem
                key={message.id}
                message={message}
                showToolProgress={message.id === chatRunId}
                />
            ))}
        </div>
    </div>
  );
};

export default memo(MessageList);
