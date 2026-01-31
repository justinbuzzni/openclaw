/**
 * Session Extractor
 *
 * LLM을 사용하여 채팅 세션에서 구조화된 메모리 데이터 추출
 */
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

export class SessionExtractor {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model: string = "claude-sonnet-4-20250514") {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = model;
  }

  async extract(sessionLog: string, date?: string, sessionId?: number): Promise<Session> {
    const now = new Date();
    const defaultDate = date || now.toISOString().split("T")[0];
    const defaultSessionId = sessionId || 1;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `Date: ${defaultDate}\nSession ID: ${defaultSessionId}\n\n---\n\n${sessionLog}`,
        },
      ],
    });

    // 응답에서 텍스트 추출
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from LLM");
    }

    // JSON 파싱
    const jsonText = this.extractJson(content.text);
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
