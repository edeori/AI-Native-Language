# Retrospektív promptok

Ezek azok a promptok, amiket nekem kell megadni ahhoz, hogy a keletkezett adatokból tanulságokat vonjak le és javítsam a promptokat, heurisztikákat.

---

## Hogyan használd ezt a dokumentumot

1. Gyűjtsd össze az adatokat a [02-data-collection.md](02-data-collection.md) alapján
2. Nyiss egy új Claude conversation-t (ideálisan nagyobb context windowos modellel — Opus vagy Sonnet)
3. Másold be az adatokat + az alább szereplő megfelelő promptot
4. A válasz alapján frissítsd a [04-findings.md](04-findings.md)-t és a plugin forráskódját

---

## Prompt 1 — Teljes retrospektív

Ezt add be, ha egy projekt egy fázisa lezárult és mindent egyszerre akarod elemezni.

```
Végezz retrospektív elemzést ezen az AI-asszisztált fejlesztési folyamaton.

## Kontextus
Ez egy VSCode plugin által vezérelt fejlesztési workflow volt. A plugin:
- Claude-dal futtatott implementációs taskokat, context-enriched promptokkal
- Minden taskhoz összegyűjtötte: direction.md (amit a fejlesztő írt), report.md (Claude kimenete)
- Nyomon követte: docDrift flag (Claude jelzett-e semantic érintettséget), iterációk száma, kockázatok

## Adatok

### tasks.json
[ILLESZD BE A tasks.json TARTALMÁT]

### direction.md fájlok (taskId → tartalom)
[ILLESZD BE AZ ÖSSZES direction.md TARTALMÁT, taskId-vel fejlécezve]

### report.md fájlok (taskId → tartalom)
[ILLESZD BE AZ ÖSSZES report.md TARTALMÁT, taskId-vel fejlécezve]

### Akkumulált memory
[ILLESZD BE A memory/memory.md TARTALMÁT]

## Elemzési kérdések

1. **Iteráció hatékonyság**: Melyik taskok igényeltek follow-up-ot? Mi volt a közös bennük (irány szövege, kontextus hiány, feladat komplexitás)?

2. **Prompt minőség**: A report.md-ekben látható-e minta abban, hogy Claude következetesen félreértett valamit, vagy üres maradt valamelyik szekció? Javaslatod a prompt format módosítására?

3. **Memory hasznosság**: A Memory update szekciókban írt dolgok ténylegesen hasznos projekt-specifikus tények? Vagy zaj? Volt-e olyan, ami a következő taskokban tényleg segített?

4. **Semantic drift minőség**: A docDrift:true esetek valóban tartalmaztak semantic-szintű változást a Semantic drift szekcióban? Volt-e hamis pozitív (üres szekció de docDrift:true)?

5. **Context completeness hatás**: Ahol hiányzott valamelyik context source (docs, codegraph), ott rosszabb volt az eredmény? Konkrét példák?

6. **Direction minőség**: Milyen direction-formátumok vezettek jobb első körös eredményre? Van-e minta a "sok iterációt igénylő" vs "első körre jó" taskokban?

Minden ponthoz adj konkrét példát a betöltött adatokból, ne csak általánosságban fogalmazz.
```

---

## Prompt 2 — Prompt finomítás

Ha az 1-es prompt elemzés alapján konkrét prompt módosítást akarsz, ezt add be.

```
Az alábbi retrospektív elemzés alapján javasolj konkrét módosításokat a development task prompt templatehoz.

## Jelenlegi prompt template (Report format szekció)
[ILLESZD BE A contextAssembler.ts buildPrompt() függvény Report format részét]

## Retrospektív tanulságok
[ILLESZD BE AZ 1-ES PROMPT EREDMÉNYÉT — a releváns részeket]

## Feladat
Módosítsd a prompt templatet úgy, hogy:
1. A félreértett vagy következetesen üres szekciók egyértelműbbek legyenek
2. A Memory update szekció instrukciója pontosabb legyen (mi kerüljön bele, mi ne)
3. A Semantic drift szekció instrukciója csökkentse a hamis pozitívokat
4. Adj példát az ideális output formátumra minden szekciónál

Formátum: add meg a teljes, módosított Report format szekció szövegét, amit közvetlenül be lehet másolni a kódba.
```

---

## Prompt 3 — Context assembly finomítás

Ha a graph keyword slice vagy a doc entity matching nem jól teljesített.

```
Elemezd a context assembly hatékonyságát az alábbi futási adatok alapján.

## direction.md fájlok (taskId → tartalom)
[ILLESZD BE — különösen a Context sources sort nézd meg]

## report.md fájlok — Changed files szekciók
[ILLESZD BE CSAK A Changed files szekciót minden report-ból]

## Jelenlegi graph slice logika
A plugin direction szavait (>3 karakter) illeszti a codegraph node nevekre/leírásokra/filePath-ekre.
Top-25 node kerül be a promptba.

## Jelenlegi doc entity logika  
Ugyanaz keyword match, top-20 entitás.

## Feladat
1. A Changed files alapján: a graph slice valószínűleg releváns node-okat hozott-e be? (taskId-k alapján próbáld megbecsülni)
2. Volt-e olyan task ahol a direction szavai nem egyeztek jól a graph node nevekkel, de mégis jó lett az eredmény? (és miért)
3. Javaslatod a keyword extraction javítására: más tokenizálás, szinonimák, más scoring?
```

---

## Prompt 4 — Semantic Sync timing kalibráció

Futasd le, ha már van legalább 2-3 Semantic Sync adat (`sync-history.json`-ból).

```
Segíts kalibrálni a Semantic Sync ritmusát a következő adatok alapján.

## sync-history.json
[ILLESZD BE]

## Elemzési kérdések
1. A driftFlagsSincePrevSync és a sectionsModified között van-e korreláció? (sok drift → sok módosítás?)
2. Melyik tasksSincePrevSync értéknél volt a legtöbb érdemi módosítás?
3. Volt-e olyan sync ahol sok drift volt, de kevés módosítás? (hamis pozitív drift)
4. Mi az eddigi átlagos cost per sync (inputTokens + outputTokens alapján)?
5. Javaslatod: milyen szabállyal érdemes triggert felállítani? (pl. "ha driftFlags >= X VAGY taskCount >= Y")
```

---

## Prompt 5 — Heurisztika frissítés

Ha már van elegendő adat ahhoz, hogy a plugin kódjában lévő heurisztikákat módosítsuk.

```
Az alábbi tanulságok alapján javasolj konkrét kódmódosításokat a plugin fejlesztési flow-jában.

## Tanulságok (04-findings.md tartalma)
[ILLESZD BE]

## Releváns plugin fájlok
[ILLESZD BE A contextAssembler.ts és/vagy implementationRunner.ts teljes tartalmát]

## Feladat
Minden tanulsághoz, ami konkrét kódváltoztatást igényel:
1. Nevezd meg a pontos fájlt és funkciót
2. Írd meg a módosított kód részletet
3. Indokold meg miért javít az adott mérőszámon

Ne javasolj architektúrális változtatásokat — csak a meglévő logikán belüli finomítások.
```
