# Operator-first dashboard design contract

Status: **design proposal — not an implemented UI or acceptance claim**.
Baseline: `milestone-13/delegation` merge `1181f36`, Console-2. This decision record refines the Console-2 overview and establishes Console-3 and monitoring requirements. It does not widen browser/agent/service authority.

## Product promise

Within five seconds of opening the console, an operator should understand:

1. **Are we okay?** What is observed, what is unknown, and how fresh is that observation?
2. **What work is happening?** Running, waiting, completed, failed and recovered work, with project names where trusted.
3. **What needs me?** Decisions, failures and blocked work, sorted by urgency and reason.
4. **Are we getting better?** Trends and throughput over a clearly labelled interval *only when historical evidence exists*.

The overview is not a wall of diagnostics, not a marketing hero, and not a live-system claim from a snapshot. The first desktop screen reserves its largest area for actionable work, not decorative prose.

## Information hierarchy

| Visible tier | Operator question | Presentation | Disclosure |
| --- | --- | --- | --- |
| 1: system pulse | Is the observed system OK? | Compact status banner + source freshness, never an invented green light | "Why this status?" → source health |
| 1: work outcomes | What is happening in this bounded sample? | Status distribution using a stacked bar or segmented ring with **both numerator and denominator** | Select segment → task list filtered to that status |
| 1: needs attention | What requires my decision? | Priority cards/rows: waiting, failed, blocked, disconnected | Select item → relevant task or source detail |
| 1: task activity | What changed recently? | Readable project, task status, last update; at most 5–8 visible rows | Open task → overview, runs, independent evidence |
| 2: projects | Where is the work? | Trusted display names and task counts, coverage disclaimers | Select project → workspace and task list |
| 2: trends | Is performance changing? | Time-series line/area charts with interval, units, capture source, missing-data gaps | Select date/range → underlying events or sampled observations |
| 3: technical evidence | Why did it happen? | Run chronology, validation, checkpoints, warnings, sanitized system diagnostics | Expand evidence with provenance, freshness and limits |

### Preferred first-screen layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Cline Orchestrator  /  Overview                  Snapshot • refreshed time    │
├──────────────────────────────────────────────────────────────────────────────┤
│ STATUS: Some signals unavailable     3 sources disconnected  [See why →]    │
├─────────────────────────────────┬────────────────────────────────────────────┤
│ WORK AT A GLANCE                │ NEEDS ATTENTION                            │
│ [status distribution / ring]    │ Waiting for review, failed, blocked       │
│ 9 sampled tasks • bounded       │ Incomplete sources visibly separate       │
│ [completed][failed][rolled back]│ [Open attention →]                        │
├─────────────────────────────────┴────────────────────────────────────────────┤
│ RECENT WORK                                     [All tasks →]                │
│ Project name   Task / safe label    Status    Updated     [Details →]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ TRENDS (only when collected)                   [7d] [30d]                    │
│ Work completed vs failed over time • gaps shown • no fabricated history    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Mobile: system pulse → attention → outcome distribution → task list → trends. Navigation remains reachable. Avoid duplicate source-count cards.

## Choosing the correct visualization

- **Ring/segmented meter:** suitable for a defined whole (e.g. task statuses among the visible, bounded sample), with a legible count in the center and category totals alongside. Never imply percentage of *all* work if `findTasks` has returned a bounded or unverified-complete list.
- **Progress bar:** suitable for a trusted finite workflow with a real total and completed-node count, not for arbitrary "agent progress".
- **Capacity gauge:** only when a measured denominator exists (e.g. independently verified permitted concurrent writers). A lease count alone is **not** agent capacity, CPU, GPU or model health.
- **Line/area chart:** time progression only from a bounded sanitized event/observation series with timestamps and retention metadata. A single `updatedAt` per task does not reconstruct historical activity or past system health.
- **Bar chart:** compare projects/workspaces or task statuses from the current bounded snapshot. Show "observed sample" and its limits.
- **No data:** show "Not connected", "Not collected", "Stale", "Incomplete sample", or "No activity observed" **as distinct states**. Never draw a zero line for missing data.

Charts must have a text summary, units, legend, accessible table or equivalent, period, data-source label, and drill-down target. Do not use color alone to distinguish statuses.

## Drill-down contract

`Overview → status/attention group → filtered tasks or sources → task detail → runs/evidence`.

- The overview uses human language: **Needs your review**, **Failed**, **Rolled back**, **Completed**, **Running**, **Not connected**. Full internal codes/UUIDs appear in expandable technical detail or copyable IDs, not as dominant labels.
- Clicking **Failed** opens a bounded list of failed tasks for a declared project/time scope, not an unfiltered giant table. The list shows readable project/workspace names where verified; labels must be safe, pre-sanitized projections.
- Clicking a task opens a read-only detail page with status, last update, run attempts, trusted validation and diff-safety results, checkpoint/recovery evidence and explicit omissions.
- "Completed" does **not** mean independently approved/released. Worker testimony is distinct from validator and checkpoint evidence.
- Clicking system pulse/source status opens a plain-language explanation of which sources are connected, delayed, unavailable, truncated and when they were captured, plus expandable source codes.
- No button or link may imply task execution, agent dispatch, user approval or authorization before the separately gated browser interaction work.

## Present data versus data gaps

Checked implementation on this baseline:

- `machine-dashboard-snapshot-reader.ts` calls trusted `listProjects`, `listWorkspaces`, `findTasks({limit:100})`, and marks incomplete saturation. The current passive `OperatorVisualizationV1` includes task statuses, timestamps, projects/workspace **IDs**, run counts, validation/diff-safety flags, bounded source notices.
- `orchestration-dashboard.ts` already projects trusted project and workspace **display names**, but `operator-visualization.ts` does **not yet carry them** into the passive browser model. Add a bounded, sanitized adapter rather than showing raw task goals/paths.
- The passive dashboard still declares workflow, incident, supervisor, writer and handoff sources disconnected where those feeds have not been wired. Do not imply their absence is good health.
- `MachineOrchestratorService.getTaskEvents` exists but returns an event stream with optional message; it is **not** safe to expose raw events in the passive viewer. A new bounded, redacted event projection with retention/completeness controls is a prerequisite for genuine trends and run chronology.
- There is currently no reliable installed-viewer time-series feed for agent/model latency, tokens, GPU or service uptime. Such meters remain omitted or clearly unavailable until a measured reader exists.

## Planned implementation and acceptance

**UX-1 (next): compact operator-first overview**
- Reduce the current promotional blue hero and duplicated source counts; replace it with a concise observation/coverage strip.
- Show a useful status-distribution visualization from the current bounded task sample; include denominator, status breakdown and a reliable anchor into the tasks section.
- Put attention and recent work on the first screen; keep existing read-only/CSP/no-script contract.
- Keep explicit unknown/truncated states; visible differences for populated, empty and disconnected fixtures.
- Prove desktop, mobile and 200% browser layouts; preserve accessible navigation, colors, data table, and Chrome screenshots. Human visual approval required.

**UX-2: meaningful names and passive drill-down**
- Extend the sanitized read-only model with bounded trusted project/workspace display names and coverage metadata.
- Add authorized read-only detail/filter routing only after session/origin/CSP review, exact binding validation and tests; expose no raw task goal, path, secret, worker output or authority material.

**UX-3: real trends**
- Define sanitized bounded observation/event aggregator, its clock, retention, source completeness, missing-data semantics and test fixtures.
- Add task outcome and throughput trend charts with time ranges and drill-to-evidence only once backed by that source.

**UX-4: connected agent and workflow monitoring**
- Use individually trusted monitoring readers with timestamp/source metadata. Distinguish agent runtime connectivity from coordinator/writer lease evidence; CPU/GPU/token meters require actual instrumented metrics.

### Acceptance rules

1. User can answer the four top questions in five seconds from the above-the-fold view.
2. Every metric names its scope and freshness; charts have real numerators/denominators, time range and provenance.
3. Choosing a visible metric can ultimately trace the underlying bounded records; until interactive routing is separately authorized, clearly labelled same-page navigation is acceptable but **not falsely described as task detail drill-down**.
4. Populated, empty, disconnected, stale and truncated cases are visually different and tested.
5. No security widening: no new browser mutation, service installation, remote listener, task dispatch, credential or release path.
6. GitHub tests/screenshots **plus actual Windows operator inspection**; green CI alone is not visual acceptance.
