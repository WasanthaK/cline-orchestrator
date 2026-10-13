import crypto from "node:crypto";
import path from "node:path";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import type { FirstRunAssessmentV1 } from "./first-run-assessment.js";
import { buildGuidedSetupView } from "./first-run-guided-view.js";
import { renderGuidedSetupHtml } from "./first-run-guided-html.js";

export const OFFLINE_SETUP_VIEW_EXPORT_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  input: "trusted_first_run_assessment_only" as const,
  format: "passive_local_html" as const,
  targetPolicy: "new_file_only" as const,
  browserAutoOpen: false as const,
  listenerStarted: false as const,
  grantsTaskAuthority: false as const,
  grantsFilesystemAuthority: false as const,
  grantsCredentialAuthority: false as const,
  grantsReleaseAuthority: false as const,
});

export interface OfflineSetupViewExportReceiptV1 {
  schemaVersion: 1;
  created: true;
  outputFile: string;
  byteLength: number;
  readOnlyView: true;
  authority: "local_snapshot_export_only";
  opensListener: false;
  opensBrowser: false;
  grantsAuthority: false;
}

export class OfflineSetupViewExportError extends Error {
  constructor(public readonly code: "output_invalid" | "output_exists" | "export_failed") {
    super({
      output_invalid: "Choose a new .html file in an existing local directory",
      output_exists: "The selected HTML file already exists and will not be replaced",
      export_failed: "The read-only HTML snapshot could not be exported",
    }[code]);
    this.name = "OfflineSetupViewExportError";
  }
}

const MAX_HTML_BYTES = 128 * 1024;

/**
 * UX-E2a: safely publish an already-sanitized snapshot as a user-selected,
 * standalone HTML file to open in the browser via file://.
 *
 * No localhost listener, browser launch, network request, task data, credential
 * lookup or UI action handler. Unlike setup-config, this creates *only* a
 * human-readable offline output artifact, never product/runtime state.
 */
export async function exportOfflineSetupView(
  assessment: FirstRunAssessmentV1,
  requestedFile: string,
): Promise<OfflineSetupViewExportReceiptV1> {
  let html: string;
  try {
    html = renderGuidedSetupHtml(buildGuidedSetupView(assessment));
  } catch {
    throw new OfflineSetupViewExportError("export_failed");
  }
  const bytes = Buffer.from(html, "utf8");
  if (bytes.length === 0 || bytes.length > MAX_HTML_BYTES) {
    throw new OfflineSetupViewExportError("export_failed");
  }
  if (typeof requestedFile !== "string" || !requestedFile.trim()
    || /[\x00-\x1f\x7f]/.test(requestedFile)
    || !/\.html$/i.test(path.basename(requestedFile))) {
    throw new OfflineSetupViewExportError("output_invalid");
  }

  let directory: string;
  let identity: { dev: number; ino: number };
  try {
    directory = await realpath(path.dirname(path.resolve(requestedFile)));
    const info = await lstat(directory);
    if (!info.isDirectory()) throw new Error("not a directory");
    identity = { dev: info.dev, ino: info.ino };
  } catch {
    throw new OfflineSetupViewExportError("output_invalid");
  }
  const target = path.join(directory, path.basename(requestedFile));
  let temporary: string | undefined;
  let published = false;
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.dev !== identity.dev || info.ino !== identity.ino) {
      throw new OfflineSetupViewExportError("output_invalid");
    }
    temporary = path.join(directory, ".orchestrator-view-" + crypto.randomBytes(16).toString("hex") + ".tmp");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const current = await lstat(directory);
    if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new OfflineSetupViewExportError("output_invalid");
    }
    // Atomic publish by hard-linking the complete file. Existing files and
    // symlinks always win. No truncation, replacement or partial target file.
    await link(temporary, target);
    published = true;
  } catch (error) {
    if (error instanceof OfflineSetupViewExportError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new OfflineSetupViewExportError("output_exists");
    }
    throw new OfflineSetupViewExportError("export_failed");
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
  }
  if (!published) throw new OfflineSetupViewExportError("export_failed");
  return Object.freeze({
    schemaVersion: 1 as const,
    created: true as const,
    outputFile: target,
    byteLength: bytes.length,
    readOnlyView: true as const,
    authority: "local_snapshot_export_only" as const,
    opensListener: false as const,
    opensBrowser: false as const,
    grantsAuthority: false as const,
  });
}
