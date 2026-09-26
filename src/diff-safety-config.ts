export interface DiffSafetyPolicy {
  maxChangedFiles: number;
  protectedPatterns: string[];
  warningPatterns: string[];
  expectedChangedPaths?: string[];
}

const DEFAULT_PROTECTED_PATTERNS = [
  ".env", ".env.*", "**/.env", "**/.env.*",
  "secrets/**", "**/secrets/**", "credentials/**", "**/credentials/**",
  "*.pem", "**/*.pem", "*.key", "**/*.key", "*.p12", "**/*.p12",
  "*.pfx", "**/*.pfx", "id_rsa", "**/id_rsa", "id_ed25519", "**/id_ed25519",
];

const DEFAULT_WARNING_PATTERNS = [
  ".github/workflows/**", "Dockerfile", "Dockerfile.*", "**/Dockerfile", "**/Dockerfile.*",
  "docker-compose*.yml", "docker-compose*.yaml", "**/docker-compose*.yml", "**/docker-compose*.yaml",
  "infra/**", "**/infra/**", "deploy/**", "**/deploy/**", "deployment/**", "**/deployment/**",
  "*.tf", "**/*.tf",
];

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readPatterns(name: string, fallback?: string[]): string[] | undefined {
  const raw = process.env[name];
  if (raw === undefined) return fallback ? [...fallback] : undefined;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function diffSafetyPolicyFromEnvironment(): DiffSafetyPolicy {
  return {
    maxChangedFiles: Math.max(0, readInt("ORCH_DIFF_MAX_CHANGED_FILES", 100)),
    protectedPatterns: readPatterns("ORCH_DIFF_PROTECTED_PATTERNS", DEFAULT_PROTECTED_PATTERNS) ?? [],
    warningPatterns: readPatterns("ORCH_DIFF_WARNING_PATTERNS", DEFAULT_WARNING_PATTERNS) ?? [],
    expectedChangedPaths: readPatterns("ORCH_DIFF_EXPECTED_PATHS"),
  };
}
