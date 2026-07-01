# 2. Konverzió Markdownná

**Hol:** `document-import` MCP szerver (Docker) → de a fájlt az **extension írja a host fájlrendszerére**

Minden item külön MCP hívással konvertálódik. Az eredmény normalizált Markdown, amit az extension ment el helyben.

## Lokális fájl → `convert_document_to_markdown`

A fájl tartalmát az extension beolvassa és base64-ben küldi az MCP szervernek (`contentBase64` + `fileName`) — a Docker container nem fér hozzá a host fájlrendszerhez, ezért nem `sourcePath`-ot kap.

| Formátum | Feldolgozás |
|---|---|
| `.pdf` | `pdf-parse` library — szöveg kinyerése a PDF binárisból |
| `.docx` | `mammoth` library — raw text kinyerés, formázás nélkül |
| `.doc` | raw UTF-8 olvasás (korlátozott; `.docx` ajánlott) |
| `.html` / `.htm` | raw olvasás, HTML tagek eltávolítva |
| `.md` / `.txt` | közvetlen olvasás |

## Confluence oldal → `fetch_confluence_page`

- Confluence REST API: `GET /rest/api/content/{pageId}?expand=body.storage,body.view,version,space`
- Az URL-ből a numeric page ID-t extráktolja és REST API hívást épít belőle
- Bearer token (Personal Access Token) a `CONFLUENCE_PERSONAL_TOKEN` env változóból vagy az extension által átadott `token` mezőből
- **`body.view`** (renderelt HTML) — elsődleges forrás, macro-mentes
- **`body.storage`** (Confluence Storage Format XML) — fallback, ha `body.view` üres
- HTML strip: táblák, listák megtartva, entitások dekódolva

## Mentés — host fájlrendszeren

Az extension a konvertált Markdown-t **közvetlenül a host fájlrendszerére** menti (nem Docker volume-on keresztül):

```
.ai-native/imports/<safe-name>.md
```

A `safe-name` Confluence oldalakból a page title-ből, fájloknál a fájlnévből képzett URL-safe string.

> Az MCP szerver `persist: false` módban hívódik — a Docker container oldalán **nem** keletkeznek fájlok. Csak a `markdown` mező kerül vissza a válaszban, amit az extension ment el.

## Kimenet az extension felé

A konvertált Markdown visszakerül az extensionhez, ami `importsDir/<safe-name>.md`-be menti. Az import lefutása után az **✦ Analyze with AI** lépés ezeket a fájlokat olvassa be.
