"use client";

import { memo, useCallback, useRef, useState, type DragEvent } from "react";
import { useAtom } from "jotai";
import { attachmentsAtom, type Attachment } from "./_stores/chat";
import { cn } from "@/lib/utils";
import { Paperclip, X, FileText, Image as ImageIcon, File, Upload } from "lucide-react";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = {
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  document: ["application/pdf", "text/plain", "text/markdown", "application/json"],
};

function getFileIcon(type: string) {
  if (type.startsWith("image/")) return ImageIcon;
  if (type === "application/pdf" || type.startsWith("text/")) return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const FileAttachment = () => {
  const [attachments, setAttachments] = useAtom(attachmentsAtom);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const newAttachments: Attachment[] = [];

      for (const file of Array.from(files)) {
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          console.warn(`File ${file.name} is too large (max 10MB)`);
          continue;
        }

        // Validate file type
        const allAccepted = [...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.document];
        if (!allAccepted.includes(file.type)) {
          console.warn(`File type ${file.type} is not supported`);
          continue;
        }

        try {
          const base64 = await fileToBase64(file);
          const isImage = ACCEPTED_TYPES.image.includes(file.type);

          newAttachments.push({
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type,
            size: file.size,
            data: base64,
            preview: isImage ? URL.createObjectURL(file) : undefined,
          });
        } catch (err) {
          console.error(`Failed to read file ${file.name}:`, err);
        }
      }

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    },
    [setAttachments]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
      // Reset input
      e.target.value = "";
    },
    [handleFiles]
  );

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => {
        const toRemove = prev.find((a) => a.id === id);
        if (toRemove?.preview) {
          URL.revokeObjectURL(toRemove.preview);
        }
        return prev.filter((a) => a.id !== id);
      });
    },
    [setAttachments]
  );

  return (
    <div className="flex items-center gap-2">
      {/* Attach Button */}
      <button
        onClick={handleClick}
        className={cn(
          "p-2 rounded-lg transition-colors",
          "text-gray-400 hover:text-gray-200 hover:bg-white/5"
        )}
        title="Attach file"
      >
        <Paperclip className="w-4 h-4" />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={[...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.document].join(",")}
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Attachment Previews */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto max-w-xs">
          {attachments.map((attachment) => {
            const Icon = getFileIcon(attachment.type);
            return (
              <div
                key={attachment.id}
                className="relative group flex items-center gap-2 px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg"
              >
                {attachment.preview ? (
                  <img
                    src={attachment.preview}
                    alt={attachment.name}
                    className="w-6 h-6 rounded object-cover"
                  />
                ) : (
                  <Icon className="w-4 h-4 text-gray-400" />
                )}
                <span className="text-xs text-gray-300 max-w-[100px] truncate">{attachment.name}</span>
                <button
                  onClick={() => removeAttachment(attachment.id)}
                  className="p-0.5 rounded-full bg-white/10 text-gray-400 hover:text-white hover:bg-white/20 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Drop Zone Overlay */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="p-8 bg-[#1a1b22] border-2 border-dashed border-primary-500 rounded-2xl text-center">
            <Upload className="w-12 h-12 text-primary-400 mx-auto mb-4" />
            <p className="text-lg font-medium text-white">Drop files here</p>
            <p className="text-sm text-gray-400 mt-1">Images, PDFs, and text files supported</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(FileAttachment);
