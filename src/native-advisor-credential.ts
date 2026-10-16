/**
 * M19R3J — installed native advisor credential reference.
 * A trusted host may check whether a dedicated env reference is named
 * without resolving the key. Only the future explicit send boundary
 * may call resolve(); no UI or diagnostics may receive secret material.
 */
export const ADVISOR_CREDENTIAL_REFERENCE = "ORCH_RECOVERY_ADVISOR_API_KEY" as const;
export const NATIVE_ADVISOR_CREDENTIAL_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  keyName: ADVISOR_CREDENTIAL_REFERENCE,
  acceptsBrowserSecrets: false as const,
  storesCredentials: false as const,
  attachedToRuntime: false as const,
  grantsAuthority: false as const,
});
export interface AdvisorCredentialReadinessV1 {
  schemaVersion: 1;
  reference: typeof ADVISOR_CREDENTIAL_REFERENCE;
  state: "reference_present_unverified" | "not_configured";
  validatedWithProvider: false;
  externalCallsEnabled: false;
  grantsAuthority: false;
}
export class NativeAdvisorCredentialError extends Error {
  constructor(readonly code: "credential_unavailable") {
    super(code);
    this.name = "NativeAdvisorCredentialError";
  }
}
export interface NativeAdvisorCredentialSource {
  readiness(): AdvisorCredentialReadinessV1;
  resolve(): Promise<string>;
}
/**
 * The two callbacks are supplied by native host, NEVER from a request.
 * The first must inspect presence only; the second reads the value lazily.
 */
export function createNativeAdvisorCredentialSource(
  hasReference: (name: typeof ADVISOR_CREDENTIAL_REFERENCE) => boolean,
  lookup: (name: typeof ADVISOR_CREDENTIAL_REFERENCE) => string | undefined,
): NativeAdvisorCredentialSource {
  if (typeof hasReference !== "function" || typeof lookup !== "function")
    throw new NativeAdvisorCredentialError("credential_unavailable");
  return Object.freeze({
    readiness(): AdvisorCredentialReadinessV1 {
      let present = false;
      try { present = hasReference(ADVISOR_CREDENTIAL_REFERENCE) === true; }
      catch { /* unavailable by default */ }
      return Object.freeze({
        schemaVersion:1,reference:ADVISOR_CREDENTIAL_REFERENCE,
        state:present ? "reference_present_unverified" : "not_configured",
        validatedWithProvider:false,externalCallsEnabled:false,grantsAuthority:false,
      });
    },
    async resolve(): Promise<string> {
      let key: string | undefined;
      try { key = lookup(ADVISOR_CREDENTIAL_REFERENCE); }
      catch { throw new NativeAdvisorCredentialError("credential_unavailable"); }
      if (typeof key !== "string" || key.length < 16 || key.length > 512
        || !/^[\x21-\x7e]+$/.test(key))
        throw new NativeAdvisorCredentialError("credential_unavailable");
      return key;
    },
  });
}
/** Installed native host: no reads or network until resolve() is invoked. */
export function installedAdvisorCredentialSource(): NativeAdvisorCredentialSource {
  return createNativeAdvisorCredentialSource(
    name => Object.hasOwn(process.env, name),
    name => process.env[name],
  );
}
