# 6. AI Analízis — ✦ Analyze with AI

**Hol:** Document Import panel → **✦ Analyze with AI** gomb, vagy Command Palette: `AI Native: Analyze Imported Documents with AI`

## Mikor érdemes futtatni

Az **▶ Import Documents** gomb lefutása után — vagy bármikor, ha a `.ai-native/imports/` mappában vannak `.md` fájlok és frissíteni akarod a `source.semantic.md`-t.

Az analízis **függetlenül futtatható** az import lépéstől: ha korábban már importáltál dokumentumokat és azok megvannak az `imports/` mappában, a gomb azokat is fel tudja dolgozni.

## Konfiguráció szükséglete

A parancs a Settings panelen beállított **AI Review Provider**-t használja (Claude CLI vagy endpoint). Ha nincs AI provider konfigurálva, a parancs figyelmeztetést jelenít meg.

## Mit ad vissza

Claude az összes importált dokumentumból egy teljes `source.semantic.md`-t ír, amely tartalmazza:
- Az összes megtalált komponenst, modult, adatbázis táblát
- Az összes REST API endpointot és event topicot
- Az összes flow-t, folyamatot, migrációs lépést, részletesen
- Az adatokat és azok mozgását a rendszerben
- Az összes külső függőséget

Ha már létezik `source.semantic.md`, Claude azt is megkapja és kibővíti — nem törli a meglévő tartalmat.

## Kapcsolat a régi "AI Review" checkbox-szal

A régi flow-ban volt egy **AI Review** checkbox az Import panelen, ami az import végén automatikusan lefuttatta a kódgráf AI enrichmentjét (`runAiEnrichment`). Ez a checkbox **el lett távolítva** — a kódgráf enrichment csak a source import flow-ban releváns, nem a dokumentum importnál.

Az **✦ Analyze with AI** gomb teljesen más logika: kifejezetten az importált dokumentumok szöveges tartalmát dolgozza fel Claude-dal, és abból ír `source.semantic.md`-t.
