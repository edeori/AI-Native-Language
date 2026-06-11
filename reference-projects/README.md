# Reference Projects

This folder contains complex real-world systems used as reference material for improving:

- semantic slicing
- graph extraction
- validation heuristics
- MCP server behavior
- code generation heuristics

## How to use a reference project

For each project, keep a small, human-readable semantic slice that captures:

- architecture boundaries
- inbound and outbound interfaces
- service layers
- persistence
- security
- external integrations
- flows and outcomes

The goal is not to mirror the full source code tree in markdown. The goal is to capture the system shape that helps the graph and tooling become smarter over time.

## Current reference corpus

- `event-app-be`: a complex Spring Boot / Maven enterprise backend with layered modules, security, persistence, and notification flows.

## Adding a new project

Create a new folder under this directory and include:

- `README.md` with project context and what should be learned
- `<project>.reference.semantic.md` with the semantic slice
- optionally a generated graph JSON later, once the slice is validated

## Re-running the ingest

Use the repository script to regenerate the analysis and graph artifacts:

```bash
npm run reference:ingest -- --root ../YourProjectRoot --name your-project --out reference-projects/your-project
```

This writes:

- `<project>.analysis.json`
- `<project>.analysis.md`
- `<project>.reference.graph.json`

## Batch ingest for multiple projects

Keep a manifest at `reference-projects/manifest.json` and run:

```bash
npm run reference:ingest:batch
```

The batch runner replays the same ingest pipeline for every manifest entry, so new reference projects can be added without changing the toolchain.

## Step-by-step learning process from source code only

When you only have a source repository and want to teach the system from it, use this loop:

1. **Copy the source repository next to this repo**
   - Keep the target project locally available, for example `../Event-App-BE`.
   - Do not modify the source project yet.

2. **Add a reference project folder**
   - Create `reference-projects/<project-name>/`.
   - Add a short `README.md` that explains what this project is and what should be learned from it.

3. **Generate the first analysis**
   - Run:
     ```bash
     npm run reference:ingest -- --root ../YourProjectRoot --name your-project --out reference-projects/your-project
     ```
   - This scans the source tree and writes:
     - `<project>.analysis.json`
     - `<project>.analysis.md`
     - `<project>.reference.graph.json`

4. **Create or update the semantic slice**
   - Add `<project>.reference.semantic.md` in the same folder.
   - Write the architecture slice at a system level:
     - boundaries
     - interfaces
     - services
     - persistence
     - security
     - external integrations
     - main flows

5. **Compare source structure with the semantic slice**
   - Use the generated analysis to spot missing modules, layers, or integrations.
   - If the source has clear boundaries that the semantic slice does not mention, add them.
   - If the semantic slice mentions things that are not present in the source, remove or weaken them.

6. **Regenerate the graph**
   - Re-run the ingest after every meaningful semantic update.
   - Check whether the graph now reflects the real module layout, interfaces, external systems, and flows.

7. **Run the smoke test**
   - Use:
     ```bash
     npm run reference:smoke
     ```
   - Compare the toy example with the reference project:
     - the toy slice should stay simple
     - the reference slice should show richer modules, dependencies, and external systems

8. **Refine the heuristics**
   - If the graph is missing important patterns, update the semantic slice first.
   - If the graph still misses important structure, extend the heuristics in:
     - `mcp-servers/shared/src/graph.ts`
     - `mcp-servers/shared/src/validator.ts`
     - `mcp-servers/shared/src/compiler.ts`
   - Use the reference project as the regression target after each change.

9. **Repeat for every new source project**
   - Add the new project to `reference-projects/manifest.json`.
   - Run:
     ```bash
     npm run reference:ingest:batch
     ```
   - This keeps the corpus growing without changing the workflow.

## Practical rule

The source repository is the truth for structure and behavior. The semantic slice is the editable teaching artifact. The graph is the normalized intermediate representation. The heuristics improve over time by comparing both against the reference corpus.

## Editable learning states

If you want an editable, source-derived state for feature work, create it in the target project workspace under its own `learning-projects/` folder instead of changing the curated reference corpus in this tooling repo. The learning state is intentionally revisited and refreshed as the source evolves, while the reference corpus stays mostly stable as regression material.
