import assert from "node:assert/strict";
import test from "node:test";
import {
  buildToolProtocolRepairPrompt,
  classifyRecoverableClineRuntimeFailure,
  ClineSessionReplacementRequiredError,
  createRecoveringClineRuntime,
} from "./cline-runtime-recovery.js";
import type { ClineRuntime } from "./cline-runtime.js";

class ScriptedRuntime implements ClineRuntime {
  readonly sent: unknown[] = [];
  readonly aborted: string[] = [];
  private readonly subscribers: Array<(event: any) => void> = [];

  constructor(private readonly outcomes: Array<unknown | (() => unknown)>) {}

  async start() { return { sessionId: "session-1" }; }

  async send(input: unknown): Promise<any> {
    this.sent.push(structuredClone(input));
    const next = this.outcomes.shift();
    const value = typeof next === "function" ? next() : next;
    if (value instanceof Error) throw value;
    return value;
  }

  async abort(sessionId: string) {
    this.aborted.push(sessionId);
  }

  subscribe(listener: (event: any) => void) {
    this.subscribers.push(listener);
    return () => {
      const index = this.subscribers.indexOf(listener);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  emitAgentError(message: string) {
    for (const subscriber of this.subscribers) {
      subscriber({
        type: "agent_event",
        payload: { event: { type: "error", error: { message } } },
      });
    }
  }

  async dispose() {}
}

test("classifies the observed hard context overflow exactly", () => {
  const failure = classifyRecoverableClineRuntimeFailure(
    new Error("request (197745 tokens) exceeds the available context size (196608 tokens), try increasing it"),
  );
  assert.deepEqual(failure, {
    kind: "context_overflow",
    strategy: "replace_session",
    requestedTokens: 197745,
    availableTokens: 196608,
  });
});

test("classifies invalid JSON emitted for a tool call", () => {
  const failure = classifyRecoverableClineRuntimeFailure(
    new Error(
      "Tool call editor emitted invalid JSON arguments: Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.",
    ),
  );
  assert.deepEqual(failure, {
    kind: "tool_arguments_invalid_json",
    strategy: "repair_same_session",
  });
});

test("classifies missing/undefined tool schema values but not unrelated validation errors", () => {
  const failure = classifyRecoverableClineRuntimeFailure(
    new Error("Invalid input: expected string, received undefined at path new_text"),
  );
  assert.deepEqual(failure, {
    kind: "tool_arguments_schema_invalid",
    strategy: "repair_same_session",
  });

  assert.equal(
    classifyRecoverableClineRuntimeFailure(new Error("Invalid input: expected string, received undefined")),
    undefined,
  );
});

test("hard context overflow becomes a bounded replacement-session signal", async () => {
  const raw = new ScriptedRuntime([
    new Error("request (197745 tokens) exceeds the available context size (196608 tokens), try increasing it"),
  ]);
  const runtime = createRecoveringClineRuntime(raw);

  await assert.rejects(
    () => runtime.send({ sessionId: "session-1", prompt: "continue" }),
    (error: unknown) => {
      assert.ok(error instanceof ClineSessionReplacementRequiredError);
      assert.equal(error.code, "session_not_found");
      assert.equal(error.sessionId, "session-1");
      assert.equal(error.requestedTokens, 197745);
      assert.equal(error.availableTokens, 196608);
      return true;
    },
  );
  assert.deepEqual(raw.aborted, ["session-1"]);
  assert.equal(raw.sent.length, 1);
});

test("invalid JSON tool call is repaired in the same session without replaying the original prompt", async () => {
  const raw = new ScriptedRuntime([
    new Error(
      "Tool call editor emitted invalid JSON arguments: Tool call arguments could not be parsed as JSON.",
    ),
    { finishReason: "completed", text: "recovered" },
  ]);
  const runtime = createRecoveringClineRuntime(raw);

  const result = await runtime.send({ sessionId: "session-1", prompt: "original task prompt" });
  assert.equal(result.finishReason, "completed");
  assert.equal(raw.sent.length, 2);
  assert.deepEqual(raw.sent[0], { sessionId: "session-1", prompt: "original task prompt" });

  const repaired = raw.sent[1] as { sessionId: string; prompt: string };
  assert.equal(repaired.sessionId, "session-1");
  assert.notEqual(repaired.prompt, "original task prompt");
  assert.match(repaired.prompt, /rejected before execution/i);
  assert.match(repaired.prompt, /do not repeat earlier successful side effects/i);
  assert.match(repaired.prompt, /do not invent/i);
  assert.deepEqual(raw.aborted, []);
});

test("agent error event can drive schema repair even when send resolves failed", async () => {
  let raw!: ScriptedRuntime;
  raw = new ScriptedRuntime([
    () => {
      raw.emitAgentError("Invalid input: expected string, received undefined at path new_text");
      return { finishReason: "failed" };
    },
    { finishReason: "completed", text: "fixed" },
  ]);
  const runtime = createRecoveringClineRuntime(raw);

  const result = await runtime.send({ sessionId: "session-1", prompt: "edit the file" });
  assert.equal(result.finishReason, "completed");
  assert.equal(raw.sent.length, 2);
  assert.match((raw.sent[1] as { prompt: string }).prompt, /input-schema validation/i);
});

test("tool protocol repairs are bounded and unknown runtime failures still fail closed", async () => {
  const invalid = () => new Error(
    "Tool call editor emitted invalid JSON arguments: arguments could not be parsed as JSON",
  );
  const raw = new ScriptedRuntime([invalid(), invalid(), invalid()]);
  const runtime = createRecoveringClineRuntime(raw, { maxToolProtocolRepairs: 2 });

  await assert.rejects(
    () => runtime.send({ sessionId: "session-1", prompt: "edit" }),
    /invalid JSON arguments/i,
  );
  assert.equal(raw.sent.length, 3);

  const unknownRaw = new ScriptedRuntime([new Error("permission denied while writing file")]);
  const unknownRuntime = createRecoveringClineRuntime(unknownRaw);
  await assert.rejects(
    () => unknownRuntime.send({ sessionId: "session-1", prompt: "edit" }),
    /permission denied/i,
  );
  assert.equal(unknownRaw.sent.length, 1);
});

test("repair prompt never grants new authority", () => {
  const prompt = buildToolProtocolRepairPrompt({
    kind: "tool_arguments_schema_invalid",
    strategy: "repair_same_session",
  });
  assert.match(prompt, /existing task context/i);
  assert.match(prompt, /already-approved scope/i);
  assert.match(prompt, /stop and explain what is missing/i);
});
