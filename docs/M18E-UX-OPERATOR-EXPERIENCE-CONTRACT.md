# M18E-UX-A — Operator experience inventory and interaction contract

Status: **inventory/design proposed; no graphical product shipped by this document**  
Reviewed source: `milestone-13/delegation` at `60ff71ff71914aaa9dc580cb5bc171f86a0a52a3` (2026-10-12).  
Dependency: M18D real service-manager acceptance remains open; the UX inventory is independent and must not bypass the physical release gate.

## Product objective and user profiles

Offer a local-first, safe, usable operator interface for setting up a model/provider, registering a workspace, supervising Cline work, examining independently captured evidence, and applying narrowly confirmed actions. It must reuse existing trusted orchestration contracts and must not become a second task/Safety/service/credential/release authority.

- **Local developer/operator:** installs an npm tarball, sets a model endpoint, registers workspaces, monitors work.
- **Reviewer:** sees source-labelled validation/diff-safety/checkpoint evidence and identifies decisions needing human approval.
- **Multi-machine operator (future):** observes remote machine availability/placement; cannot create authority via the machine list.

The **current supported release posture is CLI-first** plus a passive HTML visualization and an optional limited browser rejection flow. An inventory, a mockup, or a backend acceptance test does not make the installed product GUI-ready.

## Existing code inventory — reuse, do not duplicate

| Code/docs | Existing capability | Boundary for new UI |
| --- | --- | --- |
| `src/operator-visualization.ts`, `src/operator-visualization-html.ts` | Bounded, sanitized read-only summary of attention, tasks, workflows, incidents, writers, handoffs and source quality; passive HTML | Reuse snapshots and source notices; **no forms or actions are present** |
| `src/orchestration-dashboard.ts` | Projects, workspaces, task/workflow/incident summaries and freshness/truncation metadata | No raw roots, task prompts, events, credentials or diff text |
| `src/local-operator-control.ts`, `docs/MILESTONE-10-LOCAL-OPERATOR.md` | Opt-in `127.0.0.1` browser page for **reject escalation only**, local token, session, CSRF, preview and single-use confirmation | Do not claim other actions are browser-enabled |
| `src/operator-capabilities.ts`, `src/operator-action.ts` | Explicit trusted mutation list; unavailable controls; per-action service with bounded review/confirmation | Show an action only when the trusted current capability and service state permit it |
| `src/first-run-assessment.ts`, `src/first-run-setup.ts` | Read-only readiness steps and separately confirmed setup operations | Guided checklist cannot silently change configuration or start processes |
| `src/config-write-setup.ts`, `src/registration-setup.ts`, `src/daemon-start-setup.ts` | Existing reviewed create-only configuration, registry changes and loopback daemon setup | Preserve one-action-per-confirmation and no automatic elevation |
| `src/product-config.ts`, `src/product-config-source.ts`, `src/product-cli.ts` | Validated provider/runtime/daemon config, named secret references, packaged CLI commands | Show credential reference presence, not secret content |
| `src/production-operator-status.ts` | Read-only sanitized readiness, backpressure and alerts | Preserve source freshness, unknown and fail-closed states |
| `src/local-service-install-preview.ts`, `src/platform-service-command-plan.ts`, `src/service-host-readiness.ts` | Non-executing install previews and command plans; readiness gate | Do not advertise working OS service lifecycle until M18D physical acceptance |

The README's historical Ollama example does not represent an exclusive provider choice. The setup journey must permit the operator to configure an **explicit supported provider/model/endpoint**, including a locally hosted `llama.cpp` OpenAI-compatible server where the chosen provider adapter and preflight allow it, without silently assuming an Ollama daemon.

## Proposed screen / navigation map

These are **future information architecture labels, not existing HTTP routes**. No new server, listener, public bind, or API route is created here.

| Screen / possible route | Purpose | Upstream source | Mutation exposure |
| --- | --- | --- | --- |
| Welcome / `/welcome` | Runtime/platform/readiness checklist, release posture | first-run assessment + package identity | None |
| Provider / `/setup/provider` | Model/provider and endpoint class, preflight, secret-ref status | config source + provider diagnostics | Confirmed config write only |
| Workspace setup / `/setup/workspaces` | Project/workspace registration and policy revision | workspace registry + registration setup | Separately confirmed create actions |
| Safety setup / `/setup/safety` | Review allowed/protected paths and trusted validation commands | New **sanitized** Safety preview adapter required | No direct UI-only Safety approval |
| Overview / `/overview` | Health, activity, action-needed, data quality | operator visualization + production status | None |
| Tasks / `/tasks`, `/tasks/:id` | Task status, run count, independent validation/diff/checkpoint summary | dashboard, trusted task evidence adapter (needed) | Existing service action preview/confirm only |
| Workflows / `/workflows` | Progress, bounded budgets, blocked reasons, status | workflow summaries; detail projection (needed) | Existing workflow action gate only |
| Workspaces / `/workspaces` | Registry, policy versions, active writer coordination | dashboard + writer snapshot | No raw lock/lease operations |
| Machines / `/machines` | Machine health, placement and freshness | Sanitized distributed observation adapter (needed) | Observation only; no dispatch/fence/runtime controls |
| Incidents / `/incidents` | Escalations, recovery blocking reasons | incident and operational status summaries | Independently gated approved actions only |
| Review / `/review/:id` | Evidence provenance, exact affected scope, decision consequence | Trusted bounded evidence projection (needed) | Two-stage review + short-lived single-use confirmation |
| History / `/history` | Audit-friendly chronology | Sanitized structured operational events (new projection needed) | None |
| Settings / `/settings` | Validated configuration, installed artifacts, service readiness | product config + service-host readiness | Explicit confirmed setup actions only |

First GUI release may consolidate routes, but must preserve the journeys, isolation and availability rules below. The existing browser endpoint `/operator` is **not** a complete dashboard.

## Journey contracts

### A. First run / unregistered

Install user-owned package → observe runtime and local transport safety → choose supported provider/model/endpoint → preflight → separately confirm configuration write → register project and workspace → review Safety scope and validation → confirm each mutation → only show **Ready** when the associated independent checks agree. Do not reveal secret values, auto-add listeners, or assume a local model is running.

### B. Running task

Overview freshness → task list → task details → inspect independently captured validation, diff-safety and checkpoint evidence → observe specialist handoffs and incidents. Worker prose is labelled *unverified worker report*, never the trusted final outcome.

### C. Pending human action

Action-needed queue → choose a specific task → see sanitized exact task/workspace/approval context, allowed/protected paths, provenance, and consequence → request trusted preview → deliberate second confirmation → service revalidates expiry/Safety/task state → render resulting receipt or fail-closed state. Reject expired or replayed confirmations. No “approve all”, implicit confirm, or UI-maintained authority token.

### D. Degraded or disconnected

Explicit unknown/unavailable/stale source state (with captured time) → keep observation-only view where safe → disable affected actions → show a diagnostic reason and a manual retry/refresh path. Never collapse **unknown** into **healthy** or infer installed service presence from a static command plan.

### E. Distributed observation

List machines and selected-workspace association only from sanitized trusted state, with stale/broken connectivity shown explicitly. Machine identity, placement and fence evidence are not task execution authority. No power user “run shell on machine” shortcut.

## Presentation and interaction states

Use consistent, non-color-only text plus icon/status labels for **unregistered**, **needs setup**, **ready**, **running**, **waiting for human**, **blocked**, **degraded**, **unknown**, **aborted**, **completed with passing independent proof**, and **failed**. Unknown and stale records cannot be displayed as current.

- **Loading:** labelled skeleton or progress indicator; never suggest mutation has completed while pending.
- **Empty:** clearly distinguish “no tasks” from “task source unavailable”; preserve source timestamp and truncation.
- **Error:** sanitized human-readable error code/next step without raw secrets, stack traces or untrusted log content.
- **Success:** require a trusted service receipt, not a client-only optimistic update.
- **Confirmation:** explicit outcome, affected task/workspace, authority scope, expiry, and cancel path. Review and confirm are separate operations.
- **Accessibility:** semantic headings/landmarks, logical keyboard tab order, visible focus, labelled controls, skip navigation, screen-reader status announcements, text alternatives, minimum WCAG 2.2 AA contrast targets, reduced-motion preference, at least 200% zoom and responsive narrow-screen operation.
- **Responsive:** list-to-detail navigation on small screens; tables offer horizontal scrolling or safe stacked layout; long opaque identifiers wrap and can be copied without revealing secrets.

## Trust-boundary map

| Input or operation | Trusted source/boundary | UI restriction |
| --- | --- | --- |
| Task/registry/Safety identity | Current trusted task, workspace registry and approved Safety Plan | No model-provided or URL-provided approval authority |
| Completion/validation/diff/checkpoint | Independently captured trusted evidence | No success based on Cline/self-reported prose |
| Model output, task descriptions, incident text | Untrusted until sanitized | Text only; escape HTML, no markdown-executed HTML or active links from untrusted text |
| Secrets/provider connection | Named secret references, existing provider runtime boundary | Never expose raw key/credential in DOM, URL, diagnostics, browser storage or logs |
| Operator mutation | Existing preview + single-use short-lived service confirmation | Strong session/CSRF/origin protections; all action eligibility server-side |
| Local browser transport | Existing loopback-only boundaries; secure local origin/session constraints | No additional listener, tunnel, remote exposure or broad CORS as a convenience |
| Lease/machine/dispatch | Coordination and transport metadata only | Read-only; cannot turn machine/session state into task authorization |
| Service install, Git merge/deploy and release | Separate M18D/M15/M18F explicit authorization | Preview is not execution; GUI presence is not permission |
| Cache/restart | Durable trusted task/safety state wins | Never reuse old confirmations, leases or state as current |

## Next implementation slices and acceptance gates

**UX-B — Read-only composed dashboard prototype**: use existing sanitized operator dashboard/status models, not a new privileged API. Add responsive, accessible navigation and safe empty/stale/error states. Keep the HTML renderer passive and verify script/form/action-free output unless a new trusted browser security review explicitly allows interactions.

**UX-C — Guided setup screens**: integrate read-only assessment and confirmed existing setup paths, including custom supported local model endpoints. Test cancel/expiry/replay; negative test secrets absent from rendered content, network queries and saved client state.

**UX-D — Bounded detail and review**: add the smallest trusted sanitized evidence projection; no raw model output in HTML. Expose reviewed actions only through independently confirmed existing action services, preserve the current browser-exposure restriction until each route has explicit security acceptance.

**UX-E — Graphical artifact and hands-on acceptance**: Windows/Linux installed npm artifact must genuinely include and launch the UI using a documented, authorized loopback path; cross-browser keyboard/zoom/responsive/a11y checks, signed-in/out/blocked/degraded states and end-to-end confirmation gates must pass. If absent, classify release **CLI-only**.

These UX slices are not a substitute for the independent **M18D Windows SCM and Linux systemd physical lifecycle evidence**; service installation and physical proof require their own explicit scoped authorization and recorded logs. M18F remains a separately authorized staged release.

## UX-A completion criteria (inventory only)

- Actual current surfaces and boundaries enumerated; missing adapters labelled rather than invented.
- Screen/navigation map, persona journeys, state model, accessibility criteria and threat map reviewed.
- No changed runtime code, installed artifact, service registration, network listener, credential or authority widening.
- M18D and M18F gating remains visibly unresolved.
