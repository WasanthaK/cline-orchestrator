import type { OrchestrationDashboardV1 } from "./orchestration-dashboard.js";
import type { SpecialistHandoffV1 } from "./specialist-handoff.js";
import type { WorkspaceLockStateV1 } from "./workspace-lock.js";

const MAX_HANDOFFS = 100;
const MAX_WRITERS = 64;
const MAX_ATTENTION = 100;
const MAX_SOURCE_NOTICES = 20;

export const OPERATOR_VISUALIZATION_LIMITS = Object.freeze({
  maxHandoffs: MAX_HANDOFFS,
  maxWriters: MAX_WRITERS,
  maxAttention: MAX_ATTENTION,
  maxSourceNotices: MAX_SOURCE_NOTICES,
});

export type OperatorAttentionKind = "task" | "workflow" | "incident" | "source";
export type OperatorAttentionSeverity = "info" | "warning" | "critical";

export interface OperatorVisualizationInputV1 {
  dashboard: OrchestrationDashboardV1;
  handoffs: SpecialistHandoffV1[];
  writerLocks: WorkspaceLockStateV1[];
}

export interface OperatorVisualizationV1 {
  schemaVersion: 1;
  generatedAt: string;
  readOnly: true;
  actions: readonly [];
  header: {
    health: "healthy" | "attention" | "critical" | "unknown";
    activeTasks: number;
    activeWorkflows: number;
    openIncidents: number;
    waitingForHuman: number;
    activeWriters: number;
    staleSources: number;
    unavailableSources: number;
  };
  sourceNotices: Array<{
    source: keyof OrchestrationDashboardV1["sources"];
    stale: boolean;
    available: boolean;
    truncated: boolean;
    errorCode?: string;
  }>;
  attention: Array<{
    kind: OperatorAttentionKind;
    severity: OperatorAttentionSeverity;
    id: string;
    workspaceId?: string;
    code: string;
    at?: string;
  }>;
  taskBoard: OrchestrationDashboardV1["tasks"];
  workflows: OrchestrationDashboardV1["workflows"];
  incidents: OrchestrationDashboardV1["incidents"];
  specialistTimeline: Array<{
    handoffId: string;
    taskId: string;
    workspaceId: string;
    sequence: number;
    createdAt: string;
    fromRole: SpecialistHandoffV1["fromRole"];
    toRole: SpecialistHandoffV1["toRole"];
    evidenceCount: number;
  }>;
  activeWriters: Array<{
    workspaceId: string;
    taskId: string;
    acquiredAt: string;
    expiresAt: string;
    leaseState: "active" | "expiring";
  }>;
  truncation: {
    handoffs: boolean;
    writers: boolean;
    attention: boolean;
    sourceNotices: boolean;
  };
}

function boundedSorted<T>(values: T[], limit: number, compare: (a: T, b: T) => number): T[] {
  return [...values].sort(compare).slice(0, limit);
}

function sourceNotices(dashboard: OrchestrationDashboardV1): OperatorVisualizationV1["sourceNotices"] {
  return (Object.entries(dashboard.sources) as Array<[
    keyof OrchestrationDashboardV1["sources"],
    OrchestrationDashboardV1["sources"][keyof OrchestrationDashboardV1["sources"]],
  ]>)
    .filter(([, meta]) => !meta.available || meta.stale || meta.truncated || meta.errorCode !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_SOURCE_NOTICES)
    .map(([source, meta]) => ({
      source,
      stale: meta.stale,
      available: meta.available,
      truncated: meta.truncated,
      errorCode: meta.errorCode,
    }));
}

function attentionItems(
  dashboard: OrchestrationDashboardV1,
  notices: OperatorVisualizationV1["sourceNotices"],
): OperatorVisualizationV1["attention"] {
  const items: OperatorVisualizationV1["attention"] = [];

  for (const incident of dashboard.incidents) {
    if (incident.status !== "open") continue;
    items.push({
      kind: "incident",
      severity: incident.severity === "critical" ? "critical" : "warning",
      id: incident.incidentId,
      workspaceId: incident.workspaceId,
      code: incident.kind,
      at: incident.lastSeenAt,
    });
  }

  for (const task of dashboard.tasks) {
    if (!task.waitingForHuman) continue;
    items.push({
      kind: "task",
      severity: "warning",
      id: task.taskId,
      workspaceId: task.workspaceId,
      code: "waiting_for_human",
      at: task.updatedAt,
    });
  }

  for (const workflow of dashboard.workflows) {
    if (!["blocked", "budget_blocked", "waiting_for_human"].includes(workflow.status)) continue;
    items.push({
      kind: "workflow",
      severity: workflow.status === "blocked" ? "critical" : "warning",
      id: workflow.workflowId,
      code: workflow.latestBudgetDeniedReason ?? workflow.status,
      at: workflow.generatedAt,
    });
  }

  for (const notice of notices) {
    items.push({
      kind: "source",
      severity: notice.available ? "info" : "warning",
      id: notice.source,
      code: notice.errorCode ?? (notice.stale ? "source_stale" : "source_truncated"),
    });
  }

  const rank: Record<OperatorAttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return boundedSorted(items, MAX_ATTENTION, (a, b) =>
    rank[a.severity] - rank[b.severity]
    || (b.at ?? "").localeCompare(a.at ?? "")
    || a.kind.localeCompare(b.kind)
    || a.id.localeCompare(b.id));
}

function sanitizedHandoffs(handoffs: SpecialistHandoffV1[]): OperatorVisualizationV1["specialistTimeline"] {
  return boundedSorted(
    handoffs,
    MAX_HANDOFFS,
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sequence - a.sequence || a.handoffId.localeCompare(b.handoffId),
  ).map((handoff) => ({
    handoffId: handoff.handoffId,
    taskId: handoff.taskId,
    workspaceId: handoff.authority.workspaceId,
    sequence: handoff.sequence,
    createdAt: handoff.createdAt,
    fromRole: handoff.fromRole,
    toRole: handoff.toRole,
    evidenceCount: handoff.evidence.length,
  }));
}

function sanitizedWriters(
  locks: WorkspaceLockStateV1[],
  now: Date,
): OperatorVisualizationV1["activeWriters"] {
  const nowMs = now.getTime();
  const live = locks.filter((state) => {
    const writer = state.activeWriter;
    return writer !== undefined && Date.parse(writer.expiresAt) > nowMs;
  });

  return boundedSorted(live, MAX_WRITERS, (a, b) => a.workspaceId.localeCompare(b.workspaceId))
    .map((state) => {
      const writer = state.activeWriter!;
      const remaining = Date.parse(writer.expiresAt) - nowMs;
      const lifetime = Date.parse(writer.expiresAt) - Date.parse(writer.acquiredAt);
      return {
        workspaceId: state.workspaceId,
        taskId: writer.taskId,
        acquiredAt: writer.acquiredAt,
        expiresAt: writer.expiresAt,
        leaseState: remaining <= Math.max(1_000, lifetime / 3) ? "expiring" as const : "active" as const,
      };
    });
}

/**
 * Builds a UI-facing, read-only operator model from evidence that is already
 * sanitized at its source. The model intentionally omits raw paths, goals, model
 * output, command/stdout data, checkpoint/session details, Safety Plan/profile IDs,
 * worker/owner IDs, lease/fence tokens, credentials, and mutation callbacks.
 */
export function buildOperatorVisualization(
  input: OperatorVisualizationInputV1,
  options: { now?: Date } = {},
): OperatorVisualizationV1 {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("operator visualization clock is invalid");
  if (input.dashboard.readOnly !== true) throw new Error("operator visualization requires a read-only dashboard");

  const notices = sourceNotices(input.dashboard);
  const attention = attentionItems(input.dashboard, notices);
  const handoffs = sanitizedHandoffs(input.handoffs);
  const writers = sanitizedWriters(input.writerLocks, now);
  const staleSources = Object.values(input.dashboard.sources).filter((meta) => meta.stale).length;
  const unavailableSources = Object.values(input.dashboard.sources).filter((meta) => !meta.available).length;

  const health: OperatorVisualizationV1["header"]["health"] = unavailableSources > 0
    ? "unknown"
    : input.dashboard.totals.criticalIncidents > 0
      ? "critical"
      : input.dashboard.totals.waitingForHumanTasks > 0
        || input.dashboard.totals.blockedWorkflows > 0
        || input.dashboard.totals.openIncidents > 0
        ? "attention"
        : "healthy";

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    readOnly: true,
    actions: [],
    header: {
      health,
      activeTasks: input.dashboard.totals.activeTasks,
      activeWorkflows: input.dashboard.totals.activeWorkflows,
      openIncidents: input.dashboard.totals.openIncidents,
      waitingForHuman: input.dashboard.totals.waitingForHumanTasks,
      activeWriters: writers.length,
      staleSources,
      unavailableSources,
    },
    sourceNotices: notices,
    attention,
    taskBoard: structuredClone(input.dashboard.tasks),
    workflows: structuredClone(input.dashboard.workflows),
    incidents: structuredClone(input.dashboard.incidents),
    specialistTimeline: handoffs,
    activeWriters: writers,
    truncation: {
      handoffs: input.handoffs.length > handoffs.length,
      writers: input.writerLocks.filter((state) => state.activeWriter !== undefined).length > writers.length,
      attention: (
        input.dashboard.incidents.filter((item) => item.status === "open").length
        + input.dashboard.tasks.filter((item) => item.waitingForHuman).length
        + input.dashboard.workflows.filter((item) => ["blocked", "budget_blocked", "waiting_for_human"].includes(item.status)).length
        + notices.length
      ) > attention.length,
      sourceNotices: Object.values(input.dashboard.sources)
        .filter((meta) => !meta.available || meta.stale || meta.truncated || meta.errorCode !== undefined).length > notices.length,
    },
  };
}
