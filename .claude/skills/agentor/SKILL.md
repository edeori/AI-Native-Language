---
name: agentor
description: "Agentor multi-repo task wizard: új task indítása VAGY meglévő folytatása. Triggerelj ha a user: /agentor-t ír, új agentor taskot akar indítani, meglévő taskot akar folytatni, vagy AI fejlesztést akar elkezdeni vagy folytatni."
---

# `/agentor` — Agentor task wizard

Ezt a protokollt kövesd szigorúan, lépésről lépésre. Minden lépés után hajtsd végre
a műveletet — ne csak írd le, hogy mit kellene csinálni.

---

## Lépés 0 — AGENTOR_DIR meghatározása

Először határozd meg az agentor könyvtárat:

```bash
REPO_ROOT=$(git -C /mnt/c/REPOSITORY/AI-Native-Language rev-parse --show-toplevel 2>/dev/null || echo "/mnt/c/REPOSITORY/AI-Native-Language")
AGENTOR_DIR="$REPO_ROOT/agentor"
echo "AGENTOR_DIR=$AGENTOR_DIR"
```

Ellenőrizd, hogy létezik-e a `config.yaml`:
```bash
ls "$AGENTOR_DIR/config.yaml" 2>/dev/null || echo "MISSING — copy config.example.yaml to config.yaml"
```

Ha hiányzik a `config.yaml`, jelezd a usernek:
> A `agentor/config.yaml` nem létezik. Másold a `agentor/config.example.yaml`-t `agentor/config.yaml`-ba, és töltsd ki a `workspace_root` és `repos` mezőket.

## Lépés 1 — Mód kiválasztása

`AskUserQuestion`-nel kérdezd meg:

- **Új task** — contract megírása + run dir létrehozása
- **Meglévő folytatása** — korábban elindított task újranyitása vagy followup

Ha "Meglévő folytatása"-t választ, ugorj a **[CONTINUE ág](#continue-ág)**-ra.

---

## Lépés 2 — Konfig beolvasása

Olvasd be: `$AGENTOR_DIR/config.yaml`

Az elérhető repo aliasok a config `repos:` szekciójából derülnek ki.
Olvasd be a configot és listázd ki az aliasokat a usernek ha szükséges.

---

## Lépés 3 — Paraméterek bekérése

`AskUserQuestion` tool-lal kérd be egyszerre az alábbi kérdéseket.
Ne találd ki a válaszokat.

**Kérdések:**

1. **Title** — egy rövid, egyértelmű mondat angolul, pl.
   `"Unify error response format on backend and update frontend handling"`

2. **Érintett repók** — aliasok vesszővel elválasztva, pl. `refintrate-be, refintrate-fe`
   Ha a user nem tudja pontosan, segíts: kérdezz rá a funkcionális területre,
   és ajánlj alias-okat a config alapján.

3. **Goal** — mit kell elvégezni, magyarul vagy angolul, 2–5 mondat.

Ha bármelyik válasz hiányzik vagy nem egyértelmű, kérdezz vissza mielőtt továbblépnél.

### Task ID automatikus generálása

A Task ID-t **te generálod**, a user nem adja meg. Formátum:

```
YYYYMMDD-{alias1}-{alias2}
```

- Dátum: mai nap (`date +%Y%m%d` Bash tool-lal)
- Aliasok: a kiválasztott repók, kötőjellel összefűzve, ugyanabban a sorrendben ahogy a user megadta
- Ha az így kapott fájlnév már létezik (`$AGENTOR_DIR/contracts/YYYYMMDD-{...}.yaml`), fűzz `-2`, `-3` suffixet

Példák:
- `20260520-daily-confirmation-be`
- `20260520-refintrate-be-refintrate-fe`
- `20260520-refintrate-be-2` (ha az első már létezik)

Ellenőrizd Bash tool-lal:
```bash
date +%Y%m%d
ls "$AGENTOR_DIR/contracts/" 2>/dev/null
```

---

## Lépés 4 — Skeleton generálása és jóváhagyás

### 4.1 — Skeleton felépítése memóriában

A config.yaml adatai alapján építsd fel a contract YAML-t **mentés előtt**,
és mutasd meg a usernek.

**Default paths type szerint:**

| type | default paths |
|------|---------------|
| spring-boot, legacy-ejb, gradle-java, gradle-lambda | `src/main/java`, `src/test/java` |
| angular, vite-ts | `src` |
| asa-config, kubera-manifest, terraform, ansible-cda | `.` |

Ha több repo van: az első `role: primary`, a többi `role: secondary`.

### 4.2 — Skeleton megjelenítése

Írd ki a chaten egy code blockban a teljes generált YAML-t, pl.:

```
Így néz ki a contract. Szólj ha változtatsz valamit, vagy mondd hogy "OK"
és elmentem + elindítom a sandboxot.

---
id: TASK-001
title: "..."

repos:
  - alias: refintrate-be
    role: primary
    paths:
      - "src/main/java"
      - "src/test/java"
    test_command: "mvn test"

  - alias: refintrate-fe
    role: secondary
    paths:
      - "src"
    test_command: "npm test -- --run"

goal: >
  ...

constraints:
  - Keep changes minimal.
  - Do not push.
  - Do not commit.
  - Do not add dependencies unless explicitly required.
  - Do not modify files outside the listed repositories.
  - Do not touch secrets, credentials, certificates, or deployment configs.

acceptance_criteria:
  - Existing relevant tests pass.
  - Changes are easy to review per repository.
  - The agent writes a report.md with changed files, tests run, and risks.

agent:
  tool: "claude"
  mode: "direct"
```

### 4.3 — Módosítások kezelése

Várd meg a user visszajelzését:

- Ha **"OK" / "jó" / "mehet"** → folytasd az 5. lépéssel (mentés + sandbox)
- Ha **módosítást kér** → alkalmazd, írd ki újra a skeletont, és kérd újra a jóváhagyást
- Ha **egyszerre több dolgot kér** → alkalmaz mindent egyszerre

**Soha ne mentsd el a fájlt jóváhagyás előtt.**

---

## Lépés 5 — Contract YAML mentése

Csak jóváhagyás után: **mentsd el** a jóváhagyott tartalmat (Write tool):

```
$AGENTOR_DIR/contracts/{TASK-ID}/{TASK-ID}.yaml
```

Könyvtár létrehozása:
```bash
mkdir -p "$AGENTOR_DIR/contracts/{TASK-ID}"
```

A `test_command`-ot a config.yaml-ból vedd — ne találd ki.

---

## Lépés 6 — Run dir létrehozása

Futtasd Bash tool-lal:

```bash
cd "$AGENTOR_DIR" && ./agentor.sh run {TASK-ID}
```

Ha hibát kapsz, olvasd el a hibaüzenetet és kezeld:
- `Repo not found` → ellenőrizd az alias-t a config.yaml-ban
- `config.yaml not found` → emlékeztesd a usert hogy másolja a config.example.yaml-t

---

## Lépés 7 — Agent prompt átadása

Olvasd be a generált promptot:

```
$AGENTOR_DIR/runs/{TASK-ID}/agent-prompt-current.md
```

Írd ki a teljes tartalmát a usernek, és add hozzá:

---

**Következő lépések:**

1. A fenti prompt tartalmaz mindent — ezt add Claude-nak VS Code-ban.
2. VS Code-ban nyisd meg: `agentor/runs/{TASK-ID}/{TASK-ID}.code-workspace`
3. Indítsd el a Claude Code chat-et, és másold be a promptot.
4. Claude **orchestratorként** indul — szükség esetén automatikusan indít
   sub-agenteket (repónként / fázisonként). A változtatások közvetlenül az
   eredeti repókban történnek, és azonnal látszanak SmartGitben.
5. Ha Claude végzett:
   - SmartGit → review a változtatások → commit → push → CR
   - Ha módosítás kell: `Ctrl+Shift+P` → Tasks → `agentor: 📝 Review`

---

## CONTINUE ág

Ide kerülsz ha a user meglévő taskot akar folytatni.

### C1 — Task azonosítása

Kérd be a task ID-t (`AskUserQuestion`), vagy ha a user már megadta, használd azt.

Ezután futtasd:
```bash
cd "$AGENTOR_DIR" && ./agentor.sh status {TASK-ID}
```

Írd ki az eredményt, és a státusz alapján döntsd el melyik ágra van szükség.

### C2 — Állapot alapján következő lépés

`AskUserQuestion`-nel kérdezd meg mit szeretne csinálni, és mutasd azokat az
opciókat amelyek relevánsak a státusz alapján:

**A) Claude még dolgozik / félbemaradt → Folytasd**
- VS Code workspace újranyitása + agent-prompt újraátadása (lásd C3)

**B) Claude végzett, review kell → Review generálás**
- Futtasd: `./agentor.sh review {TASK-ID}` (lásd C4)

**C) Review megvan, de módosítás kell → Next Iteration**
- `Ctrl+Shift+P` → Tasks → `agentor: ▶ Next Iteration` (lásd C5)

**D) Minden rendben → Commit**
- SmartGit → commit → push → CR

**E) Run dir nem létezik, de contract igen → Újraépítés**
- Futtasd: `./agentor.sh run {TASK-ID}`

### C3 — Task újranyitása (Claude folytatja)

Nyisd meg a workspace-t:
```bash
code "$AGENTOR_DIR/runs/{TASK-ID}/{TASK-ID}.code-workspace"
```

Olvasd be és add át a promptot:
```
$AGENTOR_DIR/runs/{TASK-ID}/agent-prompt-current.md
```

Ha `report.md` már létezik, olvasd be és foglald össze mi történt eddig.
Egészítsd ki a promptot: *"Az eddigi munka: {összefoglaló}. Folytasd ahol abbahagytad."*

### C4 — Review generálás

```bash
cd "$AGENTOR_DIR" && ./agentor.sh review {TASK-ID}
```

Ez legenerálja a `REVIEW-{TASK-ID}.yaml`-t az aktuális git diff alapján.
A user VS Code-ban (`Ctrl+Shift+G`) megnézi a változtatásokat, és kitölti a notes mezőt.

### C5 — Következő iteráció (review alapján)

1. A user VS Code-ban (`Ctrl+Shift+G`) megnézi a diff-et fájlonként
2. Megnyitja a `REVIEW-{TASK-ID}.yaml`-t:
   - `decision: needs_changes`
   - `notes:` mezőbe szabadszavasan írja mi nem tetszik
3. Futtatja: `Ctrl+Shift+P` → Tasks: Run Task → **`agentor: ▶ Next Iteration`**
   - Ez lefuttatja `./agentor.sh next {TASK-ID}`
   - Létrehoz egy belső `{TASK-ID}-F{n}.yaml` contractot
   - Legenerálja a `runs/{TASK-ID}/agent-prompt-current.md`-t
4. `Ctrl+Shift+P` → **Reload Window**
5. Másold be az `agent-prompt-current.md` tartalmát Claude-nak

Ha a user elégedett a változtatásokkal:
→ SmartGit → commit → push → CR
