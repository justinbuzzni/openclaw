/**
 * Type declarations for openclaw/plugin-sdk
 */
declare module "openclaw/plugin-sdk" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export interface OpenClawPluginApi {
    logger: {
      info(message: string): void;
      debug(message: string): void;
      warn(message: string): void;
      error(message: string): void;
    };
    config: Record<string, unknown>;
    getDataDir(): string;
    on(
      event: "before_agent_start",
      handler: (
        event: { prompt?: string },
        ctx: AgentContext
      ) => Promise<{ prependContext?: string } | void>
    ): void;
    on(
      event: "session_end",
      handler: (event: { sessionId: string }, ctx: AgentContext) => Promise<void>
    ): void;
    registerTool(
      tool: ToolDefinition,
      options?: { names?: string[] }
    ): void;
    registerHttpHandler(
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
    ): void;
  }

  export interface AgentContext {
    sessionId?: string;
    messages?: Array<{ role: string; content: string }>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface ToolDefinition {
    name: string;
    label?: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    execute: (
      callId: string,
      params: any
    ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  }
}
