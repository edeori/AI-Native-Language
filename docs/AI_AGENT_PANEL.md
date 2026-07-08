# AI Agent panel — gombok, kapcsolók és folyamatok

Ez az útmutató a VSCode extension **AI Agent** oldalsávjának felületét dokumentálja: mit csinál minden nézet, gomb és kapcsoló, és két gyakorlati példát ad (dokumentum importálása, gráfok frissítése a hatékonyabb AI agentic munkavégzéshez). Az itt használt nevek a **felületen látható feliratok**.

## A panel nézetei (fentről lefelé)

| Nézet | Mire való |
|---|---|
| **Import Document** | Dokumentumok (fájlok, Confluence oldalak) importálása és AI-val `source.semantic.md`-be olvasztása |
| **Import Source** | Forráskódból (Java) determinisztikus + opcionális AI feldolgozás lépésekben |
| **Recon Runs** | A forrás-import felderítő (recon) futásainak állapota és története |
| **Actions** | Gyorsgombok: **Show graph**, **Endpoint summary**, és hatékonysági (token) összegzés |
| **Validation** | **Validate semantic** és **Doc-code alignment** gombok + a legutóbbi kimenetek |
| **Sources** | A jelenlegi kanonikus fájlok: semantic / database schema / review |
| **Settings** | MCP végpontok, **AI Review Provider**, **Local AI Agents** konfigurálása |

> A Development panel (a fejlesztési taskok futtatása) külön aktivitássávban van, nem az AI Agent panelen.

---

## Import Document

Dokumentumokat importál, majd AI-val a `source.semantic.md`-be olvasztja.

**Források:**
- **Local files → Add documents** — PDF · DOCX · MD · HTML · TXT (húzd be vagy tallózz).
- **Confluence URLs** — illeszd be az oldal URL-jét és nyomd meg az **Add**-et. A **Confluence credentials** résznél add meg az **Instance URL**-t és a **Personal Access Token**-t (**Save**), vagy **Clear token**. Modern (`…/pages/12345/…`) és legacy (`…/pages/viewpage.action?pageId=12345`) URL is működik.

**Gombok:**
- **▶ Import Documents** — minden hozzáadott fájlt/oldalt Markdownná alakít és elment ide: `.ai-native/imports/`. Semmi mást nem módosít.
- **✦ Analyze with AI** — beolvassa a `.ai-native/imports/` tartalmát, és AI-val előállítja/frissíti a `source.semantic.md`-t.
  - **Első import** (még nincs `source.semantic.md`): közvetlenül létrejön a `source.semantic.md`, és belőle determinisztikusan a `source.graph.json` + `source.database.json/.md` is.
  - **Újraimport** (már van `source.semantic.md`): NEM írja felül. AI-merge készül (`source.semantic.proposed.md`, konfliktus-marker nélkül), és megnyílik egy **2-paneles diff** (Current ↔ AI proposal) — lásd [Reconcile: felülvizsgálat és Apply](#reconcile-fel%C3%BClvizsg%C3%A1lat-%C3%A9s-apply).

---

## Import Source

Forráskódból dolgozik, lépésenként. Minden lépés egy **checkbox** (be/ki) + egy **▶** gomb (csak azt a lépést futtatja). Az alul lévő **▶ Run Selected Steps** a bepipált lépéseket futtatja sorban.

### Source Import
*„Java AST, project analysis, code graph”* — **determinisztikus alap**, nem igényel AI-t. Előállítja többek közt: `source.ast.json`, `source.ast-index.json`, `source.analysis.md/json`, `source.codegraph.json/md`, `source.class-index.md`, `source.database.json/md`, `source.layer-graphs.json`, `source.component-map.json`, `source.recon.json` + `source.recon.prompt.md`, `source.graph.json`, és egy determinisztikus alap `source.semantic.md`.

Al-kapcsolók:
- **jQAssistant Scan** — bytecode-szintű szken (Docker `jqassistant` szerver + lefordított jar-ok kellenek). Ez adja a mélyebb struktúra-adatokat. AI nem kell hozzá.
- **Local AI Agents** — szerepenként Ollama vagy Cloud (Settings → **Local AI Agents**). Lokális enrichment az import közben.
- **Cloud AI** — felhő-enrichment pass az import során (Settings → **AI Review Provider**). Ez finomítja/gazdagítja a `source.semantic.md`-t; **kikapcsolva a determinisztikus alap készül el.**

### Semantic Enrichment
*„Re-generates source.semantic.md from cached AST & graph artifacts”* — a már meglévő AST/gráf artifactokból újragenerálja a semantic-ot. Al-kapcsolók: **Local AI Agents**, **Cloud AI** (a megfelelő Settings szerint).

### Flow Extraction
A kód-gráf láncokat és a dokumentum-entitásokat a semantic `# processes` / `# data_flows` szekcióiba fűzi. Al-kapcsoló: **AI Synthesis** (a folyamatok AI-finomítása a merge után).

### Generate Graph
*„Canonical semantic graph from source.semantic.md”* — a `source.semantic.md`-ből előállítja a kanonikus gráfot (`source.graph.json`).
- Al-kapcsoló: **AI Review** — agentic gráf-felülvizsgálat. Bekapcsolva a felülvizsgált gráf (`source.graph.reviewed.json`) és a `source.review.md` is elkészül. Kikapcsolva csak a determinisztikus gráf frissül.
- **Előfeltétel:** friss validáció kell. A **Validation → Validate semantic** eltárol egy frissesség-jelet (`.ai-native/validation/<slug>.validation.hash`) az aktuális `source.semantic.md`-hez; ha a semantic azóta módosult, a Generate Graph figyelmeztet, hogy előbb futtass **Validate semantic**-et.

---

## Validation

Saját nézet (nem az Actions alatt). Felül két gomb, alatta a legutóbbi kimenetek listája (kattintásra megnyílnak):
- **Validate semantic** — az aktív `source.semantic.md`-t ellenőrzi a policy ellen; riportot ír a `.ai-native/validation/` alá, és eltárolja a frissesség-jelet a Generate Graph kapujához.
- **Doc-code alignment** — az importált dokumentumokból származó entitásokat veti össze a kód-gráffal, és eltéréseket jelez (`.ai-native/alignment/`).

---

## Actions

- **Show graph** — megnyitja a **mentett kanonikus gráf JSON**-t (a `source.semantic.md`-ből származtatott csúcs/él modell, **nem** maga a semantic.md). A gráf a gyökérben van (nincs `graph/` almappa) — keresési sorrend: `source.graph.reviewed.json` (felülvizsgált) → `source.graph.json` (determinisztikus). Ha egyik sincs, élőben generál a `source.semantic.md`-ből (megjeleníti, de nem menti — ez az „AI Native Graph Preview").
- **Endpoint summary** — REST · SOAP · GraphQL · Events · gRPC végpontok összegzése.
- Alul: token-hatékonysági kártya (a mért AI-hívások alapján).

## Sources

Mindig a **jelenlegi** kanonikus fájlokat mutatja (verziótörténetet a git kezeli, nincs külön file-szintű verziózás):
- **Current semantic source** → `source.semantic.md`
- **Current database schema** → `source.database.md`
- **Current review** → `source.review.md`

## Settings (Configure Settings)

- **AI Review Provider** — **Provider** (claude / codex) és **Model**. A Model egy legördülő a provider ismert modelljeivel; a **Custom…** opció hoz elő szabad-szöveges mezőt egyedi gateway-modell-ID-hez.
- **Local AI Agents** — szerepenkénti (Ollama/Cloud) modell- és képesség-beállítás.
- MCP végpontok, Confluence alap-URL.

---

## Reconcile: felülvizsgálat és Apply

Amikor az **Analyze with AI** vagy a **Source Import** egy már létező `source.semantic.md`-t találna, **nem írja felül**. Helyette:

1. Egy AI agent elkészíti a **kész, egyesített** javaslatot: `source.semantic.proposed.md` (konfliktus-marker nélkül — az új tartalom bekerül, a meglévő részletek megmaradnak).
2. Megnyílik egy **2-paneles diff**: bal = **Current** (a mostani), jobb = **AI proposal** (a javaslat). A jobb panelt kézzel szerkesztheted, ha valamit módosítanál.
3. **Apply** háromféleképp:
   - a szerkesztő jobb felső sarkában a **✓** (Apply Reconcile Proposal) gomb,
   - **Command Palette** → *„AI Native: Apply Reconcile Proposal”*,
   - a felugró értesítés **Apply** gombja.
4. Apply után a `source.semantic.md` frissül, a tranziens fájlok törlődnek, és **determinisztikusan újragenerálódik a `source.graph.json` + a `source.database.json/.md`** (hogy szinkronban maradjanak az új semantic-kal).

> A kanonikus gráf JSON így **mindig frissül, amikor a `source.semantic.md` készül/frissül** (első import, Apply, Source Import) — a **Show graph** ezt a mentett gráfot nyitja meg, nem generál újat.
>
> Megjegyzés: az Apply a *sima* (`source.graph.json`) gráfot frissíti. A felülvizsgált gráf (`source.graph.reviewed.json`) csak a **Generate Graph → AI Review** futtatásával frissül.

---

## Példa 1 — Dokumentum importálása

1. Nyisd meg az **Import Document** nézetet.
2. **Local files → Add documents** (húzd be a fájlt), vagy Confluence esetén állítsd be a **Confluence credentials**-t, majd illeszd be az oldal URL-jét és **Add**.
3. **▶ Import Documents** — a dokumentumok Markdownként a `.ai-native/imports/`-ba kerülnek.
4. **✦ Analyze with AI** — elkészül/frissül a `source.semantic.md`.
   - Ha már volt semantic: nézd át a **2-paneles diff**-et, szükség szerint szerkeszd a jobb panelt, majd **✓ Apply**. Apply után a gráf + database schema is frissül.
5. Ellenőrzés: a **Sources** nézetben nyisd meg a *Current semantic source*-t.

## Példa 2 — Gráfok frissítése a hatékonyabb AI agentic munkavégzéshez

A fejlesztési taskok kontextusa a `source.semantic.md`-ből és a kód-oldali fájlokból (`source.codegraph.json`, `source.ast-index.json`, `source.class-index.md`, `source.analysis.md`, `source.database.md`, `source.layer-graphs.json`, `source.component-map.json`) épül. Ezek frissen tartása jobb agentic eredményt ad.

**Ha a `source.semantic.md` frissült (pl. dokumentum-import után):**
- A gráf + database schema az **Apply**-kor már determinisztikusan frissült. Ha a **felülvizsgált** gráfot is naprakészen akarod:
  1. **Validation → Validate semantic** (hogy a frissesség-jel az aktuális semantic-ra álljon).
  2. **Import Source** → pipáld ki csak a **Generate Graph** lépést, kapcsold be az **AI Review** al-kapcsolót → **▶ Run Selected Steps**.
  3. Az eredményt az **Actions → Show graph** nyitja meg.

**Ha a forráskód változott:**
- **Import Source** → **Source Import** (+ **jQAssistant Scan**) → **Run Selected Steps**: frissíti a kód-oldali fájlokat (AST, code graph, class-index, layer/component map, database).
- Ezután **Validate semantic**, majd **Generate Graph** (kívánság szerint **AI Review**-val).

> Tipp a költségre: a determinisztikus lépések (Source Import, jQAssistant Scan, Generate Graph AI Review nélkül) nem hívnak felhő-AI-t. A felhő-AI-t igénylő al-kapcsolók: **Cloud AI**, **AI Synthesis**, **AI Review**, és az **✦ Analyze with AI**.
