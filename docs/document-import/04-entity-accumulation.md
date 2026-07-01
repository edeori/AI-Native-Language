# 4. Entitás-akkumuláció — elavult

Ez a lépés a régi flow része volt, ahol az MCP szerver heurisztikus elemzése (`analyze_document_for_semantic`) dokumentumonként entity listákat adott vissza, ezeket az extension akkumulálta, és `doc-entities.json`-ba mentette.

**Az új flow-ban ez a lépés nem létezik.** Az AI analízis (`runAnalyzeDocImports`) egyből `source.semantic.md`-t ír az összes dokumentum alapján. `doc-entities.json` nem keletkezik az import folyamat során.

Ha downstream lépések (pl. Doc-Code Alignment) `doc-entities.json`-t igényelnek, azt manuálisan kell létrehozni, vagy a jövőben az AI analízis lépés bővíthető.
