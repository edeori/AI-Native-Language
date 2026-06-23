# MCP Server Contracts

This document is a lightweight inventory of the currently relevant MCP service roles.

Detailed processing behavior belongs in:

- `docs/CURRENT_PROCESSING_PIPELINE.md`
- `docs/DEVELOPER_FLOW_PIPELINE.md`
- `docs/JQASSISTANT_INTEGRATION_PLAN.md`

## Shared expectations

- Streamable HTTP is a first-class transport
- `stdio` is still acceptable for local development
- server responses are returned as text-wrapped JSON payloads
- structural extraction, validation, compilation, and semantic processing remain separated by server responsibility

## Current server roles

### `semantic-core`

Primary role:

- semantic parsing
- canonical graph generation
- database schema generation
- reconnaissance prompt generation

### `validator`

Primary role:

- semantic validation
- issue reporting
- diagnostics-oriented output

### `compiler`

Primary role:

- generated application scaffolding

### `java-parser`

Primary role:

- Java AST parsing
- project-level AST catalog generation

### `jqassistant`

Primary role:

- structural scan orchestration
- Maven/module/package evidence extraction
- future deterministic merge evidence support

## Note

This document intentionally avoids duplicating full tool-by-tool pipeline descriptions.
The contract surface is evolving, and the more detailed behavior should be maintained closer to the pipeline and integration docs.
