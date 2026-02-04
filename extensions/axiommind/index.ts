/**
 * AxiomMind - Memory Graduation Pipeline + Custom Chat UI
 *
 * OpenClaw 플러그인으로 통합되는 커스텀 메모리 시스템
 *
 * v2.0 - Intent-based Memory Retrieval
 * - 매 메시지마다 메모리 검색 → 필요할 때만 검색
 * - 세션 시작 시 메타데이터 프리로드
 * - 세션 종료 시 자동 메모리 추출
 */
import type { OpenClawPluginApi, AgentContext } from "openclaw/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import { MemoryPipeline } from "./memory-pipeline/orchestrator.js";
import { createSearchTool, createRecallTool, createSaveTool } from "./memory-pipeline/tools.js";
import { createApiHandler } from "./api/routes.js";
import { serveStaticWeb } from "./api/static.js";
import { createAuthChecker } from "./api/auth.js";
import {
  MessageHandler,
  generateLightMemoryContext,
  generateConfirmationQuestions,
} from "./memory-pipeline/message-handler.js";
import { MemoryGraphManager } from "./memory-pipeline/memory-graph.js";
import {
  AutoPromotionScheduler,
  getAutoScheduler,
  stopAutoScheduler,
} from "./memory-pipeline/auto-scheduler.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * JSONL 세션 파일에서 대화 히스토리를 포맷된 텍스트로 로드
 * (최근 N개 메시지만, 토큰 절약)
 */
async function loadSessionContext(sessionId: string, maxMessages = 20): Promise<string | null> {
  const sessionsDir = path.join(os.homedir(), ".openclaw", "agents", "axiommind", "sessions");

  // sessionId가 UUID이면 직접 파일 접근, 아니면 검색
  let filePath: string | null = null;
  if (UUID_RE.test(sessionId)) {
    const candidate = path.join(sessionsDir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) filePath = candidate;
  }

  if (!filePath) return null;

  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const messages: Array<{ role: string; text: string }> = [];

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message" || !entry.message) continue;

        const msg = entry.message;
        let text = "";
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text) text += block.text;
          }
        } else if (typeof msg.content === "string") {
          text = msg.content;
        }

        if (!text.trim()) continue;

        // Memory Tools 프롬프트 부분 제거
        if (msg.role === "user" && text.includes("## Memory Tools Available")) {
          const parts = text.split(/\n\n+/);
          for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i].trim();
            if (part && !part.startsWith("##") && !part.startsWith("-") && !part.startsWith("A new session")) {
              text = part;
              break;
            }
          }
        }
        if (text.includes("[message_id:")) {
          text = text.split("[message_id:")[0].trim();
        }

        messages.push({
          role: msg.role === "user" ? "User" : "Assistant",
          text: text.slice(0, 500), // 각 메시지 500자 제한
        });
      } catch { /* skip */ }
    }

    if (messages.length === 0) return null;

    // 최근 N개만 사용
    const recent = messages.slice(-maxMessages);
    const formatted = recent.map(m => `${m.role}: ${m.text}`).join("\n\n");

    return `## Previous Conversation (${recent.length} messages)\n\n${formatted}`;
  } catch {
    return null;
  }
}

const plugin = {
  id: "plugin-axiommind",
  name: "AxiomMind Memory System",
  description: "Memory Graduation Pipeline with Idris type verification + Custom Chat UI",

  register(api: OpenClawPluginApi) {
    const logger = api.logger;

    logger.info("Initializing AxiomMind plugin v2.0...");

    // 1. Memory Pipeline 초기화
    const pipeline = new MemoryPipeline(api);
    let messageHandler: MessageHandler;
    let graphManager: MemoryGraphManager | null = null;
    let autoScheduler: AutoPromotionScheduler | null = null;

    pipeline
      .initialize()
      .then(() => {
        // MessageHandler 초기화
        messageHandler = new MessageHandler(pipeline);

        // GraphManager 초기화 (DB가 있으면)
        const db = pipeline.indexer?.getDatabase?.();
        if (db) {
          graphManager = new MemoryGraphManager(db);
          try {
            graphManager.initialize();
          } catch (err) {
            logger.warn(`Graph initialization failed: ${err}`);
          }
          messageHandler.setGraphManager(graphManager);
        }

        // AutoPromotionScheduler 초기화 및 시작
        autoScheduler = getAutoScheduler(pipeline, {
          // 개발 환경에서는 짧은 주기로 테스트 가능
          promotionCheckInterval: 60 * 60 * 1000, // 1시간
          consolidationInterval: 6 * 60 * 60 * 1000, // 6시간
          graphCleanupInterval: 24 * 60 * 60 * 1000, // 24시간
          enabled: true,
        });
        autoScheduler.start();
        logger.info("AutoPromotionScheduler started");

        logger.info("AxiomMind pipeline initialized successfully");
      })
      .catch((error) => {
        logger.error(`Failed to initialize pipeline: ${error}`);
      });

    // 플러그인 언로드 시 스케줄러 정리 (process 이벤트 사용)
    const shutdownHandler = () => {
      logger.info("Shutting down AxiomMind plugin...");
      stopAutoScheduler();
    };
    process.on("SIGTERM", shutdownHandler);
    process.on("SIGINT", shutdownHandler);

    // 세션별 도구 안내 표시 여부 추적 (첫 메시지에만 표시)
    const sessionToolsShown = new Set<string>();

    // 2. 에이전트 시작 시 - 세션 프리로드 + 경량 컨텍스트 주입
    api.on("before_agent_start", async (event: { prompt?: string; sessionId?: string }, ctx: AgentContext) => {
      // sessionKey에서 세션 ID 추출 (agent:axiommind:{uuid} 형식)
      const sessionKey = (ctx as any).sessionKey as string | undefined;
      const sessionKeyParts = sessionKey?.split(":") || [];
      const sessionIdFromKey = sessionKeyParts.length >= 3 ? sessionKeyParts[sessionKeyParts.length - 1] : undefined;
      const sessionId = sessionIdFromKey || event.sessionId || (ctx as any).sessionId || "default";

      logger.info(`[AxiomMind] before_agent_start: sessionKey=${sessionKey}, sessionId=${sessionId}`);

      // 첫 메시지인지 확인
      const isFirstMessage = !sessionToolsShown.has(sessionId);
      if (isFirstMessage) {
        sessionToolsShown.add(sessionId);
      }

      // UUID 세션에서 ctx.messages가 없으면 JSONL에서 대화 히스토리 로드
      let historicalContext = "";
      if (UUID_RE.test(sessionId) && (!ctx.messages || ctx.messages.length <= 1)) {
        try {
          const history = await loadSessionContext(sessionId);
          if (history) {
            historicalContext = history + "\n\n---\n\n";
            logger.info(`[AxiomMind] Loaded historical context for session ${sessionId} (${history.length} chars)`);
          } else {
            logger.debug(`[AxiomMind] No historical context found for session ${sessionId}`);
          }
        } catch (err) {
          logger.warn(`Failed to load historical context: ${err}`);
        }
      }

      if (!messageHandler) {
        // 폴백: 첫 메시지에만 기본 도구 안내
        return {
          prependContext: historicalContext + generateLightMemoryContext(undefined, undefined, { includeToolsList: isFirstMessage }),
        };
      }

      const userPrompt = event.prompt || "";

      try {
        // Intent 기반 메모리 검색
        const result = await messageHandler.handleMessage(userPrompt, {
          messages: ctx.messages?.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : "",
          })),
          sessionId,
        });

        // 로깅
        if (result.action !== "skip") {
          logger.debug(
            `[AxiomMind] Intent: ${result.intent}, Score: ${result.score.total}, ` +
              `Action: ${result.action}, CacheHit: ${result.cacheHit}, ` +
              `Memories: ${result.memories.length}, Time: ${result.timing.total}ms`
          );
        }

        // 확인 질문이 필요한 메모리가 있으면
        const confirmQuestions = generateConfirmationQuestions(result.memories);
        if (confirmQuestions.length > 0) {
          // 첫 번째 확인 질문만 컨텍스트에 추가
          const preloaded = messageHandler.getPreloadedContext(sessionId);
          return {
            prependContext: historicalContext + generateLightMemoryContext(preloaded, result.memories, { includeToolsList: isFirstMessage }),
            // 확인 질문을 assistant 응답에 포함하도록 힌트
            systemNote: `Before answering, consider asking: "${confirmQuestions[0]}"`,
          };
        }

        // 경량 컨텍스트 생성
        const preloaded = messageHandler.getPreloadedContext(sessionId);
        return {
          prependContext: historicalContext + generateLightMemoryContext(preloaded, result.memories, { includeToolsList: isFirstMessage }),
        };
      } catch (error) {
        logger.warn(`Memory retrieval failed: ${error}`);
        return {
          prependContext: historicalContext + generateLightMemoryContext(undefined, undefined, { includeToolsList: isFirstMessage }),
        };
      }
    });

    // 4. 세션 종료 시 자동 메모리 처리 + 정리
    api.on("session_end", async (event: { sessionId: string }, ctx: AgentContext) => {
      try {
        logger.debug(`Processing session end: ${event.sessionId}`);

        // 세션 컨텍스트에서 메모리 추출 및 저장
        await pipeline.processSessionFromContext(event.sessionId, ctx);

        // MessageHandler 정리
        if (messageHandler) {
          await messageHandler.onSessionEnd(event.sessionId);
        }

        // 세션 도구 안내 추적 정리
        sessionToolsShown.delete(event.sessionId);
      } catch (error) {
        logger.error(`Failed to process session end: ${error}`);
      }
    });

    // 5. 메모리 도구 등록 (명시적 요청 시에만 사용)
    api.registerTool(createSearchTool(pipeline), { names: ["axiom_search"] });
    api.registerTool(createRecallTool(pipeline), { names: ["axiom_recall"] });
    api.registerTool(createSaveTool(pipeline), { names: ["axiom_save"] });

    // 6. HTTP 핸들러 등록 (인증 + prefix-based matching)
    const checkAuth = createAuthChecker(api);

    logger.info("Registering HTTP handler for /ax routes");
    api.registerHttpHandler(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathname = url.pathname;

      logger.debug(`[HTTP] ${req.method} ${pathname}`);

      // /ax 경로가 아니면 처리하지 않음
      if (!pathname.startsWith("/ax")) {
        return false;
      }

      logger.info(`[HTTP] Handling /ax route: ${req.method} ${pathname}`);

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

    logger.info("AxiomMind plugin v2.0 registered successfully");
  },
};

export default plugin;
