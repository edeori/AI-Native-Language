# 1e. Validáció és verziózott artifactek

**Hol:** `extension.ts` → `importSourceProject()`, a recon prompt után  
**MCP szerver:** `validator` · tool: `validate_semantic_markdown`

## Validáció

Az extension beolvassa a frissen generált `source.semantic.md`-t és ellenőrizteti az MCP validátorral:

```ts
registry.callTool('validator', 'validate_semantic_markdown', {
  content: semanticText,
  policyText: validationPolicy,  // validator MCP: get_validation_policy
  persist: false,
})
```

A validátor ellenőrzi:
- a kötelező szekciók megléte (`# system`, `# intent`, `# context`, `# interfaces`, `# processes`, `# data_flows`, `# dependencies`)
- szekciók minimális tartalma (nem üres)
- belső konzisztencia (pl. `# interfaces`-ben hivatkozott komponens szerepel-e `# processes`-ben)

A validáció eredménye (`gaps`, `conflicts`, `warnings`, `violations`) megjelenik VSCode diagnosztika figyelmeztetésként a megnyíló `source.semantic.md` szerkesztőben.

## Verziózott artifactek

Sikeres futás után az extension három verziózott snapshot-ot ment le a `.ai-native/artifacts/` könyvtárba (`writeVersionedArtifact`):

| Kind | Tartalom |
|---|---|
| `semantic` | `semantic.md`, `semantic.json`, `analysis.json` |
| `databaseSchema` | `database.schema.json`, `database.schema.md` |
| `validation` | `validation.md` (issues, summary, retraining delta) |

Minden artifact-verzió tartalmaz `sourceHash`-t (a `source.semantic.md` tartalmi ujjlenyomata), így a Generate Graph lépés ellenőrizni tudja, hogy a graph generáláshoz használt semantic.md megegyezik-e az utoljára validáltal.

## A validation.md tartalma

A verziózott `validation.md`:
- MCP validátor issue-k listája (severity + kód + üzenet)
- Retraining delta: hiányzó szekciók listája
- Metaadat: forrás path, report path, validation policy forrása

## Mi nyílik meg

A Source Import végén az extension automatikusan megnyitja a `source.semantic.md`-t VSCode szerkesztőben, és a diagnosztika figyelmeztetések azonnal megjelennek.
