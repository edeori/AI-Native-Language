# Development panel — áttekintő

A direction → context assembly → AI implementál ciklus gombnyomásos, copy-paste és kézi lépések nélkül.

---

## Döntések

| Kérdés | Döntés |
|---|---|
| AI hívás mechanizmusa | A beállított `review.provider` CLI-je (Claude Code CLI vagy Codex CLI) — ugyanaz mint a review flow |
| Panel elhelyezése | Önálló panel az activity bar-ban, jobb oldalra helyezhető |
| Task input | Rövid vagy hosszú direction szövege — a plugin rakja össze a kontextust az importokból |
| Scope forrása | Kizárólag a Source Import / Document Import artifactokból (semantic.md, codegraph, doc-entities) |
| Iteráció modell | Lapos task lista — follow-up = új task manuálisan írva |

---

## Előfeltétel

Legalább egy forrás szükséges a development cycle indításához:
- Source Import: `source.semantic.md` + `source.codegraph.json`
- Document Import: `doc-entities.json`

Ha egyik sem áll rendelkezésre, a panel felkínálja a megfelelő import indítását.

---

## Artifact struktúra

```
.ai-native/development/
├── tasks.json                  ← minden task state, result, docDrift flag
├── runs/
│   └── {taskId}/
│       ├── direction.md        ← amit a fejlesztő beírt + context sources metaadat
│       └── report.md           ← AI teljes kimenete
└── memory/
    └── memory.md               ← akkumulált repo-memória
```

Részletes adatmodell és példák: [02-data-model.md](02-data-model.md)

---

## Memory mechanizmus

Az AI a `report.md`-be ír egy `# Memory update` szekciót — max 5 bullet, projekt-specifikus apró tények (framework-konvenciók, gotchák, naming patterns).

**Struktúra** — két szekció, összesítéssel marad kicsi:

```markdown
## Summary
- tömörített, deduplikált tények (max 12 bullet)

---

## Recent
### 20260629-event-app-be-3
- valami amit az AI felfedezett
```

**Összesítési logika:** ha a `Recent`-ben 2 bejegyzés gyűlt össze, az AI egy kis API hívással összevonja a `Summary`-val. A memory fájl soha nem nő 12 bullet + 2 nyers bejegyzésnél tovább.

**Következő promptban:** a teljes memory fájl bekerül a context assembly-be.

---

## AI motor kiválasztása

A development task a `review.provider` / `review.model` beállítást olvassa — nincs külön AI konfiguráció.

| Setting | Mit jelent |
|---|---|
| `review.provider: claude` | `claude -p --output-format json --model <model>` |
| `review.provider: codex` | `codex exec --sandbox workspace-write --model <model> --json` |

**File-hozzáférés:** az AI csak szöveget kap (prompt) és szöveget ad vissza (report). File I/O-t az extension végzi, nem az AI — nincs permission prompt.

**Előfeltétel:** a megfelelő CLI telepítve legyen (`claude` vagy `codex` PATH-on).

---

## Semantic drift detekció

Az AI a `report.md` végén ír egy `# Semantic drift` szekciót. Akkor tölti ki, ha az implementáció során üzleti szintű változást észlelt — nem implementációs részletet, hanem olyat, ami a `source.semantic.md`-ben is megjelenne (új üzleti szabály, folyamatváltozás, meglévő contract sérülése).

Ha a szekció nem üres:
- `docDrift: true` kerül a task-ra → `⚠ drift` badge a task logban
- Warning diagnostic jelenik meg a `source.semantic.md` első során, a drift szövegével

Ha üres: nincs false positive.
