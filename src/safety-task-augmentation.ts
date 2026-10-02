import "./types.js";

declare module "./types.js" {
  interface OrchestratorTask {
    projectId?: string;
    workspaceId?: string;
    workspaceRegistryRevision?: number;
    safetyPlanId?: string;
    safetyPolicyVersion?: string;
    safetyProfileId?: string;
    safetyProfileRevision?: number;
    approvedAllowedPathPatterns?: string[];
    approvedProtectedPathPatterns?: string[];
    workerProfileId?: string;
  }
}

export {};
