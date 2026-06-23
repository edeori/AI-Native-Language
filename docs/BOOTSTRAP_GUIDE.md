# Bootstrap Guide

This document is now a short orientation note.

Detailed pipeline behavior, UI direction, and graph strategy have moved into dedicated docs.

## Read these first

- `docs/CURRENT_PROCESSING_PIPELINE.md`
- `docs/DEVELOPER_FLOW_PIPELINE.md`
- `docs/JQASSISTANT_INTEGRATION_PLAN.md`
- `docs/PLUGIN_UI_REFACTOR_NOTES.md`
- `docs/PLUGIN_INSTALLATION.md`

## Repository role

This repository currently acts as:

- a semantic workflow prototype
- a deterministic and AI-assisted source analysis workspace
- a VSCode plugin plus MCP server codebase
- a place for artifact-driven implementation experiments

## Core runtime pieces

The most important runtime pieces are:

- `vscode-extension/`
- `mcp-servers/shared/`
- `mcp-servers/semantic-core/`
- `mcp-servers/validator/`
- `mcp-servers/compiler/`
- `mcp-servers/java-parser/`
- `mcp-servers/jqassistant/`

## Current development baseline

Use these as the practical starting point:

```bash
npm install
npm run build
```

For local HTTP MCP development, start only the services you need.

## Note

This document intentionally stays short to avoid repeating material that now has more specific owners in other docs.
