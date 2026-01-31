/**
 * AxiomMind - Memory Graduation Pipeline + Custom Chat UI
 *
 * OpenClaw 플러그인으로 통합되는 커스텀 메모리 시스템
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { MemoryPipeline } from "./memory-pipeline/orchestrator.js";
import { createSearchTool, createRecallTool, createSaveTool } from "./memory-pipeline/tools.js";
import { createApiHandler } from "./api/routes.js";
import { serveStaticWeb } from "./api/static.js";
import { createAuthChecker } from "./api/auth.js";

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

    // 2. 세션 종료 시 자동 메모리 처리
    api.on("session_end", async (event, ctx) => {
      try {
        logger.debug(`Processing session: ${event.sessionId}`);
        await pipeline.processSessionFromContext(event.sessionId, ctx);
      } catch (error) {
        logger.error(`Failed to process session: ${error}`);
      }
    });

    // 3. 메모리 도구 등록
    api.registerTool(createSearchTool(pipeline), { names: ["axiom_search"] });
    api.registerTool(createRecallTool(pipeline), { names: ["axiom_recall"] });
    api.registerTool(createSaveTool(pipeline), { names: ["axiom_save"] });

    // 4. HTTP 핸들러 등록 (인증 + prefix-based matching)
    const checkAuth = createAuthChecker(api);

    api.registerHttpHandler(async (req, res) => {
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
