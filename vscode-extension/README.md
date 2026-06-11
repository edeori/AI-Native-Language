# VSCode Extension

This extension is the developer-facing entry point for the AI-native semantic workflow.

It is intentionally thin:

- the UI lives here
- the semantic services live in MCP servers
- local artifacts are written to `.ai-native/`
- remote MCP servers can run locally in Docker or later in Kubernetes

## What you get in v0

- a dedicated activity bar container
- Actions, Inputs, Model, Generate, Review, and MCP views under the same AI Native icon
- a sidebar Actions view with the primary workflow buttons
- a compact AI agent configuration panel
- a source-to-semantic import flow for turning an existing source repository into an editable learning state
- commands for validation, graph generation, and Spring Boot generation
- remote MCP configuration through a global MCP config file

## Views

- **Actions**: import a source project, start from scratch, validate, generate graph, or generate Spring Boot output
- **Inputs**: create a semantic source from scratch or run from the active input
- **Model**: parse, validate, and inspect the canonical graph
- **Generate**: produce the Spring Boot skeleton and inspect generated files
- **Review**: browse local artifacts and review outputs
- **MCP**: check connections and open the agent selector

## Commands

- `AI Native: Open Actions View`
- `AI Native: Configure AI Agent`
- `AI Native: Open Tutorial`
- `AI Native: Refresh Views`
- `AI Native: Validate Active Semantic Markdown`
- `AI Native: Generate Canonical Graph`
- `AI Native: Generate Spring Boot Skeleton`
- `AI Native: Open Artifact Folder`
- `AI Native: Import Source Project`

## Settings

The extension reads its remote services from a global MCP config file. The built-in configuration panel now only chooses the AI agent:

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
   ./deploy/remote-sync-and-start.sh
   ```
2. Open the repository in VSCode.
3. Open the AI Native view container.
4. Use the **Actions** section for the primary workflow buttons.
5. Open the **Inputs** section if you want to create a structured source file.
6. Run **AI Native: Create Semantic Source Template**.
7. Open or save a semantic source.
8. Run **AI Native: Validate Active Semantic Markdown**.
   - Findings appear inline in the editor and in the Problems panel.
9. Run **AI Native: Generate Canonical Graph**.
10. Run **AI Native: Generate Spring Boot Skeleton**.
   - If you want a prefilled example, open `examples/simple_notes_service.semantic.md`.

## Tutorial 2: day-to-day loop

1. Edit a system slice in Semantic Markdown.
2. Re-run graph generation when the input changes.
3. Re-run validation.
4. Inspect security violations and gaps.
5. Generate the Spring Boot skeleton.
6. Review generated artifacts under `.ai-native/generated/`.
7. Refine the semantic source if the output diverges.

## Tutorial 2b: source-to-semantic import loop

1. Open the **Actions** view.
2. Click **Import source project**.
3. Pick a Java source repository.
4. The extension writes a new editable learning state under the active target workspace root in `learning-projects/<project>/`. That folder belongs to the project you are importing, not to this tooling repo.
5. Open `source.semantic.md` and refine it for the project you want to model.
6. Re-run the import when the source changes to refresh the analysis and suggested semantic slice without overwriting the curated file.

## Tutorial 3: working with remote MCP servers

1. Point the extension settings at remote Streamable HTTP endpoints.
2. Keep the semantic source in the workspace.
3. Let the servers run in Docker or Kubernetes.
4. Keep the artifacts local or in the mounted workspace volume.
5. Use the extension as the control plane, not as the execution engine.

## Tutorial 4: choose the AI agent

1. Open **AI Native: Configure AI Agent**.
2. Pick `codex` or `claude`.
3. Save the setting.
4. Re-run the graph / review flow with that agent selection.

## Build the extension package

```bash
npm run build:vscode-extension
```

## Run locally in VSCode

1. Open the repository root in VSCode.
2. Run the `Run AI Native Extension` launch configuration from the Run and Debug panel.
3. VSCode will build the extension and open an Extension Development Host.
4. Use the AI Native activity bar entry inside the new window.

## Recommended local layout

- semantic source: `examples/` or the application repo’s `semantic/`
- graph snapshots: `.ai-native/graph/`
- generated Java: `.ai-native/generated/`
- local cache: `.ai-native/cache/`

## Design rule

The extension should stay thin. The MCP servers and generated artifacts are the source of truth for the workflow.
