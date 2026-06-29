# 2. Semantic Enrichment

**Flow panel:** Step 2 — **Semantic Enrichment**  
**Command:** `aiNative.runAiEnrichment`  
**Hol:** `extension.ts` → `runAiEnrichment()`

## Mire való

Az [1c — importSourceProjectState](03-analysis.md) által generált `source.semantic.md` determinisztikusan épül fel az AST-ból. A Semantic Enrichment lépés cloud AI (vagy lokális Ollama) agent-eket futtat erre az alapra, hogy gazdagabb, kontextuálisabb leírást hozzon létre.

## Konfiguráció (Flow panel kártyán)

| Checkbox | Leírás |
|---|---|
| **Local AI Agents** (`semanticLocalEnabled`) | Ollama enrichment: `importSourceProjectState` résumption `'semantic'` stage-ről |
| **Cloud AI** (`semanticCloudEnabled`) | `runAgenticReviewBundle` a konfigurált cloud AI providerrel |

## Cloud AI ág (`cloudEnabled: true`)

1. Beolvassa `.ai-native/source.semantic.md`-t (a meglévő generált tartalmat)
2. Betölti a validation policy szöveget a `validator` MCP szerverről
3. Felépít egy `ReviewPromptBundle`-t a `semantic-core` MCP szervertől (`generate_review_prompt_bundle`):
   - architecture review prompt
   - flow review prompt
   - data model review prompt
   - consistency review prompt
   - merge prompt (az összes review eredményét kombinálja)
4. Lefuttatja a `runAgenticReviewBundle`-t:
   - HTTP kérés a konfigurált AI provider-nek (Claude / Codex / custom command)
   - A review eredménye artifact-ként mentődik el (nem írja felül automatikusan a `source.semantic.md`-t)
   - A artifacts panel frissül

## Lokális Ollama ág (`ollamaEnabled: true`)

Az `importSourceProjectState` `resumeFromStage: 'semantic'` opcióval fut újra — kihagyja az analízis és gráfépítés fázisait, és közvetlenül a semantic polishing agenteket futtatja Ollama-n keresztül. Ez felülírja a `source.semantic.md`-t.

## Különbség a Source Import AI enrichment-jéhez képest

A Source Import (Step 1) is tartalmazhat AI enrichment lépéseket (`enableOllamaEnrichment` / `enableCloudEnrichment`) az `importSourceProjectState` belsejében. A Semantic Enrichment (Step 2) ettől független: akkor is futtatható standalone, ha a Source Import AI enrichment nélkül ment le, vagy ha a `source.semantic.md` manuálisan szerkesztve lett.
