"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  messagesAtom,
  toolProgressListAtom,
  chatRunIdAtom,
  type Message,
  type ToolProgress,
} from "./_stores/chat";
import { cn } from "@/lib/utils";

// 도구 진행 상태 표시 (접기/펼치기 가능)
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
    <div className="mt-2">
      {/* 요약 헤더 (항상 표시) */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 text-xs px-2 py-1 rounded",
          "bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600",
          "transition-colors cursor-pointer w-full text-left"
        )}
      >
        <span className={cn(
          "transition-transform",
          isExpanded ? "rotate-90" : ""
        )}>
          ▶
        </span>
        {isStreaming && runningCount > 0 ? (
          <span className="flex items-center gap-1">
            <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
            <span>{runningCount}개 실행 중</span>
            {doneCount > 0 && <span className="text-gray-500">({doneCount}개 완료)</span>}
          </span>
        ) : (
          <span>{tools.length}개 도구 사용됨</span>
        )}
      </button>

      {/* 상세 목록 (펼쳤을 때만) */}
      {isExpanded && (
        <div className="flex flex-wrap gap-2 mt-2 pl-4">
          {tools.map((tool, idx) => (
            <div
              key={`${tool.name}-${idx}`}
              className={cn(
                "text-xs px-2 py-1 rounded-full flex items-center gap-1",
                tool.status === "running" && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                tool.status === "done" && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                tool.status === "error" && "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
              )}
            >
              {tool.status === "running" && (
                <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
              )}
              {tool.status === "done" && <span>✓</span>}
              {tool.status === "error" && <span>✗</span>}
              <span>{tool.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// 스트리밍 표시 (점 애니메이션)
const StreamingIndicator = memo(function StreamingIndicator() {
  return (
    <span className="inline-flex gap-1 ml-1">
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
});

// content에서 텍스트 추출
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

// JSON 도구 결과인지 감지
function isToolResultJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    // 도구 결과로 보이는 패턴 감지
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

// 접기/펼치기 가능한 도구 결과 표시
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
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  // 요약 정보 생성
  const summary = parsed.query
    ? `🔍 검색: "${parsed.query}"`
    : parsed.results
      ? `📊 결과 ${parsed.results?.length || 0}건`
      : "📦 도구 실행 결과";

  return (
    <div className="my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 text-xs px-2 py-1 rounded",
          "bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600",
          "transition-colors cursor-pointer text-left"
        )}
      >
        <span
          className={cn("transition-transform", isExpanded ? "rotate-90" : "")}
        >
          ▶
        </span>
        <span>{summary}</span>
        {parsed.tookMs && (
          <span className="text-gray-500">({parsed.tookMs}ms)</span>
        )}
      </button>

      {isExpanded && (
        <pre className="mt-2 p-2 rounded bg-gray-100 dark:bg-gray-800 text-xs overflow-x-auto max-h-60 overflow-y-auto">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
});

// 마크다운 렌더러 컴포넌트
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 코드 블록
        code({ node, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match && !className;

          if (isInline) {
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          }

          return (
            <div className="relative my-2">
              {match && (
                <div className="absolute top-0 right-0 px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                  {match[1]}
                </div>
              )}
              <pre className="p-3 rounded-lg bg-gray-900 dark:bg-gray-950 overflow-x-auto">
                <code className={cn("text-sm font-mono text-gray-100", className)} {...props}>
                  {children}
                </code>
              </pre>
            </div>
          );
        },
        // 링크
        a({ href, children, ...props }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
              {...props}
            >
              {children}
            </a>
          );
        },
        // 리스트
        ul({ children, ...props }) {
          return (
            <ul className="list-disc list-inside my-2 space-y-1" {...props}>
              {children}
            </ul>
          );
        },
        ol({ children, ...props }) {
          return (
            <ol className="list-decimal list-inside my-2 space-y-1" {...props}>
              {children}
            </ol>
          );
        },
        li({ children, ...props }) {
          return (
            <li className="ml-2" {...props}>
              {children}
            </li>
          );
        },
        // 헤딩
        h1({ children, ...props }) {
          return <h1 className="text-xl font-bold mt-4 mb-2" {...props}>{children}</h1>;
        },
        h2({ children, ...props }) {
          return <h2 className="text-lg font-bold mt-3 mb-2" {...props}>{children}</h2>;
        },
        h3({ children, ...props }) {
          return <h3 className="text-base font-bold mt-2 mb-1" {...props}>{children}</h3>;
        },
        // 단락
        p({ children, ...props }) {
          return <p className="my-1" {...props}>{children}</p>;
        },
        // 인용
        blockquote({ children, ...props }) {
          return (
            <blockquote
              className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-2 italic text-gray-600 dark:text-gray-400"
              {...props}
            >
              {children}
            </blockquote>
          );
        },
        // 테이블
        table({ children, ...props }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600" {...props}>
                {children}
              </table>
            </div>
          );
        },
        thead({ children, ...props }) {
          return (
            <thead className="bg-gray-100 dark:bg-gray-800" {...props}>
              {children}
            </thead>
          );
        },
        th({ children, ...props }) {
          return (
            <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-semibold" {...props}>
              {children}
            </th>
          );
        },
        td({ children, ...props }) {
          return (
            <td className="border border-gray-300 dark:border-gray-600 px-3 py-2" {...props}>
              {children}
            </td>
          );
        },
        // 구분선
        hr({ ...props }) {
          return <hr className="my-4 border-gray-300 dark:border-gray-600" {...props} />;
        },
        // 강조
        strong({ children, ...props }) {
          return <strong className="font-bold" {...props}>{children}</strong>;
        },
        em({ children, ...props }) {
          return <em className="italic" {...props}>{children}</em>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

type MessageItemProps = {
  message: Message;
  showToolProgress?: boolean;
};

const MessageItem = memo(function MessageItem({ message, showToolProgress }: MessageItemProps) {
  const isUser = message.role === "user";
  const tools = useAtomValue(toolProgressListAtom);
  const text = getMessageText(message.content);

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
        <div className="break-words">
          {text ? (
            isUser ? (
              // 사용자 메시지는 일반 텍스트로 표시
              <span className="whitespace-pre-wrap">{text}</span>
            ) : isToolResultJson(text) ? (
              // 도구 결과 JSON은 접기/펼치기로 표시
              <CollapsibleToolResult content={text} />
            ) : (
              // 어시스턴트 메시지는 마크다운으로 렌더링
              <MarkdownContent content={text} />
            )
          ) : (
            message.isStreaming && <span className="text-gray-400">응답 생성 중...</span>
          )}
          {message.isStreaming && <StreamingIndicator />}
        </div>

        {/* 도구 진행 상태 (스트리밍 중인 메시지에만) */}
        {showToolProgress && message.isStreaming && (
          <ToolProgressIndicator tools={tools} isStreaming={message.isStreaming} />
        )}

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
  const chatRunId = useAtomValue(chatRunIdAtom);
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
        <MessageItem
          key={message.id}
          message={message}
          showToolProgress={message.id === chatRunId}
        />
      ))}
    </div>
  );
};

export default memo(MessageList);
