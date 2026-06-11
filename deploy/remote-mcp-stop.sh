#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-10.9.0.2}"
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_DEPLOY_DIR="${REMOTE_DEPLOY_DIR:-/srv/ai-native-language-mcp}"
REMOTE_COMPOSE_PATH="${REMOTE_COMPOSE_PATH:-${REMOTE_DEPLOY_DIR}/docker/compose.yaml}"
SSH_OPTIONS="${SSH_OPTIONS:--o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10}"

if [[ -n "${REMOTE_USER}" ]]; then
  SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"
else
  SSH_TARGET="${REMOTE_HOST}"
fi

ssh ${SSH_OPTIONS} -p "${REMOTE_PORT}" "${SSH_TARGET}" "docker compose -f '${REMOTE_COMPOSE_PATH}' down || true"
