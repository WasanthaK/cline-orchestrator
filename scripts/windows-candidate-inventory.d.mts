export declare function createWindowsCandidateInventory(root: string, sourceCommit: string): Promise<{
  schemaVersion: 1; candidate: "unsigned-windows-foreground-preview"; sourceCommit: string;
  filesVerified: number; installedDependenciesChecked: number; sbomComponents: number;
  fullBundleInventory: true; standard: "CycloneDX"; unsigned: true; signed: false;
  installationPerformed: false; startsModel: false; startsTask: false;
  releasesSoftware: false; grantsAuthority: false;
}>;
export declare function verifyWindowsCandidateInventory(root: string, sourceCommit: string): ReturnType<typeof createWindowsCandidateInventory>;
