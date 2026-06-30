# Compiler MCP server — áttekintés

Az `ai-native-compiler` MCP szerver felelős a projekt generáláshoz és strukturális konvenciókhoz kapcsolódó tudásért. A development panel AI agentje automatikusan hívja ezeket a toolokat, amikor a feladat típusa megkívánja — nincs szükség manuális beavatkozásra.

## Elérhető toolok

| Tool                           | Mikor hívódik              | Leírás                                                        |
|--------------------------------|----------------------------|---------------------------------------------------------------|
| `get_maven_project_conventions`| `isCreating` topic         | Maven multi-modul layout, POM chain, package naming, verziók  |
| `get_openapi_yaml_conventions` | `isApi` topic              | OpenAPI YAML szabályok, DTO elnevezés, response struktúrák    |
| `generate_spring_boot_skeleton`| Manuális (skeleton gen.)   | Skeleton generálás Semantic Markdown alapján                   |

## Hogyan működik az automatikus trigger

1. A development panel feladat indításakor az assembler elemzi a direction szövegét
2. Topic detection futtatja a kulcsszó-egyeztetést (magyar + angol)
3. Ha `isCreating` vagy `isApi` topic aktív → az assembler `--mcp-config` flaggel indítja a Claude CLI-t, amely tartalmazza a compiler szerver URL-jét
4. A system promptba kerül egy hint: "hívd meg a megfelelő MCP toolt"
5. Claude saját döntése alapján hívja a toolt a feladat végrehajtása közben

Ha egyik topic sem aktív (pl. bugfix, kommentelés, rename) → a compiler MCP szerver nem kerül regisztrálásra, nem indul extra kapcsolat.

## Dokumentációk

- [01-maven-structure.md](01-maven-structure.md) — Maven modul struktúra, POM chain, dependency chain, package naming, verziókezelés
- [02-openapi-yaml-conventions.md](02-openapi-yaml-conventions.md) — OpenAPI YAML szabályok, DTO/schema elnevezés, response struktúrák, security, HTTP method szemantika

## Docker konfiguráció

A compiler szerver a `docker/compose.yaml`-ban van definiálva, port: **3003**.  
Indítás: `docker compose up compiler` vagy az összes szerver indításával együtt.
