# 1d. Recon prompt generálás

**Hol:** `extension.ts` → `importSourceProject()`, az `importSourceProjectState` után  
**MCP szerver:** `semantic-core` · tool: `generate_reconnaissance_prompt`

## Cél

Az analízis eredményéből (`result.analysis`) és a modul-dossierekből felépít egy strukturált felderítési promptot. Ez a prompt az alapja annak, ha manuálisan cloud AI-val szeretnéd tovább feldolgozni a projektet — pl. a Semantic Enrichment lépésnél.

## Bemenet

Az MCP szerver megkapja:
- `analysis` — a teljes `ProjectAnalysis` objektum (osztályok, modulok, layerek, függőségek, DB séma)
- `moduleDossiers` — modul-szintű dossierek listája

## Mit generál az MCP szerver

Két szintű promptot készít:

**Projekt szintű prompt** (`projectPrompt`) — leírja a projekt egészét:
- alkalmazás neve, típusa (Spring Boot monolith / multi-module)
- modulok és határaik
- fő entry pointok (REST controllerek)
- adatbázis-táblák és séma-összefoglaló
- azonosított fő flow-ok (login, checkout, stb. ha detektálható)

**Modul szintű promptok** (`modulePrompts`) — minden Maven modulhoz vagy fő csomaghoz:
- a modul neve és felelőssége
- fő osztályok és annotációk
- belső függőségek

## Kimenet

`.ai-native/source.recon.json` — a teljes payload (projectPrompt + modulePrompts)  
`.ai-native/source.recon.prompt.md` — csak a `projectPrompt`, Markdown fájlként

Ezek a fájlok a Recon Runs panelen is megtekinthetők (ReconRun snapshot hivatkozik rájuk).

## Mire való

A recon prompt nem fut le automatikusan — felderítési kiindulópont. A Semantic Enrichment lépés (Step 2) ezt a fájlt is felhasználja kontextusként a cloud AI review bundle-be, de alapvetően ez egy emberi olvasásra szánt összefoglaló is arról, hogy a plugin mit tárt fel a projektből.
