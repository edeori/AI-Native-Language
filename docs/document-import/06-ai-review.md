# 6. AI Review (opcionális)

**Hol:** `documentImportView.ts` → `commandIds.runAiEnrichment` → `runAiEnrichment()` az `extension.ts`-ben

## Mikor fut le

Ha a Document Import panelen be van jelölve az **AI Review** checkbox, az import végén — miután a `source.semantic.md` és `doc-entities.json` kiírásra kerültek — az extension automatikusan lefuttatja a cloud AI enrichment passt.

## Mit csinál

Az `runAiEnrichment` command `cloudEnabled: true` módban fut:

1. Beolvassa a frissen írt `.ai-native/source.semantic.md`-t
2. Betölti a validation policy-t a `validator` MCP szerverről (`get_validation_policy`)
3. Felépít egy review prompt bundle-t a `semanticCore`-tól (`generate_review_prompt_bundle`) — ez tartalmazza az architecture, flow, data model, consistency és merge promptokat
4. Lefuttatja a `runAgenticReviewBundle`-t a konfigurált AI providerrel (Claude vagy Codex)

## Mit nem csinál

Ez a lépés **nem írja vissza** a `source.semantic.md`-t — az enrichment eredménye csak artifact-ként kerül elmentésre. Célja a semantic leírás minőségének cloud AI-val való értékelése, nem automatikus felülírása.

## Konfiguráció

Az AI provider és modell a Settings panelen konfigurálható (Settings → AI Review Provider). Ugyanaz a konfiguráció, amit a Flow panel többi cloud AI lépése is használ.

## Ha nincs bejelölve

Ha az AI Review nincs bejelölve, az import a `doc-entities.json` és `source.semantic.md` írásával véget ér. A cloud AI pass később manuálisan is lefuttatható a Flow panel **Semantic Enrichment** lépésével.
