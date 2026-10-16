/**
 * M19R3G: native-host-owned selection of registered projects for the
 * authenticated operator AI-recovery Settings screen. No browser path input.
 * No advisor transport, grant issuance, credential lookup or task authority.
 */
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { AdvisorSettingsStore } from "./recovery-advisor-settings.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

export const NATIVE_ADVISOR_BINDING_CONTRACT = Object.freeze({
  schemaVersion: 1 as const, registeredProjectsOnly: true as const,
  projectStateIsolation: true as const, browserFilesystemPaths: false as const,
  mountedOnlyOnOperatorControl: true as const, externalCallsEnabled: false as const,
  grantsAuthority: false as const,
});
export interface AdvisorProjectOptionV1 {
  projectId: string;
  displayName: string;
}
export interface NativeAdvisorProjectBinding {
  listProjects(): Promise<AdvisorProjectOptionV1[]>;
  resolveProject(projectId: string): Promise<{ store: AdvisorSettingsStore; projectLabel: string }>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function validLabel(s: unknown): s is string {
  return typeof s === "string" && s.length >= 1 && s.length <= 100
    && s.trim() === s && !/[\x00-\x1f\x7f<>]/.test(s);
}

/** Supplied only by the trusted native MCP host, never via the HTTP request. */
export function createNativeAdvisorProjectBinding(
  registry: WorkspaceRegistry,
): NativeAdvisorProjectBinding {
  const root = path.dirname(path.resolve(registry.path));
  const parent = path.join(root, "advisor-preferences");
  if (root === path.parse(root).root) throw new Error("unsafe_operator_registry");
  const load = async (): Promise<AdvisorProjectOptionV1[]> => {
    const projects = await registry.listProjects();
    if (projects.length > 128) throw new Error("advisor_project_registry_unavailable");
    const seen = new Set<string>();
    const options: AdvisorProjectOptionV1[] = [];
    for (const item of projects) {
      if (!UUID.test(item.projectId) || !validLabel(item.displayName)
        || seen.has(item.projectId)) throw new Error("advisor_project_registry_unavailable");
      seen.add(item.projectId);
      options.push({ projectId: item.projectId, displayName: item.displayName });
    }
    return options;
  };
  return Object.freeze({
    listProjects: load,
    async resolveProject(projectId: string) {
      if (!UUID.test(projectId)) throw new Error("advisor_project_unavailable");
      // Never trust the project ID or display label supplied by the browser.
      const registered = (await load()).find(x => x.projectId === projectId);
      if (!registered) throw new Error("advisor_project_unavailable");
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const directory = await lstat(parent);
      if (!directory.isDirectory() || directory.isSymbolicLink()
        || (process.platform !== "win32" && (directory.mode & 0o077) !== 0)) {
        throw new Error("advisor_state_parent_unavailable");
      }
      const store = new AdvisorSettingsStore(path.join(parent, registered.projectId),
        registered.projectId);
      return Object.freeze({ store, projectLabel: registered.displayName });
    },
  });
}
