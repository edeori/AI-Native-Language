#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-10.9.0.2}"
REMOTE_USER="${REMOTE_USER:-}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_DEPLOY_DIR="${REMOTE_DEPLOY_DIR:-/srv/ai-native-language-mcp}"
REMOTE_ARTIFACT_ROOT="${REMOTE_ARTIFACT_ROOT:-${REMOTE_DEPLOY_DIR}/.ai-native}"
REMOTE_COMPOSE_PATH="${REMOTE_COMPOSE_PATH:-${REMOTE_DEPLOY_DIR}/docker/compose.yaml}"
SSH_OPTIONS="${SSH_OPTIONS:--o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SYNC_ITEMS=(
  package.json
  package-lock.json
  tsconfig.base.json
  tsconfig.json
  README.md
  AI_Native_Semantic_Pilot_Spec.md
  AI_Native_Semantic_Workflow.md
  AI_Native_Semantic_Programming_Platform.md
  docs
  examples
  reference-projects
  mcp-servers
  docker
)

if [[ -n "${REMOTE_USER}" ]]; then
  SSH_TARGET="${REMOTE_USER}@${REMOTE_HOST}"
else
  SSH_TARGET="${REMOTE_HOST}"
fi

echo "Preparing remote deployment directory on ${SSH_TARGET}:${REMOTE_DEPLOY_DIR} ..."
ssh ${SSH_OPTIONS} -p "${REMOTE_PORT}" "${SSH_TARGET}" \
  "mkdir -p '${REMOTE_DEPLOY_DIR}' '${REMOTE_ARTIFACT_ROOT}'"

echo "Cleaning previous build inputs on remote host ..."
ssh ${SSH_OPTIONS} -p "${REMOTE_PORT}" "${SSH_TARGET}" \
  "cd '${REMOTE_DEPLOY_DIR}' && rm -rf package.json package-lock.json tsconfig.base.json tsconfig.json README.md AI_Native_Semantic_Pilot_Spec.md AI_Native_Semantic_Workflow.md AI_Native_Semantic_Programming_Platform.md docs examples reference-projects mcp-servers docker"

if ssh ${SSH_OPTIONS} -p "${REMOTE_PORT}" "${SSH_TARGET}" "command -v rsync >/dev/null 2>&1"; then
  echo "Syncing required build inputs to remote host with rsync ..."
  RSYNC_RSH="ssh ${SSH_OPTIONS} -p ${REMOTE_PORT}"
  SOURCE_PATHS=()
  for item in "${SYNC_ITEMS[@]}"; do
    SOURCE_PATHS+=("${LOCAL_REPO_ROOT}/${item}")
  done
  rsync -az \
    -e "${RSYNC_RSH}" \
    "${SOURCE_PATHS[@]}" \
    "${SSH_TARGET}:${REMOTE_DEPLOY_DIR}/"
else
  echo "rsync is not available on the remote host; using tar fallback ..."
  tar -C "${LOCAL_REPO_ROOT}" \
    --exclude='.git' \
    --exclude='.ai-native' \
    --exclude='node_modules' \
    --exclude='vscode-extension/out' \
    --exclude='mcp-servers/*/dist' \
    --exclude='mcp-servers/*/node_modules' \
    --exclude='.DS_Store' \
    -cf - "${SYNC_ITEMS[@]}" | ssh ${SSH_OPTIONS} -p "${REMOTE_PORT}" "${SSH_TARGET}" \
      "tar -xf - -C '${REMOTE_DEPLOY_DIR}'"
fi

echo "Building and starting MCP services on the remote host ..."
ssh ${SSH_OPTIONS} -p "${REMOTE_PORT}" "${SSH_TARGET}" \
  "cd '${REMOTE_DEPLOY_DIR}' && docker compose -f '${REMOTE_COMPOSE_PATH}' up -d --build && docker compose -f '${REMOTE_COMPOSE_PATH}' ps"

echo "Remote MCP stack is running from ${REMOTE_DEPLOY_DIR}"
