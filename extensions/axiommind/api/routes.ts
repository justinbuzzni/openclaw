/**
 * API Routes
 *
 * AxiomMind REST API 핸들러
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MemoryPipeline } from "../memory-pipeline/orchestrator.js";
import type { EntryType } from "../memory-pipeline/types.js";

type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

/**
 * API 핸들러 생성
 */
export function createApiHandler(pipeline: MemoryPipeline): HttpHandler {
  return async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // /axiommind/api/ 이후의 경로 추출
    const apiPath = path.replace(/^\/axiommind\/api\/?/, "");

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
      }

      if (req.method === "POST") {
        if (apiPath === "process") {
          return await handleProcess(req, res, pipeline);
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
    body.sessionLog,
    body.date,
    body.sessionId
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
