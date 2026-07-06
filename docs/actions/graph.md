# Show graph

**Command:** `aiNative.openGraphPreview`  
**Elérés:** Actions panel → Graph szekció gomb

Megnyitja a legutóbbi kanonikus gráf vizualizációját a `GraphPreviewPanel`-ben.

### Keresési sorrend

1. Ha van kanonikus gráf az aktív semantic.md-hez (`.ai-native/graph/<slug>.graph.json`, ill. a source-import ág `source.graph.reviewed.json` / `source.graph.json` fájlja): azt nyitja meg
2. Ha van `source.semantic.md` de nincs mentett gráf: élő gráfot generál az MCP-vel (`persist: false`) és megjeleníti — de nem menti el
3. Ha nincs semmi: figyelmeztetés

A `GraphPreviewPanel` interaktív webview: csúcsok és élek kattinthatók, zoomolható.

---

# Endpoint summary

**Command:** `aiNative.showEndpoints`  
**Elérés:** Actions panel → Graph szekció gomb

Megnyitja az `EndpointSummaryPanel`-t, amely a kódgráfból kinyert összes végpontot mutatja:

- REST endpoints (`@GetMapping`, `@PostMapping`, stb.)
- SOAP service operációk
- GraphQL query/mutation definíciók
- Event/message channel-ek (Kafka, RabbitMQ)
- gRPC service-ek

A legutóbbi `source.codegraph.json` (ill. kanonikus gráf) fájlból olvassa az adatokat. Nincs MCP hívás — in-process feldolgozás.
