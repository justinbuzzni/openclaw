/**
 * API Routes
 *
 * AxiomMind REST API 핸들러
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MemoryPipeline } from "../memory-pipeline/orchestrator.js";
import type { EntryType, MemoryStage, DemotionReason, AnyEntry } from "../memory-pipeline/types.js";
import {
  getAutoScheduler,
  stopAutoScheduler,
  type SchedulerStats,
} from "../memory-pipeline/auto-scheduler.js";

type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

/**
 * API 핸들러 생성
 */
export function createApiHandler(pipeline: MemoryPipeline): HttpHandler {
  return async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // /ax/api/ 이후의 경로 추출
    const apiPath = path.replace(/^\/ax\/api\/?/, "");

    try {
      if (req.method === "GET") {
        if (apiPath === "search" || apiPath === "") {
          return await handleSearch(req, res, url, pipeline);
        }
        if (apiPath === "decisions") {
          return await handleDecisions(req, res, url, pipeline);
        }
        if (apiPath === "tasks") {
          return await handleTasks(req, res, pipeline);
        }
        // Entry CRUD API
        if (apiPath === "entries") {
          return await handleListEntries(req, res, url, pipeline);
        }
        if (apiPath.startsWith("entries/")) {
          const entryId = apiPath.replace("entries/", "");
          return await handleGetEntry(req, res, entryId, pipeline);
        }
        // Graduation API
        if (apiPath === "graduation/stats") {
          return await handleGraduationStats(req, res, pipeline);
        }
        if (apiPath === "graduation/history") {
          return await handleGraduationHistory(req, res, url, pipeline);
        }
        // Conflict API
        if (apiPath === "conflicts") {
          return await handleGetConflicts(req, res, pipeline);
        }
        // Scheduler API
        if (apiPath === "scheduler/stats") {
          return await handleSchedulerStats(req, res, pipeline);
        }
      }

      // PUT for updates
      if (req.method === "PUT") {
        if (apiPath.startsWith("entries/")) {
          const entryId = apiPath.replace("entries/", "");
          return await handleUpdateEntry(req, res, entryId, pipeline);
        }
      }

      // DELETE for deletions
      if (req.method === "DELETE") {
        if (apiPath.startsWith("entries/")) {
          const entryId = apiPath.replace("entries/", "");
          return await handleDeleteEntry(req, res, entryId, pipeline);
        }
      }

      if (req.method === "POST") {
        if (apiPath === "process") {
          return await handleProcess(req, res, pipeline);
        }
        // Graduation API
        if (apiPath === "promote") {
          return await handlePromote(req, res, pipeline);
        }
        if (apiPath === "demote") {
          return await handleDemote(req, res, pipeline);
        }
        if (apiPath === "graduation/run-auto") {
          return await handleRunAutoPromotions(req, res, pipeline);
        }
        // Conflict API
        if (apiPath === "conflicts/resolve") {
          return await handleResolveConflict(req, res, pipeline);
        }
        // Scheduler API
        if (apiPath === "scheduler/trigger-promotion") {
          return await handleTriggerPromotion(req, res, pipeline);
        }
        if (apiPath === "scheduler/trigger-consolidation") {
          return await handleTriggerConsolidation(req, res, pipeline);
        }
        if (apiPath === "scheduler/start") {
          return await handleSchedulerStart(req, res, pipeline);
        }
        if (apiPath === "scheduler/stop") {
          return await handleSchedulerStop(req, res, pipeline);
        }
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return true;
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
      return true;
    }
  };
}

async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const query = url.searchParams.get("q") || "";
  const types = url.searchParams.getAll("types") as EntryType[];
  const stages = url.searchParams.getAll("stages") as MemoryStage[];
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);
  const dateFrom = url.searchParams.get("dateFrom") || undefined;
  const dateTo = url.searchParams.get("dateTo") || undefined;

  if (!query) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Query parameter 'q' is required" }));
    return true;
  }

  const results = await pipeline.search.keywordSearch({
    query,
    entryTypes: types.length > 0 ? types : undefined,
    memoryStages: stages.length > 0 ? stages : undefined,
    limit,
    dateFrom,
    dateTo,
  });

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ results }));
  return true;
}

async function handleDecisions(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const dateFrom = url.searchParams.get("dateFrom") || undefined;

  const decisions = await pipeline.search.getDecisionsWithEvidence(dateFrom);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ decisions }));
  return true;
}

async function handleTasks(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const tasks = await pipeline.search.getPendingTasks();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ tasks }));
  return true;
}

async function handleProcess(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  // POST body 읽기
  const body = await readBody(req);

  if (!body.sessionLog) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "sessionLog is required" }));
    return true;
  }

  const result = await pipeline.processSession(
    body.sessionLog as string,
    body.date as string | undefined,
    body.sessionId as number | undefined
  );

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return true;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

// === Graduation API Handlers ===

async function handleGraduationStats(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const stats = await pipeline.getGraduationStats();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ stats }));
  return true;
}

async function handleGraduationHistory(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);

  const history = await pipeline.getPromotionHistory(limit);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ history }));
  return true;
}

async function handlePromote(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const body = await readBody(req);

  if (!body.entryId || !body.targetStage) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "entryId and targetStage are required" }));
    return true;
  }

  const validStages: MemoryStage[] = ["candidate", "verified", "certified"];
  if (!validStages.includes(body.targetStage as MemoryStage)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid targetStage. Must be: candidate, verified, or certified" }));
    return true;
  }

  const result = await pipeline.promoteEntry(
    body.entryId as string,
    body.targetStage as MemoryStage
  );

  res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return true;
}

async function handleDemote(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const body = await readBody(req);

  if (!body.entryId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "entryId is required" }));
    return true;
  }

  const reason = (body.reason as DemotionReason) || "user_demotion";
  const validReasons: DemotionReason[] = ["unused", "conflict_detected", "compile_failed", "user_demotion"];
  if (!validReasons.includes(reason)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid reason. Must be: unused, conflict_detected, compile_failed, or user_demotion" }));
    return true;
  }

  const result = await pipeline.demoteEntry(body.entryId as string, reason);

  res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return true;
}

async function handleRunAutoPromotions(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const results = await pipeline.runAutoPromotions();

  const successCount = results.filter((r) => r.success).length;

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    total: results.length,
    success: successCount,
    failed: results.length - successCount,
    results,
  }));
  return true;
}

// === Conflict API Handlers ===

async function handleGetConflicts(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const conflicts = await pipeline.getUnresolvedConflicts();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ conflicts, count: conflicts.length }));
  return true;
}

async function handleResolveConflict(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const body = await readBody(req);

  if (!body.conflictId || !body.resolution) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "conflictId and resolution are required" }));
    return true;
  }

  const validResolutions = ["keep_newer", "keep_older", "merge", "manual"];
  if (!validResolutions.includes(body.resolution as string)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "Invalid resolution. Must be: keep_newer, keep_older, merge, or manual"
    }));
    return true;
  }

  await pipeline.resolveConflict(
    body.conflictId as string,
    body.resolution as string,
    body.keepEntryId as string | undefined
  );

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true }));
  return true;
}

// === Scheduler API Handlers ===

async function handleSchedulerStats(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const scheduler = getAutoScheduler(pipeline);
  const stats = scheduler.getStats();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ stats }));
  return true;
}

async function handleTriggerPromotion(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const scheduler = getAutoScheduler(pipeline);
  const results = await scheduler.triggerPromotionCheck();

  const successCount = results.filter((r) => r.success).length;

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    total: results.length,
    success: successCount,
    failed: results.length - successCount,
    results,
  }));
  return true;
}

async function handleTriggerConsolidation(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const scheduler = getAutoScheduler(pipeline);
  const consolidatedCount = await scheduler.triggerConsolidation();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    consolidated: consolidatedCount,
  }));
  return true;
}

async function handleSchedulerStart(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const scheduler = getAutoScheduler(pipeline);
  scheduler.start();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, message: "Scheduler started" }));
  return true;
}

async function handleSchedulerStop(
  req: IncomingMessage,
  res: ServerResponse,
  pipeline: MemoryPipeline
): Promise<boolean> {
  stopAutoScheduler();

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, message: "Scheduler stopped" }));
  return true;
}

// === Entry CRUD Handlers ===

async function handleListEntries(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const entryTypes = url.searchParams.getAll("types");
  const memoryStages = url.searchParams.getAll("stages");
  const dateFrom = url.searchParams.get("dateFrom") || undefined;
  const dateTo = url.searchParams.get("dateTo") || undefined;
  const sortBy = url.searchParams.get("sortBy") || "created_at";
  const sortOrder = (url.searchParams.get("sortOrder") || "DESC") as "ASC" | "DESC";

  const result = await pipeline.listEntries({
    limit,
    offset,
    entryTypes: entryTypes.length > 0 ? entryTypes : undefined,
    memoryStages: memoryStages.length > 0 ? memoryStages : undefined,
    dateFrom,
    dateTo,
    sortBy,
    sortOrder,
  });

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return true;
}

async function handleGetEntry(
  req: IncomingMessage,
  res: ServerResponse,
  entryId: string,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const entry = await pipeline.getEntry(entryId);

  if (!entry) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Entry not found" }));
    return true;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ entry }));
  return true;
}

async function handleUpdateEntry(
  req: IncomingMessage,
  res: ServerResponse,
  entryId: string,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const body = await readBody(req);

  if (!body.title && !body.content) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "At least one of title or content is required" }));
    return true;
  }

  const success = await pipeline.updateEntry(entryId, {
    title: body.title as string | undefined,
    content: body.content as AnyEntry | undefined,
  });

  if (!success) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to update entry" }));
    return true;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true }));
  return true;
}

async function handleDeleteEntry(
  req: IncomingMessage,
  res: ServerResponse,
  entryId: string,
  pipeline: MemoryPipeline
): Promise<boolean> {
  const success = await pipeline.deleteEntry(entryId);

  if (!success) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to delete entry" }));
    return true;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true }));
  return true;
}
