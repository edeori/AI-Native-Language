# Semantic Sync — részletes terv

A Semantic Sync egy manuálisan indítható akció, ami a legutóbbi implementációs taskokat megvizsgálva javasol frissítéseket a `source.semantic.md`-ben.

---

## Miért kell ez

A `source.semantic.md` üzleti/rendszer szintű leírás — nem fejlesztő írja, hanem üzleti igényekből, LRT-ből, rendszertervből születik. De az implementáció közben a valóság finomodik: új üzleti korlátok kerülnek be, meglévő folyamatok módosulnak, kontrakt szegések derülnek ki.

A `docDrift` flag jelzi, hogy *valamiféle* semantic érintettség volt. A Semantic Sync arra válaszol, hogy *pontosan mit* kellene frissíteni.

---

## Mikor futtasd

Nem kell minden task után. Érdemes futtatni:
- Amikor 3-5 `docDrift: true` task összegyűlt az utolsó sync óta
- Mielőtt új üzleti funkciót kezdenél (tiszta lappal indulj)
- Sprint/milestone végén

Ezt a mérőszámot (`tasksSinceLastSync`, `driftsSinceLastSync`) a retrospektív során kell kalibrálni.

---

## Implementációs terv (plugin)

**Hol:** Actions panel → új gomb a Validation szekció alatt: `⇄ Sync semantic`

**Input összegyűjtés:**
1. Jelenlegi `source.semantic.md` tartalma
2. Az utolsó Semantic Sync óta keletkezett task-ok `report.md`-jei (vagy az utolsó 5, ha nincs sync timestamp)
3. `git diff {lastSyncCommit}..HEAD` — mi változott a kódban

**Utolsó sync timestamp tárolása:** `.ai-native/development/sync-history.json`
```json
[{ "timestamp": "2026-06-29T14:00:00Z", "tasksSynced": ["20260629-event-app-be", "..."] }]
```

**Claude prompt:**
> Lásd: [03-retrospective-prompts.md](03-retrospective-prompts.md) — "Semantic Sync prompt" szekció

**Output kezelése:**
- Claude markdown diff-et javasol: `## section name` + konkrét módosítás
- VSCode QuickPick: "Apply suggested changes" / "Show diff" / "Cancel"
- Ha apply: a módosítások bekerülnek a `source.semantic.md`-be (Claudetól érkező szekció-frissítések)
- Sync timestamp frissül

**Cost becslés (majd mérni kell):**
- Input: semantic (~2000 token) + N report (~500 token/db) + git diff (~1000 token) ≈ 5000-8000 token per sync
- Output: javasolt szekció-frissítések ≈ ~500-1500 token
- Összesen: kb. 1-2 Claude Sonnet API hívás értéke

---

## Mérőszámok a kalibrációhoz

Minden sync után rögzítendő (automatikusan vagy kézzel `sync-history.json`-ba):

```json
{
  "timestamp": "...",
  "tasksSincePrevSync": 6,
  "driftFlagsSincePrevSync": 3,
  "sectionsModified": 2,
  "inputTokens": 6200,
  "outputTokens": 800,
  "developerAccepted": true
}
```

Ebből 5-10 sync után látható lesz:
- Átlagosan hány task után van érdemi semantic változás
- A drift flag-ek jó prediktorok-e (sok drift → sok módosítás?)
- Mennyibe kerül egy sync valójában
