# M19C2B2 — Windows native workspace and Safety registration

Status: **implementation review candidate**, not a released installer. Related canonical issue #49.

## User experience

After connecting a local model and registering a project, the user selects **Register workspace** from the installed Windows launcher. A read-only project picker displays previously registered project names. The user browses to an existing local folder and explicitly enters the workspace name, worker profile ID, maximum changed files, allowed paths, protected paths and validation commands.

A dedicated, scrollable native review window displays the **resolved canonical folder** and every Safety rule and command. The user must explicitly choose **Register this workspace**; the default action is cancellation. This operation creates a registry record only. No validation command, Cline task, local model, service or daemon starts.

## Boundaries and reuse

- Installed `list-projects-desktop` reads the canonical local workspace registry, returning bounded project IDs/names only.
- Installed `setup-workspace-desktop` consumes one bounded structured request from the native window over private process stdin. It has no arbitrary registry path parameter or `--config` override.
- The existing `runRegistrationSetup("register_workspace")` performs project existence, canonical directory, duplicate/system-root, exact Safety profile, registry snapshot and folder identity checks. Its single-use expiring confirmation token stays internal. Only an explicitly reviewed `REGISTER WORKSPACE` response authorizes registration.
- The read-only localhost dashboard remains passive. Registry creation is not task authority. No browser mutation endpoint is added.
- The native adapter requires explicit nonempty allow/protect/validation rules, rejects broad blanket `**` allowed pattern, limits changed-file counts and rejects control characters. The core registry service independently applies its existing safety rules.

## Acceptance

- Source tests check local project list, approved registration, cancellation without writes, duplicate root refusal, invalid or missing Safety fields, unsafe roots, altered symlink target **after** review, and no task authority.
- The dedicated hosted Windows installer test builds an actual native executable, installs a bundled Node/CLI, registers an isolated project, lists projects, reviews/cancels a temporary workspace without mutation, registers one exact Safety profile after confirmation, rejects duplicate folder registration and verifies uninstall preserves external state.
- Full exact-head CI, browser acceptance and unsigned Windows installation tests must pass before merge. This is not a clean user-machine manual acceptance, a signed release or a service integration approval.

Next: M19C first-run readiness summary, M19D settings/operations UX, M19E installation/update/uninstall human signoff. M18D and M18F remain separately gated.
