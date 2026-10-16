export declare function verifyWindowsForegroundEvidence(root: string, expectedCommit: string): Promise<{
  readonly schemaVersion: 1;
  readonly candidate: "unsigned-windows-foreground-preview";
  readonly sourceCommit: string;
  readonly componentsVerified: number;
  readonly archivesVerified: number;
  readonly filesCountVerified: true;
  readonly installationPerformed: false;
  readonly modelStarted: false;
  readonly taskStarted: false;
  readonly serviceInstalled: false;
  readonly signed: false;
  readonly releaseAuthorized: false;
  readonly grantsAuthority: false;
}>;
