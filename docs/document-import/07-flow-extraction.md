# 7. Downstream: Flow Extraction

**Hol:** Flow panel → Step 3 — önállóan is futtatható, nem a document import közvetlen része  
**Command:** `aiNative.runFlowExtraction`  
**MCP szerver:** `document-import` · tool: `extract_application_flows`

## Bemenet

| Fájl | Kötelező | Forrás |
|---|---|---|
| `.ai-native/source.semantic.md` | igen | Document Import [5. lépés](05-outputs.md) vagy Source Import |
| `.ai-native/doc-entities.json` | nem | Document Import [5. lépés](05-outputs.md) |
| `.ai-native/graph/<latest>.graph.json` | nem | Generate Graph lépés |

Ha a `doc-entities.json` nem létezik (nem volt document import), csak a semantic.md és az esetleges gráf alapján dolgozik.

## Meglévő semantic.md kezelése — unió, nem felülírás

A `# processes` és `# data_flows` szekciók tartalma **nem törlődik ki** — a meglévő bejegyzések megmaradnak, az újak hozzáadódnak.

Az MCP szerver a szekciók frissítése előtt kiolvassa a meglévő `# processes` és `# data_flows` tartalmakat, és ezeket beépíti az összesítésbe:

```
meglévő processes + doc-entities.flows + kódgráfból kinyert flow-ok
          ↓ deduplikálva
  új # processes szekció
```

Így a kézzel szerkesztett vagy korábbi import által írt bejegyzések nem vesznek el.

## Flows összegyűjtése

**Meglévő semantic.md-ből:** a `# processes` és `# data_flows` szekciók sorai

**doc-entities.json-ból (ha van):**
- `docEntities.flows` → flowSet
- `docEntities.processes` → processSet

**Kódgráfból (ha van):**
- `*Controller` node-ok → általuk hívott service-ek láncolata: `"<domain> request flow: <Controller> → <Service1>"`
- `*Repository` node-ok → `"<domain> persistence"` process bejegyzések

## Kimenet

**Frissített `.ai-native/source.semantic.md`** — a `# processes` és `# data_flows` szekciók az unióval feltöltve. Ha ezek a szekciók nem léteznek, hozzáfűzve a fájl végéhez.

**Frissített `.ai-native/doc-entities.json`** — az extension visszaírja, kiegészítve az újonnan kinyert flows/processes értékekkel (Set-alapú dedup a meglévőkkel).

**Flow panel feedback** — az eredmény megjelenik a Flow Extraction kártyán: `X flow(s), Y process(es) — docs: N, graph: N, existing: N`.

## AI Synthesis (opcionális)

Ha a Flow Extraction kártyán az **AI Synthesis** be van kapcsolva, a determinisztikus unió után egy `runAgenticReviewBundle` pass is lefut: cloud AI értelmezi és gazdagítja a `# processes` és `# data_flows` szekciók tartalmát.
