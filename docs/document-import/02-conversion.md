# 2. Konverzió Markdownná

**Hol:** `document-import` MCP szerver — `mcp-servers/document-import/src/index.ts`

Minden item külön MCP hívással konvertálódik. Az eredmény mindig normalizált Markdown.

## Lokális fájl → `convert_document_to_markdown`

| Formátum | Feldolgozás |
|---|---|
| `.pdf` | `pdf-parse` library — szöveg kinyerése a PDF binárisból |
| `.docx` | `mammoth` library — raw text kinyerés, formázás nélkül |
| `.doc` | raw UTF-8 olvasás (korlátozott; `.docx` ajánlott) |
| `.html` / `.htm` | raw olvasás, HTML tagek eltávolítva |
| `.md` / `.txt` | közvetlen olvasás |

A nyers szövegből normalizált Markdown készül (`normalizeToMarkdown`):
- `\r\n` → `\n`
- hármas+ üressor → kettős üressor
- `# <fájlnév>` fejléc a tetején

## Confluence oldal → `fetch_confluence_page`

- Confluence REST API hívás: `GET /rest/api/content/{pageId}?expand=body.storage,version,space`
- Ha csak URL áll rendelkezésre (nem pageId), az URL-t direkt kéri le
- Basic Auth header ha `user` + `token` meg van adva
- Structured macro blokkok eltávolítása (`<ac:structured-macro>`)
- HTML tagek strip-elése, whitespace normalizálás
- Ugyanaz a `normalizeToMarkdown` pass, mint a lokális fájloknál

## Persist — mindig megtörténik

Az MCP szerver **minden konverzió után automatikusan** menti a kimenetet a `.ai-native/imports/` alá (`persist` alapértéke `true`, az extension nem kapcsolja ki):

```
.ai-native/imports/<name>.md               ← a Markdown verzió
.ai-native/imports/<name>.txt              ← a nyers szöveg
.ai-native/imports/<name>.import-manifest.json  ← metaadat
```

A manifest tartalmazza: forrás útvonal, formátum, Markdown path, szöveg path, figyelmeztetések (pl. PDF-ből nagyon kevés szöveg jött ki, `.doc` konverzió korlátozott).

## Kimenet az extension felé

A konvertált Markdown átadódik az [elemzési lépésnek](03-analysis.md). Az extension a `markdown` mezőt veszi át a válaszból — a `.ai-native/imports/` fájlokat nem olvassa vissza, azok archív másolatok.
