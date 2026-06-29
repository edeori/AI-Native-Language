# 4. Entitás-akkumuláció

**Hol:** `documentImportView.ts` — az extension oldalán, minden egyes dokumentum sikeres elemzése után

## Miért kell

Az [elemzési lépés (3)](03-analysis.md) egy dokumentumhoz egyszerre csak azt az entitáslistát adja vissza, amit abból a dokumentumból ki tudott nyerni. Ha több dokumentumot importálsz egyszerre (pl. egy architektúra doc + egy API spec + egy LLD), a köztük lévő átfedéseket és az összesített képet az extension oldal aggregálja.

## Hogyan működik

Az extension a teljes import futás alatt egy `accumulatedEntities` objektumot tart fenn, ahol minden kategória egy `Set<string>`:

```ts
const accumulatedEntities: Record<string, Set<string>> = {
  components: new Set(),
  flows:      new Set(),
  apis:       new Set(),
  dataModels: new Set(),
  techStack:  new Set(),
  processes:  new Set(),
};
```

Minden dokumentum sikeres elemzése után az adott dokumentum `entities` mezőjéből érkező tömböket beleadja a megfelelő Set-be:

```ts
for (const key of Object.keys(accumulatedEntities)) {
  const arr = entities[key];
  if (Array.isArray(arr)) {
    arr.forEach((v) => { if (typeof v === 'string') accumulatedEntities[key].add(v); });
  }
}
```

A Set garantálja, hogy ha ugyanaz a komponens neve több dokumentumban is szerepel (pl. `UserService` az architektúra docban és az LLD-ben is), csak egyszer kerül a végső listába.

## Eredmény

Az akkumuláció végén minden Set-et tömbbé alakít és átadja az [5. lépésnek (kimeneti fájlok)](05-outputs.md):

```ts
const docEntities = Object.fromEntries(
  Object.entries(accumulatedEntities).map(([k, s]) => [k, [...s]])
);
```

Ha egy dokumentum feldolgozása hibával végzett, annak entitásai nem kerülnek be — csak a sikeresen feldolgozott dokumentumok entitásai akkumulálódnak.
