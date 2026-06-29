# Learning loop — áttekintő

A cél: miután egy valódi projekten N task lefutott, visszanézni az egész folyamatot és belőle finomítani a promptokat, heurisztikákat, context assembly logikát.

Ez nem automatikus. Ez egy kézi retrospektív, amit időnként elvégzünk.

---

## Mit akarunk megtudni

### Prompt minőség
- A jelenlegi report format (Summary, Changed files, Risks, Memory update, Semantic drift) lefed-e mindent amit kellene?
- Vannak-e szekciók amiket Claude következetesen üres hagyott? Vagy amiket félreértett?
- A Memory update szekciók hasznosak voltak-e a következő taskokhoz, vagy zaj?

### Context assembly hatékonyság
- Mikor volt elég a semantic + codegraph + docs kombináció? Mikor kellett sok iteráció?
- Ha csak semantic volt (docs vagy codegraph nélkül): romlott-e az eredmény?
- A graph keyword slice (top-25 node) releváns volt-e, vagy sok irreleváns node kerül bele?

### Iteráció minták
- Átlagosan hány follow-up kellett egy feladathoz?
- Milyen típusú direction-ök vezettek sok iterációhoz? (túl tág? túl szűk? hiányzó kontextus?)
- Mikor triggerelt docDrift — valóban helyes volt, vagy zaj volt?

### Semantic sync ritmus
- Hány task után válik kritikussá a semantic sync?
- A docDrift flag-ek sűrűsége jó-e jelzőnek arra, hogy mikor kell syncet futtatni?
- Mi a Semantic Sync egy futásának valódi cost-ja (tokenben)?

---

## Mérőszámok amiket gyűjteni kell

Ezeket a `tasks.json` + run artifactek alapján lehet visszaszámolni. Nem kell manuálisan felvinni — a retrospektív során számítjuk ki.

| Mérőszám | Honnan | Mit mond |
|---|---|---|
| `iterationsPerTask` | tasks.json direction tartalmából következtethető (nincs automatikus prefix) | Mennyire volt jó az első körös implementáció |
| `driftRate` | docDrift:true / összes done task | Milyen sűrűn jelzi Claude a semantic érintettséget |
| `tasksSinceLastSync` | tasks.json + utolsó Semantic Sync timestamp | Mennyire elavult a semantic |
| `contextCompleteness` | direction.md `Context sources` sor | Milyen arányban futott teljes vs. hiányos kontextussal |
| `memoryUtilization` | memory/memory.md Recent szekció | Tényleg bővül a memory, vagy üres marad |
| `risksPerTask` | result.risks átlag | Mennyire kockázatos területeken dolgoztunk |

---

## Semantic Sync — koncepció

Egy manuálisan triggert akció, ami megválaszolja: *"Az utóbbi N task alapján mi változott a rendszer valódi viselkedésében, amit a semantic.md-ben is frissíteni kellene?"*

**Input:** jelenlegi `source.semantic.md` + utolsó N task `report.md`-je + `git diff` az utolsó sync óta

**Output:** Claude javasol konkrét változtatásokat a semantic egyes szekciójában — developer review után elfogad vagy elvet

**Mérőszám:** a sync előtti `driftRate` és az utána következő `driftRate` összehasonlítása. Ha csökkent → a sync hasznos volt.

**Mikor érdemes futtatni:** hüvelykujj szabály egyelőre — minden 5. docDrift flag után, vagy 2 hetente. Ezt a projekt adatai alapján fogjuk kalibrálni.

Részletek: [01-semantic-sync.md](01-semantic-sync.md)

---

## Hogyan használd ezt a mappát

1. **Projekt indításakor**: olvasd el a [02-data-collection.md](02-data-collection.md)-t — tudd, mi keletkezik és hol
2. **Retrospektív futtatásakor**: olvasd el a [03-retrospective-prompts.md](03-retrospective-prompts.md)-t — ott vannak a konkrét promptok, amiket nekem kell beadni
3. **Finomítás után**: frissítsd a [04-findings.md](04-findings.md)-t — ide kerülnek a tanulságok, amik alapján a promptokat és heurisztikákat módosítjuk
