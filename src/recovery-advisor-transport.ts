/**
 * M19R3B: dormant one-shot recovery advice transport.
 * Never registers a daemon, action endpoint, runtime hook or scheduler.
 * No raw text, file paths or credentials are accepted as incident evidence.
 */
import {
  validateAdvisorRequest, validateAdvisorSuggestion,
  type AdvisorDecisionV1,
} from "./recovery-advisor-contract.js";

const ENDPOINT = "https://api.openai.com/v1/responses" as const;
const RESPONSE_LIMIT = 16_384;
export interface AdvisorTransportConfigV1 {
  schemaVersion: 1;
  enabled: true;
  endpoint: typeof ENDPOINT;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxCallsPerHour: number;
  maxEstimatedCentsPerHour: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}
export interface AdvisorCallAuthority {
  /** Trusted host consumes an independently approved single-use grant. */
  authorizeOnce: () => Promise<boolean>;
  /** Resolves a short-lived credential only after authorization. */
  resolveCredential: () => Promise<string>;
}
export interface AdvisorTransportReceiptV1 {
  schemaVersion: 1;
  status: "review_required" | "unavailable";
  contacted: boolean;
  reason?: "invalid_config" | "invalid_request" | "permission_denied"
    | "credential_unavailable" | "budget_exceeded" | "transport_failed"
    | "invalid_response";
  advice?: AdvisorDecisionV1;
  retryAuthorized: false;
  skipExecutionPermitted: false;
  grantsAuthority: false;
}
const deny = (reason: NonNullable<AdvisorTransportReceiptV1["reason"]>, contacted = false):
  AdvisorTransportReceiptV1 => Object.freeze({
    schemaVersion: 1, status: "unavailable", contacted, reason,
    retryAuthorized: false, skipExecutionPermitted: false, grantsAuthority: false,
  });
const inRange = (n: unknown, min: number, max: number): n is number =>
  Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
function validConfig(c: AdvisorTransportConfigV1): boolean {
  return !!c && c.schemaVersion === 1 && c.enabled === true
    && c.endpoint === ENDPOINT
    && typeof c.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(c.model)
    && inRange(c.timeoutMs, 1000, 15000)
    && inRange(c.maxOutputTokens, 64, 256)
    && inRange(c.maxCallsPerHour, 1, 12)
    && inRange(c.maxEstimatedCentsPerHour, 1, 10000)
    && typeof c.inputUsdPerMillionTokens === "number"
    && Number.isFinite(c.inputUsdPerMillionTokens)
    && c.inputUsdPerMillionTokens > 0 && c.inputUsdPerMillionTokens <= 10000
    && typeof c.outputUsdPerMillionTokens === "number"
    && Number.isFinite(c.outputUsdPerMillionTokens)
    && c.outputUsdPerMillionTokens > 0 && c.outputUsdPerMillionTokens <= 10000;
}
const format = {
  type: "json_schema", name: "recovery_advice", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      decision: { type: "string", enum: [
        "inspect_evidence", "prepare_context_handoff", "suggest_strategy_change",
        "escalate_to_human", "observe_only",
      ] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["schemaVersion", "decision", "confidence"],
  },
} as const;

/**
 * M19R3D: exact shared request serialization and conservative rate quote.
 * The quote is not provider billing evidence, merely the upper estimate
 * expected by the durable admission ledger for this fixed request body.
 */
function encodeAdvisorPayload(config: AdvisorTransportConfigV1,
  input: NonNullable<ReturnType<typeof validateAdvisorRequest>>): string {
  return JSON.stringify({
    model: config.model, store: false, stream: false,
    tools: [], max_output_tokens: config.maxOutputTokens,
    text: { format },
    input: [
      { role: "system", content:
        "Review typed incident metadata only. Return a review-only suggestion. "
        + "Never infer an absent tool result or grant execution authority." },
      { role: "user", content: JSON.stringify(input) },
    ],
  });
}
function estimatedAdvisorCostCents(config: AdvisorTransportConfigV1, bytes: number): number {
  return Math.max(1, Math.ceil(100 *
    (bytes * config.inputUsdPerMillionTokens
    + config.maxOutputTokens * config.outputUsdPerMillionTokens) / 1_000_000));
}
async function readSmallBody(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      total += chunk.value.byteLength;
      if (total > RESPONSE_LIMIT) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
function parseAdvice(raw: string): AdvisorDecisionV1 | undefined {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    const response = data as Record<string, unknown>;
    if (response.status !== "completed" || !Array.isArray(response.output)
      || response.output.length !== 1) return undefined;
    const item = response.output[0] as Record<string, unknown> | null;
    if (!item || item.type !== "message" || item.role !== "assistant"
      || !Array.isArray(item.content) || item.content.length !== 1) return undefined;
    const content = item.content[0] as Record<string, unknown> | null;
    if (!content || content.type !== "output_text"
      || typeof content.text !== "string" || content.text.length > 512) return undefined;
    const usage = response.usage as Record<string, unknown> | null;
    if (!usage || !inRange(usage.input_tokens, 0, 100_000)
      || !inRange(usage.output_tokens, 0, 256)) return undefined;
    return validateAdvisorSuggestion(JSON.parse(content.text));
  } catch { return undefined; }
}

/**
 * Process-local limits and operator-supplied prices are ONLY estimates.
 * Unattended use must remain disconnected until durable authorization,
 * quota state and consent revocation are implemented.
 */
export class OneShotRecoveryAdvisor {
  private startedAt: number | undefined;
  private calls = 0;
  private reservedCents = 0;
  private readonly attemptedIncidents = new Set<string>();
  constructor(
    private readonly config: AdvisorTransportConfigV1,
    private readonly http: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Shared with the durable admission bridge. No I/O, no authorization and
   * no credentials. Returns undefined for invalid or oversized requests.
   */
  quoteEstimatedCents(raw: unknown): number | undefined {
    if (!validConfig(this.config)) return undefined;
    const input = validateAdvisorRequest(raw);
    if (!input) return undefined;
    const bytes = Buffer.byteLength(encodeAdvisorPayload(this.config, input), "utf8");
    if (bytes > 4096) return undefined;
    return estimatedAdvisorCostCents(this.config, bytes);
  }

  async consult(raw: unknown, authority: AdvisorCallAuthority):
    Promise<AdvisorTransportReceiptV1> {
    if (!validConfig(this.config)) return deny("invalid_config");
    const input = validateAdvisorRequest(raw);
    if (!input) return deny("invalid_request");
    if (!authority || typeof authority.authorizeOnce !== "function"
      || typeof authority.resolveCredential !== "function") return deny("permission_denied");
    const body = encodeAdvisorPayload(this.config, input);
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > 4096) return deny("invalid_request");
    const now = this.clock();
    if (!inRange(now, 0, Number.MAX_SAFE_INTEGER)) return deny("invalid_config");
    if (this.startedAt !== undefined && now < this.startedAt) return deny("budget_exceeded");
    const freshWindow = this.startedAt === undefined || now - this.startedAt >= 3_600_000;
    const cost = estimatedAdvisorCostCents(this.config, bytes);
    if (!freshWindow && (this.calls >= this.config.maxCallsPerHour
      || this.reservedCents + cost > this.config.maxEstimatedCentsPerHour))
      return deny("budget_exceeded");
    if (cost > this.config.maxEstimatedCentsPerHour
      || this.attemptedIncidents.has(input.incidentId)) return deny("budget_exceeded");

    let permitted = false;
    try { permitted = await authority.authorizeOnce() === true; }
    catch { /* a failing authorization is always denial */ }
    if (!permitted) return deny("permission_denied");

    let credential: string;
    try { credential = await authority.resolveCredential(); }
    catch { return deny("credential_unavailable"); }
    if (typeof credential !== "string" || credential.length < 16 || credential.length > 512
      || !/^[\x21-\x7e]+$/.test(credential)) return deny("credential_unavailable");

    // Reserve synchronously after async approval, before any network request.
    if (freshWindow) {
      this.startedAt = now;
      this.calls = 0;
      this.reservedCents = 0;
    }
    if (this.calls >= this.config.maxCallsPerHour
      || this.reservedCents + cost > this.config.maxEstimatedCentsPerHour
      || this.attemptedIncidents.has(input.incidentId)) return deny("budget_exceeded");
    this.calls += 1;
    this.reservedCents += cost;
    this.attemptedIncidents.add(input.incidentId);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.timeoutMs);
    try {
      const response = await this.http(ENDPOINT, {
        method: "POST", redirect: "error", cache: "no-store", credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + credential,
        },
        body, signal: abort.signal,
      });
      if (!response.ok) return deny("transport_failed", true);
      const result = await readSmallBody(response);
      const advice = result === undefined ? undefined : parseAdvice(result);
      if (!advice) return deny("invalid_response", true);
      return Object.freeze({
        schemaVersion: 1, status: "review_required", contacted: true, advice,
        retryAuthorized: false, skipExecutionPermitted: false, grantsAuthority: false,
      });
    } catch { return deny("transport_failed", true); }
    finally {
      clearTimeout(timer);
      credential = "";
    }
  }
}
