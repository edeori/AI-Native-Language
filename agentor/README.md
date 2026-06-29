# Agentor — Multi-repo AI task workflow

Agentor egy lightweight CLI + Claude Code skill kombináció, amivel multi-repo AI fejlesztési
taskokat lehet strukturáltan kezelni: contract alapú feladatleírás, agent-prompt generálás,
iteratív review ciklus.

---

## Hogyan működik

```
1. /agentor  →  Claude megkérdezi mi a task, melyik repók érintettek
2. Contract YAML generálás + jóváhagyás
3. agentor.sh run → agent-prompt-current.md generálás
4. Prompt bemásolása Claude Code-ba → Claude elvégzi a munkát az eredeti repókban
5. agentor.sh review → REVIEW-*.yaml szerkesztése
6. Ha kell módosítás: agentor.sh next → új iteráció
7. SmartGit → commit → push → CR
```

---

## Setup

### 1. Config létrehozása

```bash
cp agentor/config.example.yaml agentor/config.yaml
```

Töltsd ki a `config.yaml`-t:

```yaml
workspace_root: /mnt/c/REPOSITORY   # a repók szülőmappája

repos:
  my-backend:
    path: my-backend-repo            # workspace_root-hoz relatív
    type: spring-boot
    test_command: ./mvnw test

  my-frontend:
    path: my-frontend-repo
    type: vite-ts
    test_command: npm test -- --run
```

> `config.yaml` gitignorált — minden fejlesztő a saját workspace_root-jával dolgozik.

### 2. Script futtathatóvá tétele

```bash
chmod +x agentor/agentor.sh
```

### 3. Függőség

```bash
pip3 install pyyaml
```

---

## Parancsok

```
./agentor.sh run     TASK-ID    # Run dir + agent-prompt generálás
./agentor.sh review  TASK-ID    # Review fájl generálása (git diff alapján)
./agentor.sh next    TASK-ID    # Következő iteráció (review notes alapján)
./agentor.sh status  TASK-ID    # Státusz + git változások + cost
./agentor.sh clean   TASK-ID    # Run dir törlése (repók érintetlenek maradnak)
```

---

## Iterációs ciklus

```
agentor.sh run TASK-001
  └─ Prompt → Claude Code-ba
       └─ Claude elvégzi a munkát
            └─ agentor.sh review TASK-001
                 └─ REVIEW-TASK-001.yaml kitöltése
                      ├─ decision: approved      → SmartGit → commit → push → CR
                      └─ decision: needs_changes → Ctrl+Shift+P → "agentor: ▶ Next Iteration"
                                                        └─ agentor.sh next → TASK-001-F1
                                                             └─ Prompt → Claude Code-ba ...
```

---

## Könyvtárstruktúra

```
agentor/
├── agentor.sh              # CLI
├── config.yaml             # gitignorált — saját workspace_root és repo lista
├── config.example.yaml     # sablon
├── templates/
│   └── agent-prompt.md     # agent-prompt generátor sablonja
├── contracts/              # gitignorált — task contractok (YAML)
│   └── TASK-ID/
│       ├── TASK-ID.yaml
│       └── TASK-ID-F1.yaml (followup)
├── runs/                   # gitignorált — generált fájlok per task
│   └── TASK-ID/
│       ├── TASK-ID.code-workspace
│       ├── agent-prompt-current.md
│       ├── report.md
│       └── reviews/
│           └── REVIEW-TASK-ID.yaml
└── memory/                 # gitignorált — per-repo memória (Claude írja)
    └── {alias}.md
```

---

## Claude Code skill

A `.claude/skills/agentor/SKILL.md` automatikusan betöltődik Claude Code-ban ha ebben
a repóban dolgozol. A `/agentor` parancs — vagy ha Claude felismeri hogy agentor taskot
akarsz indítani — elindítja a wizard-ot.

---

## Cost tracking

Az `agentor.sh status TASK-ID` kiolvassa a Claude Code session JSONL logokból a token
használatot és kiszámolja a becsült USD költséget. Az eredmény a contract YAML-be is
bekerül (`cost:` szekció).

---

## Task ID konvenciók

| Formátum | Példa | Leírás |
|----------|-------|--------|
| `YYYYMMDD-{alias}` | `20260629-refintrate-be` | Egyetlen repo |
| `YYYYMMDD-{alias1}-{alias2}` | `20260629-refintrate-be-refintrate-fe` | Multi-repo |
| `TASK-ID-F{n}` | `20260629-refintrate-be-F1` | Followup iteráció |
| `TASK-ID-2` | `20260629-refintrate-be-2` | Ha az első ugyanazon a napon már létezik |
