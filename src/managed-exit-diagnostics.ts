/**
 * M18E foreground-only post-cleanup observation.
 *
 * A diagnostic never changes task/SDK state or process lifetime. Its timer is
 * unref'ed so it cannot keep an otherwise idle CLI alive. It emits only counts
 * of Node's active resource TYPE names, never resource instances, paths,
 * prompts, environment values, provider responses or credentials.
 */
export const MANAGED_EXIT_DIAGNOSTIC_CONTRACT = Object.freeze({
  optInEnvironmentName: "ORCH_MANAGED_EXIT_DIAGNOSTICS",
  passiveOnly: true,
  excludesResourceDetails: true,
  unrefTimer: true,
  neverCallsProcessExit: true,
  grantsAuthority: false,
});

export interface ManagedExitResourceSummary {
  schemaVersion: 1;
  observation: "managed_run_post_cleanup";
  resourceTypes: Array<{ type: string; count: number }>;
  totalObserved: number;
  capped: boolean;
}

const MAX_RESOURCES = 512;
const MAX_TYPES = 24;
const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

export function summarizeManagedExitResources(values: readonly string[]): ManagedExitResourceSummary {
  const counts = new Map<string, number>();
  const bounded = values.slice(0, MAX_RESOURCES);
  for (const value of bounded) {
    const label = typeof value === "string" && TYPE_PATTERN.test(value) ? value : "Other";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const included = sorted.slice(0, MAX_TYPES);
  const omittedCount = sorted.slice(MAX_TYPES).reduce((total, [, count]) => total + count, 0);
  if (omittedCount) {
    const existing = included.findIndex(([key]) => key === "Other");
    if (existing >= 0) included[existing]![1] += omittedCount;
    else included.push(["Other", omittedCount]);
  }
  return {
    schemaVersion: 1,
    observation: "managed_run_post_cleanup",
    resourceTypes: included.map(([type, count]) => ({ type, count })),
    totalObserved: values.length,
    capped: values.length > MAX_RESOURCES || omittedCount > 0,
  };
}

export interface ManagedExitDiagnosticDependencies {
  activeResources?: () => string[];
  write?: (line: string) => void;
  schedule?: (callback: () => void, delayMs: number) => { unref(): unknown };
}

export function scheduleManagedRunExitDiagnostic(
  env: Record<string, string | undefined>,
  deps: ManagedExitDiagnosticDependencies = {},
): boolean {
  if (env.ORCH_MANAGED_EXIT_DIAGNOSTICS !== "1") return false;
  const schedule = deps.schedule ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const timer = schedule(() => {
    // Reaching this callback means that the CLI process was still alive
    // after cleanup and receipt delivery. No attempt to terminate it is made.
    try {
      const resources = (deps.activeResources ?? (() => process.getActiveResourcesInfo()))();
      const summary = summarizeManagedExitResources(resources);
      (deps.write ?? ((line: string) => process.stderr.write(line)))(
        "[managed-run exit diagnostic] " + JSON.stringify(summary) + "\n",
      );
    } catch {
      (deps.write ?? ((line: string) => process.stderr.write(line)))(
        "[managed-run exit diagnostic] active resource type observation unavailable\n",
      );
    }
  }, 2000);
  timer.unref();
  return true;
}
