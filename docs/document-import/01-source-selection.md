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

Hitelesítés: ha a Confluence szerver nem nyilvános, `user` + `token` (Basic Auth) szükséges. Ezeket közvetlenül a panelen lehet megadni, nem a Settings-ben tárolódnak.

## AI Review checkbox

A futtatás előtt bekapcsolható az **AI Review** opció. Ha be van jelölve, az import végén automatikusan lefut egy cloud AI enrichment pass a `source.semantic.md`-n. Lásd: [6. AI Review](06-ai-review.md).

## Futtatás

Az **Import into Semantic** gomb csak akkor aktív, ha legalább egy item a listában van. A gombra kattintva indul a [konverzió](02-conversion.md).
