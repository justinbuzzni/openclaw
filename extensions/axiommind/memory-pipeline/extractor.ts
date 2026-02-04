/**
 * Session Extractor
 *
 * LLM을 사용하여 채팅 세션에서 구조화된 메모리 데이터 추출
 * 인증 우선순위:
 *   1. Anthropic SDK (API key / OAuth token)
 *   2. CLI 호출 (claude -p / codex) — subscription 사용자용
 */
import { execFile, exec } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Session, AnyEntry } from "./types.js";

const EXTRACTION_PROMPT = `당신은 개발 세션 로그를 구조화된 메모리로 변환하는 전문가입니다.

다음 채팅 세션을 분석하고, 아래 JSON 스키마로 추출하세요:

\`\`\`json
{
  "date": "2026-01-31",
  "sessionId": 1,
  "timeRange": "22:30~22:50",
  "title": "세션 제목 (간단명료하게)",
  "entries": [
    {
      "type": "fact",
      "title": "완료된 작업",
      "evidence": "구체적 증거/방법"
    },
    {
      "type": "decision",
      "title": "내린 결정",
      "rationale": "결정 이유 (필수)",
      "basedOn": ["관련 fact 제목"]
    },
    {
      "type": "insight",
      "observation": "발견한 것",
      "implication": "시사점/후속 조치"
    },
    {
      "type": "task",
      "title": "할 일",
      "status": "pending|in_progress|done|blocked",
      "priority": "low|medium|high|critical",
      "blockedBy": []
    },
    {
      "type": "reference",
      "path": "파일 경로",
      "description": "설명"
    }
  ]
}
\`\`\`

규칙:
1. Fact: 실제로 완료된 작업. evidence는 구체적으로
2. Decision: 선택/결정 사항. rationale 필수
3. Insight: 배운 것, 주의사항. implication으로 행동 유도
4. Task: 아직 안 한 것, 해야 할 것
5. Reference: 수정/참조한 파일 경로

JSON만 출력하세요. 다른 텍스트는 포함하지 마세요.`;

/**
 * LLM completion 함수 시그니처
 */
export type CompletionFn = (options: {
  model: string;
  maxTokens: number;
  system: string;
  userMessage: string;
}) => Promise<string>;

export type ExtractorAuth = {
  apiKey?: string;
  authToken?: string;
};

/**
 * CLI 실행으로 LLM 호출 (claude -p / codex)
 * subscription 사용자용 — 별도 API key 불필요
 */
function createCliCompletionFn(cli: "claude" | "codex"): CompletionFn {
  return async ({ system, userMessage }) => {
    const fullPrompt = `${system}\n\n---\n\n${userMessage}`;

    // 프롬프트가 길면 임시 파일로 전달
    const tmpFile = join(tmpdir(), `axiommind-prompt-${randomUUID()}.txt`);
    await writeFile(tmpFile, fullPrompt, "utf-8");

    try {
      const output = await new Promise<string>((resolve, reject) => {
        if (cli === "claude") {
          // claude -p "prompt" --output-format text --max-turns 1
          execFile(
            "claude",
            ["-p", `@${tmpFile}`, "--output-format", "text", "--max-turns", "1"],
            { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout, stderr) => {
              if (err) reject(new Error(`claude CLI failed: ${err.message}\n${stderr}`));
              else resolve(stdout);
            },
          );
        } else {
          // codex exec - : stdin에서 프롬프트를 읽어 비대화형 실행
          const outputFile = join(tmpdir(), `axiommind-codex-out-${randomUUID()}.txt`);
          exec(
            `codex exec -o "${outputFile}" - < "${tmpFile}"`,
            { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
            (err, _stdout, stderr) => {
              if (err) {
                unlink(outputFile).catch(() => {});
                reject(new Error(`codex CLI failed: ${err.message}\n${stderr}`));
              } else {
                readFile(outputFile, "utf-8")
                  .then((content) => {
                    unlink(outputFile).catch(() => {});
                    resolve(content);
                  })
                  .catch((readErr) => {
                    reject(new Error(`Failed to read codex output: ${readErr.message}`));
                  });
              }
            },
          );
        }
      });

      return output.trim();
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  };
}

/**
 * 사용 가능한 CLI 감지
 */
function detectAvailableCli(): "claude" | "codex" | null {
  const { execFileSync } = require("node:child_process");
  for (const cli of ["codex", "claude"] as const) {
    try {
      execFileSync("which", [cli], { timeout: 3000, stdio: "pipe" });
      return cli;
    } catch {
      // not found
    }
  }
  return null;
}

export class SessionExtractor {
  private completionFn: CompletionFn;
  private model: string;

  constructor(options?: {
    auth?: ExtractorAuth;
    completionFn?: CompletionFn;
    model?: string;
  }) {
    this.model = options?.model || "claude-sonnet-4-20250514";

    if (options?.completionFn) {
      this.completionFn = options.completionFn;
    } else {
      // 1) Anthropic SDK 직접 사용 시도
      const apiKey = options?.auth?.apiKey || process.env.ANTHROPIC_API_KEY;
      const authToken = options?.auth?.authToken || process.env.ANTHROPIC_AUTH_TOKEN;

      if (apiKey || authToken) {
        const client = apiKey
          ? new Anthropic({ apiKey })
          : new Anthropic({ authToken: authToken! });

        this.completionFn = async ({ model, maxTokens, system, userMessage }) => {
          const response = await client.messages.create({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: userMessage }],
          });
          const content = response.content[0];
          if (content.type !== "text") {
            throw new Error("Unexpected response type from LLM");
          }
          return content.text;
        };
      } else {
        // 2) CLI fallback (claude -p / codex)
        const cli = detectAvailableCli();
        if (cli) {
          this.completionFn = createCliCompletionFn(cli);
        } else {
          // 3) 최후 수단: SDK 기본 (env 자동 감지)
          const client = new Anthropic();
          this.completionFn = async ({ model, maxTokens, system, userMessage }) => {
            const response = await client.messages.create({
              model,
              max_tokens: maxTokens,
              system,
              messages: [{ role: "user", content: userMessage }],
            });
            const content = response.content[0];
            if (content.type !== "text") {
              throw new Error("Unexpected response type from LLM");
            }
            return content.text;
          };
        }
      }
    }
  }

  async extract(sessionLog: string, date?: string, sessionId?: number): Promise<Session> {
    const now = new Date();
    const defaultDate = date || now.toISOString().split("T")[0];
    const defaultSessionId = sessionId || 1;

    const text = await this.completionFn({
      model: this.model,
      maxTokens: 4096,
      system: EXTRACTION_PROMPT,
      userMessage: `Date: ${defaultDate}\nSession ID: ${defaultSessionId}\n\n---\n\n${sessionLog}`,
    });

    // JSON 파싱
    const jsonText = this.extractJson(text);
    const data = JSON.parse(jsonText) as Session;

    // 기본값 설정
    if (!data.date) data.date = defaultDate;
    if (!data.sessionId) data.sessionId = defaultSessionId;

    return data;
  }

  private extractJson(text: string): string {
    // ```json ... ``` 블록 제거
    let cleaned = text.trim();

    if (cleaned.includes("```json")) {
      cleaned = cleaned.split("```json")[1].split("```")[0].trim();
    } else if (cleaned.includes("```")) {
      cleaned = cleaned.split("```")[1].split("```")[0].trim();
    }

    return cleaned;
  }

  /**
   * 컴파일 에러 피드백을 받아 재시도
   */
  async retryWithFeedback(
    sessionLog: string,
    date: string,
    sessionId: number,
    errors: string[]
  ): Promise<Session> {
    const errorFeedback = errors.join("\n");

    const retryPrompt = `이전 추출 결과가 Idris 컴파일 에러를 발생시켰습니다.
에러: ${errorFeedback}

다시 추출해주세요. 특히:
1. 문자열에 escape 필요한 특수문자 확인 (", \\, 줄바꿈)
2. 모든 필수 필드 포함 확인
3. basedOn, blockedBy 배열의 문자열이 실제 존재하는 제목인지 확인

원본 세션:
${sessionLog}`;

    return this.extract(retryPrompt, date, sessionId);
  }
}
