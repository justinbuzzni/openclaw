/**
 * Static Web Serving
 *
 * Next.js 빌드된 정적 파일 서빙
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

// MIME 타입 매핑
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

/**
 * 정적 웹 서빙 핸들러 생성
 */
export function serveStaticWeb(): HttpHandler {
  // 정적 파일 디렉토리 (Next.js 빌드 출력)
  // TypeScript 빌드 후 __dirname은 dist/ 디렉토리를 가리키므로,
  // 소스 디렉토리를 찾아야 함
  const sourceDir = __dirname.includes("/dist/")
    ? __dirname.replace("/dist/", "/")
    : __dirname;
  const staticDir = path.join(sourceDir, "..", "web", "out");
  console.log("[axiommind/static] __dirname:", __dirname);
  console.log("[axiommind/static] staticDir:", staticDir);

  return async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let pathname = url.pathname;

    // /ax 프리픽스 제거
    pathname = pathname.replace(/^\/ax\/?/, "/");
    if (!pathname || pathname === "/") {
      pathname = "/index.html";
    }

    // 보안: 경로 탐색 방지
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
    const filePath = path.join(staticDir, safePath);

    // 파일 존재 확인
    if (!fs.existsSync(filePath)) {
      // SPA fallback: index.html 반환
      const indexPath = path.join(staticDir, "index.html");
      if (fs.existsSync(indexPath)) {
        return serveFile(indexPath, res);
      }

      // 웹 UI가 아직 빌드되지 않은 경우 플레이스홀더 반환
      return servePlaceholder(res);
    }

    // 디렉토리인 경우 index.html 확인
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      if (fs.existsSync(indexPath)) {
        return serveFile(indexPath, res);
      }
      res.writeHead(404);
      res.end("Not Found");
      return true;
    }

    return serveFile(filePath, res);
  };
}

function serveFile(filePath: string, res: ServerResponse): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch (error) {
    res.writeHead(500);
    res.end("Internal Server Error");
    return true;
  }
}

function servePlaceholder(res: ServerResponse): boolean {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AxiomMind</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    p {
      font-size: 1.2rem;
      opacity: 0.9;
      margin-bottom: 2rem;
    }
    .status {
      background: rgba(255,255,255,0.2);
      padding: 1rem 2rem;
      border-radius: 8px;
      display: inline-block;
    }
    code {
      background: rgba(0,0,0,0.2);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧠 AxiomMind</h1>
    <p>Memory Graduation Pipeline + Custom Chat UI</p>
    <div class="status">
      <p>웹 UI가 아직 빌드되지 않았습니다.</p>
      <p style="margin-top: 1rem;">
        빌드하려면: <code>cd extensions/axiommind/web && npm run build</code>
      </p>
    </div>
  </div>
</body>
</html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
  return true;
}
