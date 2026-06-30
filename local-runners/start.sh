#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"

mkdir -p "${LOG_DIR}"

cd "${REPO_ROOT}"

if [ ! -d "mcp-servers/semantic-core/dist" ]; then
  echo "Building MCP servers..."
  npm run build
fi

start_service() {
  local name=$1
  local port=$2
  local log="${LOG_DIR}/${name}.log"
  MCP_TRANSPORT_MODE=http PORT=${port} node "mcp-servers/${name}/dist/index.js" > "${log}" 2>&1 &
  echo $! > "${LOG_DIR}/${name}.pid"
  echo "  ${name} → http://localhost:${port}/mcp  (log: local-runners/logs/${name}.log)"
}

echo "Starting MCP servers..."
start_service semantic-core    3001
start_service validator        3002
start_service compiler         3003
start_service java-parser      3004
start_service jqassistant      3005
start_service document-import  3007

echo ""
echo "All servers started. Stop with: local-runners/stop.sh"
