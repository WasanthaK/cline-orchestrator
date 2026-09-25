/**
 * Proof-only barrier: both independent Hub owners must reach their send calls
 * before either send is allowed to proceed. A sequential runtime cannot pass.
 */
export class LiveProofSendBarrier {
  private readonly expected: Set<string>;
  private readonly arrived = new Set<string>();
  private readonly ready: Promise<void>;
  private release!: () => void;

  constructor(workspaceRoots: string[], private readonly timeoutMs = 120_000) {
    this.expected = new Set(workspaceRoots);
    if (workspaceRoots.length < 2 || this.expected.size !== workspaceRoots.length) {
      throw new Error("Live proof send barrier requires distinct workspace roots");
    }
    this.ready = new Promise<void>((resolve) => { this.release = resolve; });
  }

  get bothSendsReached(): boolean {
    return this.arrived.size === this.expected.size;
  }

  async enter(workspaceRoot: string): Promise<void> {
    if (!this.expected.has(workspaceRoot)) {
      throw new Error("Unregistered workspace reached the live proof send barrier");
    }
    this.arrived.add(workspaceRoot);
    if (this.bothSendsReached) this.release();

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            `Independent Hub sends did not overlap within ${this.timeoutMs}ms`,
          )), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
