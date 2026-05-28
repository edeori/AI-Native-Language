# VSCode Extension

This extension is the developer-facing entry point for the AI-native semantic workflow.

It is intentionally thin:

- the UI lives here
- the semantic services live in MCP servers
- local artifacts are written to `.ai-native/`
- remote MCP servers can run locally in Docker or later in Kubernetes

## What you get in v0

- a dedicated activity bar container
- workflow, artifacts, and tutorial views
- a dashboard panel with quick actions
- a dedicated MCP configuration panel
- commands for validation, graph generation, and Spring Boot generation
- remote MCP configuration through VSCode settings

## Views

- **Workflow**: the recommended execution path from Semantic Markdown to Java output
- **Artifacts**: local `.ai-native` cache, graph, validation, and generated outputs
- **Tutorials**: a guided starting point for using the repo and the extension

## Commands

- `AI Native: Open Dashboard`
- `AI Native: Configure MCP Servers`
- `AI Native: Open Tutorial`
- `AI Native: Refresh Views`
- `AI Native: Validate Active Semantic Markdown`
- `AI Native: Generate Canonical Graph`
- `AI Native: Generate Spring Boot Skeleton`
- `AI Native: Open Artifact Folder`
- `AI Native: Show MCP Status`

## Settings

The extension reads its remote services from VSCode settings, and it can also write them from the built-in configuration panel:

- `aiNative.mcp.semanticCoreUrl`
- `aiNative.mcp.validatorUrl`
- `aiNative.mcp.compilerUrl`
- `aiNative.artifactRoot`
- `aiNative.java.basePackage`
- `aiNative.autoValidateOnSave`

Default URLs point at the local Docker ports:

- semantic-core: `http://localhost:3001/mcp`
- validator: `http://localhost:3002/mcp`
- compiler: `http://localhost:3003/mcp`

## Tutorial 1: first run

1. Start the MCP services:
   ```bash
   docker compose -f docker/compose.yaml up --build
   ```
2. Open the repository in VSCode.
3. Open the AI Native view container.
4. Open the dashboard.
5. Run **AI Native: Show MCP Status**.
6. Open `examples/document_processing_service.semantic.md`.
7. Run **AI Native: Validate Active Semantic Markdown**.
8. Run **AI Native: Generate Canonical Graph**.
9. Run **AI Native: Generate Spring Boot Skeleton**.

## Tutorial 2: day-to-day loop

1. Edit a system slice in Semantic Markdown.
2. Re-run validation.
3. Inspect security violations and gaps.
4. Generate the canonical graph.
5. Generate the Spring Boot skeleton.
6. Review generated artifacts under `.ai-native/generated/`.
7. Refine the semantic source if the output diverges.

## Tutorial 3: working with remote MCP servers

1. Point the extension settings at remote Streamable HTTP endpoints.
2. Keep the semantic source in the workspace.
3. Let the servers run in Docker or Kubernetes.
4. Keep the artifacts local or in the mounted workspace volume.
5. Use the extension as the control plane, not as the execution engine.

## Tutorial 4: configure MCP servers

1. Open **AI Native: Configure MCP Servers**.
2. Set the `semantic-core`, `validator`, and `compiler` URLs.
3. Optionally change the artifact root and Java base package.
4. Save the settings into the workspace configuration.
5. Re-run **AI Native: Show MCP Status**.

## Build the extension package

```bash
npm run build:vscode-extension
```

## Recommended local layout

- semantic source: `examples/` or the application repo’s `semantic/`
- validation snapshots: `.ai-native/validation/`
- graph snapshots: `.ai-native/graph/`
- generated Java: `.ai-native/generated/`
- local cache: `.ai-native/cache/`

## Design rule

The extension should stay thin. The MCP servers and generated artifacts are the source of truth for the workflow.
