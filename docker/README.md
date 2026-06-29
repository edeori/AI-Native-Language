# Docker

This directory will contain local orchestration templates for the semantic workflow.

## Intended contents

- compose definitions
- environment templates
- local service wiring
- optional development-only infrastructure

## Current layout

- `Dockerfile.mcp`: shared container image for the MCP servers
- `compose.yaml`: local multi-service orchestration for:
  - `semantic-core`
  - `validator`
  - `compiler`
  - `java-parser`
  - `jqassistant`
  - `document-import`

## Remote runtime model

- each MCP server can run as a remote HTTP service
- local development can still use `stdio`
- containerized runs expose the services on dedicated ports
