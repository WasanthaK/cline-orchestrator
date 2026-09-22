import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import {
  createMachineMcpHandler,
  readMcpGatewayConfig,
  startMachineMcpHttpServer,
} from "./mcp-gateway.js";
import type { MachineOrchestratorService } from "./machine-orchestrator.js";

const PROTOCOL_VERSION = "2026-07-28";
const EXPECTED_TOOLS = [
  "abort_task",
  "approve_escalation",
  "continue_task",
  "find_tasks",
  "get_task",
  "get_task_diff",
  "get_task_events",
  "get_workspace_status",
  "list_projects",
  "list_workspaces",
  "preview_task",
  "reject_escalation",
  "rollback_task",
  "start_task",
];

function fakeService(): MachineOrchestratorService {
  return {} as MachineOrchestratorService;
}

function modernParams(params: Record<string, unknown> = {}) {
  return {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientInfo": {
        name: "cline-orchestrator-test",
        version: "1.0.0",
      },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

async function mcpFetch(
  handler: ReturnType<typeof createMachineMcpHandler>,
  method: string,
  params: Record<string, unknown> = {},
) {
  return await handler.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-method": method,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: modernParams(params),
      }),
    }),
  );
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  assert.ok(text, `expected response body for HTTP ${response.status}`);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
    assert.ok(dataLine, `expected SSE data line, got ${text}`);
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
  return JSON.parse(text);
}

test("MCP gateway config is loopback-only and requires a strong local bearer token", () => {
  const valid = readMcpGatewayConfig({
    ORCH_MCP_HOST: "127.0.0.1",
    ORCH_MCP_PORT: "4318",
    ORCH_MCP_PATH: "/mcp",
    ORCH_MCP_BEARER_TOKEN: "x".repeat(32),
    ORCH_MCP_TUNNEL_PUBLIC_URL: "https://example.test/mcp",
  });
  assert.equal(valid.host, "127.0.0.1");
  assert.equal(valid.port, 4318);
  assert.equal(valid.path, "/mcp");
  assert.equal(valid.tunnelPublicUrl, "https://example.test/mcp");

  assert.throws(() => readMcpGatewayConfig({
    ORCH_MCP_HOST: "0.0.0.0",
    ORCH_MCP_BEARER_TOKEN: "x".repeat(32),
  }), /loopback-only/i);
  assert.throws(() => readMcpGatewayConfig({
    ORCH_MCP_BEARER_TOKEN: "short",
  }), /at least 32/i);
  assert.throws(() => readMcpGatewayConfig({
    ORCH_MCP_BEARER_TOKEN: "x".repeat(32),
    ORCH_MCP_TUNNEL_PUBLIC_URL: "http://example.test/mcp",
  }), /must use https/i);
});

test("MCP tools expose only task-level authority with accurate safety annotations", async () => {
  const handler = createMachineMcpHandler(fakeService());
  try {
    const response = await mcpFetch(handler, "tools/list");
    assert.equal(response.status, 200);
    const payload = await responseJson(response);
    const tools = payload.result?.tools ?? [];
    const names = tools.map((tool: any) => tool.name).sort();
    assert.deepEqual(names, EXPECTED_TOOLS);

    const byName = new Map(tools.map((tool: any) => [tool.name, tool]));
    assert.equal((byName.get("list_projects") as any)?.annotations?.readOnlyHint, true);
    assert.equal((byName.get("preview_task") as any)?.annotations?.readOnlyHint, true);
    assert.equal((byName.get("start_task") as any)?.annotations?.readOnlyHint, false);
    assert.equal((byName.get("rollback_task") as any)?.annotations?.destructiveHint, true);

    const forbiddenNames = [
      "shell",
      "read_file",
      "write_file",
      "run_command",
      "session_attach",
      "hub_command",
      "daemon_control",
    ];
    for (const name of forbiddenNames) assert.equal(byName.has(name), false);

    for (const tool of tools) {
      const schemaText = JSON.stringify((tool as any).inputSchema ?? {});
      for (const forbiddenParameter of [
        "workspace_root",
        "raw_path",
        "session_id",
        "hub_token",
        "command",
        "credential",
      ]) {
        assert.equal(
          schemaText.includes(forbiddenParameter),
          false,
          `${(tool as any).name} unexpectedly exposes ${forbiddenParameter}`,
        );
      }
    }
  } finally {
    await handler.close();
  }
});

test("plain HTTP MCP endpoint rejects unauthenticated requests before protocol handling", async () => {
  const token = "local-only-token-" + "x".repeat(32);
  const server = startMachineMcpHttpServer(fakeService(), {
    host: "127.0.0.1",
    port: 0,
    path: "/mcp",
    bearerToken: token,
  });
  try {
    if (!server.listening) {
      await new Promise<void>((resolve) => server.once("listening", resolve));
    }
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/mcp`;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: modernParams(),
    });
    const protocolHeaders = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-method": "tools/list",
    };

    const unauthenticated = await fetch(url, {
      method: "POST",
      headers: protocolHeaders,
      body,
    });
    assert.equal(unauthenticated.status, 401);

    const wrongPath = await fetch(`http://127.0.0.1:${address.port}/not-mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    assert.equal(wrongPath.status, 404);

    const authenticated = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...protocolHeaders,
      },
      body,
    });
    assert.equal(authenticated.status, 200);
    const payload = await responseJson(authenticated);
    assert.ok(Array.isArray(payload.result?.tools));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
