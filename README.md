# AI Native Language

Source repository for an AI-native semantic programming workflow.

This repo is organized as a reproducible starting point for a future pilot that can:

- describe enterprise Java system slices in `Semantic Markdown`
- validate them into a canonical graph IR
- generate Java 17+ / Spring Boot output
- enforce security and dependency constraints
- remain provider-neutral across AI vendors
- support IDE-driven development through a VSCode extension and MCP tools
- support local Docker execution and remote containerized MCP servers
- include a VSCode extension scaffold with workflow views, tutorial views, and remote MCP integration

## Current Status

- specification-first
- example-driven
- no runnable pilot implementation yet
- designed to be cloned and extended by other teams

## Core Documents

- [AI_Native_Semantic_Pilot_Spec.md](./AI_Native_Semantic_Pilot_Spec.md)
- [AI_Native_Semantic_Pilot_Notes.md](./AI_Native_Semantic_Pilot_Notes.md)
- [AI_Native_Semantic_Workflow.md](./AI_Native_Semantic_Workflow.md)
- [docs/REPO_STRUCTURE.md](./docs/REPO_STRUCTURE.md)
- [docs/BOOTSTRAP_GUIDE.md](./docs/BOOTSTRAP_GUIDE.md)
- [docs/MCP_SERVER_CONTRACTS.md](./docs/MCP_SERVER_CONTRACTS.md)

## Example Artifacts

- [examples/document_processing_service.semantic.md](./examples/document_processing_service.semantic.md)
- [examples/document_processing_service.graph.json](./examples/document_processing_service.graph.json)

## Repository Layout

```text
.
├── agents/              # bounded task schemas and policies
├── docker/              # local orchestration templates
├── docs/                # architecture and bootstrap docs
├── examples/            # semantic markdown and graph examples
├── local-runners/       # deterministic local helpers
├── mcp-servers/         # MCP server contracts and future implementations
├── vscode-extension/    # developer-facing VSCode extension scaffold
├── AI_Native_Semantic_Pilot_Notes.md
├── AI_Native_Semantic_Pilot_Spec.md
├── AI_Native_Semantic_Workflow.md
└── README.md
```

## How This Repo Is Meant To Be Used

1. Write or refine a system slice in `Semantic Markdown`.
2. Validate the slice into a canonical graph model.
3. Check gaps, contradictions, and security violations.
4. Generate Java 17+ / Spring Boot output for the target slice.
5. Review semantic and generated diffs in the same branch.
6. Refine the semantic source when needed.

## Design Principles

- Semantic source is the primary artifact.
- Graph IR is the canonical machine-readable artifact.
- Spring Boot / Java 17+ is the first target backend.
- Security is first-class.
- Dependencies and external documentation are first-class inputs.
- AI provider choice must remain interchangeable.
- Generated code must remain reviewable and traceable back to semantic source.

## Planned Components

- `mcp-servers/semantic-core`
- `mcp-servers/validator`
- `mcp-servers/compiler`
- `local-runners/`
- `vscode-extension/`
- `docker/compose.yaml`

## Current Implementation Scaffold

The first MCP server scaffold is now laid out as a TypeScript workspace with:

- `semantic-core` MCP server
- `validator` MCP server
- `compiler` MCP server
- shared semantic parser / graph / validation / compiler helpers

### Expected install and run flow

```bash
npm install
npm run dev:semantic-core
npm run dev:validator
npm run dev:compiler
```

### Local artifact output

- `.ai-native/cache/`
- `.ai-native/graph/`
- `.ai-native/validation/`
- `.ai-native/generated/`

### Containerized run

```bash
docker compose -f docker/compose.yaml up --build
```

Each MCP server is exposed as a separate remote HTTP service on its own port.

### VSCode extension

The `vscode-extension/` package is the developer-facing control plane:

- workflow tree view
- artifacts tree view
- tutorial tree view
- dashboard webview
- MCP configuration panel
- commands for validation, graph generation, and Spring Boot generation

Build it separately:

```bash
npm run build:vscode-extension
```

The extension expects the remote MCP endpoints to be available at the defaults from `vscode-extension/package.json` unless overridden in VSCode settings.

## Contributing Direction

When this repo is extended into an implementation, keep the following stable:

- semantic terminology
- graph schema contract
- validation severity model
- provider-neutral workflow
- repo layout conventions
