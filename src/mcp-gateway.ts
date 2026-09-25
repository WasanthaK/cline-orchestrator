import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  MachineGatewayError,
  MachineOrchestratorService,
} from "./machine-orchestrator.js";
import { listRegisteredWorkspaceIncidents } from "./sentinel-query.js";
import type { TaskStatus } from "./types.js";

const TOOL_RESULT_MAX_CHARS = 120_000;
const TASK_STATUSES: TaskStatus[] = [
  "created",
  "running",
  "waiting",
  "waiting_for_human",
  "stalled",
  "validating",
  "repairing",
  "safety_checking",
  "completed",
  "validation_failed",
  "failed",
  "aborted",
  "rolled_back",
];

export interface McpGatewayConfig {
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
  path: string;
  bearerToken: string;
  tunnelPublicUrl?: string;
}

export class McpGatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpGatewayConfigError";
  }
}

function readPort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new McpGatewayConfigError("ORCH_MCP_PORT must be an integer from 1 to 65535");
  }
  return value;
}

function readPath(raw: string | undefined): string {
  const value = raw?.trim() || "/mcp";
  if (!value.startsWith("/") || value.includes("?") || value.includes("#") || value.includes("..")) {
    throw new McpGatewayConfigError("ORCH_MCP_PATH must be a simple absolute URL path");
  }
  return value.replace(/\/+$/, "") || "/mcp";
}

export function readMcpGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): McpGatewayConfig {
  const host = (env.ORCH_MCP_HOST ?? "127.0.0.1").trim();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new McpGatewayConfigError(
      "ORCH_MCP_HOST must stay loopback-only (127.0.0.1, localhost, or ::1); use a secure MCP tunnel for remote access",
    );
  }

  const bearerToken = (env.ORCH_MCP_BEARER_TOKEN ?? "").trim();
  if (bearerToken.length < 32 || bearerToken.length > 4096) {
    throw new McpGatewayConfigError(
      "ORCH_MCP_BEARER_TOKEN must be configured locally and contain at least 32 characters",
    );
  }

  let tunnelPublicUrl: string | undefined;
  if (env.ORCH_MCP_TUNNEL_PUBLIC_URL?.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(env.ORCH_MCP_TUNNEL_PUBLIC_URL.trim());
    } catch {
      throw new McpGatewayConfigError("ORCH_MCP_TUNNEL_PUBLIC_URL must be a valid URL when set");
    }
    if (parsed.protocol !== "https:") {
      throw new McpGatewayConfigError("ORCH_MCP_TUNNEL_PUBLIC_URL must use https");
    }
    tunnelPublicUrl = parsed.toString();
  }

  return {
    host,
    port: readPort(env.ORCH_MCP_PORT, 4318),
    path: readPath(env.ORCH_MCP_PATH),
    bearerToken,
    tunnelPublicUrl,
  };
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requestBearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function toolPayload(value: unknown) {
  let text = JSON.stringify(value, null, 2);
  if (text.length > TOOL_RESULT_MAX_CHARS) {
    text = `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n... [truncated]`;
  }
  return {
    content: [{ type: "text" as const, text }],
  };
}

function toolError(error: unknown) {
  const code = error instanceof MachineGatewayError
    ? error.code
    : "internal_error";
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message, code }),
      },
    ],
  };
}

async function guardedTool<T>(job: () => Promise<T>) {
  try {
    return toolPayload(await job());
  } catch (error) {
    return toolError(error);
  }
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
} as const;

export function createMachineMcpServer(
  service: MachineOrchestratorService,
): McpServer {
  const server = new McpServer({
    name: "cline-orchestrator",
    version: "0.1.0",
  });

  server.registerTool(
    "list_projects",
    {
      title: "List registered projects",
      description: "List user-registered machine projects by opaque ID. Does not expose filesystem roots.",
      annotations: readAnnotations,
    },
    async () => guardedTool(() => service.listProjects()),
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List registered workspaces",
      description: "List user-registered workspaces by opaque ID and safe root alias; never accepts or returns raw write paths.",
      inputSchema: z.object({
        project_id: z.string().uuid().optional(),
      }),
      annotations: readAnnotations,
    },
    async ({ project_id }) => guardedTool(async () => {
      const workspaces = await service.listWorkspaces();
      return project_id
        ? workspaces.filter((workspace) => workspace.projectId === project_id)
        : workspaces;
    }),
  );

  server.registerTool(
    "get_workspace_status",
    {
      title: "Get workspace status",
      description: "Return bounded Git/task/runtime status for one registered workspace without exposing its raw filesystem root.",
      inputSchema: z.object({ workspace_id: z.string().uuid() }),
      annotations: readAnnotations,
    },
    async ({ workspace_id }) => guardedTool(() => service.getWorkspaceStatus(workspace_id)),
  );

  server.registerTool(
    "list_incidents",
    {
      title: "List orchestrator incidents",
      description: "Refresh and return bounded, redacted Sentinel incidents for one registered workspace. This is read-only and exposes no process-control or filesystem authority.",
      inputSchema: z.object({
        workspace_id: z.string().uuid(),
        include_resolved: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readAnnotations,
    },
    async ({ workspace_id, include_resolved, limit }) => guardedTool(() =>
      listRegisteredWorkspaceIncidents(service.registry, workspace_id, {
        includeResolved: include_resolved,
        limit,
      }),
    ),
  );

  server.registerTool(
    "find_tasks",
    {
      title: "Find orchestrator tasks",
      description: "Find approved tasks across registered workspaces using opaque project/workspace IDs.",
      inputSchema: z.object({
        project_id: z.string().uuid().optional(),
        workspace_id: z.string().uuid().optional(),
        status: z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]]).optional(),
        query: z.string().max(500).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readAnnotations,
    },
    async ({ project_id, workspace_id, status, query, limit }) => guardedTool(() =>
      service.findTasks({
        projectId: project_id,
        workspaceId: workspace_id,
        status,
        query,
        limit,
      }),
    ),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task status",
      description: "Return a bounded sanitized task view. Raw workspace paths, Hub session IDs, prompts, credentials and model output are omitted.",
      inputSchema: z.object({ task_id: z.string().uuid() }),
      annotations: readAnnotations,
    },
    async ({ task_id }) => guardedTool(() => service.getTask(task_id)),
  );

  server.registerTool(
    "get_task_events",
    {
      title: "Get task events",
      description: "Return the sanitized durable task event timeline without raw event payloads or runtime credentials.",
      inputSchema: z.object({ task_id: z.string().uuid() }),
      annotations: readAnnotations,
    },
    async ({ task_id }) => guardedTool(() => service.getTaskEvents(task_id)),
  );

  server.registerTool(
    "get_task_diff",
    {
      title: "Get bounded task diff",
      description: "Return checkpoint-relative changed paths and safety findings only; no file contents are exposed.",
      inputSchema: z.object({ task_id: z.string().uuid() }),
      annotations: readAnnotations,
    },
    async ({ task_id }) => guardedTool(() => service.getTaskDiff(task_id)),
  );

  server.registerTool(
    "preview_task",
    {
      title: "Preview a safe task",
      description: "Read-only Safety Preview. Resolves a registered workspace ID, captures Git/scope/policy state, and returns a short-lived single-use plan token. It does not mutate workspace files or start Cline.",
      inputSchema: z.object({
        workspace_id: z.string().uuid(),
        goal: z.string().min(1).max(20_000),
        requested_scope: z.array(z.string().min(1).max(1_000)).max(100).optional(),
      }),
      annotations: {
        ...readAnnotations,
        idempotentHint: false,
      },
    },
    async ({ workspace_id, goal, requested_scope }) => guardedTool(() =>
      service.previewTask({
        workspaceId: workspace_id,
        goal,
        requestedScope: requested_scope,
      }),
    ),
  );

  server.registerTool(
    "start_task",
    {
      title: "Start approved task",
      description: "Consume a short-lived Safety Plan token exactly once, persist the approved task envelope, and queue Hub-backed execution. No workspace/path/policy/model override parameters are accepted.",
      inputSchema: z.object({ plan_token: z.string().min(32).max(256) }),
      annotations: writeAnnotations,
    },
    async ({ plan_token }) => guardedTool(() => service.startTask(plan_token)),
  );

  server.registerTool(
    "continue_task",
    {
      title: "Continue approved task",
      description: "Queue an instruction for an existing task while inheriting its immutable approved workspace/path/policy envelope. It cannot broaden task authority.",
      inputSchema: z.object({
        task_id: z.string().uuid(),
        instruction: z.string().min(1).max(20_000),
      }),
      annotations: writeAnnotations,
    },
    async ({ task_id, instruction }) => guardedTool(() =>
      service.continueTask(task_id, instruction),
    ),
  );

  server.registerTool(
    "abort_task",
    {
      title: "Abort task",
      description: "Abort a non-terminal task or validation run. Does not grant new workspace authority.",
      inputSchema: z.object({
        task_id: z.string().uuid(),
        reason: z.string().min(1).max(500).optional(),
      }),
      annotations: writeAnnotations,
    },
    async ({ task_id, reason }) => guardedTool(() => service.abortTask(task_id, reason)),
  );

  server.registerTool(
    "approve_escalation",
    {
      title: "Approve safety escalation",
      description: "Record explicit approval of a pending scope expansion. The old task envelope remains immutable and is closed; a fresh Safety Preview is still required before broader authority can be granted.",
      inputSchema: z.object({
        task_id: z.string().uuid(),
        escalation_id: z.string().uuid(),
      }),
      annotations: writeAnnotations,
    },
    async ({ task_id, escalation_id }) => guardedTool(() =>
      service.approveEscalation(task_id, escalation_id),
    ),
  );

  server.registerTool(
    "reject_escalation",
    {
      title: "Reject safety escalation",
      description: "Reject a pending safety escalation and close the paused task without granting additional authority.",
      inputSchema: z.object({
        task_id: z.string().uuid(),
        escalation_id: z.string().uuid(),
      }),
      annotations: writeAnnotations,
    },
    async ({ task_id, escalation_id }) => guardedTool(() =>
      service.rejectEscalation(task_id, escalation_id),
    ),
  );

  server.registerTool(
    "rollback_task",
    {
      title: "Rollback task changes",
      description: "Destructively restore the task's current orchestrator checkpoint. The opaque checkpoint_id returned by get_task must match exactly.",
      inputSchema: z.object({
        task_id: z.string().uuid(),
        checkpoint_id: z.string().regex(/^[0-9a-f]{32}$/i),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ task_id, checkpoint_id }) => guardedTool(() =>
      service.rollbackTask(task_id, checkpoint_id),
    ),
  );

  return server;
}

export function createMachineMcpHandler(service: MachineOrchestratorService) {
  return createMcpHandler(() => createMachineMcpServer(service), {
    responseMode: "json",
  });
}

export function startMachineMcpHttpServer(
  service: MachineOrchestratorService,
  config: McpGatewayConfig,
): Server {
  const handler = createMachineMcpHandler(service);
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const server = createServer((req, res) => {
    const pathname = (() => {
      try {
        return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
      } catch {
        return "";
      }
    })();
    if (pathname !== config.path) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;

    const token = requestBearerToken(req.headers.authorization);
    if (!token || !safeEqual(token, config.bearerToken)) {
      res.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="cline-orchestrator"',
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    void nodeHandler(req, res);
  });

  server.on("close", () => {
    void handler.close();
  });
  server.listen(config.port, config.host);
  return server;
}
