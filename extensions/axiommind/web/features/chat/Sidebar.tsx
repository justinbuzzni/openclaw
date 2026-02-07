"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Plus,
  MessageSquare,
  Clock,
  ChevronLeft,
  PanelLeftClose,
  PanelLeft,
  Search,
  Settings,
  Sparkles,
  Download,
  Loader2,
  CheckCircle,
  Timer,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  fetchSessions,
  importAllSessions,
  fetchImportStatuses,
  deleteSession,
} from "./_api/sessions";
import { sessionKeyAtom } from "./_stores/chat";
import {
  sessionsListAtom,
  sessionsLoadingAtom,
  loadSessionsAtom,
  startLoadingSessionsAtom,
  sessionsRefreshTriggerAtom,
  type SessionSummary,
} from "./_stores/session";

type SidebarProps = {
  isOpen: boolean;
  onToggle: () => void;
  onSwitchSession: (sessionKey: string) => void;
  onNewSession: () => void;
};

/**
 * 날짜 라벨별로 세션 그룹화 (최신순)
 * 같은 라벨(예: "Previous 7 Days")에 속하는 세션들을 하나의 그룹으로 통합
 */
function groupSessionsByDate(sessions: SessionSummary[]): Map<string, SessionSummary[]> {
  const groups = new Map<string, SessionSummary[]>();

  // 날짜 내림차순 정렬
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  for (const session of sorted) {
    const label = formatDateLabel(session.date);
    const existing = groups.get(label) || [];
    existing.push(session);
    groups.set(label, existing);
  }

  return groups;
}

/**
 * 날짜 포맷팅 (오늘, 어제, 최근 7일, 이전)
 */
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const dateOnly = (d: Date) => d.toISOString().split("T")[0];

  if (dateOnly(date) === dateOnly(today)) {
    return "Today";
  }
  if (dateOnly(date) === dateOnly(yesterday)) {
    return "Yesterday";
  }
  if (date >= weekAgo) {
    return "Previous 7 Days";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * 세션 ID를 sessionKey 형식으로 변환
 */
function sessionIdToSessionKey(sessionId: string): string {
  return `agent:axiommind:${sessionId}`;
}

/**
 * 세션 아이템 컴포넌트
 */
const SessionItem = memo(
  ({
    session,
    isActive,
    isImported,
    onSelect,
    onDelete,
  }: {
    session: SessionSummary;
    isActive: boolean;
    isImported: boolean;
    onSelect: () => void;
    onDelete: () => void;
  }) => {
    return (
      <div
        className={cn(
          "w-full group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer",
          "hover:bg-white/8 active:scale-[0.98]",
          isActive && "bg-white/10 hover:bg-white/12",
        )}
        onClick={onSelect}
      >
        <MessageSquare
          className={cn(
            "w-4 h-4 shrink-0 transition-colors",
            isActive ? "text-primary-400" : "text-white/40 group-hover:text-white/60",
          )}
        />
        <div className="flex-1 min-w-0 text-left">
          <span
            className={cn(
              "block text-sm truncate transition-colors",
              isActive ? "text-white font-medium" : "text-white/70 group-hover:text-white/90",
            )}
          >
            {session.title || `Session ${session.sessionId}`}
          </span>
          <div className="flex items-center gap-2">
            {session.entryCount > 0 && (
              <span className="text-[10px] text-white/30 group-hover:text-white/40">
                {session.entryCount} messages
              </span>
            )}
            {isImported && <CheckCircle className="w-3 h-3 text-emerald-400/50" />}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-500/20 transition-all"
          title="Delete session"
        >
          <Trash2 className="w-3.5 h-3.5 text-white/30 hover:text-red-400" />
        </button>
      </div>
    );
  },
);

SessionItem.displayName = "SessionItem";

/**
 * Sidebar Component
 * ChatGPT/Claude 스타일의 사이드바
 */
const Sidebar = ({ isOpen, onToggle, onSwitchSession, onNewSession }: SidebarProps) => {
  const sessions = useAtomValue(sessionsListAtom);
  const isLoading = useAtomValue(sessionsLoadingAtom);
  const currentSessionKey = useAtomValue(sessionKeyAtom);
  const loadSessions = useSetAtom(loadSessionsAtom);
  const startLoading = useSetAtom(startLoadingSessionsAtom);

  const refreshTrigger = useAtomValue(sessionsRefreshTriggerAtom);

  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(
    null,
  );
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [hideCron, setHideCron] = useState(true);

  // Import 상태 로드
  const loadImportStatuses = useCallback(async () => {
    try {
      const result = await fetchImportStatuses();
      const ids = new Set<string>();
      for (const s of result.statuses) {
        if (s.imported) ids.add(s.sessionFileId);
      }
      setImportedIds(ids);
    } catch {
      // 무시
    }
  }, []);

  // 전체 import 핸들러
  const handleImportAll = useCallback(async () => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const result = await importAllSessions();
      setImportResult({ imported: result.imported, skipped: result.skipped });
      await loadImportStatuses();
    } catch (error) {
      console.error("Failed to import sessions:", error);
    } finally {
      setIsImporting(false);
    }
  }, [loadImportStatuses]);

  // 초기 세션 로드
  const handleLoadSessions = useCallback(async () => {
    startLoading();
    try {
      const result = await fetchSessions({ limit: 100, excludeCron: hideCron });
      loadSessions(result.sessions);
    } catch (error) {
      console.error("Failed to load sessions:", error);
      loadSessions([]);
    }
  }, [startLoading, loadSessions, hideCron]);

  // 컴포넌트 마운트 시, hideCron 변경 시, 대화 완료 시 세션 + import 상태 로드
  useEffect(() => {
    handleLoadSessions();
    loadImportStatuses();
  }, [handleLoadSessions, loadImportStatuses, refreshTrigger]);

  // 세션 선택 핸들러
  const handleSelectSession = useCallback(
    (session: SessionSummary) => {
      const sessionKey = sessionIdToSessionKey(session.id);
      onSwitchSession(sessionKey);
    },
    [onSwitchSession],
  );

  // 세션 삭제 핸들러
  const handleDeleteSession = useCallback(
    async (session: SessionSummary) => {
      if (!confirm(`Delete "${session.title || `Session ${session.sessionId}`}"?`)) return;
      try {
        await deleteSession(session.id);
        handleLoadSessions();
      } catch (error) {
        console.error("Failed to delete session:", error);
      }
    },
    [handleLoadSessions],
  );

  const groupedSessions = groupSessionsByDate(sessions);

  return (
    <>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={onToggle}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{
          width: isOpen ? 280 : 0,
          opacity: isOpen ? 1 : 0,
        }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={cn(
          "h-full bg-gray-900/80 backdrop-blur-xl border-r border-white/5 flex flex-col overflow-hidden",
          "fixed md:relative z-50 md:z-auto",
          !isOpen && "pointer-events-none md:pointer-events-auto",
        )}
      >
        <div className="flex flex-col h-full w-[280px]">
          {/* Header */}
          <div className="p-3 border-b border-white/5 space-y-2">
            {/* New Chat Button */}
            <button
              onClick={onNewSession}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl",
                "bg-gradient-to-r from-primary-500/20 to-primary-600/20",
                "hover:from-primary-500/30 hover:to-primary-600/30",
                "border border-primary-500/20 hover:border-primary-500/30",
                "transition-all duration-200 group",
              )}
            >
              <div className="p-1.5 rounded-lg bg-primary-500/20 group-hover:bg-primary-500/30 transition-colors">
                <Plus className="w-4 h-4 text-primary-400" />
              </div>
              <span className="text-sm font-medium text-white/90">New Chat</span>
            </button>

            {/* Import to Memory Button */}
            <button
              onClick={handleImportAll}
              disabled={isImporting}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl",
                "bg-emerald-500/10 hover:bg-emerald-500/20",
                "border border-emerald-500/15 hover:border-emerald-500/25",
                "transition-all duration-200 group disabled:opacity-50",
              )}
            >
              <div className="p-1.5 rounded-lg bg-emerald-500/15 group-hover:bg-emerald-500/25 transition-colors">
                {isImporting ? (
                  <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 text-emerald-400" />
                )}
              </div>
              <span className="text-sm font-medium text-emerald-300/80">
                {isImporting ? "Importing..." : "Import to Memory"}
              </span>
            </button>

            {/* Import Result */}
            {importResult && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-xs text-emerald-400">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>
                  {importResult.imported} imported
                  {importResult.skipped > 0 && `, ${importResult.skipped} skipped`}
                </span>
              </div>
            )}
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                <span className="mt-3 text-xs text-white/40">Loading sessions...</span>
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="p-4 rounded-2xl bg-white/5 mb-4">
                  <Sparkles className="w-8 h-8 text-white/20" />
                </div>
                <span className="text-sm text-white/50 text-center">No conversations yet</span>
                <span className="text-xs text-white/30 text-center mt-1">
                  Start a new chat to begin
                </span>
              </div>
            ) : (
              <div className="p-2">
                {Array.from(groupedSessions.entries()).map(([label, dateSessions]) => (
                  <div key={label} className="mb-4">
                    {/* Date Header */}
                    <div className="px-3 py-2 sticky top-0 bg-gray-900/80 backdrop-blur-sm z-10">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/30">
                        {label}
                      </span>
                    </div>

                    {/* Sessions for this date */}
                    <div className="space-y-0.5">
                      {dateSessions.map((session) => {
                        const isActive = currentSessionKey === sessionIdToSessionKey(session.id);
                        return (
                          <SessionItem
                            key={session.id}
                            session={session}
                            isActive={isActive}
                            isImported={importedIds.has(session.id)}
                            onSelect={() => handleSelectSession(session)}
                            onDelete={() => handleDeleteSession(session)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/5 space-y-1">
            <button
              onClick={() => setHideCron((prev) => !prev)}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
                "text-xs hover:bg-white/5 transition-all duration-200",
                hideCron
                  ? "text-white/30 hover:text-white/50"
                  : "text-amber-400/60 hover:text-amber-400/80",
              )}
            >
              {hideCron ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {hideCron ? "Show cron sessions" : "Hide cron sessions"}
            </button>
            <button
              onClick={handleLoadSessions}
              disabled={isLoading}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
                "text-xs text-white/40 hover:text-white/60 hover:bg-white/5",
                "transition-all duration-200 disabled:opacity-50",
              )}
            >
              {isLoading ? "Refreshing..." : "Refresh sessions"}
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Toggle Button (Floating) */}
      <button
        onClick={onToggle}
        className={cn(
          "fixed md:absolute top-4 z-50 p-2 rounded-lg",
          "bg-gray-800/80 hover:bg-gray-700/80 backdrop-blur-sm",
          "border border-white/10 hover:border-white/20",
          "transition-all duration-200",
          isOpen ? "left-[292px] md:left-[292px]" : "left-4 md:left-4",
        )}
        title={isOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isOpen ? (
          <PanelLeftClose className="w-4 h-4 text-white/60" />
        ) : (
          <PanelLeft className="w-4 h-4 text-white/60" />
        )}
      </button>
    </>
  );
};

export default memo(Sidebar);
