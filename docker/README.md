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

## Prerequisites before first build

The `jqassistant` image requires a pre-downloaded binary that is **not committed to the repo**:

```bash
curl -fsSL --insecure \
  "https://repo1.maven.org/maven2/com/buschmais/jqassistant/cli/jqassistant-commandline-neo4jv5/2.9.1/jqassistant-commandline-neo4jv5-2.9.1-distribution.zip" \
  -o docker/jqassistant.zip
```

> On corporate networks with SSL inspection (e.g. Zscaler), use `--insecure`. The file is `docker/jqassistant.zip` and is gitignored. Without it `docker compose build` will fail with a missing file error.

## Remote runtime model

- each MCP server can run as a remote HTTP service
- local development can still use `stdio`
- containerized runs expose the services on dedicated ports
