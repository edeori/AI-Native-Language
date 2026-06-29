# 3. Heurisztikus elemzés

**Hol:** `document-import` MCP szerver — `analyze_document_for_semantic`

A konvertált Markdownból determinisztikusan (AI nélkül) vonja ki a semantic releváns entitásokat, majd ezekből semantic.md patche-t vagy teljes semantic.md draft-ot generál.

## 3a. Szekciók parse-olása

`parseSections` — H1–H6 fejlécek alapján szekció-fa: `{ level, title, content }`.

## 3b. Entitás-kinyerés

### components
Két forrásból:
- Szekciófejlécek ahol a cím tartalmaz valamelyik suffixet (45+ minta): `Service`, `Module`, `Component`, `Controller`, `Repository`, `Gateway`, `Handler`, `Manager`, `Adapter`, `Engine`, `Processor`, `Worker`, `Scheduler`, `Cache`, `Store`, `Bus`, `Broker`, `Queue`, `Connector`, `Proxy`, stb.
- Szövegben előforduló `XService`, `XController`, `XRepository` stb. CamelCase nevek regex-szel

Max 40 eredmény, 3–80 karakter között.

### flows
- Szekciófejlécek ahol flow-kulcsszó van: `flow`, `process`, `sequence`, `workflow`, `pipeline`, `lifecycle`, `authentication`, `authorization`, `checkout`, `payment`, `onboarding`, `notification`, `event processing`, `batch`, `migration`, stb.
- Tartalom alapján: ha numbered list vagy Step/First/Then/Finally kezdetű sorok vannak → az adott szekció egy flow
- Tartalom alapján: ha `→`, `->`, `=>`, `>>` nyíl-minták vannak → flow-leíró szekció

Max 20 eredmény.

### apis
- REST endpoint minták: `GET /path`, `POST /path`, `PUT`, `DELETE`, `PATCH`, stb.
- Backtick-es útvonalak: `` `/api/users/{id}` ``, `` `/v2/orders` ``

Max 30 eredmény.

### dataModels
- Markdown táblát tartalmazó szekciók (szekciócím = entitásnév)
- `CREATE TABLE IF NOT EXISTS X` SQL minták
- `Entity: X`, `Table: X`, `Model: X` inline minták

Max 20 eredmény.

### techStack
~80 technológia hardcoded névsora elleni case-insensitive egyezés. Néhány példa: Spring Boot, Spring Security, Hibernate, JPA, Flyway, Kafka, RabbitMQ, Redis, PostgreSQL, MySQL, MongoDB, Docker, Kubernetes, AWS, gRPC, GraphQL, OAuth2, JWT, React, Vue, Gradle, Maven, Java, Kotlin, Go, Python, TypeScript.

## 3c. Dokumentum-típus felismerés

`detectDocKind` — az entitások arányából:

| Típus | Feltétel |
|---|---|
| `api-spec` | sok API (>5), kevés komponens (<3) |
| `lld` | részletes szekciók (`detail`, `implementation`, `class`, `method`, `algorithm`) + komponensek |
| `architecture` | sok komponens (>3) + flows (>1) |
| `mixed` | components + flows + apis összesen >2 |
| `technical-description` | alapértelmezett |

## 3d. Semantic patch generálás

`buildSemanticPatch` — strukturált Markdown szekciót épít:

```markdown
## Imported: <docTitle>

<overview szekció első 6 sora, ha van>

### Components & Modules
- **UserService**
- **OrderController**

### Flows & Processes
- **checkout flow** — User selects items and proceeds to payment...

### API Endpoints
- `POST /api/orders`
- `GET /api/users/{id}`

### Data Models
- **Order**
- **User**

### Tech Stack
Spring Boot, PostgreSQL, Kafka
```

## 3e. Merge meglévő semantic.md-be (vagy új létrehozása)

**Ha van meglévő `source.semantic.md`:**

`mergeIntoExisting` — a patch-et a `# dependencies` szekció elé szúrja be, vagy a fájl végére fűzi. Ha az adott dokumentum már importálva volt (az `## Imported: <cím>` marker megvan), újra nem kerül be — idempotens.

**Ha nincs meglévő `source.semantic.md`:**

`buildNewSemanticMd` — teljes semantic.md-t épít a standard sémával:

```
# system
# intent
# context
# interfaces
# processes
# data_flows
# dependencies
```

Az overview szekció tartalmából tölti fel az `# intent`-et és a `# context`-et.

## Kimenet

```json
{
  "ok": true,
  "docTitle": "...",
  "docKind": "architecture",
  "mode": "enrich",
  "entities": {
    "components": [...],
    "flows": [...],
    "apis": [...],
    "dataModels": [...],
    "techStack": [...]
  },
  "semanticPatch": "## Imported: ...",
  "mergedSemanticMd": "# system\n..."
}
```

Az extension a `mergedSemanticMd` mezőt veszi át, és ezt adja be a következő dokumentum elemzésébe mint `existingSemanticMd` — tehát minden dokumentum a már merge-elt állapotra épít.
