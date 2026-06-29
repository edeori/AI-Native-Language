# 1b. jQAssistant bytecode scan

**Hol:** `extension.ts` → `importSourceProject()` → `runJqassistantScanInternal()`  
**MCP szerver:** `jqassistant` · tool: `jqassistant_scan_files`

## Mikor fut le

A Flow panelen a **Source Import** kártyán van egy **jQAssistant Scan** checkbox. Ha be van jelölve, a scan lefut a Source Import részeként. Ha nincs bejelölve, az extension megpróbálja betölteni a létező `.ai-native/source.jqassistant.json`-t — ha megvan, azt használja; ha nincs, skipped állapotban folytat.

A standalone futtatáshoz is van command: `aiNative.runJqassistantScan` (Actions panel → jQAssistant Scan gomb).

## Mit küld az MCP szervernek

Az extension összegyűjti:
- Minden `pom.xml` és `.java` fájlt a workspace-ből (VSCode `findFiles`)
- A `target/classes` könyvtárakat becsomagolja JAR archívumokká (a jQAssistant Java pluginje JAR-okból dolgozik, nem loose `.class` fájlokból)

## Mit csinál az MCP szerver

A jQAssistant bytecode elemzés:
- Feldolgozza a JAR archívumokat és a `pom.xml`-eket
- Meghatározza az alkalmazások és modulok határait
- Kivonja az osztályok közötti függőségeket bytecode szinten (nem csak forráskód alapján)
- Megtalálja a `@SpringBootApplication` entry pointokat
- Feltérképezi a csomag struktúrát

Visszaad egy `JqassistantArtifact`-et:
```json
{
  "status": "ok",
  "summary": {
    "applicationCount": 1,
    "moduleCount": 3,
    "classCount": 247
  },
  "applications": [...],
  "modules": [...],
  "dependencies": [...]
}
```

## Kimenet

`.ai-native/source.jqassistant.json` — elmentve az extension által.

Az artifact átadásra kerül az `importSourceProjectState`-nek, ahol `applyJqassistantEvidence` beépíti a bytecode-szintű függőségi adatokat az analízisbe.

## Ha a scan sikertelen

Ha a jQAssistant MCP szerver nem elérhető vagy hiba lép fel, az exception el van kapva, a futás `failed` állapotba kerül a ReconRun snapshotban, de a folyamat folytatódik. Az `importSourceProjectState` ebben az esetben `buildSkippedJqassistantArtifact`-et kap — ez egy üres placeholder, ami nem okoz hibát a downstream lépésekben.
