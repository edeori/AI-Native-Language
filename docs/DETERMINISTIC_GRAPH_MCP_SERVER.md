# Deterministic Graph MCP Server

## Decision

The deterministic graph builder is a dedicated MCP server.

It is not owned by the shared import pipeline long-term.

The shared pipeline may still call the same shared builder functions internally during transition, but the architectural ownership now belongs to the separate `deterministic-graph` MCP server.

## Purpose

This server owns deterministic graph construction from already collected structural artifacts.

It does not parse raw source itself.

Its job starts after these inputs already exist:

- project analysis
- snapshot
- AST-derived analysis data
- optional `jqassistant` artifact

## Scope

The server currently builds these deterministic artifacts:

- `source.ast-index.json`
- `source.codegraph.json`
- `source.codegraph.md`
- `source.jqassistant-graph.json`
- `source.support-graph.json`
- `source.graph-verification.json`
- `source.graph-verification-slices.json`
- `source.layer-graphs.json`
- `source.preview.json`
- `source.component-map.json`
- `source.flow-map.json`

## Non-scope

This server does not own:

- raw Java parsing
- `jqassistant` scanning
- local AI enrichment
- semantic markdown polishing
- canonical semantic graph generation

## MCP tool

### `deterministic_graph_build`

Input:

- `projectName`
- `projectRoot`
- `analysis`
- `snapshot`
- optional `jqassistantArtifact`
- optional `outputDir`

Output:

- deterministic artifact bundle as JSON
- optional file emission into `outputDir`

## Shared contract

The server uses the shared exported builder:

- `buildDeterministicGraphArtifacts(...)`

This is the current contract boundary between:

- source scanning / analysis
- deterministic graph construction

## Expected long-term flow

1. Java parser produces AST or AST-driven analysis input
2. `jqassistant` produces structural graph input
3. shared/source analysis prepares deterministic analysis objects
4. `deterministic-graph` MCP server builds deterministic graph artifacts
5. later stages consume these artifacts for:
   - verification
   - enrichment
   - semantic generation

## Why this split matters

This keeps deterministic graph construction:

- separately testable
- separately deployable
- callable from plugin or external orchestrators
- easier to evolve without coupling it to semantic assembly logic
