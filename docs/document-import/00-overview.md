# Document Import — áttekintés

A Document Import panel (`aiNativeDocImport` webview) külső dokumentumokból vagy Confluence oldalakból épít semantic tartalmat.

## Lépések

1. [Forrásválasztás](01-source-selection.md) — fájlok és Confluence URL-ek hozzáadása a panelen
2. [Konverzió Markdownná](02-conversion.md) — PDF/DOCX/HTML/TXT → normalizált Markdown, mentés `.ai-native/imports/` alá
3. [Heurisztikus elemzés](03-analysis.md) — entitások kinyerése, semantic patch generálás (MCP szerver)
4. [Entitás-akkumuláció](04-entity-accumulation.md) — több dokumentum entitásainak összegyűjtése
5. [Kimeneti fájlok](05-outputs.md) — `source.semantic.md` és `doc-entities.json` írása (merge, ha már létezik)
6. [AI Review](06-ai-review.md) — opcionális cloud AI enrichment pass
7. [Downstream: Flow Extraction](07-flow-extraction.md) — flows és processes beépítése a semantic.md-be (önállóan is futtatható)

> A **Doc-Code Alignment** nem a document import flow része — az Actions panelről indítható standalone ellenőrzés. Lásd: [source-import/08-generate-graph.md](../source-import/08-generate-graph.md) és a plugin Actions panel dokumentációja.

## Adatfolyam

```
Fájlok / Confluence URL-ek
        │
        ▼
[2] convert_document_to_markdown / fetch_confluence_page
        │  → .ai-native/imports/<name>.md  (mindig mentve)
        ▼
[3] analyze_document_for_semantic  (per document)
        │  → semantic patch
        │  → entities: components, flows, apis, dataModels, techStack
        ▼
[4] entitás-akkumuláció (extension, Set-ek)
        │
        ▼
[5] .ai-native/source.semantic.md  ← append "## Imported:" szekció, ha már létezik
    .ai-native/doc-entities.json   ← felülírva az aktuális futás összesítésével
        │
        └──▶ [7] Flow Extraction  →  # processes / # data_flows (unió a meglévőkkel)
```
