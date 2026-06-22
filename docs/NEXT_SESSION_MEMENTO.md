# Next Session Memento

## Main priorities

1. [x] Parallel agent orchestration for source reconnaissance
   - Run module-level agents in parallel.
   - Orchestrate them, track state, and persist per-module outputs.
   - Add a dedicated UI view for parallel runs and current activity.

2. Better architecture extraction
   - Tighten the software architecture layer.
   - Remove buzzword buckets from the diagram.
   - Keep HTTP ingress families narrow.
   - Keep integration interfaces separate from web ingress.
   - Keep object storage, Redis, mail, WebSocket, and schedulers in the correct categories.

3. Better flow analysis
   - Treat flows as the real application paths, not generic summary text.
   - Map all meaningful runtime flows from source code.
   - Show branching, persistence, external calls, and side effects clearly.
   - Define exactly what the agent must inspect for each flow.

4. [x] Remove noisy summary counters from the UI
   - The interface count / service count summary cards are not useful.
   - Replace them with versioned artifacts, validation outputs, reviews, and current semantic views.

5. [x] Version everything
   - Validation runs should be versioned.
   - Graph generations should be versioned.
   - Reviews should be versioned.
   - The UI should be able to step through versions.
   - Graph generation should require a fresh validated version; otherwise warn in the plugin.
   - Versioned artifact storage is in place for validation, graph, review, and semantic import.
   - Graph generation now gates on a fresh validation version.
   - A dedicated version-stepping browser still remains for a later pass.

6. Retraining / feedback loop
   - [x] Add a retraining button or lightweight automation.
   - [x] Persist feedback so it survives server restarts and can be migrated.
   - [x] Make MCP-side learning/state durable.
   - [x] Collect deltas per MCP server locally in the project repo.
   - [x] Push feedback into MCP ingest tools at the end of validation / graph runs.
   - [x] Remove redundant delta/prompt report files; keep feedback as the canonical retraining payload.
   - [x] Move recon / review prompt generation to MCP so prompt updates do not require plugin rebuilds.
   - [ ] Add a full export/import bundle for migrating learning state between installs.

7. Local agent paths for specific tasks
   - Identify tasks that are worth running locally to avoid token cost.
   - Use a tuned local model for those tasks.
   - Keep the model/task contract explicit.

8. Reverse direction must work
   - Source code -> graph -> spec must keep working.
   - Spec -> graph must also work.
   - Code-first import should run Java parser MCP -> AST -> knowledge graph first, then let the agent rewrite semantic from that graph.
   - Compiler is out of scope for now.

9. Stronger logical validation
   - Detect contradictions after the model has been tightened.
   - Make the validation stricter and more informative.

## UI direction

- [x] Keep `Actions` at the top, `Recon Runs` above `Settings`, and `Settings` at the bottom.
- [x] Replace the legacy workflow tree sections with artifact-centric views:
  - validation
  - review
  - semantic
  - database schema
- [x] The per-kind artifact trees act as the browser for the latest user-facing artifacts.
- [x] The `Settings` group covers endpoints, agent selection, and runtime configuration.
- [x] The graph is a preview action, not a sidebar section.

## Scope note

- For now, do not work on the compiler.
- The next major implementation step is the version browser / stepping UI and further architecture / flow refinement.
