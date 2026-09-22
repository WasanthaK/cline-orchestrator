import type { ActionDescriptor, PolicyDecision, PreExecutionPolicyContext } from "./pre-execution-policy.js";
import { evaluatePreExecutionPolicy, normalizeToolAction } from "./pre-execution-policy.js";

export interface BeforeToolGateResult {
  allow?: boolean;
  skip?: boolean;
  stop?: boolean;
  reason: string;
  decision: PolicyDecision["decision"];
}

export interface PatchPreviewChange {
  path: string;
  operation: string;
}

export interface SafeExecutorDelegates<ReadResult = unknown, SearchResult = unknown, EditResult = unknown, PatchResult = unknown> {
  readFile(path: string): Promise<ReadResult>;
  search(queries: string[]): Promise<SearchResult>;
  editor(path: string, operation: "create" | "modify", input: unknown): Promise<EditResult>;
  previewPatch(patch: string): Promise<PatchPreviewChange[]> | PatchPreviewChange[];
  applyPatch(patch: string): Promise<PatchResult>;
}

export type EscalationHandler = (action: ActionDescriptor, reason: string) => Promise<void>;

export class SafeExecutorError extends Error {
  constructor(
    message: string,
    public readonly decision: PolicyDecision["decision"],
  ) {
    super(message);
    this.name = "SafeExecutorError";
  }
}

async function enforce(
  action: ActionDescriptor,
  context: PreExecutionPolicyContext,
  onEscalation?: EscalationHandler,
): Promise<PolicyDecision> {
  const decision = await evaluatePreExecutionPolicy(action, context);
  if (decision.decision === "ALLOW") return decision;
  if (decision.decision === "ESCALATE_AND_STOP") {
    if (!onEscalation) {
      throw new SafeExecutorError(
        "Escalation was required but no durable escalation handler is configured; execution failed closed",
        "DENY",
      );
    }
    try {
      await onEscalation(action, decision.reason);
    } catch (error) {
      throw new SafeExecutorError(
        `Durable escalation persistence failed; execution failed closed: ${error instanceof Error ? error.message : String(error)}`,
        "DENY",
      );
    }
  }
  throw new SafeExecutorError(decision.reason, decision.decision);
}

export function createBeforeToolGate(
  context: PreExecutionPolicyContext,
  onEscalation?: EscalationHandler,
): (toolName: string, input: unknown) => Promise<BeforeToolGateResult> {
  return async (toolName: string, input: unknown) => {
    let action: ActionDescriptor;
    try {
      action = normalizeToolAction(toolName, input);
    } catch (error) {
      return {
        skip: true,
        reason: `Tool normalization failed closed: ${error instanceof Error ? error.message : String(error)}`,
        decision: "DENY",
      };
    }

    const decision = await evaluatePreExecutionPolicy(action, context);
    if (decision.decision === "ALLOW") {
      return { allow: true, reason: decision.reason, decision: decision.decision };
    }
    if (decision.decision === "DENY") {
      return { skip: true, reason: decision.reason, decision: decision.decision };
    }
    if (!onEscalation) {
      return {
        stop: true,
        reason: "Escalation required but durable escalation handling is unavailable; execution failed closed",
        decision: "DENY",
      };
    }
    try {
      await onEscalation(action, decision.reason);
      return { stop: true, reason: decision.reason, decision: decision.decision };
    } catch (error) {
      return {
        stop: true,
        reason: `Durable escalation persistence failed; execution failed closed: ${error instanceof Error ? error.message : String(error)}`,
        decision: "DENY",
      };
    }
  };
}

export class SafeWorkspaceExecutors<ReadResult = unknown, SearchResult = unknown, EditResult = unknown, PatchResult = unknown> {
  constructor(
    private readonly context: PreExecutionPolicyContext,
    private readonly delegates: SafeExecutorDelegates<ReadResult, SearchResult, EditResult, PatchResult>,
    private readonly onEscalation?: EscalationHandler,
  ) {}

  async readFile(path: string): Promise<ReadResult> {
    await enforce({ kind: "read", paths: [path] }, this.context, this.onEscalation);
    return await this.delegates.readFile(path);
  }

  async search(queries: string[]): Promise<SearchResult> {
    await enforce({ kind: "search", workspaceRoot: this.context.workspaceRoot, queries }, this.context, this.onEscalation);
    return await this.delegates.search(queries);
  }

  async editor(path: string, operation: "create" | "modify", input: unknown): Promise<EditResult> {
    await enforce({ kind: "edit", paths: [path], operation }, this.context, this.onEscalation);
    return await this.delegates.editor(path, operation, input);
  }

  async applyPatch(patch: string): Promise<PatchResult> {
    let changes: PatchPreviewChange[];
    try {
      changes = await this.delegates.previewPatch(patch);
    } catch (error) {
      throw new SafeExecutorError(
        `Patch preview failed closed: ${error instanceof Error ? error.message : String(error)}`,
        "DENY",
      );
    }
    if (!Array.isArray(changes) || changes.length === 0 || changes.some((change) => !change || typeof change.path !== "string" || !change.path.trim())) {
      throw new SafeExecutorError("Patch preview did not produce a valid affected-path set", "DENY");
    }

    await enforce(
      {
        kind: "patch",
        paths: changes.map((change) => change.path),
        operations: changes.map((change) => change.operation || "modify"),
      },
      this.context,
      this.onEscalation,
    );
    return await this.delegates.applyPatch(patch);
  }
}
