# 3. AI analízis — Analyze with AI

**Hol:** `extension.ts` — `runAnalyzeDocImports()` → `commandIds.analyzeDocImports`

Az import lépés (▶ Import Documents) után az **✦ Analyze with AI** gombra kattintva fut le. Command Palette-ből is elérhető: `AI Native: Analyze Imported Documents with AI`.

## Mit csinál

1. Beolvassa az összes `.md` fájlt a `.ai-native/imports/` mappából
2. Beolvassa a meglévő `source.semantic.md`-t (ha van)
3. Felépít egy részletes promptot az összes dokumentum tartalmával
4. Claude-ot hív a konfigurált review provider-en keresztül (`runCloudRawPrompt`)
5. A Claude válaszát közvetlenül a `source.semantic.md`-be írja

## Prompt stratégia

A prompt explicit módon tiltja az eszközhasználatot — Claude csak szöveget ad vissza, nem autonóm ágensként viselkedik:

```
CRITICAL INSTRUCTIONS:
- Output ONLY the raw markdown content. Do NOT use any tools.
  Do NOT write to files. Do NOT explain or summarize anything.
- Extract EVERYTHING: every API, data model, database table, flow,
  migration step, integration, business rule.
- Be exhaustive, not concise.
```

A prompt tartalmazza az összes dokumentum szövegét, és ha már létezik `source.semantic.md`, azt is átadja enrichment-re.

Ha a teljes prompt mérete meghaladja a 180,000 karaktert, csonkítva kerül elküldésre.

## Kimenet formátuma

Claude a következő szekciókat tölti ki a dokumentumok tartalmából:

```markdown
# system
# intent
# context         ← komponensek, tech stack
# interfaces      ← REST API-k, event topicok
# processes       ← flowk, folyamatok, migrációs lépések
# data_flows      ← adatok mozgása a rendszerben
# data_models     ← adatbázis táblák, entitások
# dependencies    ← külső rendszerek, tech függőségek
```

## Heurisztikus elemzés (háttér)

Az MCP szerver `analyze_document_for_semantic` eszköze (regex-alapú heurisztika) megmarad a szerveren, de az import flow már **nem hívja**. Célja: programmatic entity extraction tesztelési vagy integrációs célokra.

## Konfiguráció

Ugyanaz az AI provider és modell, amit a Settings panelen az **AI Review Provider** konfigurál. A parancs csak akkor működik, ha a provider be van állítva (pl. Claude CLI elérhető).
