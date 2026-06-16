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

- `semantic-core`: parse Semantic Markdown, generate canonical graph models, and infer database schema drafts
- `validator`: run validation, security checks, and issue reporting
- `compiler`: generate Spring Boot / Java output
- `cache`: store IR snapshots and generated artifacts
- `legacy-introspection`: ingest existing code, docs, and system context

## Reference projects

The repository now keeps a growing reference corpus under `reference-projects/`.

- These reference slices are used to improve graph heuristics, validation behavior, and future MCP tools.
- The first complex enterprise reference is `reference-projects/event-app-be/`.
- Future projects can be added in the same format to keep training material reproducible.
- The ingest command is `npm run reference:ingest -- --root <project-root> --name <project-name> --out reference-projects/<project-name>`.
- The batch command is `npm run reference:ingest:batch` and replays every project listed in `reference-projects/manifest.json`.
- The `semantic-core` and `validator` servers consult the reference corpus when inferring module boundaries and enterprise-level warnings.
- The source learning pipeline now emits module dossiers and a stored reconnaissance prompt so deeper scans can be replayed consistently across large Maven projects.

## Implemented v0 tools

### `semantic-core`

- `parse_semantic_markdown`
- `generate_canonical_graph`
- `generate_database_schema`

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
- inferred database schema drafts are stored under `.ai-native/schema/`
- validation reports are stored under `.ai-native/validation/`
- generated Spring Boot output is written to the workspace output directory
- a generated manifest is stored under `.ai-native/generated/`
