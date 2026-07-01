# Document Import — áttekintés

A Document Import panel (`aiNativeDocImport` webview) külső dokumentumokból vagy Confluence oldalakból épít semantic tartalmat.

## Lépések

1. [Forrásválasztás](01-source-selection.md) — fájlok és Confluence URL-ek hozzáadása a panelen
2. [Konverzió Markdownná](02-conversion.md) — PDF/DOCX/HTML/TXT → normalizált Markdown, mentés `.ai-native/imports/` alá (host fájlrendszeren)
3. [AI analízis](03-analysis.md) — **✦ Analyze with AI** gomb: az összes importált `.md` fájlt Claude elemzi, és strukturált `source.semantic.md`-t ír
4. [Downstream: Flow Extraction](07-flow-extraction.md) — flows és processes beépítése a semantic.md-be (önállóan is futtatható)

> A **Doc-Code Alignment** nem a document import flow része — az Actions panelről indítható standalone ellenőrzés.

## Adatfolyam

```
Fájlok / Confluence URL-ek
        │
        ▼
[2] ▶ Import Documents gomb
    convert_document_to_markdown / fetch_confluence_page (Docker MCP szerver)
        │
        ▼
    .ai-native/imports/<name>.md  ← host fájlrendszeren, Claude számára olvasható
        │
        ▼
[3] ✦ Analyze with AI gomb  (vagy: AI Native: Analyze Imported Documents with AI)
    Claude beolvassa az összes imports/*.md fájlt
    → strukturált source.semantic.md (components, interfaces, processes, data_models, dependencies)
        │
        └──▶ [4] Flow Extraction  →  # processes / # data_flows (unió a meglévőkkel)
```

## Két gomb, két lépés

| Gomb | Mit csinál |
|---|---|
| **▶ Import Documents** | Letölti/konvertálja a dokumentumokat, menti `.ai-native/imports/*.md`-be. Nem nyúl a `source.semantic.md`-hez. |
| **✦ Analyze with AI** | Beolvassa az összes `imports/*.md` fájlt, Claude-ot hív, és megírja/frissíti a `source.semantic.md`-t. Command Palette-ből is futtatható: `AI Native: Analyze Imported Documents with AI`. |
