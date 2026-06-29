# Repository Structure

This repository is organized as a source distribution for the AI-native semantic workflow.
The goal is to keep the semantic model, tooling contracts, examples, and implementation scaffolding in one place so the project can be cloned and reused by other teams.

## Top-Level Layout

```text
.
├── AI_Native_Semantic_Pilot_Spec.md
├── AI_Native_Semantic_Pilot_Notes.md
├── AI_Native_Semantic_Workflow.md
├── README.md
├── docs/
├── examples/
├── mcp-servers/
├── vscode-extension/
└── docker/
```

## Directory Responsibilities

### `docs/`

- [source-import/](source-import/) — Source Import pipeline lépések részletesen
- [document-import/](document-import/) — Document Import pipeline lépések részletesen
- [actions/](actions/) — minden plugin action és command leírása
- `CURRENT_PROCESSING_PIPELINE.md` — pipeline design elvek és artifact stratégia
- `MCP_SERVER_CONTRACTS.md` — MCP server szerepkörök összefoglalója
- `PLUGIN_INSTALLATION.md` — extension build, package, install útmutató
- `REPO_STRUCTURE.md` — ez a fájl

### `examples/`

- semantic markdown példák
- kanonikus gráf JSON példák
- validáció példák

### `mcp-servers/`

- `semantic-core/` — kanonikus gráf, recon prompt, review prompt bundle
- `validator/` — semantic validáció, policy
- `compiler/` — alkalmazás scaffold (jövőbeni funkció, nincs extensionbe bekötve)
- `java-parser/` — Java AST parsing
- `jqassistant/` — bytecode scan, Maven/modul struktúra
- `document-import/` — dokumentum → Markdown konverzió, semantic elemzés, alignment
- `shared/` — determinisztikus artifact utilities, `importSourceProjectState`

### `vscode-extension/`

- plugin UI (Flow panel, Actions panel, Document Import, Settings)
- artifact tree view-ok (validation, graph, semantic, database schema)
- Recon Runs panel

### `docker/`

- Docker Compose konfiguráció az MCP szerverekhez
- `10.9.0.2` hálózaton futó service-ek (portok: 3001–3007, kivéve 3006)

## Reproducibility Principle

- A repository plain textből olvasható legyen futtatás nélkül
- A semantic model inspektálható legyen
- A generált artifactek levezethetők legyenek a kommittált forrásból
- A toolchain provider-semleges és klónozható legyen más csapatok számára
