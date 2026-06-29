# Source Import — áttekintés

A Flow panel négy egymásra épülő lépést tartalmaz, amelyek a forráskódbázisból felépítik a projekt teljes semantic leírását és kódgráfját.

## A négy Flow panel lépés

| # | Panel felirat | stepId | Command |
|---|---|---|---|
| 1 | **Source Import** | `activate` | `aiNative.importSourceProject` |
| 2 | **Semantic Enrichment** | `ai-enrichment` | `aiNative.runAiEnrichment` |
| 3 | **Flow Extraction** | `flow-extraction` | `aiNative.runFlowExtraction` |
| 4 | **Generate Graph** | `graph` | `aiNative.generateCanonicalGraph` |

Az összes lépés egyszerre is futtatható (**Run Selected Steps** gomb), vagy egyenként (minden kártyán a ▶ gomb).

## Source Import belső sorrendje

A Source Import (Step 1) több egymásba ágyazott fázisból áll:

```
[1a] Java AST parsing         → MCP: java-parser · scan_java_project
[1b] jQAssistant scan         → MCP: jqassistant · jqassistant_scan_files  (opcionális)
[1c] importSourceProjectState → shared lib · determinisztikus analízis + AI enrichment + graph
[1d] Recon prompt             → MCP: semantic-core · generate_reconnaissance_prompt
[1e] Validation               → MCP: validator · validate_semantic_markdown
```

## Kimeneti fájlok (Source Import után)

| Fájl | Leírás |
|---|---|
| `.ai-native/source.ast.json` | Java AST catalog |
| `.ai-native/source.jqassistant.json` | jQAssistant bytecode eredmény |
| `.ai-native/source.analysis.json` | Projekt-analízis snapshot |
| `.ai-native/source.semantic.md` | Generált semantic leírás (fő artifact) |
| `.ai-native/source.semantic.json` | Semantic JSON verzió |
| `.ai-native/source.enrichment.json` | AI enrichment eredmény |
| `.ai-native/source.codegraph.json` | In-process kódgráf |
| `.ai-native/source.jqassistant-graph.json` | jQAssistant support gráf |
| `.ai-native/source.recon.json` | Felderítési prompt payload |
| `.ai-native/source.recon.prompt.md` | Projekt szintű recon prompt |
| `.ai-native/source.database.schema.json` | DB schema artifact |
| `.ai-native/source.graph.json` | Kanonikus semantic gráf |
| `.ai-native/source.recon.runs/<runId>/` | Run snapshot és eseménynapló |

## Részletes leírások

- [1a — Java AST parsing](01-java-ast.md)
- [1b — jQAssistant scan](02-jqassistant.md)
- [1c — Analízis és gráfépítés (importSourceProjectState)](03-analysis.md)
- [1d — Recon prompt generálás](04-recon-prompt.md)
- [1e — Validáció](05-validation.md)
- [2 — Semantic Enrichment](06-semantic-enrichment.md)
- [3 — Flow Extraction](07-flow-extraction.md)
- [4 — Generate Graph](08-generate-graph.md)
