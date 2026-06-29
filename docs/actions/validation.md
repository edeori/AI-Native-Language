# Validate semantic

**Command:** `aiNative.validateActiveSemanticMarkdown`  
**Elérés:** Actions panel → Validation szekció gomb

Lefuttatja az MCP validátort az aktív `source.semantic.md`-n.

1. Verziós checkpoint: ha a fájl változott az utolsó snapshot óta, automatikusan elmenti az aktuális állapotot
2. MCP hívás: `validator` → `validate_semantic_markdown` (policy: `get_validation_policy`)
3. A validáció issue-i megjelennek VSCode diagnosztika figyelmeztetésekként a szerkesztőben (gap / conflict / warning / violation)
4. Artifact mentése: `.ai-native/validation/<slug>.validation.md`

A Generate Graph lépés megköveteli, hogy legyen friss validációs snapshot (sourceHash egyezés) — ezt a gomb futtatja le.

---

# Doc-code alignment

**Command:** `aiNative.runDocCodeAlignment`  
**Elérés:** Actions panel → Validation szekció gomb

Összehasonlítja a Document Import által kinyert komponens listát a kódgráfból ismert komponensekkel, és riportot generál.

## Előfeltétel

`.ai-native/doc-entities.json` megléte — ha nem létezik, az extension felajánlja a Document Import panel megnyitását.

## Lépések

1. Ellenőrzi a `doc-entities.json` meglétét
2. MCP hívás: `documentImport` → `validate_doc_code_alignment` (bemenet: `docEntitiesPath` + `artifactRoot`)
3. A szerver betölti a `doc-entities.json`-t és a legutóbbi graph JSON-t
4. Riport mentése: `.ai-native/alignment/<timestamp>.alignment.md`
5. Értesítés: információs ablak **Open Report** gombbal

## Riport tartalma

```markdown
# Doc-Code Alignment Report

## Summary
- Documented components: N
- Code components checked: N
- Matched: N
- In docs, not in code: N
- In code, not documented: N

## Matched          ← dokumentált és kódban is megvan
## In docs only     ← dokumentált, de kódban nem azonosítható
## In code only     ← kódban van (*Service/*Controller stb.), de nem dokumentált
## Documented flows ← az összes dokumentált folyamat
```
