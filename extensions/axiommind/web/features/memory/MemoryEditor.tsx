"use client";

import { useState, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import { useEntry, useUpdateEntry, useDeleteEntry, usePromoteEntry, useDemoteEntry } from "./_hooks/useMemory";
import type { EntryWithMeta } from "./_api/queries";
import {
  X,
  Save,
  Trash2,
  ArrowUpCircle,
  ArrowDownCircle,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Lightbulb,
  CheckSquare,
  Bookmark,
  Gavel,
  Clock,
  Eye,
  ThumbsUp,
} from "lucide-react";

type MemoryEditorProps = {
  entryId: string;
  onClose: () => void;
};

const ENTRY_TYPE_CONFIG: Record<string, { label: string; className: string; icon: any }> = {
  fact: { label: "Fact", className: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: FileText },
  decision: { label: "Decision", className: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: Gavel },
  insight: { label: "Insight", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: Lightbulb },
  task: { label: "Task", className: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: CheckSquare },
  reference: { label: "Reference", className: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: Bookmark },
};

const STAGE_CONFIG: Record<string, { label: string; className: string; level: number }> = {
  working: { label: "L1 Working", className: "bg-gray-500/20 text-gray-400", level: 1 },
  candidate: { label: "L2 Candidate", className: "bg-blue-500/20 text-blue-400", level: 2 },
  verified: { label: "L3 Verified", className: "bg-emerald-500/20 text-emerald-400", level: 3 },
  certified: { label: "L4 Certified", className: "bg-purple-500/20 text-purple-400", level: 4 },
};

const MemoryEditor = ({ entryId, onClose }: MemoryEditorProps) => {
  const { data: entry, isLoading, error } = useEntry(entryId);
  const updateMutation = useUpdateEntry();
  const deleteMutation = useDeleteEntry();
  const promoteMutation = usePromoteEntry();
  const demoteMutation = useDemoteEntry();

  const [editedTitle, setEditedTitle] = useState<string>("");
  const [editedContent, setEditedContent] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // entry가 로드되면 편집 상태 초기화
  const handleStartEdit = useCallback(() => {
    if (entry) {
      setEditedTitle(entry.title);
      setEditedContent(JSON.stringify(entry.content, null, 2));
      setIsEditing(true);
    }
  }, [entry]);

  const handleSave = useCallback(async () => {
    if (!entry) return;

    try {
      const content = JSON.parse(editedContent);
      await updateMutation.mutateAsync({
        entryId: entry.id,
        updates: { title: editedTitle, content },
      });
      setIsEditing(false);
    } catch (err) {
      alert("저장 실패: " + String(err));
    }
  }, [entry, editedTitle, editedContent, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!entry) return;

    try {
      await deleteMutation.mutateAsync(entry.id);
      onClose();
    } catch (err) {
      alert("삭제 실패: " + String(err));
    }
  }, [entry, deleteMutation, onClose]);

  const handlePromote = useCallback(async () => {
    if (!entry) return;

    const currentLevel = STAGE_CONFIG[entry.memoryStage]?.level || 1;
    let targetStage: string;

    if (currentLevel === 1) targetStage = "candidate";
    else if (currentLevel === 2) targetStage = "verified";
    else if (currentLevel === 3) targetStage = "certified";
    else return; // 이미 최고 레벨

    try {
      await promoteMutation.mutateAsync({ entryId: entry.id, targetStage });
    } catch (err) {
      alert("승격 실패: " + String(err));
    }
  }, [entry, promoteMutation]);

  const handleDemote = useCallback(async () => {
    if (!entry) return;

    try {
      await demoteMutation.mutateAsync({ entryId: entry.id, reason: "user_demotion" });
    } catch (err) {
      alert("강등 실패: " + String(err));
    }
  }, [entry, demoteMutation]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-[#1a1b22] border border-white/10 rounded-2xl p-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-[#1a1b22] border border-white/10 rounded-2xl p-8">
          <p className="text-red-400">Error loading entry</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-white/10 rounded-lg text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  const typeConfig = ENTRY_TYPE_CONFIG[entry.entryType] || ENTRY_TYPE_CONFIG.reference;
  const stageConfig = STAGE_CONFIG[entry.memoryStage] || STAGE_CONFIG.working;
  const Icon = typeConfig.icon;
  const canPromote = stageConfig.level < 4;
  const canDemote = stageConfig.level > 1;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1b22] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", typeConfig.className)}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-200">Memory Detail</h2>
              <p className="text-[10px] text-gray-500">{entry.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Type & Stage Badges */}
          <div className="flex items-center gap-3">
            <span className={cn("px-3 py-1 rounded-full text-xs font-medium border", typeConfig.className)}>
              {typeConfig.label}
            </span>
            <span className={cn("px-3 py-1 rounded-full text-xs font-medium", stageConfig.className)}>
              {stageConfig.label}
            </span>
          </div>

          {/* Title */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-2">
              Title
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            ) : (
              <p className="text-gray-200 font-medium">{entry.title}</p>
            )}
          </div>

          {/* Content */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-medium block mb-2">
              Content
            </label>
            {isEditing ? (
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                rows={10}
                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-gray-200 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            ) : (
              <pre className="p-4 bg-black/30 border border-white/10 rounded-xl text-gray-300 text-sm font-mono overflow-x-auto">
                {JSON.stringify(entry.content, null, 2)}
              </pre>
            )}
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Clock className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wider">Created</span>
              </div>
              <p className="text-sm text-gray-300">{entry.sessionDate}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Eye className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wider">Access Count</span>
              </div>
              <p className="text-sm text-gray-300">{entry.accessCount}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <ThumbsUp className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wider">Confirmations</span>
              </div>
              <p className="text-sm text-gray-300">{entry.confirmationCount}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <FileText className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wider">Session</span>
              </div>
              <p className="text-sm text-gray-300 truncate">{entry.sessionTitle}</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Promote / Demote */}
            {canPromote && (
              <button
                onClick={handlePromote}
                disabled={promoteMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {promoteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUpCircle className="w-4 h-4" />
                )}
                Promote
              </button>
            )}
            {canDemote && (
              <button
                onClick={handleDemote}
                disabled={demoteMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {demoteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowDownCircle className="w-4 h-4" />
                )}
                Demote
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors text-sm font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
                <button
                  onClick={handleStartEdit}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
                >
                  Edit
                </button>
              </>
            )}
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="bg-[#1a1b22] border border-white/10 rounded-xl p-6 max-w-sm mx-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-200">Delete Memory?</h3>
              </div>
              <p className="text-gray-400 text-sm mb-6">
                This action cannot be undone. The memory will be permanently deleted.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(MemoryEditor);
