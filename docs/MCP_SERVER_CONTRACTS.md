# MCP Server Contracts

Lightweight inventory of the MCP server roles. Részletes tool-szintű leírásért lásd a pipeline doksit.

## Shared expectations

- Streamable HTTP az elsődleges transport (`http://<host>:<port>/mcp`)
- `stdio` helyi fejlesztéshez elfogadott
- Válaszok text-wrapped JSON payload-ok
- Strukturális kinyerés, validáció, compilation, és semantic feldolgozás szerver-felelősségek szerint szétválasztva

## Server roles

### `semantic-core`

- semantic parsing
- kanonikus gráf generálás (`generate_canonical_graph`)
- adatbázis séma generálás
- reconnaissance prompt generálás (`generate_reconnaissance_prompt`)
- review prompt bundle generálás (`generate_review_prompt_bundle`)

### `validator`

- semantic validáció (`validate_semantic_markdown`)
- issue és diagnosztika riportolás
- validation policy (`get_validation_policy`)

### `compiler`

- alkalmazás scaffold generálás
- Spring Boot skeleton generálás
- **Státusz:** MCP szerver kész, az extensionbe nincs bekötve (jövőbeni funkció)

### `java-parser`

- Java AST parsing (`scan_java_project`)
- projekt szintű AST katalógus generálás

### `jqassistant`

- bytecode scan orchestráció (`jqassistant_scan_files`)
- Maven/modul/csomag struktúra kinyerés
- alkalmazás-határ és dependency evidence

### `document-import`

- dokumentum → Markdown konverzió (`convert_document_to_markdown`)
- Confluence oldal letöltés és normalizálás (`fetch_confluence_page`)
- heurisztikus semantic elemzés (`analyze_document_for_semantic`)
- flow és process kinyerés (`extract_application_flows`)
- doc-code alignment ellenőrzés (`validate_doc_code_alignment`)

## Részletes dokumentáció

- [docs/source-import/](source-import/) — Source Import pipeline (java-parser, jqassistant, semantic-core, validator)
- [docs/document-import/](document-import/) — Document Import pipeline (document-import szerver)
- [docs/actions/](actions/) — minden meghívható action és a mögöttük lévő MCP hívások
