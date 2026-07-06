# Validate semantic

**Command:** `aiNative.validateActiveSemanticMarkdown`  
**Elérés:** **Validation** nézet → **Validate semantic** gomb (vagy Command Palette)

Lefuttatja az MCP validátort az aktív `source.semantic.md`-n.

## Lépések

1. **Validation policy betöltése**: MCP `validator` → `get_validation_policy`
2. **Validáció futtatása**: MCP `validator` → `validate_semantic_markdown` (`persist: true` — a szerver is ment fájlt)
3. **VSCode diagnosztikák**: az issue-k megjelennek szerkesztő figyelmeztetésekként (gap / conflict / warning / violation)
4. **Plain file mentése**: `.ai-native/validation/<slug>.validation.md`
5. **Frissesség-jel mentése**: `.ai-native/validation/<slug>.validation.hash` — az aktuális `source.semantic.md` hash-e. A **Generate Graph** ezt olvassa, hogy stale semantic-ból ne épüljön gráf.
6. **Feedback delta**: `submitFeedbackDelta` → MCP `validator` → `ingest_feedback_delta`
7. **Megnyitás + info üzenet**: `source.semantic.md` megnyílik, értesítés az issue-k számával

## A mentett validation.md tartalma

```
# AI Native Validation
- Source: <path>
- MCP report path: <path>
- MCP summary: gaps=N, conflicts=N, warnings=N, violations=N

## MCP issues
- [severity] code: message

## Retraining delta
- missing sections: ...
- schema gaps: ...
- persistence gaps: ...
- review targets: ...

## Graph signals
- nodes: N
- edges: N
- database schema tables: N
- graph layers: ...

## Delta hints
- ...
```

## Mit ellenőriz a validátor

Részletesen: [docs/source-import/05-validation.md](../source-import/05-validation.md#mit-ellenőriz-a-validátor)

Röviden: section completeness, quality (processes/interfaces/modules), contradictions (rules/security), security policy violations, dependency references, layering.

Státusz: `validated` (tiszta) · `ready` (csak warning) · `draft` (gap/conflict/violation van)

A Generate Graph lépés megköveteli, hogy legyen friss validáció (a `<slug>.validation.hash` frissesség-jel egyezzen az aktuális `source.semantic.md` hash-ével) — ezt a gomb futtatja le.

---

# Doc-code alignment

**Command:** `aiNative.runDocCodeAlignment`  
**Elérés:** **Validation** nézet → **Doc-code alignment** gomb (vagy Command Palette)

Összehasonlítja az **Import Document** által kinyert komponens listát a kódgráfból ismert komponensekkel, és riportot generál.

## Előfeltétel

`.ai-native/doc-entities.json` megléte — ha nem létezik, az extension felajánlja az **Import Document** panel megnyitását.

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
