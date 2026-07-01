# 5. Kimeneti fájlok

## ▶ Import Documents lépés után

Az import lépés **csak** a `.ai-native/imports/` mappába ment fájlokat:

```
.ai-native/imports/<safe-name>.md     ← konvertált Markdown (Confluence vagy lokális fájl)
```

- A `source.semantic.md` **nem** kerül írásra ebben a lépésben
- A `doc-entities.json` **nem** keletkezik ebben a lépésben

## ✦ Analyze with AI lépés után

```
.ai-native/source.semantic.md     ← Claude által írt/frissített semantic leírás
```

Ha már létezett `source.semantic.md`, az AI analízis azt is megkapja inputként és gazdagítja — nem törli, hanem enricheli.

## imports/ mappa tartalma

A `.ai-native/imports/` mappában minden importált dokumentum Markdown verziója megtalálható. Ezek:
- Confluence oldalak esetén: a renderelt HTML-ből kinyert, normalizált szöveg
- Lokális fájlok esetén: a konverzió eredménye (PDF szöveg, DOCX tartalom, stb.)

Az `imports/` mappa **nem törlődik** automatikusan újabb import futásakor — az új fájlok hozzáadódnak, a régiek megmaradnak (hacsak a nevük nem egyezik).
