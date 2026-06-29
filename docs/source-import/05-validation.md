# 1e. Validáció és verziózott artifactek

**Hol:** `extension.ts` → `importSourceProject()`, a recon prompt után  
**MCP szerver:** `validator` · tool: `validate_semantic_markdown`

## Validáció

Az extension beolvassa a frissen generált `source.semantic.md`-t és ellenőrizteti az MCP validátorral:

```ts
registry.callTool('validator', 'validate_semantic_markdown', {
  content: semanticText,
  policyText: validationPolicy,  // validator MCP: get_validation_policy
  persist: false,                // Source Import: nem ment fájlt a szerveren
})
```

### Mit ellenőriz a validátor

A `validateSemanticDocument` hat függvényt futtat sorban:

| Függvény | Mit néz |
|---|---|
| `assessSectionCompleteness` | kötelező szekciók megléte; üres szekciók |
| `assessQuality` | vannak-e processzek + interfészek; enterprise jellegű-e de nincs `# modules`; van-e persistence szándék de nincs DB séma |
| `assessContradictions` | egymásnak ellentmondó allow/deny szabályok a `# rules`-ban; SSO engedélyezve és letiltva egyszerre |
| `assessSecurity` | user-facing slice auth nélkül; access control authz nélkül; policy követelmény megsértése |
| `assessDependencies` | `# dependencies`-ben felsorolt elem nincs hivatkozva `# processes`-ben vagy `# interfaces`-ben |
| `assessLayering` | service réteg client adaptert/DTO-t tartalmaz; event ownership split |

### Kötelező szekciók

Az összes KNOWN_SECTION hiányként jelenik meg, ha nem szerepel a fájlban:

`# system` · `# intent` · `# context` · `# interfaces` · `# data_flows` · `# processes` · `# rules` · `# security` · `# dependencies` · `# examples` · `# acceptance_criteria`

### Validáció státusza

| Státusz | Feltétel |
|---|---|
| `draft` | van legalább egy gap / conflict / violation |
| `ready` | csak warning van |
| `validated` | nincs issue |

Az issue típusai: `gap` · `conflict` · `warning` · `violation`

A validáció eredménye megjelenik VSCode diagnosztika figyelmeztetésként a megnyíló `source.semantic.md` szerkesztőben.

## Verziózott artifactek

Futás után az extension három verziózott snapshot-ot ment le a `.ai-native/artifacts/` könyvtárba (`writeVersionedArtifact`):

| Kind | Fájlok |
|---|---|
| `semantic` | `semantic.md`, `semantic.json`, `analysis.json` |
| `databaseSchema` | `database.schema.json`, `database.schema.md` |
| `validation` | `validation.md` |

Minden artifact-verzió tartalmaz `sourceHash`-t (a `source.semantic.md` tartalmi ujjlenyomata), így a Generate Graph lépés ellenőrizni tudja, hogy a graph generáláshoz használt semantic.md megegyezik-e az utoljára validáltal.

### A validation.md tartalma (Source Import kontextus)

```
# AI Native Validation
- Source: <path>
- MCP report path: <path vagy n/a>
- MCP summary: gaps=N, conflicts=N, warnings=N, violations=N

## MCP issues
- [severity] code: message

## Retraining delta
- missing sections: <lista vagy none>
```

> A standalone "Validate semantic" gomb által mentett validation.md részletesebb: graph signals (node/edge count, DB schema tables, layers), delta hints, schema gaps, persistence gaps, review targets.

## Mi nyílik meg

A Source Import végén az extension:
1. Megnyitja a `source.semantic.md`-t VSCode szerkesztőben — a diagnosztika figyelmeztetések azonnal megjelennek
2. Best-effort: ha létezik verziózott graph artifact, megnyitja a `GraphPreviewPanel`-t is
3. Info üzenet: "Imported source workspace into .ai-native"
