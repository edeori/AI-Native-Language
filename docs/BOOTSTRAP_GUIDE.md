# Bootstrap Guide

This guide describes how to turn this repository into a working pilot later.

## What exists now

- the semantic vision and working notes
- a structured pilot specification
- sample semantic markdown
- sample canonical graph JSON
- repository layout documentation

## What will be added later

- MCP server implementations and versioned tool contracts
- local runner implementations
- VSCode extension implementation
- Java 17+ Spring Boot generator
- validation engine
- security policy adapters
- Docker orchestration for local execution and remote deployment

## Recommended build order

1. implement the semantic parser and canonical graph generator
2. implement the validator and security checks
3. implement the Spring Boot code generator
4. implement the VSCode extension shell
5. implement MCP servers around the semantic core
6. add local runner and Docker orchestration

## VSCode extension loop

The extension is the developer-facing control plane:

- it renders workflow, artifact, and tutorial views
- it calls the remote MCP services over Streamable HTTP
- it surfaces validation diagnostics inline in the editor and writes graph and generated outputs under `.ai-native/`
- it keeps the semantic source in the workspace and the execution logic in services
- it includes a configuration panel for remote MCP URLs and local artifact settings

### Extension quickstart

1. start the MCP services with Docker
2. open the repository in VSCode
3. configure the remote URLs if they are not local defaults
4. open the AI Native Actions view
5. run validation and generation commands from the command palette or the views

## Repo usage model

- developers write `Semantic Markdown`
- the validator turns it into a canonical graph
- the planner validates the graph
- the compiler generates Java / Spring Boot output
- generated diffs are reviewed in the same branch
- workflow outputs can be stored locally in the workspace as artifacts
- MCP servers provide contracts and tools, while the server implementations can be improved later
- the VSCode extension is the interactive shell for the workflow

## Local development commands

```bash
npm install
npm run dev:semantic-core
npm run dev:validator
npm run dev:compiler
npm run build:vscode-extension
```

These commands assume the repository root is the workspace root.

## Remote and containerized deployment

- MCP servers support Streamable HTTP for remote execution.
- Local Docker testing uses `docker/compose.yaml`.
- Each server can be exposed on its own port:
  - `semantic-core` on `3001`
  - `validator` on `3002`
  - `compiler` on `3003`
- The HTTP path is `/mcp` by default.
- Local graph and generated output is mounted through `.ai-native/` so the workspace keeps a reproducible audit trail.

### SSH deployment to a remote host

If Docker runs on a remote host such as `10.9.0.2`, the repository includes SSH helper scripts under `deploy/`:

- `deploy/remote-sync-and-start.sh`
- `deploy/remote-mcp-start.sh`
- `deploy/remote-mcp-stop.sh`
- `deploy/remote-mcp-status.sh`

The scripts assume:

- SSH key-based access is configured
- Docker Compose is available on the remote host
- the remote host can create `/srv/ai-native-language-mcp`
- the repository can be copied to the remote host over SSH

Example:

```bash
REMOTE_HOST=10.9.0.2 REMOTE_USER=myuser \
  ./deploy/remote-sync-and-start.sh
```

The sync script copies only the build inputs to `/srv/ai-native-language-mcp`, keeps the remote `.ai-native/` artifact directory, and runs `docker compose -f /srv/ai-native-language-mcp/docker/compose.yaml up -d --build` on the remote host.

### Smoke test

- Health check:

```bash
curl -sS http://10.9.0.2:3001/health | jq .
curl -sS http://10.9.0.2:3002/health | jq .
curl -sS http://10.9.0.2:3003/health | jq .
```

- MCP initialize:

```bash
curl -sS -X POST "http://10.9.0.2:3001/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2024-11-05",
      "capabilities":{},
      "clientInfo":{
        "name":"smoke-test",
        "version":"0.1.0"
      }
    }
  }' | jq .
```

## Current MVP server tool set

- `semantic-core`
  - `parse_semantic_markdown`
  - `generate_canonical_graph`
- `validator`
  - `validate_semantic_markdown`
- `compiler`
  - `generate_spring_boot_skeleton`

## What should stay stable

- the semantic vocabulary
- the graph model contract
- the validation severity contract
- the provider-neutral task schema
- the Spring Boot target baseline
- the local artifact layout

## Local artifact storage model

- store generated outputs locally in the workspace and validation results in the editor Problems panel
- keep cache and snapshot files close to the repo for traceability
- evolve the MCP server implementations over time without changing the semantic source contract

## Local file layout for generated artifacts

- `.ai-native/graph/`
- `.ai-native/generated/`
- target output directory chosen by the compiler
