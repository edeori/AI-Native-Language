#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"

for pid_file in "${LOG_DIR}"/*.pid; do
  [ -f "${pid_file}" ] || continue
  name=$(basename "${pid_file}" .pid)
  pid=$(cat "${pid_file}")
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}"
    echo "Stopped ${name} (pid ${pid})"
  fi
  rm -f "${pid_file}"
done
