# 1. Forrásválasztás

**Hol:** `documentImportView.ts` — `aiNativeDocImport` webview panel

## Lokális fájlok

A drop zone-ra kattintva VSCode natív fájlválasztó nyílik. Szűrő: `pdf, docx, doc, md, markdown, html, htm, txt`.

Több fájl egyszerre is kiválasztható. Minden fájlból egy `ImportItem` jön létre:

```ts
{ kind: 'file', name: string, fsPath: string, ext: string }
```

## Confluence oldalak

URL mező + Add gomb. Az URL-ből egy `ImportItem` jön létre:

```ts
{ kind: 'confluence', name: string, url: string, user?: string, token?: string }
```

**Hitelesítés:** Confluence credentials a panel Confluence credentials szekciójában állítható be:
- **Instance URL** — a Confluence alap URL (pl. `https://wiki.example.com/confluence`)
- **Personal Access Token** — VSCode SecretStorage-ban (OS kulcstárban) tárolódik, restart után is megmarad

A token a Settings panelen is beállítható, de a Document Import panelen közvetlenül is módosítható.

## Futtatás

**▶ Import Documents** gomb — csak akkor aktív, ha legalább egy item a listában van. A gombra kattintva indul a [konverzió](02-conversion.md).

**✦ Analyze with AI** gomb — az importált `.md` fájlokat elemzi Claude-dal és megírja a `source.semantic.md`-t. Akkor is aktív, ha nincs item a listában (a korábban mentett imports fájlokon is futtatható). Lásd: [3. AI analízis](03-analysis.md).
