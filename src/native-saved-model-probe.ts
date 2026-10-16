import { existingSettings, NativeSettingsUpdateError } from "./native-settings-update.js";
import { testLocalInference, type InferenceProbeStatus } from "./native-local-inference.js";

/** M19E4D — native-only fixed user-state probe of an exact saved revision.
 * It inherits the strict literal-loopback checks from M19E4C. The saved
 * provider selection never comes from CLI arguments or a browser request.
 */
export const SAVED_MODEL_PROBE_CONTRACT = Object.freeze({
  schemaVersion: 1 as const,
  requiresExactSavedRevision: true as const,
  modelSelectionFromVerifiedConfig: true as const,
  rechecksRevisionAfterNetwork: true as const,
  fixedHarmlessPromptOnly: true as const,
  browserMutation: false as const,
  configSaved: false as const,
  startsTask: false as const,
  startsModel: false as const,
  startsDaemon: false as const,
  grantsAuthority: false as const,
});

export interface SavedModelProbeV1 {
  schemaVersion: 1;
  command: "test-saved-model-desktop";
  status: InferenceProbeStatus;
  inferenceResponseObserved: boolean;
  modelAuthenticityVerified: false;
  configSaved: false;
  taskStarted: false;
  modelStarted: false;
  grantsAuthority: false;
}

const validRevision = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);

export async function testSavedModel(
  stateDirectory: string,
  expectedRevision: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SavedModelProbeV1> {
  if (!validRevision(expectedRevision)) throw new NativeSettingsUpdateError("unsafe");
  const before = await existingSettings(stateDirectory);
  if (before.revision !== expectedRevision) throw new NativeSettingsUpdateError("stale");
  const probed = await testLocalInference(before.selection, fetchImpl);
  const after = await existingSettings(stateDirectory);
  if (after.revision !== before.revision ||
    after.identity.dev !== before.identity.dev ||
    after.identity.ino !== before.identity.ino)
    throw new NativeSettingsUpdateError("stale");
  return Object.freeze({
    schemaVersion: 1, command: "test-saved-model-desktop",
    status: probed.status, inferenceResponseObserved: probed.inferenceResponseObserved,
    modelAuthenticityVerified: false, configSaved: false,
    taskStarted: false, modelStarted: false, grantsAuthority: false,
  });
}
