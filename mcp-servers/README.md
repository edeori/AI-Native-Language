# MCP Servers

This directory contains the modular MCP server contracts that support the semantic workflow.

## Important distinction

- MCP servers define tools, inputs, outputs, and workflow contracts.
- They do not have to be the long-term storage layer for generated artifacts.
- Outputs produced by the workflow can be stored locally in the workspace at first.
- The server implementations themselves can and should evolve over time.
- The current MVP transports are:
  - `stdio` for local developer runs
  - `http` via Streamable HTTP for remote and containerized runs

## Planned servers

- `semantic-core`: parse Semantic Markdown and generate canonical graph models
- `validator`: run validation, security checks, and issue reporting
- `compiler`: generate Spring Boot / Java output
- `cache`: store IR snapshots and generated artifacts
- `legacy-introspection`: ingest existing code, docs, and system context

## Implemented v0 tools

### `semantic-core`

- `parse_semantic_markdown`
- `generate_canonical_graph`

### `validator`

- `validate_semantic_markdown`

### `compiler`

- `generate_spring_boot_skeleton`

## Role

- expose structured tools to the IDE and agent layer
- keep the semantic core provider-neutral
- keep execution separate from the developer-facing workflow
- evolve the server capabilities in later versions without changing the semantic source contract

## Local artifact behavior

- generated graph JSON is stored under `.ai-native/graph/`
- validation reports are stored under `.ai-native/validation/`
- generated Spring Boot output is written to the workspace output directory
- a generated manifest is stored under `.ai-native/generated/`
