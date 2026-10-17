# Open-source Agent Harness Reuse Assessment — Sprint 1

**Date:** 2026-10-17  
**Status:** Research assessment, no dependency adopted or runtime installed  
**Parent:** [Internal AI Engineering Operating Model](INTERNAL-AI-ENGINEERING-OPERATING-MODEL.md) and [Sprint 1 capability audit](SPRINT-1-CAPABILITY-GAP-AUDIT.md)

## Decision

**Evaluate DeepSeek Harness first in a disposable proof, but do not migrate Cline Orchestrator onto it.** Existing CR1–CR3, M14, M15, TaskStore, Safety and Cline integration remain the reference implementation. Adopt an external harness only if it closes a demonstrated adapter/integration gap with reduced cost and no weaker review/authority behavior.

## Candidates (official upstream sources)

| Candidate | Relevant strengths | Fit | Main risk | Disposition |
|---|---|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Cordis everything-as-plugin architecture; models, sessions, tools, skills, sandboxes and workflows; web/desktop launch | Potential interchangeable thinking-agent or coding worker adapter | Developer-preview API breaking changes, overlap with built Orchestrator services, security review of plugins and tool authority | **Highest priority disposable evaluation**, no adoption yet |
| [OpenHands software-agent-sdk](https://github.com/OpenHands/software-agent-sdk) | Composable agent SDK, REST/TypeScript clients and remote agent server; local or ephemeral workspaces | Alternative coding worker interface | Running another agent engine with its own tools and privileges; Python/runtime/sandbox complexity | Evaluate as fallback worker adapter |
| [Aider](https://github.com/Aider-AI/aider) | Git-oriented coding, repo context maps, lint/test correction, local/cloud model support | Ideas for review packets, Git practices, future CLI worker | Coding assistant, not engineering-governance/QC control plane | Study techniques; no immediate dependency |
| [Cline](https://github.com/cline/cline) | Existing installed VS Code workflow, current SDK integration, proven completion packet/recovery baseline | First-class developer executor | SDK/runtime churn, context/tool failure modes | Retain as Sprint 1 coding worker |

Sources were reviewed on 2026-10-17 from official repositories and docs. Confirm exact version, APIs and license/third-party notices before integrating any candidate.

## What may be reused vs what must remain ours

**Potential reuse:** adapter SDKs for invoking a reasoning harness; model-selection logic; structured tool call formats; independent sandboxed worker execution; event streams; context summarization; plugin patterns.

**Do not hand over:** canonical plan and sprint authority, human approval, trusted work-order admission, Safety/lease/fencing, task/approval ledger, independent QC decision gates, exact revision binding, Git push/merge/deploy authority, exception policy, audit history. Harness self-reports remain untrusted.

A successful adapter must accept an immutable review packet and return a typed advisory verdict (APPROVE / CORRECT / NEED_EVIDENCE / ESCALATE) with citations and evidence links. It must not run arbitrary code, send secrets, alter a plan, or acquire Git authority through the review role.

## DeepSeek Harness evaluation — bounded spike

**No installation on the user’s active Windows/llama.cpp/Cline environment.** Clone/pin in a disposable workspace, inspect manifest/LICENSE/third-party notices, security notice, privilege/tool defaults, session state, plugin interfaces and documented compatibility policy.

1. Identify whether a minimal headless invocation/API exists for a *review-only* role. Do not assume its web UI implies reliable programmable control.
2. Confirm whether default model can be configured independently from the Cline coding model and with constrained secrets/network/filesystem access.
3. Feed a synthetic sanitized completion packet, frozen canonical/sprint objective and actual fixture diff/test outcomes.
4. Validate a structured review verdict with exact task/revision identity and appropriate refusal of injected instructions; if plugin/tool permissions allow arbitrary edits or shell in reviewer mode, hard-disable those or reject adoption.
5. Compare total complexity, failure isolation, restart/cancellation behavior and support burden against the existing `SupervisorReviewerModel` adapter and straightforward model API.
6. Treat plugin/runtime upgrades as risky until pinned-version regression and security acceptance succeed.

**Go criteria:** documented stable callable interface or pinned repeatable version; reviewer can operate without coding permissions; output constrained and independently validated; no secret/source exfiltration beyond approved disclosure; straightforward integration with existing reviewer model interface; tangible reduction in custom code or operator attention.

**No-go criteria:** only interactive UI with no supported automation; inability to restrict arbitrary tools; app demands taking over task/approval authority; incompatible durability expectations; unstable dependencies too costly to pin; negligible improvement over direct model API.

## Outcome-sized sprint impact

**Sprint 1A remains unchanged:** Git plan → Cline → independent evidence/reviewer → correction → exact revision-bound pre-push review. The reviewer provider is an adapter; the harness assessment must not block this core outcome. Prototype either direct model API or a DeepSeek Harness review-only adapter behind the same contract, and choose by measured evidence. Do not add a separate harness adoption milestone or extend the PR chain.

**Ownership:** Orchestrator core coordinates; Cline alone codes; external reasoning harness may review; human handles material exceptions and release decisions. Provider interchangeability must never change Safety semantics.
