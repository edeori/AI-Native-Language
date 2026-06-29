# 1c. Projekt-analízis és gráfépítés

**Hol:** `mcp-servers/shared/src/source-learning.ts` → `importSourceProjectState()`  
**Csomag:** `@ai-native/semantic-shared` (in-process, nem MCP hívás)

Ez a fő munkafázis. A shared library az extension Node.js folyamatán belül fut — nem HTTP hívás, hanem közvetlen függvényhívás. Az összes determinisztikus + AI enrichment lépés itt zajlik.

## Opciók

| Opció | Forrás a UI-ból |
|---|---|
| `enableOllamaEnrichment` | Flow panel: **Local AI Agents** checkbox |
| `enableCloudEnrichment` | Flow panel: **Cloud AI** checkbox (`sourceCloudEnabled`) |
| `cloudAgentRunner` | Ha `sourceCloudEnabled`, az extension egy closure-t ad át, ami `runCloudRawPrompt`-ot hív |
| `resumeFromStage` | Ha csak Semantic Enrichment fut, `'semantic'` stage-ről folytatódik |
| `javaAstCatalog` | Az [1a lépés](01-java-ast.md) eredménye |
| `jqassistantArtifact` | Az [1b lépés](02-jqassistant.md) eredménye |

## Belső szakaszok sorrendben

### a) analyzeProject — determinisztikus projekt-analízis

Bejárja a projekt fájlrendszerét és az AST katalógust:
- Osztályok csoportosítása csomagok szerint (modul-határok detektálása)
- Spring annotációk (`@RestController`, `@Service`, `@Repository`, `@Entity`, `@Component`) alapján layer-ek
- SQL migrációs fájlok (`*.sql`, Flyway) megtalálása
- Konfigurációs fájlok (`application.yml`, `application.properties`) felismerése
- `pom.xml` dependency gráf (modulok közötti függőségek Maven szinten)
- `ModuleDossier`-ek felépítése (egy dossier = egy Maven modul vagy csomag-csoport)

### b) AST komponens-osztályozás (opcionális AI)

Ha `enableOllamaEnrichment` vagy `enableCloudEnrichment` aktív:
- `astComponentClassifier` agent — az AST osztályok neve + annotációi alapján meghatározza a funkcionális szerepet (pl. `UserService` → `user-management` domain, `payment` context)

### c) applyJqassistantEvidence

Beépíti a jQAssistant bytecode-szintű adatokat az analízisbe:
- Bytecode-ban megtalált függőségek, amelyek a forráskódból nem látszanak
- Modulok közötti tényleges hívások

### d) Repository purpose (opcionális AI)

Ha AI engedélyezve: `repositoryPurpose` agent — minden `@Repository` osztályhoz meghatározza a tárolt entitást és a célt.

### e) SQL migration semantics (opcionális AI)

Ha AI engedélyezve: `sqlMigrationSemantics` agent — a Flyway/Liquibase SQL fájlokból kinyeri az entitás-neveket, tábla-mezőket, schema evolúciót.

### f) buildDeterministicGraphArtifacts — kódgráf és support struktúrák

Ez az in-process graph builder (korábban ez volt a törölt `deterministic-graph` MCP szerver):
- `CodeKnowledgeGraph` — csúcsok (osztályok) és élek (hívások, függőségek)
- `AstIndexArtifact` — gyors lookup struktúra az AST-hoz
- `JqassistantSupportArtifact` — jQA adatok normalizált formában
- `SupportGraphArtifact` — kombinált support gráf
- `GraphPreviewMetadata` — UI preview metaadat
- `ComponentMapArtifact` — komponens → csoport mapping
- `FlowMapArtifact` — determinisztikus flow map (Controller → Service → Repository láncolások)

Progress callback-eken (`onCodeGraphProgress`, `onLifecycleProgress`) keresztül értesíti az extensiont a haladásról (4 mp-es heartbeat is fut közben a ReconRun snapshotba).

### g) Flow candidate slices (opcionális AI)

Ha AI engedélyezve: `flowCandidate` agent — a kódgráfból kiemelt flow szeletek értelmezése (pl. egy komplex tranzakció-lánc leírása).

### h) Component packaging (opcionális AI)

Ha AI engedélyezve: `componentPackaging` agent — a modulok és komponensek csomagolási mintáinak értelmezése.

### i) Semantic polishing (opcionális AI)

Ha AI engedélyezve: `semanticPolishing` agent — a generált `source.semantic.md` szöveges finomítása.

### j) Artifact írás

Kiírja az összes intermediate és végső artifactet (lásd [00-overview.md](00-overview.md) táblázat).

## Kimenet visszafelé

Az `importSourceProjectState` egy `SourceLearningResult` objektumot ad vissza, amely tartalmazza az összes artifact elérési útját. Az extension ezeket a path-okat használja a [recon prompt](04-recon-prompt.md) és [validáció](05-validation.md) lépésekhez.
