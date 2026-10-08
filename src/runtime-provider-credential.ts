import type { WorkerConfig } from "./types.js";

export const RUNTIME_PROVIDER_CREDENTIAL_CONTRACT = Object.freeze({
  exactNamedReferenceOnly: true,
  daemonRuntimeBoundaryOnly: true,
  writesConfig: false,
  persistsCredential: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsReleaseAuthority: false,
});

export class RuntimeProviderCredentialError extends Error {
  constructor(public readonly code: "reference_invalid" | "credential_unavailable") {
    super(code === "reference_invalid"
      ? "Provider credential reference is invalid"
      : "Selected provider credential is unavailable or invalid");
    this.name = "RuntimeProviderCredentialError";
  }
}

// Called only at daemon WorkerConfig assembly. No config/preview/result record
// contains the value; the existing provider/preflight/Cline consumers receive it.
export function withRuntimeProviderCredential(
  worker: WorkerConfig,
  reference: string | undefined,
  lookup: (name: string) => string | undefined,
): WorkerConfig {
  if (reference === undefined) return worker;
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(reference)
    || reference === "ORCH_API_KEY"
    || reference === "ORCH_API_KEY_SECRET_REF") {
    throw new RuntimeProviderCredentialError("reference_invalid");
  }
  let value: string | undefined;
  try { value = lookup(reference); }
  catch { throw new RuntimeProviderCredentialError("credential_unavailable"); }
  if (typeof value !== "string" || !value.trim() || value.length > 16_384 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new RuntimeProviderCredentialError("credential_unavailable");
  }
  return { ...worker, apiKey: value };
}
