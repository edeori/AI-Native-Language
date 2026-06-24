# Development View — Implementation Plan

This document is the execution plan for the **Development** section of the AI Native VSCode plugin.
It covers three areas that ship together: the RICE service header rules integration, the Agentor
workflow view, and the Agentor skill bundling strategy.

---

## Relation to existing docs

| Doc | Scope |
|-----|-------|
| `DEVELOPER_FLOW_PIPELINE.md` | Source import flow extraction → `source.flow-map.json` |
| `CURRENT_PROCESSING_PIPELINE.md` | Full source-to-semantic import pipeline |
| **This document** | Development view UI + RICE API rules + Agentor integration |

The Development view is downstream of the import pipeline: it operates on already-imported source
artifacts and helps developers create, track, and iterate on multi-repo agent tasks.

---

## 1. RICE Service Header Rules

### Source

Confluence: [Egységes szolgáltatás header a RICE REST API-nál](https://wiki.rbinternational.com/confluence/spaces/WIKI/pages/2868980635)

### Canonical header definitions

All RBHU internal REST API endpoints must include these headers:

| Header | Required | Type | Constraints | Description |
|--------|----------|------|-------------|-------------|
| `X-Request-ID` | true | string/uuid | minLength:10, maxLength:48 | Unique request ID, UUID format |
| `X-Correlation-ID` | true | string | minLength:10, maxLength:48 | Session/process ID |
| `X-User-ID` | true | string | minLength:1, maxLength:20 | Authenticated user ID |
| `X-User-Auth` | true | string | minLength:1, maxLength:255 | Auth system identifier (e.g. NDS) |
| `X-User-Auth-Time` | true | string/date-time | ISO8601 with timezone | Time of authentication |
| `X-Caller` | true | string | minLength:1, maxLength:36 | Immediate calling system |
| `X-Client` | true | string | minLength:1, maxLength:36 | Full call-chain originator |
| `X-Timeout` | true | integer | — | Max wait time in ms (default 30000) |
| `X-Idempotency-Key` | false | string | maxLength:48 | POST-only, for retry safety |

**Transport constraint:** All headers must travel over HTTPS only.

**POST-only rule:** `X-Idempotency-Key` is required on POST endpoints if the operation is not
naturally idempotent. Mark it `required: false` but document its use in the description.

### Shared source location

Single source of truth: `mcp-servers/shared/src/rice-headers.ts`

This module exports:
- `RICE_HEADER_DEFINITIONS` — typed array of all header specs
- `RICE_OPENAPI_PARAMETERS_BLOCK` — ready-to-embed YAML string for `components/parameters`
- `validateRiceHeaders(spec)` — checks an OpenAPI document for header compliance, returns issues
- `RICE_SPRING_FILTER_TEMPLATE` — Java source for `ServiceHeaderFilter.java`
- `RICE_SPRING_DTO_TEMPLATE` — Java source for `ServiceHeaderContext.java`

### Compiler integration

When `generate_spring_boot_skeleton` runs, the generated output adds:
1. `openapi.yaml` → `components/parameters` block with all 8 required RICE headers
2. Each operation in the spec references the headers via `$ref: '#/components/parameters/X-*'`
3. `src/main/java/{package}/filter/ServiceHeaderFilter.java` — Spring `OncePerRequestFilter`
   that reads and validates mandatory headers, populates a `ServiceHeaderContext`
4. `src/main/java/{package}/model/ServiceHeaderContext.java` — immutable value object
5. `ServiceHeaderFilter` auto-registered via `FilterRegistrationBean` in the main config class

### Validator integration

The validator MCP server (`validate_semantic_document` tool) adds a new check category:
`rice-headers`. Triggered when the semantic document or the associated OpenAPI YAML describes
REST endpoints. Issues reported:
- `RICE_HEADER_MISSING` — a required header is absent from `components/parameters`
- `RICE_HEADER_WRONG_TYPE` — header schema type/format doesn't match the spec
- `RICE_HEADER_WRONG_CONSTRAINT` — minLength/maxLength violates the canonical values
- `RICE_IDEMPOTENCY_POST_MISSING` — POST operation has no `X-Idempotency-Key` reference

---

## 2. Development View — Plugin Architecture

### Sidebar position

New entry in `package.json` `contributes.views.aiNativeSemantic`:

```json
{
  "id": "aiNativeDevelopment",
  "name": "Development"
}
```

Inserted **before** the existing `aiNativeMcpHub` (Settings) entry.
The `aiNativeActions` "Actions" view keeps its position at the top.

### Generate Spring Boot moved to Development

The `generateSpringBootSkeleton` button is removed from `actionsView.ts` and becomes a dedicated
entry in the Development tree (not in a webview panel — it opens the existing command directly).

### Left panel: Development tree view

`vscode-extension/src/views/developmentTree.ts` — `DevelopmentTreeDataProvider`

Tree structure:

```
Development
├── [+] New Agentor Task              (command: aiNative.agentor.newTask — opens Claude chat with /agentor)
├── [≡] Generate Spring Boot         (command: aiNative.generateSpringBootSkeleton)
│
├── Running (n)
│   └── [⟳] 20260623-refintrate-be   (click → opens detail webview)
│
├── Review Needed (n)
│   └── [●] 20260620-daily-conf-be   (click → opens detail webview)
│
├── Done (n)
│   └── [✓] 20260610-hedge-be        (click → opens detail webview)
│
└── All Tasks (collapsed by default)
```

State icons use VSCode `ThemeIcon`:
- running: `sync~spin` with `testing.iconQueued`
- review: `git-pull-request` with `charts.yellow`
- done: `check` with `testing.iconPassed`
- failed: `error` with `testing.iconFailed`

Task status is read from `{agentor-root}/runs/{task-id}/status.json` or derived from
the presence of `REVIEW-{task-id}.yaml` and the `report.md` file.

### Right panel: Task detail webview

`vscode-extension/src/webviews/developmentView.ts` — `DevelopmentWebviewProvider`

Opened via `vscode.commands.executeCommand('aiNative.agentor.openTask', taskId)`.
The panel shows:

```
┌─────────────────────────────────────────────────────┐
│  20260623-refintrate-be                  [status]   │
│  Unify error response format                        │
│  Repos: refintrate-be, refintrate-fe                │
│                                                     │
│  Goal:                                              │
│  ...text from contract.yaml...                      │
│                                                     │
│  ─── Actions ───────────────────────────────────── │
│  [ ▶ Run agent ]    [ 📋 Copy prompt ]              │
│  [ ✍ Generate review ]  [ ↻ Next iteration ]       │
│  [ 🗁 Open workspace ]                              │
│                                                     │
│  ─── Log ──────────────────────────────────────── │
│  (last 20 lines from runs/{id}/agent.log or         │
│   status.json events array)                         │
└─────────────────────────────────────────────────────┘
```

**Button → action mapping:**

| Button | Command / script call |
|--------|----------------------|
| ▶ Run agent | `agentor.sh run {id}` → streams stdout to output channel |
| 📋 Copy prompt | reads `runs/{id}/agent-prompt-current.md` → clipboard |
| ✍ Generate review | `agentor.sh review {id}` |
| ↻ Next iteration | `agentor.sh next {id}` |
| 🗁 Open workspace | `code runs/{id}/{id}.code-workspace` |

Script execution uses Node `child_process.spawn` with the agentor root as cwd.
Output streams to a dedicated output channel `AI Native: Agentor`.
On completion the tree refreshes automatically.

### Agentor root path

Configurable via new VSCode setting:

```json
"aiNative.agentor.root": {
  "type": "string",
  "default": "",
  "description": "Path to the .agentor directory. Defaults to the parent of the first workspace folder."
}
```

If empty, the plugin resolves it as `path.join(workspaceFolder.uri.fsPath, '..', '.agentor')`.
Tree shows an info node if the directory doesn't exist.

---

## 3. Agentor Skill Bundling

### Rationale

The `/agentor` skill defines the task contract wizard. It should be version-controlled alongside
the plugin so updates ship together and the installed skill stays in sync.

### Repo location

```
agents/agentor/SKILL.md       ← canonical source, committed to git
```

This replaces the copy at `~/.claude/skills/agentor/SKILL.md` on every install/update.

### Install logic

On plugin `activate()`, after `initializeMcpConfigStorage`, call:

```ts
await ensureAgentorSkillInstalled(context)
```

`ensureAgentorSkillInstalled`:
1. Reads `agents/agentor/SKILL.md` from the extension install dir
   (`context.extensionUri` + `agents/agentor/SKILL.md`)
2. Reads the current plugin version from `package.json`
3. Checks `~/.claude/skills/agentor/.plugin-version` — if it matches the current version, skip
4. Writes the skill file to `~/.claude/skills/agentor/SKILL.md`
5. Writes the version marker to `~/.claude/skills/agentor/.plugin-version`

The `agents/agentor/` directory must be included in the VSIX (add to `.vscodeignore` exclusion
whitelist or ensure the path is not excluded).

### .vscodeignore impact

Current `.vscodeignore` excludes `../` (parent of extension root) but does NOT exclude
`agents/`. The `agents/agentor/SKILL.md` will be included in the VSIX automatically
as long as it is under `vscode-extension/` … wait — the VSIX packages the extension
directory itself, not the repo root. The `agents/` directory is at the repo root, outside
`vscode-extension/`.

**Resolution:** copy the skill file into `vscode-extension/agents/agentor/SKILL.md`
as part of the build step. Add to `esbuild.mjs` a post-build `fs.copyFile` call:
```js
await fs.copyFile('../agents/agentor/SKILL.md', 'agents/agentor/SKILL.md')
```
And create `vscode-extension/agents/agentor/` in `.gitignore` (it's a build artifact).

Alternatively (simpler): embed the skill content directly as a TypeScript constant in
`vscode-extension/src/agentorSkill.ts` — single string, auto-updated by a prebuild script.
This avoids binary file inclusion complexity.

**Chosen approach:** embedded TS constant, updated by `prebuild` script that reads
`../agents/agentor/SKILL.md` and writes `src/agentorSkill.ts`. This is deterministic and
does not require `.vscodeignore` changes.

---

## 4. Implementation Phases

### Phase 1 — Now

Ordered implementation steps:

1. **`mcp-servers/shared/src/rice-headers.ts`** — shared header definitions module
   - `RICE_HEADER_DEFINITIONS`, `validateRiceHeaders`, `RICE_OPENAPI_PARAMETERS_BLOCK`
   - `RICE_SPRING_FILTER_TEMPLATE`, `RICE_SPRING_DTO_TEMPLATE`
   - Export from `mcp-servers/shared/src/index.ts`
   - Rebuild shared: `cd mcp-servers/shared && npx tsc`

2. **Compiler: add RICE headers to generated OpenAPI + Spring skeleton**
   - In `generateSpringBootSkeleton` (shared): inject `RICE_OPENAPI_PARAMETERS_BLOCK` into
     generated `openapi.yaml`, add `ServiceHeaderFilter.java` and `ServiceHeaderContext.java`

3. **Validator: add `rice-headers` check category**
   - In `validateSemanticDocument` (shared): if document has REST endpoints, run
     `validateRiceHeaders` against any embedded OpenAPI spec in the document

4. **`vscode-extension/src/constants.ts`** — add new command IDs and view ID
   - `aiNative.agentor.openTask`, `aiNative.agentor.newTask`, `aiNative.agentor.run`,
     `aiNative.agentor.review`, `aiNative.agentor.next`
   - View: `aiNativeDevelopment`

5. **`vscode-extension/src/views/developmentTree.ts`** — tree data provider
   - Reads agentor root, scans `contracts/` and `runs/`
   - Groups by status, returns styled `TreeItem`s

6. **`vscode-extension/src/webviews/developmentView.ts`** — task detail webview
   - Renders task detail HTML, handles button messages, spawns agentor.sh subprocess

7. **`vscode-extension/src/extension.ts`** — wire up
   - Register `aiNativeDevelopment` tree view
   - Register `aiNativeDevelopment` webview view provider
   - Add `ensureAgentorSkillInstalled` call in `_activate`
   - Remove `generateSpringBootSkeleton` from actionsView

8. **`vscode-extension/src/webviews/actionsView.ts`** — remove Spring Boot button

9. **`vscode-extension/package.json`** — add view, commands, setting

10. **`agents/agentor/SKILL.md`** — move skill source here from `~/.claude/skills/agentor/`
    (or copy it in — the file currently lives only in `~/.claude/skills/agentor/SKILL.md`)

11. **`vscode-extension/esbuild.mjs`** — add prebuild step to generate `src/agentorSkill.ts`

12. **Rebuild + repackage VSIX**

### Phase 2 — Later

- Full "New Task" wizard in the Development webview: repo selector (from `config.yaml`),
  title/goal form, skeleton preview, save + run — replicating the `/agentor` lépések 1–5
  without needing Claude chat.
- Live log streaming (replace static last-20-lines with SSE or polling).
- Task filtering by repo alias.

---

## 5. Open Questions / Decisions Pending

| # | Question | Default assumption |
|---|----------|-------------------|
| 1 | Should `validateRiceHeaders` also lint the **semantic markdown** text (not just YAML)? | Yes — check that the semantic doc's API section mentions the required headers |
| 2 | Where exactly is `agentor.sh`? Is it always `{agentor-root}/agentor.sh`? | Yes, based on the skill doc |
| 3 | Should the detail webview panel be persistent (one panel total) or per-task? | One persistent panel, updates on task selection |
| 4 | Should tree auto-refresh on file-system changes to `runs/`? | Yes — `fs.watch` on `{agentor-root}/runs/` with 500ms debounce |
