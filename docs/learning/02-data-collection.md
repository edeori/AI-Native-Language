# Adatgyűjtési útmutató

Mi keletkezik automatikusan, hol van, és mit kell belőle egy retrospektívhez összegyűjteni.

---

## Automatikusan keletkező adatok

Minden task futtatásakor ezek jönnek létre:

```
.ai-native/development/
├── tasks.json                          ← minden task metaadat
├── runs/
│   └── {taskId}/
│       ├── direction.md               ← amit a fejlesztő beírt + context sources
│       └── report.md                  ← Claude teljes kimenete
└── memory/
    └── memory.md                     ← akkumulált memória (Summary + Recent szekciók)
```

A `source.semantic.md` változásai a git historyban vannak — ehhez `git log` és `git show` kell.

---

## Mit kell összegyűjteni egy retrospektívhez

### 1. tasks.json — exportáld teljes egészében

Ez tartalmaz minden task-ot: taskId, direction, status, result (summary, changedFiles, risks), docDrift, createdAt.

Ebből számolható:
- Összes task szám
- Follow-up lánc hossza per eredeti task (nincs automatikus prefix — a kapcsolat a direction szövegéből következtethető ki, vagy ha a fejlesztő manuálisan jelöli, pl. `[Follow-up from X]` prefixszel)
- docDrift rate (docDrift:true / összes done task)
- Risks átlag
- Befejezett vs. sikertelen arány

### 2. Minden runs/{taskId}/direction.md

Ebből kiderül:
- Mit írt a fejlesztő pontosan
- Melyik context source-ok voltak elérhetők (semantic/codegraph/docs/memory)
- Az iterációk közötti direction-ök hogyan változtak

### 3. Minden runs/{taskId}/report.md

Ebből kiderül:
- Mit csinált Claude ténylegesen (Changed files)
- Milyen kockázatokat azonosított
- Mit tanult meg (Memory update szekciók)
- Mikor jelzett semantic érintettséget (Semantic drift szekció)

### 4. memory/memory.md — aktuális állapot

Megmutatja, mi akkumulálódott a futások során. Hasznos: mennyi lett ténylegesen, mennyire volt "jó" ami belekerült.

### 5. git log az .ai-native/development/ mappa keletkezése óta

```bash
git log --oneline --since="2026-06-29" -- src/
```

Ez megmutatja, milyen kód commitok keletkeztek párhuzamosan. Összevetés a task report-okkal: amit Claude `Changed files`-ba írt, az tényleg commitolva lett-e?

---

## Fájlok összecsomagolása retrospektívhez

Futtasd ezt a projekted gyökéréből:

```bash
# Kimásolja az összes releváns artifactet egy mappába
RETRO_DIR=".ai-native/retro-$(date +%Y%m%d)"
mkdir -p "$RETRO_DIR"
cp .ai-native/development/tasks.json "$RETRO_DIR/"
cp -r .ai-native/development/runs/ "$RETRO_DIR/runs/"
cp -r .ai-native/development/memory/ "$RETRO_DIR/memory/"
cp .ai-native/source.semantic.md "$RETRO_DIR/source.semantic.md"

# Git history a fejlesztési időszakra
git log --oneline --stat > "$RETRO_DIR/git-log.txt"

echo "Retrospective data collected in $RETRO_DIR"
```

Ezt a mappát kell nekem átadni a retrospektív során.

---

## Mennyi adat várható

Egy 2 hetes intenzív fejlesztés után kb.:
- 20-40 task (tasks.json: ~50 KB)
- 20-40 direction.md (összesen ~20 KB)
- 20-40 report.md (összesen ~200-500 KB — ezek a legterjedelmesebb fájlok)
- 1 memory fájl (~5-10 KB)
- 1 semantic.md (~10-30 KB)

Összesen ~300-600 KB — belefér egyetlen Claude context windowba, ha hatékonyan összesítjük.
