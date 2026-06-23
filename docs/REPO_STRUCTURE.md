# Repository Structure

This repository is organized as a source distribution for the AI-native semantic workflow.
The goal is to keep the semantic model, tooling contracts, examples, and implementation scaffolding in one place so the project can be cloned and reused by other teams.

## Top-Level Layout

```text
.
├── AI_Native_Semantic_Pilot_Spec.md
├── AI_Native_Semantic_Pilot_Notes.md
├── AI_Native_Semantic_Workflow.md
├── README.md
├── agents/
├── docs/
├── examples/
├── mcp-servers/
├── local-runners/
├── vscode-extension/
└── docker/
```

## Directory Responsibilities

### `docs/`

- repository architecture
- bootstrap guide
- workflow notes that are more operational than conceptual
- future implementation guidance

### `examples/`

- semantic markdown examples
- canonical graph JSON examples
- validation examples
- security policy examples
- dependency integration examples

### `mcp-servers/`

- semantic core server implementation
- validation server implementation
- compiler / generator server implementation
- Java parser implementation
- `jqassistant` integration server
- shared deterministic and artifact utilities

### `local-runners/`

- optional local helper area
- not the primary architecture focus anymore compared to MCP-driven execution

### `vscode-extension/`

- developer-facing plugin scaffold
- semantic file editing workflow
- validation triggers
- graph previews
- generated diff views

### `agents/`

- bounded task schemas
- agent policies
- allowed tool lists
- stop conditions
- output contract definitions

### `docker/`

- container and compose scaffolding
- local service orchestration templates
- environment variable templates

## Reproducibility Principle

- The repository should be readable without running code.
- The semantic model should be inspectable in plain text.
- The generated artifacts should be derivable from the committed source.
- The toolchain should be provider-neutral and cloneable by other teams.

## Current note

The repository is now evolving toward a deterministic-first artifact pipeline where:

- AST outputs
- `jqassistant` outputs
- deterministic graphs
- AI-facing support artifacts

are central to later AI-assisted implementation work.

That means the repo is no longer only about semantic markdown and generated graph output.
