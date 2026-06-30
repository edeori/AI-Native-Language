# Maven multi-module Spring Boot — structural conventions

MCP tool: `get_maven_project_conventions`  
Triggered automatically when: `isCreating` topic detected — no button, no manual call needed.

**Trigger kulcsszavak** (magyar és angol egyaránt):
`új`, `new`, `create`, `létrehoz`, `hozz létre`, `implement`, `implementálj`, `készíts`, `készítsd el`, `fejleszd`, `valósítsd meg`, `írd meg`, `generate`, `scaffold`, `modul`, `module`, `fejlessz`, `csináld meg`

---

## Module layout

```
{root-app}/                        ← parent POM (aggregator)
  versions/                        ← BUILD: Java + library version properties ONLY
  bom/                             ← BUILD: spring-boot-dependencies import + extra dep pins
  app/                             ← BUILD: plugin management + internal dep management (POM only, no src)
  api/                             ← RUNTIME: OpenAPI YAML-first → generated interfaces + DTOs
  common/                          ← RUNTIME: shared security / JWT / cross-cutting infra
  persistence/                     ← RUNTIME: JPA entities + Spring Data repositories
  service/                         ← RUNTIME: business logic services
  web/                             ← RUNTIME: REST controllers implementing api interfaces
  build/                           ← RUNTIME: @SpringBootApplication + application.yml + Flyway + spring-boot-maven-plugin → fat JAR
```

**Kulcsszabály:** a futtatható JAR a `build` modulból kerül ki, nem az `app`-ból.  
Az `app` POM-only koordinátor — plugin management, belső dep management.

## POM parent chain

```
versions  ← bom
versions  ← app
app       ← api, common, persistence, service, web, build
```

Új runtime modul `<parent>`-je mindig `app`. Hozzá kell adni:
1. root parent POM `<modules>` listához
2. `app/pom.xml` `<dependencyManagement>` blokkhoz

## Dependency chain

```
build → web → service → persistence → common
                    ↘ api ↗
```

- `api` és `common` nem függnek belső moduloktól
- `persistence`: api + common
- `service`: persistence + api + common
- `web`: api + service
- `build`: web (minden tranzitívan bejön)

## Package naming

| Modul         | Base package                         | Tartalom                                        |
|---------------|--------------------------------------|-------------------------------------------------|
| `api`         | `{groupId}.api`                      | OpenAPI-generált `*Api` Spring interfészek      |
|               | `{groupId}.dto`                      | OpenAPI-generált DTOs (Lombok + Jackson)        |
| `common`      | `{groupId}.common.security`          | SecurityConfig, JWT osztályok                   |
|               | `{groupId}.common.{domain}`          | Megosztott utility-k                            |
| `persistence` | `{groupId}.persistence.entity`       | `@Entity` osztályok                             |
|               | `{groupId}.persistence.repository`   | `*Repository extends JpaRepository<T, ID>`      |
| `service`     | `{groupId}.service.{domain}`         | `*Service` + `*ServiceImpl`                     |
|               | `{groupId}.service.jobs`             | `*Job` (scheduled feladatok)                    |
| `web`         | `{groupId}.web.controller`           | `*ApiImpl implements *Api`                      |
|               | `{groupId}.web.config`               | `*Config`, `*Properties`                        |
| `build`       | `{groupId}`                          | `*Application` (@SpringBootApplication main)    |
|               | `{groupId}.config`                   | App-szintű @Configuration beanek               |

## API-first pattern

1. Endpoint definiálása: `api/src/main/resources/openapi/{name}.yaml`
2. `mvn generate-sources` → generál `*Api` interfészeket + DTO-kat
3. Implementálás `web`-ben: `class FooApiImpl implements FooApi { ... }`
4. Service interfész `service`-ben vagy `common`-ban, impl `*ServiceImpl`

## DB migrációk (Flyway)

Hely: `build/src/main/resources/db/migration/V{n}__{leírás}.sql`  
Névképzés: `V1__init.sql`, `V2__add_user_table.sql`

## Verziókezelés

- Új dep verzió property → `versions/pom.xml` `<properties>`
- Új dep pin → `bom/pom.xml` `<dependencyManagement>`
- Modul pom-okban **soha** ne legyen hardkódolt verzió — mindig BOM-on keresztül
- Lombok ki van zárva a spring-boot-dependencies BOM-ból, explicit pin kell `bom/pom.xml`-ben

## Referencia verziók (mindig a legújabb kompatibilis Spring Boot 3.x-szel)

| Dependency          | Referencia verzió | Megjegyzés                                     |
|---------------------|-------------------|------------------------------------------------|
| Java                | 21                | LTS, record/sealed ahol indokolt               |
| Spring Boot         | 3.3.x+            | Jakarta EE (`jakarta.*`, soha nem `javax.*`)   |
| springdoc-openapi   | 2.6.x+            | `springdoc-openapi-starter-webmvc-ui`          |
| PostgreSQL driver   | 42.7.x+           |                                                |
| Lombok              | 1.18.x+           | `scope: provided` mindenhol                    |
| jjwt                | 0.12.x+           | api + impl (runtime) + jackson (runtime)       |
| AWS SDK v2          | 2.x (latest)      | `software.amazon.awssdk:{service}`             |
| Flyway              | Spring BOM-ból    | + `flyway-database-postgresql` PG-hez          |
| openapi-generator   | 7.x (latest)      | Maven plugin                                   |
