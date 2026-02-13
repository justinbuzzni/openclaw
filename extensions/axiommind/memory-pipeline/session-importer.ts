/**
 * Session Importer
 *
 * JSONL 세션 파일을 AxiomMind 메모리로 import
 * 중복 방지: session_file_id (UUID) 기준
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import type { MemoryIndexer } from "./indexer.js";

export type ImportResult = {
  sessionFileId: string;
  success: boolean;
  skipped: boolean;
  entryCount: number;
  error?: string;
};

export type ImportAllResult = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  results: ImportResult[];
};

export type ImportStatus = {
  sessionFileId: string;
  imported: boolean;
  title?: string;
  messageCount?: number;
};

/**
 * JSONL 세션 파일의 첫 번째 사용자 메시지에 [cron: 패턴이 있으면 cron 세션
 */
async function isCronSession(filePath: string): Promise<boolean> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message?.role === "user") {
          const content = entry.message.content;
          let text = "";
          if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b.type === "text");
            if (textBlock?.text) text = textBlock.text;
          } else if (typeof content === "string") {
            text = content;
          }
          rl.close();
          return text.includes("[cron:");
        }
      } catch { /* skip */ }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * JSONL 세션 파일에서 대화 로그 텍스트 추출
 */
async function extractSessionLog(filePath: string): Promise<{
  sessionLog: string;
  messageCount: number;
  firstMessage?: string;
} | null> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const parts: string[] = [];
    let messageCount = 0;
    let firstUserMessage: string | undefined;

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          messageCount++;

          const role = msg.role === "user" ? "User" : "Assistant";
          let text = "";

          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === "text" && block.text) {
                text += block.text;
              }
            }
          } else if (typeof msg.content === "string") {
            text = msg.content;
          }

          if (!text.trim()) continue;

          // 첫 사용자 메시지 (제목용)
          if (!firstUserMessage && msg.role === "user") {
            let cleaned = text;
            // Memory Tools 프롬프트 제거
            if (cleaned.includes("## Memory Tools Available")) {
              const segments = cleaned.split(/\n\n+/);
              for (let i = segments.length - 1; i >= 0; i--) {
                const seg = segments[i].trim();
                if (seg && !seg.startsWith("##") && !seg.startsWith("-") && !seg.startsWith("A new session")) {
                  cleaned = seg;
                  break;
                }
              }
            }
            if (cleaned.includes("[message_id:")) {
              cleaned = cleaned.split("[message_id:")[0].trim();
            }
            firstUserMessage = cleaned.slice(0, 100);
          }

          parts.push(`${role}: ${text}`);
        }
      } catch {
        // JSON 파싱 오류 무시
      }
    }

    if (messageCount < 2) return null;

    return {
      sessionLog: parts.join("\n\n"),
      messageCount,
      firstMessage: firstUserMessage,
    };
  } catch {
    return null;
  }
}

export class SessionImporter {
  private indexer: MemoryIndexer;
  private processSession: (sessionLog: string, date?: string, sessionId?: number) => Promise<{ entriesCount: number }>;
  private sessionsDir: string;

  constructor(
    indexer: MemoryIndexer,
    processSession: (sessionLog: string, date?: string, sessionId?: number) => Promise<{ entriesCount: number }>,
    agentId: string = "axiommind"
  ) {
    this.indexer = indexer;
    this.processSession = processSession;
    this.sessionsDir = path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions");
  }

  /**
   * 세션 파일 목록 가져오기 (최신순)
   */
  listSessionFiles(): Array<{ fileId: string; filePath: string; mtime: Date }> {
    if (!fs.existsSync(this.sessionsDir)) return [];

    return fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => {
        const fileId = f.replace(".jsonl", "");
        const filePath = path.join(this.sessionsDir, f);
        const mtime = fs.statSync(filePath).mtime;
        return { fileId, filePath, mtime };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  /**
   * 이미 import된 세션인지 확인
   */
  isAlreadyImported(sessionFileId: string): boolean {
    return this.indexer.isSessionImported(sessionFileId);
  }

  /**
   * 단일 세션 import
   */
  async importSession(sessionFileId: string): Promise<ImportResult> {
    // 중복 체크
    if (this.isAlreadyImported(sessionFileId)) {
      return { sessionFileId, success: true, skipped: true, entryCount: 0 };
    }

    const filePath = path.join(this.sessionsDir, `${sessionFileId}.jsonl`);
    if (!fs.existsSync(filePath)) {
      return { sessionFileId, success: false, skipped: false, entryCount: 0, error: "File not found" };
    }

    // cron 세션 제외 — import하지 않되 imported로 마킹 (재시도 방지)
    if (await isCronSession(filePath)) {
      this.indexer.markSessionImported(sessionFileId, 0);
      return { sessionFileId, success: true, skipped: true, entryCount: 0 };
    }

    // 세션 로그 추출
    const extracted = await extractSessionLog(filePath);
    if (!extracted || extracted.sessionLog.trim().length < 50) {
      // 내용이 너무 짧으면 import하지 않되 imported로 마킹 (재시도 방지)
      this.indexer.markSessionImported(sessionFileId, 0);
      return { sessionFileId, success: true, skipped: true, entryCount: 0 };
    }

    try {
      // 파일 수정 시간에서 날짜 추출
      const stat = fs.statSync(filePath);
      const date = stat.mtime.toISOString().split("T")[0];

      // memory pipeline 처리
      const result = await this.processSession(extracted.sessionLog, date);

      // import 완료 마킹
      this.indexer.markSessionImported(sessionFileId, result.entriesCount);

      return {
        sessionFileId,
        success: true,
        skipped: false,
        entryCount: result.entriesCount,
      };
    } catch (error) {
      return {
        sessionFileId,
        success: false,
        skipped: false,
        entryCount: 0,
        error: String(error),
      };
    }
  }

  /**
   * 전체 미처리 세션 import
   */
  async importAllPending(): Promise<ImportAllResult> {
    const files = this.listSessionFiles();
    const results: ImportResult[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of files) {
      const result = await this.importSession(file.fileId);
      results.push(result);

      if (result.skipped) {
        skipped++;
      } else if (result.success) {
        imported++;
      } else {
        failed++;
      }
    }

    return {
      total: files.length,
      imported,
      skipped,
      failed,
      results,
    };
  }

  /**
   * 각 세션의 import 상태 조회
   */
  async getImportStatuses(): Promise<ImportStatus[]> {
    const files = this.listSessionFiles();
    const fileIds = files.map(f => f.fileId);
    const statuses = this.indexer.getImportStatuses(fileIds);

    const result: ImportStatus[] = [];
    for (const file of files) {
      const extracted = await extractSessionLog(file.filePath);
      result.push({
        sessionFileId: file.fileId,
        imported: statuses.get(file.fileId) || false,
        title: extracted?.firstMessage,
        messageCount: extracted?.messageCount,
      });
    }
    return result;
  }
}
