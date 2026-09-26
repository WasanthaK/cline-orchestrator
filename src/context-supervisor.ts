export interface ContextRotationDecision {
  inputTokens: number;
  threshold: number;
}

export function defaultContextRotateAtTokens(
  contextWindow: number,
  maxInputTokens: number,
): number {
  const candidates = [
    150_000,
    Math.floor(maxInputTokens * 0.85),
    Math.floor(contextWindow * 0.8),
  ].filter((value) => Number.isFinite(value) && value > 0);

  if (candidates.length === 0) return 0;
  return Math.max(1, Math.min(...candidates));
}

export class ContextSupervisor {
  private pendingInputTokens: number | undefined;

  constructor(private readonly threshold: number) {}

  reset(): void {
    this.pendingInputTokens = undefined;
  }

  observeTurnInput(inputTokens: number): boolean {
    if (this.threshold <= 0 || !Number.isFinite(inputTokens) || inputTokens < this.threshold) {
      return false;
    }

    this.pendingInputTokens = Math.max(this.pendingInputTokens ?? 0, Math.floor(inputTokens));
    return true;
  }

  consumeAfterIteration(toolCalls: number): ContextRotationDecision | undefined {
    const inputTokens = this.pendingInputTokens;
    this.pendingInputTokens = undefined;

    if (inputTokens === undefined || toolCalls <= 0) return undefined;
    return {
      inputTokens,
      threshold: this.threshold,
    };
  }
}
