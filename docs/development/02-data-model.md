# Development — adatmodell

Mi keletkezik, hol, és mikor.

---

## Fájlstruktúra

### Runtime artifactek (`.ai-native/development/`)

```
.ai-native/development/
├── tasks.json                  ← minden task metaadat
├── runs/
│   └── {taskId}/
│       ├── direction.md        ← amit a fejlesztő beírt + context sources
│       └── report.md           ← AI teljes kimenete
└── memory/
    └── memory.md               ← akkumulált repo-memória
```

Minden task futáshoz **egy könyvtár, két fájl** keletkezik. Ha egy task hibával áll le, a `direction.md` megvan (a hívás előtt íródik), de a `report.md` hiányzik.

A teljes assemblelt prompt **nem kerül fájlba** — csak memóriában él az API hívásig.

### Forráskód (`vscode-extension/src/development/`)

```
vscode-extension/src/development/
├── types.ts              ← TaskEntry, TaskResult, TaskStatus
├── taskId.ts             ← generateTaskId()
├── taskStore.ts          ← load/add/update/patch/delete, tasks.json
├── contextAssembler.ts   ← semantic + graph + docs + memory → prompt
├── implementationRunner.ts ← AI hívás, report, memory update, drift
└── memoryManager.ts      ← memory.md írás/olvasás, összesítés
```

---

## Task státuszok

```
queued → pending → running → done
                              ↑
                   hiba esetén visszaesik queued-re
```

| Státusz | Mit jelent |
|---|---|
| `queued` | Létrehozva, vár a futásra. Manuálisan törölhető. |
| `pending` | Run Queue-ból vár sorra (más task fut előtte) |
| `running` | AI épp dolgozik rajta |
| `done` | Befejezve, van `result` |

---

## `docDrift` flag

A `docDrift: true` azt jelzi: **az AI maga észrevette, hogy amit implementált, az érintheti a semantic dokumentáció magasabb szintű tartalmát** — üzleti szabályokat, rendszer-szintű kontraktokat, folyamatleírásokat.

Nem fájlnév-alapú heurisztika. Claude látja a tényleges implementációt és a semantic kontextust.

**Hogyan kerül fel:**
1. AI implementál és a `report.md`-be ír egy `# Semantic drift` szekciót
2. Ha ez a szekció nem üres → `docDrift: true`
3. A plugin VSCode Warning diagnosticsot tesz a `source.semantic.md` első sorára

**Mikor írja az AI ide:**
- Üzleti szabályt kellett megváltoztatnia
- Rendszer-szintű kontraktot sértett meg vagy egészített ki
- Egy folyamat tényleges viselkedése megváltozott

**Mikor NEM írja:**
- Refaktorálás vagy tesztírás
- Implementációs részlet változott, üzleti viselkedés nem
- Új privát segédfüggvény

---

## `result` mező

Csak `done` státuszú taskokon. A `runs/{taskId}/report.md` tartalmát összegzi.

```json
"result": {
  "summary": "Implementáltam az EventService cancel metódusát...",
  "changedFiles": 3,
  "risks": 1,
  "timestamp": "2026-06-29T14:32:00.000Z"
}
```

| Mező | Honnan jön |
|---|---|
| `summary` | `report.md` `# Summary` szekciójából |
| `changedFiles` | `git diff --name-only HEAD` sorszáma |
| `risks` | `report.md` `# Risks` szekciójában lévő `-` sorok száma |
| `timestamp` | Task befejezésének időpontja |

---

## `direction.md` — tartalom

Amit a fejlesztő a Development panelbe beírt, plusz egy sor metaadat.

```markdown
# 20260629-event-app-be

Implementáld az event lemondás (cancellation) flow-t. A felhasználó le tudjon mondani
egy eseményt, ha ő a szervező. Küldj email értesítést a résztvevőknek.

---
Context sources: semantic ✓  codegraph ✓  docs ✓  memory ✗
Timestamp: 2026-06-29T14:00:00.000Z
```

Ha `docs ✗`, akkor nem voltak doc importok a context assembly-kor.

---

## `report.md` — tartalom

Az AI teljes válasza a meghatározott szekciókkal.

```markdown
# Summary
Implementáltam az EventService.cancel() metódust és a NotificationService.sendCancellationEmail() metódust.

# Changed files
- src/main/java/com/app/EventService.java — cancel() metódus hozzáadva
- src/main/java/com/app/NotificationService.java — sendCancellationEmail() hozzáadva
- src/test/java/com/app/EventServiceTest.java — cancel() tesztek

# Risks
- Ha az email küldés meghibásodik, a lemondás mégis sikerül (nincs rollback)

# Suggested follow-ups
- Retry mechanizmus az email küldéshez

# Memory update
- Az EventService metódusain belül a NotificationService-t setter injection-nel kell injektálni

# Semantic drift
(nothing changed at the semantic level — only new methods were added within existing contracts)
```

A plugin a `report.md`-ből automatikusan kiolvas:
- `# Summary` → `result.summary`
- `# Risks` → `result.risks`
- `# Memory update` → `memory.md`-be menti, 2 task után összesíti
- `# Semantic drift` → ha nem üres: `docDrift: true` + Warning diagnostic

---

## `tasks.json` — example

```json
[
  {
    "taskId": "20260629-event-app-be",
    "direction": "Implementáld az event cancellation flow-t...",
    "status": "done",
    "createdAt": "2026-06-29T14:00:00.000Z",
    "result": {
      "summary": "Implementáltam az EventService.cancel() metódust...",
      "changedFiles": 4,
      "risks": 1,
      "timestamp": "2026-06-29T14:32:00.000Z"
    },
    "docDrift": false
  },
  {
    "taskId": "20260629-event-app-be-2",
    "direction": "Adj HTTP 409-et ha az event már le van mondva, ne 500-at",
    "status": "queued",
    "createdAt": "2026-06-29T14:45:00.000Z"
  }
]
```

---

## Tesztelési lépések

1. Source Import futtatása a projekten
2. Development panel → New Task → direction → `▶ Run Now`
   - OutputChannel: `[development] starting task …` → `[development] task … done`
   - Ha doc drift: sárga squiggle a `source.semantic.md` első során + notification
3. `+ Add to Queue` 2-3 task → `▶ Run Queue (N)` → sorban futnak
4. Task log → `queued` kártyán hover → `✕ delete` gomb megjelenik → kattintásra törlődik
5. Task log → `done` kártyára kattintás → direction betöltődik a New Task-ba, Last Result frissül
6. `view full report` → Markdown preview a `report.md`-ről
