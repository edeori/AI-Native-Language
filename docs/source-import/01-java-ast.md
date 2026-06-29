# 1a. Java AST parsing

**Hol:** `extension.ts` → `importSourceProject()` → `collectWorkspaceJavaAstProject()`  
**MCP szerver:** `java-parser` · tool: `scan_java_project`

## Cél

A workspace összes `.java` fájljából AST (Abstract Syntax Tree) katalógust épít. Ez az alapja a determinisztikus projekt-analízisnek: minden downstream lépés az AST adatból indul ki.

## Cache

Az extension először megkeresi a már létező `.ai-native/source.ast.json` fájlt (`loadCachedJavaAstProject`). Ha megvan, újraparsing nélkül újrahasználja. Ez lehetővé teszi, hogy a Semantic Enrichment vagy a Graph Generation lépés a korábban parseolt katalógust vegye alapul, ha a forráskód nem változott.

Ha a fájl nem létezik vagy nem olvasható, a `collectWorkspaceJavaAstProject` lefut és meghívja az MCP szervert.

## Mit csinál az MCP szerver

A `java-parser` MCP szerver megkapja az összes `.java` fájl tartalmát és elérési útját. Minden fájlból kivonja:
- osztályok, interfészek, enumok, annotáció-típusok
- mezők (típus, módosítók, annotációk)
- metódusok (szignatúra, visszatérési típus, annotációk, paraméterek)
- importált csomagok
- class-szintű annotációk (`@RestController`, `@Service`, `@Repository`, `@Entity`, stb.)

Visszaad egy `JavaAstProject`-et:
```ts
{
  projectName: string,
  fileCount: number,
  summary: { totalClasses, totalMethods, ... },
  catalog: JavaAstFile[]   // egy elem per .java fájl
}
```

## Kimenet

Az AST katalóg kiírásra kerül: `.ai-native/source.ast.json`

A `javaAstCatalog` (a `catalog` tömb) átadásra kerül az `importSourceProjectState`-nek, hogy a shared library ne parseolja újra a fájlokat — csak az eredményt veszi át.

## Ha nincs Java fájl

Ha a workspace nem tartalmaz Java fájlokat (vagy az MCP szerver nem elérhető), a `javaAstProject` `undefined` marad. A folyamat folytatódik üres AST katalóggal — a downstream analízis kevesebb adatból dolgozik, de nem áll le.
