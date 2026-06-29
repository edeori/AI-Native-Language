# 3. Flow Extraction

**Flow panel:** Step 3 — **Flow Extraction**  
**Command:** `aiNative.runFlowExtraction`  
**Hol:** `extension.ts` → `runFlowExtraction()`  
**MCP szerver:** `document-import` · tool: `extract_application_flows`

## Bemenet

| Fájl | Kötelező | Forrás |
|---|---|---|
| `.ai-native/source.semantic.md` | igen | Source Import (Step 1) |
| `.ai-native/doc-entities.json` | nem | Document Import (ha volt) |
| `.ai-native/graph/<latest>.graph.json` | nem | Generate Graph (Step 4 előző futásból) |

Ha a `doc-entities.json` nem létezik, a lépés csak a semantic.md és az esetleges gráf alapján dolgozik.

## Mit csinál

Az MCP szerver a `# processes` és `# data_flows` szekciókba beépíti:

**Kódgráfból:** Controller → Service → Repository láncolások: `"<domain> request flow: <Controller> → <Service1>"`

**doc-entities.json-ból:** a Document Import során kinyert flows és processes listák

**Meglévő semantic.md-ből:** az aktuálisan megírt `# processes` / `# data_flows` tartalmak (hogy ne veszítse el a kézzel írt leírásokat)

## Extension oldali lépések

1. Frissíti a `source.semantic.md`-t a visszakapott `updatedSemanticMd`-vel
2. Ha volt `doc-entities.json`, merge-eli vissza az újonnan kinyert flow/process bejegyzéseket (Set-dedup)

## AI Synthesis (opcionális)

Ha a Flow Extraction kártyán az **AI Synthesis** checkbox be van jelölve, a determinisztikus merge után egy `runAgenticReviewBundle` pass is lefut: cloud AI értelmezi és gazdagítja a `# processes` és `# data_flows` szekciók tartalmát.

## Részletes dokumentáció

Az MCP szerver (`extract_application_flows`) belső működését részletesen lásd: [document-import/07-flow-extraction.md](../document-import/07-flow-extraction.md)
