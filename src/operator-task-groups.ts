import type { OperatorVisualizationV1 } from "./operator-visualization.js";

/** Fixed server-owned routes; never derive route slugs from task input. */
export const TASK_STATUS_GROUPS = [
  { slug: "completed", label: "Completed", color: "#169b72", statuses: ["completed"] },
  { slug: "in-progress", label: "In progress", color: "#5775da", statuses: ["created", "running", "waiting", "validating", "repairing", "safety_checking"] },
  { slug: "needs-review", label: "Needs review", color: "#ce9239", statuses: ["waiting_for_human"] },
  { slug: "failed", label: "Failed", color: "#cf4c68", statuses: ["failed", "validation_failed"] },
  { slug: "rolled-back", label: "Rolled back", color: "#9159b3", statuses: ["rolled_back"] },
  { slug: "stalled", label: "Stalled", color: "#c37832", statuses: ["stalled"] },
  { slug: "stopped", label: "Stopped", color: "#78879f", statuses: ["aborted"] },
  { slug: "other", label: "Other", color: "#8392a9", statuses: [] },
] as const;

export type TaskStatusGroupSlug = typeof TASK_STATUS_GROUPS[number]["slug"];
export type SanitizedTask = OperatorVisualizationV1["taskBoard"][number];

/** Strict UUID-shaped task addresses: no arbitrary path segments or encoded output. */
export function safeTaskHref(id: string): string | undefined {
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)
    ? "/viewer/task/" + id : undefined;
}

export function taskStatusGroup(status: string): TaskStatusGroupSlug {
  return TASK_STATUS_GROUPS.find(group => (group.statuses as readonly string[]).includes(status))?.slug ?? "other";
}

export function taskGroup(slug: string): typeof TASK_STATUS_GROUPS[number] | undefined {
  return TASK_STATUS_GROUPS.find(group => group.slug === slug);
}

export function tasksInGroup(tasks: readonly SanitizedTask[], slug: TaskStatusGroupSlug): SanitizedTask[] {
  return tasks.filter(task => taskStatusGroup(task.status) === slug);
}
