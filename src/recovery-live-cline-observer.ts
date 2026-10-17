/**
 * M19R2C: process-local trusted SDK activity observations.
 * Only matched tool lifecycles count; model token activity does not.
 */
import { correlateClineInference, type ClineProgressEvidenceV1,
  type ClineInferenceCorrelationV1, type InferenceSnapshotV1 } from "./recovery-inference-monitor.js";

export interface LiveClineObservationV1 extends ClineProgressEvidenceV1 {
  toolLifecycle: "paired" | "in_flight" | "ambiguous" | "not_observed";
  pairedToolCompletions: number;
  rawWorkerOutputIncluded: false;
  durable: false;
  grantsAuthority: false;
}
export interface LiveRecoveryCorrelationV1 {
  schemaVersion: 1;
  source: "trusted_cline_runner";
  observation: LiveClineObservationV1;
  correlation: ClineInferenceCorrelationV1;
  readOnly: true;
  advisorContacted: false;
  grantsAuthority: false;
}
const clock = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const safeTool = (s: unknown): s is string =>
  typeof s === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(s);

export class LiveClineRecoveryObserver {
  private begun = false;
  private seenAt = 0;
  private lastActivity: number | undefined;
  private lastPairedTool: number | undefined;
  private inFlight: string | undefined;
  private ambiguous = false;
  private count = 0;
  private lifecycle: LiveClineObservationV1["toolLifecycle"] = "not_observed";
  private state: ClineProgressEvidenceV1["state"] = "unknown";
  private verifiedStall = false;

  begin(nowMs: number): void {
    if (!clock(nowMs)) throw new Error("invalid_observation_clock");
    this.begun = true; this.seenAt = nowMs; this.lastActivity = nowMs;
    this.lastPairedTool = undefined; this.inFlight = undefined;
    this.ambiguous = false; this.count = 0; this.lifecycle = "not_observed";
    this.state = "running"; this.verifiedStall = false;
  }
  /** Call only from ClineRunner's own subscribed SDK event callback. */
  recordRuntimeEvent(raw: unknown, nowMs: number): void {
    if (!this.begun || this.state !== "running" || !clock(nowMs) || nowMs < this.seenAt) return;
    this.seenAt = nowMs;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const event = raw as Record<string, unknown>;
    if (!["chunk", "status", "agent_event", "hook", "ended"].includes(String(event.type))) return;
    this.lastActivity = nowMs;
    if (event.type !== "agent_event" || !event.payload || typeof event.payload !== "object") return;
    const agent = (event.payload as Record<string, unknown>).event;
    if (!agent || typeof agent !== "object" || Array.isArray(agent)) return;
    const e = agent as Record<string, unknown>;
    if ((e.type !== "content_start" && e.type !== "content_end") || e.contentType !== "tool") return;
    if (!safeTool(e.toolName)) {
      this.inFlight = undefined; this.ambiguous = true; this.lifecycle = "ambiguous";
      return;
    }
    if (e.type === "content_start") {
      if (this.inFlight || this.ambiguous) {
        this.inFlight = undefined; this.ambiguous = true; this.lifecycle = "ambiguous";
      } else {
        this.inFlight = e.toolName; this.lifecycle = "in_flight";
      }
    } else if (this.ambiguous || this.inFlight !== e.toolName) {
      this.inFlight = undefined; this.ambiguous = true; this.lifecycle = "ambiguous";
    } else {
      this.inFlight = undefined;
      this.count = Math.min(1_000_000, this.count + 1);
      this.lastPairedTool = nowMs; this.lifecycle = "paired";
    }
  }
  recordVerifiedWatchdogStall(nowMs: number): void {
    if (!this.begun || this.state !== "running" || !clock(nowMs) || nowMs < this.seenAt) return;
    this.seenAt = nowMs;
    this.verifiedStall = true;
  }
  finish(state: "completed" | "waiting_for_human" | "unknown", nowMs: number): void {
    if (!this.begun || !clock(nowMs) || nowMs < this.seenAt) return;
    this.seenAt = nowMs; this.state = state; this.inFlight = undefined;
    this.ambiguous = false;
  }
  snapshot(nowMs: number): LiveClineObservationV1 | undefined {
    if (!this.begun || !clock(nowMs) || nowMs < this.seenAt) return undefined;
    const activeTool = this.state !== "running" || this.ambiguous ? undefined
      : this.inFlight ? true : false;
    return Object.freeze({
      schemaVersion: 1, source: "trusted_cline_runner", state: this.state,
      observedAtMs: this.seenAt,
      ...(this.lastActivity === undefined ? {} : { lastActivityAtMs: this.lastActivity }),
      ...(this.lastPairedTool === undefined ? {} : { lastVerifiedProgressAtMs: this.lastPairedTool }),
      ...(activeTool === undefined ? {} : { activeTool }),
      ...(this.verifiedStall ? { watchdogStallVerified: true } : {}),
      toolLifecycle: this.lifecycle, pairedToolCompletions: this.count,
      rawWorkerOutputIncluded: false, durable: false, grantsAuthority: false,
    });
  }
  correlation(nowMs: number, backend?: InferenceSnapshotV1, thresholdMs = 90_000):
    LiveRecoveryCorrelationV1 | undefined {
    const observation = this.snapshot(nowMs);
    if (!observation) return undefined;
    return Object.freeze({
      schemaVersion: 1, source: "trusted_cline_runner",
      observation, correlation: correlateClineInference(observation, backend, nowMs, thresholdMs),
      readOnly: true, advisorContacted: false, grantsAuthority: false,
    });
  }
}
