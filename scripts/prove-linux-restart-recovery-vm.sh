#!/usr/bin/env bash
# M18D4d5: deliberately MANUAL, destructive only to a unique temporary unit
# on a disposable GitHub-hosted Linux systemd VM. Never run on shared hosts.
set -euo pipefail
refuse() { echo "Refusing disposable restart proof: $1" >&2; exit 64; }

# Opt-in and immutable candidate identity BEFORE any filesystem or OS mutation.
[[ "$ORCH_LINUX_RESTART_CONFIRMATION" == "RUN_DISPOSABLE_LINUX_RESTART" ]] 2>/dev/null ||
  refuse "explicit proof confirmation absent"
[[ "$GITHUB_ACTIONS" == true && "$RUNNER_OS" == Linux &&
   "$ORCH_PROOF_RUNNER_KIND" == github-hosted ]] 2>/dev/null ||
  refuse "GitHub-hosted Linux runner required"
[[ "$GITHUB_REPOSITORY" == WasanthaK/cline-orchestrator &&
   "$GITHUB_REF" == refs/heads/main && "$GITHUB_EVENT_NAME" == workflow_dispatch ]] 2>/dev/null ||
  refuse "manual dispatch on reviewed main workflow required"
[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]{0,17}$ ]] 2>/dev/null ||
  refuse "unique numeric runner identity required"
[[ "$ORCH_PROOF_CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]] 2>/dev/null ||
  refuse "full immutable candidate SHA required"
[[ "$(git rev-parse HEAD 2>/dev/null)" == "$ORCH_PROOF_CANDIDATE_SHA" ]] ||
  refuse "checked out candidate differs from reviewed SHA"
[[ -n "$RUNNER_TEMP" && -d "$RUNNER_TEMP" && "$RUNNER_TEMP" == /* ]] 2>/dev/null ||
  refuse "temporary runner directory required"
[[ ! -e /.dockerenv && "$(cat /proc/1/comm)" == systemd && -d /run/systemd/system ]] ||
  refuse "disposable systemd VM required"
[[ "$(id -u)" != 0 ]] || refuse "use GitHub runner user with scoped sudo only"
sudo -n true >/dev/null 2>&1 || refuse "non-interactive sudo unavailable"

temp="$(realpath -e "$RUNNER_TEMP")"
[[ -f "$ORCH_PROOF_PACKAGE" && -f "$ORCH_PROOF_ENTRY" ]] 2>/dev/null ||
  refuse "installed tarball and installed daemon entrypoint required"
package="$(realpath -e "$ORCH_PROOF_PACKAGE")"
entry="$(realpath -e "$ORCH_PROOF_ENTRY")"
[[ "$package" == "$temp/"* && "$entry" == "$temp/"* ]] ||
  refuse "proof artifacts must stay inside disposable runner directory"
[[ "$ORCH_PROOF_PACKAGE_SHA256" =~ ^[0-9a-f]{64}$ ]] 2>/dev/null ||
  refuse "reviewed package hash required"
package_hash="$(sha256sum "$package" | cut -d' ' -f1)"
[[ "$package_hash" == "$ORCH_PROOF_PACKAGE_SHA256" ]] ||
  refuse "installed tarball hash differs from reviewed artifact"
node="$(command -v node)"
[[ "$node" == /* && -f "$node" ]] || refuse "absolute Node executable required"
[[ "$ORCH_PROOF_PORT" =~ ^[0-9]{4,5}$ ]] 2>/dev/null ||
  refuse "dedicated loopback port required"
port="$ORCH_PROOF_PORT"
(( 1024 < port && port < 65536 )) || refuse "invalid port"

name="cline-orch-restart-$GITHUB_RUN_ID"
unit="/run/systemd/system/$name.service"
workspace="$temp/orch-restart-workspace-$GITHUB_RUN_ID"
home="$temp/orch-restart-home-$GITHUB_RUN_ID"
data="$temp/orch-restart-owned-sentinels-$GITHUB_RUN_ID"
for p in "$node" "$entry" "$workspace" "$home" "$data" "$unit"; do
  [[ "$p" != *$'\n'* && "$p" != *$'\r'* && "$p" != *' '* && "$p" != *'%'* ]] ||
    refuse "paths cannot contain systemd control syntax or whitespace"
done
[[ ! -e "$workspace" && ! -e "$home" && ! -e "$data" ]] ||
  refuse "temporary proof directories already exist"
if sudo test -e "$unit" || sudo systemctl list-unit-files --no-legend "$name.service" 2>/dev/null |
   grep -Fq "$name.service"; then
  refuse "temporary unit identity already exists"
fi
[[ -z "$(ss -ltnH "( sport = :$port )")" ]] ||
  refuse "proof port already has a listener"

umask 077
mkdir -m 700 -- "$workspace" "$home" "$data"
for kind in config workspace_registry secret_reference durable_task_state; do
  printf 'disposable operator-owned %s proof sentinel\n' "$kind" > "$data/$kind"
done
# This is not an inventory of real operator state: only disposable sentinels.
sentinel_manifest="$(mktemp "$temp/orch-restart-manifest-$GITHUB_RUN_ID.XXXXXX")"
(cd "$data"; sha256sum config workspace_registry secret_reference durable_task_state) > "$sentinel_manifest"
entry_hash="$(sha256sum "$entry" | cut -d' ' -f1)"
created=no
cleanup() {
  code=$?
  trap - EXIT
  if [[ "$created" == yes ]]; then
    if [[ "$code" -ne 0 ]]; then
      sudo systemctl status "$name.service" --no-pager --full || true
      sudo journalctl -u "$name.service" --no-pager -n 40 || true
    fi
    sudo systemctl stop "$name.service" >/dev/null 2>&1 || true
    sudo rm -f -- "$unit" || code=1
    sudo systemctl daemon-reload >/dev/null 2>&1 || code=1
    if sudo test -e "$unit" || sudo systemctl is-active --quiet "$name.service"; then
      echo "FAIL: temporary unit still present or active" >&2
      code=1
    fi
  fi
  if ! (cd "$data"; sha256sum --status -c "$sentinel_manifest"); then
    echo "FAIL: disposable operator-owned sentinel changed" >&2
    code=1
  fi
  if [[ "$(sha256sum "$entry" | cut -d' ' -f1)" != "$entry_hash" ||
        "$(sha256sum "$package" | cut -d' ' -f1)" != "$package_hash" ]]; then
    echo "FAIL: packaged artifact changed" >&2
    code=1
  fi
  if [[ "$code" -eq 0 ]]; then
    echo "PASS: temporary service removed; packaged artifacts and four sentinels preserved"
  fi
  exit "$code"
}
trap cleanup EXIT

# Exclusively claim this unique unit, then install only its contents.
sudo bash -c 'set -C; : > "$1"' bash "$unit"
created=yes
cat <<EOF | sudo tee "$unit" >/dev/null
[Unit]
Description=Disposable Cline Orchestrator restart proof $GITHUB_RUN_ID
[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$workspace
ExecStart=$node $entry daemon $workspace
Environment=HOME=$home
Environment=ORCH_DAEMON_HOST=127.0.0.1
Environment=ORCH_DAEMON_PORT=$port
Environment=ORCH_AUTO_APPROVE_COMMANDS=false
Environment=ORCH_AUTO_APPROVE_EDITS=false
Restart=no
KillMode=control-group
TimeoutStopSec=15s
NoNewPrivileges=true
PrivateTmp=true
EOF
sudo systemd-analyze verify "$unit"
sudo systemctl daemon-reload

healthy() {
  sudo systemctl is-active --quiet "$name.service" || return 1
  body="$(curl --noproxy '*' --silent --show-error --fail --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null)" || return 1
  printf '%s' "$body" | node -e '
    let text="";
    process.stdin.on("data",chunk=>text+=chunk);
    process.stdin.on("end",()=>{
      try {
        const state=JSON.parse(text);
        process.exit(state.status==="running" && state.activeTaskId==null ? 0 : 1);
      } catch { process.exit(1); }
    });
  ' >/dev/null 2>&1 || return 1
  listener="$(ss -ltnH "( sport = :$port )")"
  [[ "$listener" == *"127.0.0.1:$port"* &&
     "$listener" != *"0.0.0.0:$port"* && "$listener" != *"[::]:$port"* ]]
}
wait_healthy() {
  for _ in $(seq 1 25); do
    if healthy; then return 0; fi
    sleep 1
  done
  return 1
}
sudo systemctl start "$name.service"
wait_healthy || { echo "FAIL: initial application health never became ready" >&2; exit 1; }
echo "PASS: packaged daemon healthy on loopback, before simulated process failure"

# This is an intentional failure of OUR unique temporary service only.
sudo systemctl kill --kill-who=main --signal=SIGKILL "$name.service"
failed=no
for _ in $(seq 1 20); do
  if [[ "$(sudo systemctl is-failed "$name.service" || true)" == failed ]]; then
    failed=yes
    break
  fi
  sleep 1
done
[[ "$failed" == yes ]] || { echo "FAIL: controlled crash did not reach failed state" >&2; exit 1; }
if curl --noproxy '*' -fsS --max-time 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
  echo "FAIL: application still answers after main process crash" >&2; exit 1
fi
echo "PASS: temporary service entered failed state, localhost endpoint unavailable"

sudo systemctl reset-failed "$name.service"
sudo systemctl start "$name.service"
wait_healthy || { echo "FAIL: explicit restart did not restore application health" >&2; exit 1; }
echo "PASS: explicit restart recovered application health without automatic restart"

sudo systemctl stop "$name.service"
[[ "$(sudo systemctl is-active "$name.service" || true)" == inactive ]] ||
  { echo "FAIL: temporary service not inactive after stop" >&2; exit 1; }
if curl --noproxy '*' -fsS --max-time 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
  echo "FAIL: localhost endpoint remains available after stop" >&2; exit 1
fi
echo "PASS: temporary service stopped and loopback listener released"
