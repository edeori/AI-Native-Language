# 5. Kimeneti fájlok

**Hol:** `documentImportView.ts` — az extension írja, miután minden dokumentum feldolgozásra került

Az extension csak akkor ír kimeneti fájlokat, ha legalább egy dokumentum sikeresen feldolgozódott.

## source.semantic.md

**Útvonal:** `.ai-native/source.semantic.md`

### Ha még nem létezik

Az első dokumentumból teljes semantic.md épül (`buildNewSemanticMd`) a standard sémával:
```
# system
# intent
# context
# interfaces
# processes
# data_flows
# dependencies
```
Az overview szekció első sorai kerülnek az `# intent`-be és `# context`-be. Az összes kinyert komponens, flow, API, stb. a megfelelő szekcióba kerül.

### Ha már létezik — append, nem felülírás

A meglévő `source.semantic.md` tartalomhoz **hozzáfűzés** történik — a meglévő szöveg nem módosul. Minden dokumentumból egy `## Imported: <cím>` szekció kerül be:

```markdown
## Imported: OrderService Architecture

### Components & Modules
- **OrderController**
- **OrderService**

### Flows & Processes
- **checkout flow**

### API Endpoints
- `POST /api/orders`

### Tech Stack
Spring Boot, PostgreSQL
```

**Beillesztési pont:** a `# dependencies` szekció elé kerül (ha létezik), különben a fájl végéhez fűzve.

**Idempotens:** ha az adott dokumentum már importálva volt (`## Imported: <cím>` marker megvan), a lépés nem fut le újra — a fájl változatlan marad.

**Nincs deep merge:** az extension nem értelmezi újra a meglévő szekciókat, nem írja át a korábban kézzel szerkesztett tartalmakat.

### Inkrementális build több dokumentum esetén

Minden dokumentum feldolgozásakor az [elemzési lépés (3)](03-analysis.md) megkapja az előző dokumentum merge-elt eredményét `existingSemanticMd`-ként — így minden dokumentum a már összefésült állapotra épít. Az utolsó dokumentum `mergedSemanticMd` értéke kerül végül a fájlba.

## doc-entities.json

**Útvonal:** `.ai-native/doc-entities.json`

Az összes dokumentumból akkumulált entitások — ez a downstream lépések bemenete.

```json
{
  "components": ["UserService", "OrderController", "PaymentGateway"],
  "flows":      ["checkout flow", "user registration", "payment processing"],
  "apis":       ["POST /api/orders", "GET /api/users/{id}"],
  "dataModels": ["Order", "User", "Product"],
  "techStack":  ["Spring Boot", "PostgreSQL", "Kafka"],
  "processes":  []
}
```

**Felülírás:** ha létezett előző `doc-entities.json` (korábbi import futásból), az aktuális futás eredménye felülírja. Az extension nem merge-eli a régi értékekkel — a fájl mindig az utolsó import futás összesítését tükrözi.

## imports/ mappa (MCP szerver oldal)

Lásd: [02 — Konverzió](02-conversion.md#persist--mindig-megtörténik). Az extension ezeket a fájlokat nem olvassa vissza.
