/**
 * AxiomMind - Memory Graduation Pipeline + Custom Chat UI
 *
 * OpenClaw 플러그인으로 통합되는 커스텀 메모리 시스템
 */
import type { OpenClawPluginApi, AgentContext } from "openclaw/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MemoryPipeline } from "./memory-pipeline/orchestrator.js";
import { createSearchTool, createRecallTool, createSaveTool } from "./memory-pipeline/tools.js";
import { createApiHandler } from "./api/routes.js";
import { serveStaticWeb } from "./api/static.js";
import { createAuthChecker } from "./api/auth.js";

// 불용어 (검색에서 제외할 단어)
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "must", "shall", "can", "need", "dare", "ought", "used",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "and", "but", "or", "nor", "so", "yet", "both", "either", "neither",
  "not", "only", "own", "same", "than", "too", "very", "just", "also",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "am", "been", "being", "here", "there", "when", "where", "why", "how",
  "all", "any", "each", "few", "more", "most", "other", "some", "such",
  "no", "none", "one", "every", "another", "many", "much", "several",
  // 한국어 불용어
  "이", "그", "저", "것", "수", "등", "들", "및", "에", "의", "를", "을",
  "은", "는", "가", "이다", "있다", "하다", "되다", "않다", "없다",
  "아", "어", "고", "니", "면", "서", "도", "만", "까지", "부터",
  "에서", "으로", "로", "와", "과", "랑", "이랑", "하고",
  "뭐", "뭘", "어떻게", "왜", "언제", "어디", "누구", "무엇",
  "좀", "잘", "더", "덜", "많이", "조금", "매우", "아주", "정말", "진짜",
  "해줘", "해주세요", "알려줘", "알려주세요", "말해줘", "말해주세요",
]);

/**
 * 사용자 메시지에서 검색 키워드 추출
 */
function extractSearchKeywords(text: string): string[] {
  if (!text) return [];

  // 단어 분리 (영어/한국어 모두 처리)
  const words = text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

  // 중복 제거 및 최대 5개 키워드 반환
  return [...new Set(words)].slice(0, 5);
}

const plugin = {
  id: "plugin-axiommind",
  name: "AxiomMind Memory System",
  description: "Memory Graduation Pipeline with Idris type verification + Custom Chat UI",

  register(api: OpenClawPluginApi) {
    const logger = api.logger;

    logger.info("Initializing AxiomMind plugin...");

    // 1. Memory Pipeline 초기화
    const pipeline = new MemoryPipeline(api);
    pipeline.initialize().catch((error) => {
      logger.error(`Failed to initialize pipeline: ${error}`);
    });

    // 2. 에이전트 시작 시 메모리 시스템 프롬프트 주입
    api.on("before_agent_start", async (event: { prompt?: string }, _ctx: AgentContext) => {
      // 사용자 메시지에서 키워드 추출 (검색용)
      const userPrompt = event.prompt || "";
      const searchKeywords = extractSearchKeywords(userPrompt);

      const memoryInstructions = `
## AxiomMind Memory System

You have access to a persistent memory system. **USE IT PROACTIVELY ON EVERY CONVERSATION.**

### CRITICAL: Automatic Memory Search
**BEFORE answering ANY question or responding to ANY message:**
1. ALWAYS call \`axiom_search\` first to find relevant memories
2. Search using keywords from the user's message: ${searchKeywords.length > 0 ? `"${searchKeywords.join('", "')}"` : "(extract from message)"}
3. Use the retrieved context to provide personalized, informed responses
4. Even for casual conversations, search for relevant user preferences or past context

### Automatic Memory Save
Save important information using \`axiom_save\` when the user shares:
- Personal preferences, likes/dislikes, opinions
- Decisions and their rationale
- Facts about themselves, their work, projects, or interests
- Tasks, commitments, or plans
- Insights, learnings, or realizations
- Corrections to previously stored information

### Memory Tools:
- \`axiom_search\`: Search memories (USE THIS FIRST on every interaction)
- \`axiom_recall\`: Retrieve a specific session's memories
- \`axiom_save\`: Save new memories

**Remember: You have a memory. Use it. The user expects personalized responses based on what you know about them.**
`;
      return {
        prependContext: memoryInstructions,
      };
    });

    // 3. 세션 종료 시 자동 메모리 처리
    api.on("session_end", async (event: { sessionId: string }, ctx: AgentContext) => {
      try {
        logger.debug(`Processing session: ${event.sessionId}`);
        await pipeline.processSessionFromContext(event.sessionId, ctx);
      } catch (error) {
        logger.error(`Failed to process session: ${error}`);
      }
    });

    // 4. 메모리 도구 등록
    api.registerTool(createSearchTool(pipeline), { names: ["axiom_search"] });
    api.registerTool(createRecallTool(pipeline), { names: ["axiom_recall"] });
    api.registerTool(createSaveTool(pipeline), { names: ["axiom_save"] });

    // 5. HTTP 핸들러 등록 (인증 + prefix-based matching)
    const checkAuth = createAuthChecker(api);

    api.registerHttpHandler(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathname = url.pathname;

      // /ax 경로가 아니면 처리하지 않음
      if (!pathname.startsWith("/ax")) {
        return false;
      }

      // 인증 체크
      const authResult = checkAuth(req, url);
      if (!authResult.ok) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized", reason: authResult.reason }));
        return true;
      }

      // API 요청 처리
      if (pathname.startsWith("/ax/api")) {
        const apiHandler = createApiHandler(pipeline);
        await apiHandler(req, res);
        return true;
      }

      // 정적 웹 UI 처리
      const staticHandler = serveStaticWeb();
      return await staticHandler(req, res);
    });

    logger.info("AxiomMind plugin registered successfully");
  },
};

export default plugin;
