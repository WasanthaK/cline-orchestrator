import type { OperatorVisualizationV1 } from "./operator-visualization.js";
import type { NativeSetupReadinessV1 } from "./native-setup-readiness.js";

/**
 * M19D1: native foreground operations summary. Consume only the existing
 * independently sanitized passive dashboard and native setup observations.
 * This is not a task store, browser mutation route, daemon or approval path.
 */
export const NATIVE_OPERATIONS_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  readOnly: true as const,
  boundedTaskSample: 100 as const,
  noTaskIdentifiers: true as const,
  noRawPathsOrCredentials: true as const,
  noBrowserMutation: true as const,
  startsTask: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

type HistoryState = "available" | "incomplete" | "unavailable";
type TaskCounts = {
  sampled: number | null;
  active: number | null;
  needsAttention: number | null;
  completed: number | null;
};

export interface NativeOperationsV1 {
  schemaVersion: 1;
  command: "operations-desktop";
  checkedAt: string;
  setup: {
    status: NativeSetupReadinessV1["status"];
    steps: NativeSetupReadinessV1["steps"];
    projectCount: number;
    workspaceCount: number;
  };
  history: { state: HistoryState; counts: TaskCounts; scope: "bounded_current_sample" };
  additionalSources: "not_connected";
  viewerRequiredForTaskDrilldown: true;
  readOnly: true;
  grantsAuthority: false;
}

const unknown: TaskCounts = Object.freeze({
  sampled: null, active: null, needsAttention: null, completed: null,
});

export function projectNativeOperations(
  setup: NativeSetupReadinessV1,
  snapshot?: OperatorVisualizationV1,
): NativeOperationsV1 {
  if (setup.readOnly !== true || setup.grantsAuthority !== false
    || setup.setupCompleteIsTaskAuthority !== false
    || setup.command !== "readiness-desktop") {
    throw new Error("Untrusted native readiness observation");
  }
  let state: HistoryState = "unavailable";
  let counts: TaskCounts = unknown;

  // A source notice is emitted only for problematic sources by the trusted
  // dashboard reader. Missing notice therefore means this particular
  // reader verified a complete bounded query, not full lifetime history.
  if (snapshot?.readOnly === true && snapshot.actions?.length === 0
    && Array.isArray(snapshot.taskBoard) && snapshot.taskBoard.length <= 100
    && Array.isArray(snapshot.sourceNotices)) {
    const notice = snapshot.sourceNotices.find(item => item.source === "tasks");
    state = notice?.available === false ? "unavailable"
      : (notice?.stale || notice?.truncated || notice?.errorCode) ? "incomplete"
      : "available";
    if (state === "available") {
      const rows = snapshot.taskBoard;
      counts = {
        sampled: rows.length,
        active: rows.filter(x => ["created", "running", "waiting", "validating", "repairing", "safety_checking"].includes(x.status)).length,
        needsAttention: rows.filter(x => x.waitingForHuman || ["failed", "validation_failed", "stalled"].includes(x.status)).length,
        completed: rows.filter(x => x.status === "completed").length,
      };
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    command: "operations-desktop",
    checkedAt: setup.checkedAt,
    setup: {
      status: setup.status, steps: setup.steps,
      projectCount: setup.projectCount, workspaceCount: setup.workspaceCount,
    },
    history: { state, counts, scope: "bounded_current_sample" as const },
    // Workflow, supervisor, writer and incident adapters are NOT installed.
    additionalSources: "not_connected",
    viewerRequiredForTaskDrilldown: true,
    readOnly: true,
    grantsAuthority: false,
  });
}
