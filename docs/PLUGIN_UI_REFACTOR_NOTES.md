# Plugin UI Refactor Notes

This document captures the expected future changes to the VSCode plugin UI based on the new deterministic-first processing pipeline.

The purpose of this document is to keep UI refactor work separate from the core pipeline definition.

## 1. Reason for UI refactor

The current plugin UI was built around a more mixed workflow where:

- semantic outputs
- graph preview outputs
- AI enrichment outputs
- MCP runtime settings

were evolving at the same time.

With the new pipeline direction, the UI will need to reflect a more explicit split between:

- deterministic processing artifacts
- verification artifacts
- AI-facing execution artifacts
- human-facing semantic outputs

## 2. Primary UI design goal

The plugin UI should help developers validate and navigate the generated execution-support artifacts.

That means the UI should not focus only on:

- semantic markdown
- final summaries
- general graph previews

It should also clearly expose:

- AST-derived indexes
- `jqassistant` structure outputs
- deterministic graph outputs
- verification artifacts
- AI-specific enrichment graphs

## 3. Proposed UI grouping

The future UI should likely be grouped into these major areas:

### 3.1. Deterministic Inputs

- AST
- AST indexes
- `jqassistant` outputs
- config/openapi/sql derived summaries

### 3.2. Deterministic Graphs

- application graph
- dependency graph
- layer graphs
- flow graph

### 3.3. Verification

- graph verification status
- traversability reports
- correction candidates
- deterministic vs verification mismatches

### 3.4. AI Enrichment

- class-level summaries
- module-level summaries
- layer-level enrichments
- semantic support artifacts

### 3.5. Human Outputs

- semantic markdown
- semantic preview
- human-readable documentation artifacts

## 4. UI behavior expectations

The future UI should support:

- slicing by application
- slicing by layer
- slicing by module
- quick jump from graph node to source-relevant artifact
- distinction between deterministic facts and AI-added hints

## 5. Important display rule

The UI should help verify the deterministic pipeline first.

This means:

- deterministic artifacts should be clearly labeled
- AI enrichments should be visibly secondary
- verification outputs should explain where deterministic outputs might be weak or uncertain

## 6. Graph display expectations

The graph UI should be oriented toward developer verification, not just abstract visualization.

This means:

- categorized graphs
- legible grouping
- application-level separation
- layer-level separation where useful
- easier navigation than the current mixed preview structure

## 7. What should likely move out of the main docs

This UI refactor note exists so the core pipeline document can stay focused on processing logic.

Anything primarily about:

- panel layout
- graph panel structure
- interaction affordances
- preview arrangement
- artifact browsing UX

should live here or in later UI-specific docs, not in the core pipeline definition.

## 8. Current status

This document is only a planning note for now.

The UI changes described here are not yet implemented.
