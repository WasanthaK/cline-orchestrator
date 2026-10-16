# M19E5 — Real installed Windows and llama.cpp acceptance

Status: M19E5A read-only preflight is in review. Physical real-model/task
acceptance has NOT been performed. M19D/E source through M19E4D was merged
as PR #70, commit 740fe6619deb583b17cd28fc665affad65505b94.

## Exact pilot candidate

- Windows CI: https://github.com/WasanthaK/cline-orchestrator/actions/runs/38850370781
- Source commit: faa1fabf0dc732d904c79ae05e04d2c7056e2752
- Artifact: m19b-windows-unsigned-foreground-preview (ID 12025550256)
- Downloaded ZIP SHA-256 from GitHub:
  f4238e1c717f0869fd28f208ebcaf32f535b23eb2ec1c2dd228d287370144e5e
- Retention through October 30, 2026, subject to GitHub artifact policy.
- Files: ClineOrchestrator-Setup-unsigned.exe,
  ClineOrchestrator-win-x64-portable.zip, BUILD-EVIDENCE.json,
  BUNDLE-INVENTORY.json, DEPENDENCY-SBOM.cdx.json.

## Phase 0 — read-only package check

Download the original artifact ZIP from the Actions run, retain it unchanged,
and extract a separate copy into a review folder, NOT the installation target.
Inspect the PowerShell script before using it. From the reviewed repository,
execute this single command, substituting only the local path placeholders:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-m19e5-windows-pilot-preflight.ps1 -ArtifactDirectory "C:\PATH\EXTRACTED_ARTIFACT" -ArtifactArchivePath "C:\PATH\ORIGINAL_ARTIFACT.zip" -ExpectedCommit "faa1fabf0dc732d904c79ae05e04d2c7056e2752" -ExpectedArtifactArchiveSha256 "f4238e1c717f0869fd28f208ebcaf32f535b23eb2ec1c2dd228d287370144e5e"

The script only reads hashes, JSON evidence, portable ZIP entries and the
presence of current-user product folders. It does not install, extract,
launch or connect to a model. Preserve the sanitized receipt. Stop if
it fails. If cleanCurrentUserProfile is false, use a clean Windows account
or profile. Never delete or replace existing user state.

GitHub-hosted Windows CI runs the same check against a newly built exact-head
candidate (without an outer GitHub artifact ZIP) before disposable installer
acceptance. Green CI is not the physical acceptance pilot.

## Phase 1 — separately approved installation and setup

The installer is unsigned. Do not turn off Windows security protections or
use an occupied installation directory. Installation requires separate
explicit acceptance of this exact candidate after Phase 0.

Use the already-running genuine llama.cpp server in the SAME Windows loopback
namespace as the application. A separate virtual machine cannot reach a
host's 127.0.0.1 model endpoint. Do not expose or rebind the model server
remotely just to satisfy the pilot. Do not download models, change GPU
settings or start another model implicitly.

After manual installation, open the Start menu launcher. Use Connect local
model with provider openai-compatible, the actual discovered model alias
(historic qwen38-27b-192k, to be checked live) and its literal HTTP loopback
/v1 endpoint. Manually click Check connection and then Test inference.
Confirm that setup did not start any task or daemon and model output is
not written into a public log.

Register a new disposable Git project and workspace, with a bounded Safety
policy (ideally just one changed file), protected paths and a short
validation command. Inspect the Operations page and authenticated
read-only dashboard; unavailable history must be Unknown, not falsely zero.

## Phase 2 — separately approved real Cline task

Do not infer task approval from installation permission. Request independent
human consent for exactly one small supervised task in the disposable repo
(such as adding a pilot/README.md). Use a bounded validation command, for
example git diff --check, and inspect task status, events, independent
validation, diff safety, checkpoint and task history. Do not publish raw task
IDs, local paths, prompts, model responses or secrets.

## Phase 3 — physical UX, shutdown and retention

Validate keyboard-only navigation, high contrast, screen-reader labeling,
display scaling and error messages with a person. Close the app and verify
only app-owned foreground processes/ports are released; leave independently
running model servers untouched. Capture external config, workspace registry,
secret references and task history before/after uninstall. Uninstall only
product-owned binaries and preserve all user-owned state.

## Release gate

This packet and script do NOT prove real model or task acceptance.
The M19E4A 11-gate review still needs witnessed physical evidence.
Binary upgrade/rollback, signing, Linux support, M18F release authorization
and general distribution remain pending. No new task, credential, daemon,
service, remote-network or release authority is introduced.
