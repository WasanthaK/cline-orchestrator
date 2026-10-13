import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_CLI_CONTRACT,
  ProductCliError,
  routeProductCli,
  runNativeProductCommand,
  type ProductCliDependencies,
} from "./product-cli.js";

function deps(overrides: Partial<ProductCliDependencies> = {}): ProductCliDependencies {
  return {
    env: {},
    runtime: {
      nodeVersion: "v22.23.3",
      platform: "win32",
      architecture: "x64",
    },
    async findWorkspace() {
      return {
        schemaVersion: 1,
        registered: true,
        workspaceId: "11111111-1111-4111-8111-111111111111",
        projectId: "22222222-2222-4222-8222-222222222222",
        rootAlias: "workspace",
        safetyProfileConfigured: true,
        validationCommandsConfigured: true,
        authority: "first_run_workspace_observation",
        grantsAuthority: false,
      };
    },
    async fetchJson(url) {
      if (url.endsWith("/preflight")) return { ok: true, status: 200, payload: { ok: true, secret: "do-not-expose" } };
      return { ok: true, status: 200, payload: { workspace: "C:\\private\\workspace", token: "secret" } };
    },
    ...overrides,
  };
}

test("M17D contract provides stable binary without broadening authority", () => {
  assert.equal(PRODUCT_CLI_CONTRACT.executable, "cline-orchestrator");
  assert.equal(PRODUCT_CLI_CONTRACT.nativeCommandsAreReadOnly, true);
  assert.equal(PRODUCT_CLI_CONTRACT.legacyDelegatesExistingDispatcher, true);
  assert.equal(PRODUCT_CLI_CONTRACT.broadensAuthority, false);
  assert.equal(PRODUCT_CLI_CONTRACT.opensRemoteListener, false);
  assert.equal(PRODUCT_CLI_CONTRACT.grantsAuthority, false);
});

test("M17D product aliases route to existing low-level dispatcher unchanged", () => {
  assert.deepEqual(routeProductCli(["start", "C:/repo"]), {
    kind: "legacy",
    args: ["daemon", "C:/repo"],
  });
  assert.deepEqual(routeProductCli(["tasks", "C:/repo"]), {
    kind: "legacy",
    args: ["list", "C:/repo"],
  });
  assert.deepEqual(routeProductCli(["status", "C:/repo", "task-1"]), {
    kind: "legacy",
    args: ["status", "C:/repo", "task-1"],
  });
  assert.deepEqual(routeProductCli(["run", "C:/repo", "fix", "bug"]), {
    kind: "legacy",
    args: ["run", "C:/repo", "fix", "bug"],
  });
});

test("M17D status without task ID is native daemon health only", async () => {
  const route = routeProductCli(["status", "C:/repo"]);
  assert.equal(route.kind, "native");
  if (route.kind !== "native") return;

  const result = await runNativeProductCommand(route, deps());
  assert.equal(result.command, "status");
  assert.deepEqual(result.payload, {
    reachable: true,
    httpStatus: 200,
    loopback: true,
  });
  assert.equal(result.grantsAuthority, false);
  assert.doesNotMatch(JSON.stringify(result), /private\\workspace|token|secret/i);
});

test("M17D diagnose uses sanitized first-run assessment only", async () => {
  const route = routeProductCli(["diagnose", "C:/repo"]);
  assert.equal(route.kind, "native");
  if (route.kind !== "native") return;

  const result = await runNativeProductCommand(route, deps());
  assert.equal(result.command, "diagnose");
  const payload = result.payload as { status: string; grantsAuthority: boolean };
  assert.equal(payload.status, "ready");
  assert.equal(payload.grantsAuthority, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /do-not-expose|private\\workspace|token/i);
});

test("M17D setup command is plan-only and points mutation back to M17C confirmation", async () => {
  const route = routeProductCli(["setup", "C:/repo"]);
  assert.equal(route.kind, "native");
  if (route.kind !== "native") return;

  const result = await runNativeProductCommand(route, deps({
    async findWorkspace() {
      return {
        schemaVersion: 1,
        registered: false,
        safetyProfileConfigured: false,
        validationCommandsConfigured: false,
        authority: "first_run_workspace_observation",
        grantsAuthority: false,
      };
    },
  }));
  const payload = result.payload as {
    mutationPerformed: boolean;
    explicitM17CConfirmationRequiredForMutation: boolean;
  };
  assert.equal(payload.mutationPerformed, false);
  assert.equal(payload.explicitM17CConfirmationRequiredForMutation, true);
  assert.equal(result.mutatesConfig, false);
  assert.equal(result.registersWorkspace, false);
  assert.equal(result.startsService, false);
});

test("M17D config command returns resolved product config without secret material", async () => {
  const route = routeProductCli(["config"]);
  if (route.kind !== "native") throw new Error("expected native");
  const result = await runNativeProductCommand(route, deps({
    env: { ORCH_API_KEY_SECRET_REF: "ORCH_PROVIDER_API_KEY" },
  }));
  const serialized = JSON.stringify(result);
  assert.match(serialized, /ORCH_PROVIDER_API_KEY/);
  assert.doesNotMatch(serialized, /apiKey":|password|Bearer/i);
  assert.equal(result.grantsAuthority, false);
});

test("M17D invalid command fails with stable usage error", () => {
  assert.throws(
    () => routeProductCli(["unknown"]),
    (error: unknown) =>
      error instanceof ProductCliError
      && error.code === "usage_invalid",
  );
});
