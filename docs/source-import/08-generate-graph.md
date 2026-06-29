# 4. Generate Graph

**Flow panel:** Step 4 — **Generate Graph**  
**Command:** `aiNative.generateCanonicalGraph`  
**Hol:** `extension.ts` → `runGraphGeneration()`  
**MCP szerver:** `semantic-core` · tool: `generate_canonical_graph`

## Előfeltétel

A Generate Graph lépés ellenőrzi, hogy a `source.semantic.md` frissen validált-e:

1. Megkeresi a legutóbbi validált artifact snapshot-ot (`.ai-native/artifacts/validation/`)
2. Összehasonlítja a snapshot `sourceHash`-ét a jelenlegi `source.semantic.md` tartalmi hash-ével
3. Ha eltérnek → figyelmeztetés: _"The latest validation version is stale. Run Validate input before generating the graph."_

Ha nincs egyáltalán validációs snapshot → _"Graph generation requires a fresh validated version first."_

Ez biztosítja, hogy a gráf mindig egy validált semantic.md-ből készül.

## Mit csinál az MCP szerver

A `generate_canonical_graph` tool:
- Beolvassa a semantic.md teljes tartalmát
- Felépíti a kanonikus szemantikus gráfot: csúcsok = komponensek / interfészek / entitások / folyamatok, élek = függőségek / adatfolyamok / hívásrelációk
- Futtat egy belső validációt is (gaps, conflicts) — ez jelenik meg diagnosztika figyelmeztetésként
- Visszaadja a gráf JSON-t és a validáció összefoglalót

## AI Review (opcionális)

Ha a **Generate Graph** kártyán az **AI Review** checkbox be van jelölve (alapértelmezetten be):

1. Felépít egy `ReviewPromptBundle`-t (`semantic-core` → `generate_review_prompt_bundle`) — most a gráf is bele kerül a kontextusba
2. Lefuttatja a `runAgenticReviewBundle`-t a konfigurált AI providerrel
3. A MCP validátor issue-i **és** az AI review issue-i együtt jelennek meg VSCode diagnosztika figyelmeztetésként (`AI Native Review` label)

Ha az AI Review nincs bejelölve, csak a MCP validátor issue-i kerülnek diagnosztikába, és a gráf preview azonnal megnyílik.

## Kimenetek

**VSCode Diagnostics** — a `source.semantic.md` szerkesztőben megjelenik az összes gap/conflict/warning.

**Graph Preview panel** — `GraphPreviewPanel.show(context, graph, ...)` — a kanonikus gráf interaktív vizualizációja.

**Verziózott artifact:**

```
.ai-native/artifacts/graph/<hash>/
  graph.json
  graph.md
```

**`.ai-native/graph/<timestamp>.graph.json`** — a legfrissebb graph, amelyet a Flow Extraction és a Doc-Code Alignment lépések input-ként használnak.

## Összefoglalás az egész pipeline szempontjából

A Generate Graph az utolsó lépés, de a gráf kimenet visszacsatolódik:
- Flow Extraction (Step 3) felhasználja a gráfot az előző futásból
- Doc-Code Alignment (Actions panel) a gráfból veszi a kód-oldali komponens listát
- A Graph Preview panel a legfrissebb `.graph.json`-t mutatja
