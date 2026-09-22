import assert from "node:assert/strict";
import test from "node:test";
import { isDirectEntryPoint } from "./mcp-main.js";

test("MCP direct-entry detection accepts a Windows file URL", () => {
  assert.equal(
    isDirectEntryPoint(
      "file:///C:/Users/User/cline-orchestrator/src/mcp-main.ts",
      "C:\\Users\\User\\cline-orchestrator\\src\\mcp-main.ts",
      "win32",
    ),
    true,
  );
});

test("MCP direct-entry detection handles encoded Windows paths", () => {
  assert.equal(
    isDirectEntryPoint(
      "file:///C:/Users/Test%20User/cline-orchestrator/src/mcp-main.ts",
      "C:\\Users\\Test User\\cline-orchestrator\\src\\mcp-main.ts",
      "win32",
    ),
    true,
  );
});

test("MCP direct-entry detection rejects a different entry module", () => {
  assert.equal(
    isDirectEntryPoint(
      "file:///C:/Users/User/cline-orchestrator/src/mcp-main.ts",
      "C:\\Users\\User\\cline-orchestrator\\src\\other.ts",
      "win32",
    ),
    false,
  );
});

test("MCP direct-entry detection accepts a POSIX file URL", () => {
  assert.equal(
    isDirectEntryPoint(
      "file:///home/user/cline-orchestrator/src/mcp-main.ts",
      "/home/user/cline-orchestrator/src/mcp-main.ts",
      "posix",
    ),
    true,
  );
});
