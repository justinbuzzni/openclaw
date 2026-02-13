/**
 * Authentication for AxiomMind HTTP routes
 *
 * Gateway token 인증 체크
 */
import type { IncomingMessage } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { timingSafeEqual } from "node:crypto";

export type AuthResult = {
  ok: boolean;
  reason?: string;
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function extractToken(req: IncomingMessage, url: URL): string | undefined {
  // 1. Authorization: Bearer <token> 헤더
  const auth =
    typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  // 2. x-openclaw-token 헤더
  const headerToken =
    typeof req.headers["x-openclaw-token"] === "string"
      ? req.headers["x-openclaw-token"].trim()
      : "";
  if (headerToken) return headerToken;

  // 3. ?token=<value> 쿼리 파라미터
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.trim();

  return undefined;
}

function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip === "::1") return true;
  if (ip.startsWith("::ffff:127.")) return true;
  return false;
}

function getHostName(hostHeader?: string): string {
  const host = (hostHeader ?? "").trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end !== -1) return host.slice(1, end);
  }
  const [name] = host.split(":");
  return name ?? "";
}

function isLocalDirectRequest(req: IncomingMessage): boolean {
  const clientIp = req.socket?.remoteAddress ?? "";
  if (!isLoopbackAddress(clientIp)) return false;

  const host = getHostName(req.headers?.host);
  const hostIsLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

  const hasForwarded = Boolean(
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-real-ip"] ||
    req.headers?.["x-forwarded-host"],
  );

  return hostIsLocal && !hasForwarded;
}

/**
 * 인증 체커 생성
 */
export function createAuthChecker(api: OpenClawPluginApi) {
  // config에서 gateway token 가져오기
  const config = api.config as any;
  const gatewayToken = config?.gateway?.auth?.token;
  const authMode = config?.gateway?.auth?.mode || "token";

  return (req: IncomingMessage, url: URL): AuthResult => {
    // 로컬 직접 접속은 인증 불필요 (개발 편의)
    if (isLocalDirectRequest(req)) {
      return { ok: true };
    }

    // token 모드가 아니면 통과 (password 모드 등)
    if (authMode !== "token") {
      return { ok: true };
    }

    // gateway token이 설정되지 않았으면 통과 (인증 비활성화)
    if (!gatewayToken) {
      return { ok: true };
    }

    // 요청에서 token 추출
    const requestToken = extractToken(req, url);
    if (!requestToken) {
      return { ok: false, reason: "token_missing" };
    }

    // token 비교 (timing-safe)
    if (!safeEqual(requestToken, gatewayToken)) {
      return { ok: false, reason: "token_mismatch" };
    }

    return { ok: true };
  };
}
