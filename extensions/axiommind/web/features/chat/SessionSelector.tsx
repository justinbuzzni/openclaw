"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Clock, MessageSquare, Plus, Calendar, Check, Download, CheckCircle, Loader2 } from "lucide-react";
import {
  sessionsListAtom,
  sessionsLoadingAtom,
  sessionsPanelOpenAtom,
  loadSessionsAtom,
  startLoadingSessionsAtom,
  type SessionSummary,
} from "./_stores/session";
import { sessionKeyAtom } from "./_stores/chat";
import { fetchSessions, importAllSessions, fetchImportStatuses, type ImportStatus } from "./_api/sessions";

type SessionSelectorProps = {
  onSwitchSession: (sessionKey: string) => void;
  onNewSession: () => void;
};

/**
 * 날짜별로 세션 그룹화
 */
function groupSessionsByDate(sessions: SessionSummary[]): Map<string, SessionSummary[]> {
  const groups = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const existing = groups.get(session.date) || [];
    existing.push(session);
    groups.set(session.date, existing);
  }

  return groups;
}

/**
 * 날짜 포맷팅 (오늘, 어제, 또는 날짜)
 */
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = (d: Date) => d.toISOString().split("T")[0];

  if (dateOnly(date) === dateOnly(today)) {
    return "Today";
  }
  if (dateOnly(date) === dateOnly(yesterday)) {
    return "Yesterday";
  }

  return date.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

/**
 * 세션 ID를 sessionKey 형식으로 변환
 * sessions 테이블의 id (예: "2026-02-02_01")를 gateway sessionKey 형식으로 변환
 */
function sessionIdToSessionKey(sessionId: string): string {
  // axiommind 세션은 "agent:main:main" 형식을 사용
  // 실제 세션 전환은 URL 파라미터로 처리됨
  return `agent:axiommind:${sessionId}`;
}

const SessionSelector = ({ onSwitchSession, onNewSession }: SessionSelectorProps) => {
  const [isOpen, setIsOpen] = useAtom(sessionsPanelOpenAtom);
  const sessions = useAtomValue(sessionsListAtom);
  const isLoading = useAtomValue(sessionsLoadingAtom);
  const currentSessionKey = useAtomValue(sessionKeyAtom);
  const loadSessions = useSetAtom(loadSessionsAtom);
  const startLoading = useSetAtom(startLoadingSessionsAtom);

  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importStatuses, setImportStatuses] = useState<Map<string, boolean>>(new Map());

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, setIsOpen]);

  // 세션 목록 로드
  const handleLoadSessions = useCallback(async () => {
    startLoading();
    try {
      const result = await fetchSessions({ limit: 50 });
      loadSessions(result.sessions);
    } catch (error) {
      console.error("Failed to load sessions:", error);
      loadSessions([]);
    }
  }, [startLoading, loadSessions]);

  // Import 상태 로드
  const loadImportStatuses = useCallback(async () => {
    try {
      const result = await fetchImportStatuses();
      const map = new Map<string, boolean>();
      for (const s of result.statuses) {
        map.set(s.sessionFileId, s.imported);
      }
      setImportStatuses(map);
    } catch (error) {
      console.error("Failed to load import statuses:", error);
    }
  }, []);

  // 전체 import
  const handleImportAll = useCallback(async () => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const result = await importAllSessions();
      setImportResult({ imported: result.imported, skipped: result.skipped });
      // import 후 상태 갱신
      await loadImportStatuses();
    } catch (error) {
      console.error("Failed to import sessions:", error);
    } finally {
      setIsImporting(false);
    }
  }, [loadImportStatuses]);

  // 드롭다운 열 때 세션 로드
  const handleToggle = useCallback(() => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (newState) {
      if (sessions.length === 0) {
        handleLoadSessions();
      }
      loadImportStatuses();
    }
  }, [isOpen, setIsOpen, sessions.length, handleLoadSessions, loadImportStatuses]);

  // 세션 선택
  const handleSelectSession = useCallback(
    (session: SessionSummary) => {
      const sessionKey = sessionIdToSessionKey(session.id);
      onSwitchSession(sessionKey);
      setIsOpen(false);
    },
    [onSwitchSession, setIsOpen]
  );

  // 새 세션 생성
  const handleNewSession = useCallback(() => {
    onNewSession();
    setIsOpen(false);
  }, [onNewSession, setIsOpen]);

  const groupedSessions = groupSessionsByDate(sessions);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-200 group"
      >
        <span className="text-[10px] uppercase tracking-wider font-semibold text-white/50 group-hover:text-white/70 truncate max-w-[120px]">
          {currentSessionKey || "No Session"}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-white/40 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 w-72 max-h-[400px] overflow-hidden rounded-xl bg-gray-900/95 backdrop-blur-xl border border-white/10 shadow-2xl z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white/90">Sessions</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleImportAll}
                  disabled={isImporting}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50"
                  title="Import all sessions to memory"
                >
                  {isImporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Import
                </button>
                <button
                  onClick={handleNewSession}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 text-xs font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New
                </button>
              </div>
            </div>

            {/* Import Result Banner */}
            {importResult && (
              <div className="px-4 py-2 bg-emerald-500/10 border-b border-white/10 text-xs text-emerald-400">
                Imported {importResult.imported} sessions
                {importResult.skipped > 0 && `, ${importResult.skipped} skipped`}
              </div>
            )}

            {/* Sessions List */}
            <div className="overflow-y-auto max-h-[320px] scrollbar-thin scrollbar-thumb-gray-700/50">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-white/40">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-sm">No sessions yet</span>
                </div>
              ) : (
                <div className="py-2">
                  {Array.from(groupedSessions.entries()).map(([date, dateSessions]) => (
                    <div key={date} className="mb-2">
                      {/* Date Header */}
                      <div className="flex items-center gap-2 px-4 py-1.5">
                        <Calendar className="w-3 h-3 text-white/30" />
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-white/30">
                          {formatDateLabel(date)}
                        </span>
                      </div>

                      {/* Sessions for this date */}
                      {dateSessions.map((session) => {
                        const isActive =
                          currentSessionKey === sessionIdToSessionKey(session.id);

                        return (
                          <button
                            key={session.id}
                            onClick={() => handleSelectSession(session)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors ${
                              isActive ? "bg-primary-500/10" : ""
                            }`}
                          >
                            <div className="flex-1 min-w-0 text-left">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-sm font-medium truncate ${
                                    isActive ? "text-primary-400" : "text-white/80"
                                  }`}
                                >
                                  {session.title || `Session ${session.sessionId}`}
                                </span>
                                {isActive && <Check className="w-3.5 h-3.5 text-primary-400" />}
                                {importStatuses.get(session.id) && (
                                  <CheckCircle className="w-3 h-3 text-emerald-400/60" />
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5">
                                {session.timeRange && (
                                  <span className="flex items-center gap-1 text-[10px] text-white/40">
                                    <Clock className="w-3 h-3" />
                                    {session.timeRange}
                                  </span>
                                )}
                                <span className="flex items-center gap-1 text-[10px] text-white/40">
                                  <MessageSquare className="w-3 h-3" />
                                  {session.entryCount} entries
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer - Refresh Button */}
            <div className="px-4 py-2 border-t border-white/10">
              <button
                onClick={handleLoadSessions}
                disabled={isLoading}
                className="w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors disabled:opacity-50"
              >
                {isLoading ? "Loading..." : "Refresh list"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default memo(SessionSelector);
