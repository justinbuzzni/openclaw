/**
 * Agent Tools
 *
 * OpenClaw 에이전트에서 사용할 수 있는 메모리 도구
 */
import type { MemoryPipeline } from "./orchestrator.js";
import type { AnyEntry, EntryType } from "./types.js";

/**
 * axiom_search 도구 생성
 */
export function createSearchTool(pipeline: MemoryPipeline) {
  return {
    name: "axiom_search",
    label: "AxiomMind Search",
    description: "AxiomMind 메모리에서 시맨틱 검색을 수행합니다.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "검색 쿼리",
        },
        entryTypes: {
          type: "array",
          items: {
            type: "string",
            enum: ["fact", "decision", "insight", "task", "reference"],
          },
          description: "필터링할 엔트리 타입 (선택)",
        },
        limit: {
          type: "number",
          description: "최대 결과 수 (기본: 5)",
        },
      },
      required: ["query"],
    },
    async execute(
      callId: string,
      params: { query: string; entryTypes?: EntryType[]; limit?: number }
    ) {
      try {
        // 검색 진행 상황 이벤트 발생
        await pipeline.searchWithProgress(params.query, params.limit || 5, callId);

        const results = await pipeline.search.keywordSearch({
          query: params.query,
          entryTypes: params.entryTypes,
          limit: params.limit || 5,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  query: params.query,
                  results: [],
                  count: 0,
                }),
              },
            ],
          };
        }

        const formatted = results
          .map((r, i) => {
            return `${i + 1}. [${r.entryType}] ${r.title}\n   날짜: ${r.date}, 세션: ${r.sessionId}\n   ${JSON.stringify(r.content)}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                query: params.query,
                results: results.map(r => ({
                  type: r.entryType,
                  title: r.title,
                  date: r.date,
                  sessionId: r.sessionId,
                })),
                count: results.length,
                formatted,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `검색 중 오류 발생: ${error}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}

/**
 * axiom_recall 도구 생성
 */
export function createRecallTool(pipeline: MemoryPipeline) {
  return {
    name: "axiom_recall",
    label: "AxiomMind Recall",
    description: "특정 세션의 기억을 불러옵니다.",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "세션 ID (예: 2026-01-31_01)",
        },
      },
      required: ["sessionId"],
    },
    async execute(callId: string, params: { sessionId: string }) {
      try {
        // 조회 진행 상황 이벤트 발생과 함께 결과 가져오기
        const results = await pipeline.recallWithProgress(params.sessionId, callId);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  sessionId: params.sessionId,
                  results: [],
                  count: 0,
                  message: `세션 ${params.sessionId}을(를) 찾을 수 없습니다.`,
                }),
              },
            ],
          };
        }

        const formatted = (results as any[])
          .map((r, i) => {
            return `${i + 1}. [${r.entryType}] ${r.title}\n   ${JSON.stringify(r.content)}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                sessionId: params.sessionId,
                results: (results as any[]).map(r => ({
                  type: r.entryType,
                  title: r.title,
                })),
                count: results.length,
                formatted,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `불러오기 중 오류 발생: ${error}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}

/**
 * axiom_save 도구 생성
 */
export function createSaveTool(pipeline: MemoryPipeline) {
  return {
    name: "axiom_save",
    label: "AxiomMind Save",
    description: "새로운 기억을 수동으로 저장합니다.",
    parameters: {
      type: "object",
      properties: {
        entryType: {
          type: "string",
          enum: ["fact", "decision", "insight", "task", "reference"],
          description: "엔트리 타입",
        },
        title: {
          type: "string",
          description: "제목 또는 주요 내용",
        },
        details: {
          type: "object",
          description: "추가 세부 정보 (타입에 따라 다름)",
        },
      },
      required: ["entryType", "title"],
    },
    async execute(
      callId: string,
      params: { entryType: EntryType; title: string; details?: Record<string, unknown> }
    ) {
      try {
        const entry = buildEntry(params.entryType, params.title, params.details || {});
        // 저장 진행 상황 이벤트와 함께 저장
        const result = await pipeline.saveEntry(entry, undefined, callId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                sessionId: result.sessionId,
                compileStatus: result.compileStatus,
                entriesCount: result.entriesCount,
                message: `기억이 저장되었습니다.`,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `저장 중 오류 발생: ${error}`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}

function buildEntry(
  type: EntryType,
  title: string,
  details: Record<string, unknown>
): AnyEntry {
  switch (type) {
    case "fact":
      return {
        type: "fact",
        title,
        evidence: (details.evidence as string) || undefined,
      };
    case "decision":
      return {
        type: "decision",
        title,
        rationale: (details.rationale as string) || undefined,
        basedOn: (details.basedOn as string[]) || [],
      };
    case "insight":
      return {
        type: "insight",
        observation: title,
        implication: (details.implication as string) || "",
      };
    case "task":
      return {
        type: "task",
        title,
        status: (details.status as "pending") || "pending",
        priority: (details.priority as "medium") || "medium",
        blockedBy: (details.blockedBy as string[]) || [],
      };
    case "reference":
      return {
        type: "reference",
        path: title,
        description: (details.description as string) || undefined,
      };
  }
}
