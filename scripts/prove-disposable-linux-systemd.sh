#!/usr/bin/env bash
# M18D4b2: manually invoked ONLY inside a disposable Linux systemd VM/container.
set -euo pipefail
[[ "${ORCH_DISPOSABLE_SYSTEMD_PROOF:-}" == "I_AUTHORIZE_DISPOSABLE_SYSTEMD" ]] || { echo "Refusing: explicit disposable proof opt-in missing" >&2; exit 64; }
[[ "$(id -u)" == 0 ]] || { echo "Refusing: isolated proof requires root inside disposable guest" >&2; exit 64; }
[[ -f /run/cline-orchestrator-disposable-guest ]] || { echo "Refusing: isolated guest marker missing" >&2; exit 64; }
[[ "$(cat /proc/1/comm)" == systemd ]] || { echo "Refusing: PID 1 is not systemd" >&2; exit 64; }
[[ -d /run/systemd/system ]] || { echo "Refusing: systemd manager unavailable" >&2; exit 64; }
[[ -n "${ORCH_PACKAGED_INDEX:-}" && -f "${ORCH_PACKAGED_INDEX}" ]] || { echo "Refusing: installed package entrypoint required" >&2; exit 64; }
[[ -n "${ORCH_DISPOSABLE_WORKSPACE:-}" && -d "${ORCH_DISPOSABLE_WORKSPACE}" ]] || { echo "Refusing: disposable workspace required" >&2; exit 64; }
[[ "${ORCH_PACKAGED_INDEX}" == /* && "${ORCH_DISPOSABLE_WORKSPACE}" == /* ]] || { echo "Refusing: paths must be absolute" >&2; exit 64; }
case "${ORCH_PACKAGED_INDEX}${ORCH_DISPOSABLE_WORKSPACE}" in *$'\n'*|*$'\r'*) echo "Refusing: invalid path" >&2; exit 64;; esac
name="cline-orch-proof-$$"
unit="/run/systemd/system/$name.service"
[[ ! -e "$unit" ]] || { echo "Refusing: conflicting unit" >&2; exit 64; }
node="$(command -v node)"
cleanup() {
  systemctl stop "$name.service" >/dev/null 2>&1 || true
  rm -f -- "$unit"
  systemctl daemon-reload >/dev/null 2>&1 || true
}
trap cleanup EXIT
# A real packaged daemon is required; the proof fails if it cannot remain alive.
cat > "$unit" <<EOF
[Unit]
Description=Disposable Cline Orchestrator lifecycle proof
[Service]
Type=simple
WorkingDirectory=${ORCH_DISPOSABLE_WORKSPACE}
ExecStart=$node ${ORCH_PACKAGED_INDEX} daemon ${ORCH_DISPOSABLE_WORKSPACE}
Environment=ORCH_DAEMON_HOST=127.0.0.1
Environment=ORCH_AUTO_APPROVE_COMMANDS=false
Environment=ORCH_AUTO_APPROVE_EDITS=false
Restart=no
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF
systemd-analyze verify "$unit"
systemctl daemon-reload
systemctl start "$name.service"
sleep 3
[[ "$(systemctl is-active "$name.service")" == active ]] || { systemctl status "$name.service" --no-pager || true; exit 1; }
systemctl stop "$name.service"
[[ "$(systemctl is-active "$name.service")" == inactive ]] || exit 1
rm -f -- "$unit"
systemctl daemon-reload
trap - EXIT
[[ ! -e "$unit" ]] || exit 1
echo "PASS: packaged daemon systemd start/status/stop/removal in disposable guest"
