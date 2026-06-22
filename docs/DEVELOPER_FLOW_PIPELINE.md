# Developer Flow Pipeline

This document describes how developer-facing flow extraction currently works in the source import pipeline.
The goal is to produce a structured `source.flow-map.json` artifact before semantic markdown assembly, while keeping deterministic graph facts authoritative.

## Purpose

The flow pipeline answers a different question than the architecture preview.

- architecture preview explains what applications and components exist
- flow extraction explains how behavior moves through the system
- semantic markdown turns these findings into human-readable documentation

The flow pipeline is designed for:

- API-driven use cases
- scheduled jobs
- listener and event-driven execution
- startup and batch entrypoints
- later human semantic assembly

## Position in the import pipeline

During source import, the relevant stages are:

1. repository scan and analysis
2. snapshot creation
3. deterministic code knowledge graph build
4. deterministic flow map draft
5. local `flow-candidate-agent` enrichment on sliced deterministic inputs
6. final `source.flow-map.json` generation
7. semantic markdown suggestion and optional polishing

The important constraint is that local AI never replaces deterministic graph facts.
It can only add candidate interpretations on top of already discovered deterministic artifacts.

## Inputs

The flow pipeline currently uses these deterministic sources:

- `source.analysis.json`
- `source.snapshot.json`
- `source.codegraph.json`
- endpoint catalog
- service summary
- scheduled job summary
- async listener summary
- application layouts

Optional local enrichment input:

- `.ai-native/enrichment/flow-candidates/latest.json`

## Stage 1: Entrypoint Discovery

Entrypoint discovery collects all known flow starting points into a normalized list.

### Currently detected entrypoint classes

- REST endpoints
- webhook endpoints
- callback endpoints
- SOAP endpoints
- Spring `@Scheduled` methods
- Quartz-like scheduled jobs
- generic schedulers
- batch jobs
- startup runners
- Kafka listeners
- Rabbit listeners
- JMS listeners
- MDB listeners
- Spring event handlers

### Detection sources

- `analysis.endpointCatalog` for HTTP-style entrypoints
- `analysis.serviceSummary.scheduledJobs` for scheduled entrypoints
- `analysis.serviceSummary.asyncListeners` for async listener entrypoints
- `analysis.javaAstCatalog` annotations and method/type heuristics for framework-driven entrypoints

### Entrypoint output shape

Each entrypoint carries:

- stable `entrypointId`
- `applicationId`
- normalized `kind`
- human-readable `name`
- `trigger`
- `target`
- source reference
- node hints
- evidence

This becomes the `stages.entrypointDiscovery.entrypoints` section in `source.flow-map.json`.

## Stage 2: Flow Trace

The flow trace stage builds deterministic technical traces from each entrypoint.

The trace builder starts from the discovered entrypoint and attempts to walk through:

- controller or entry adapter
- primary service
- collaborator services
- validators
- mappers
- repositories
- listener-driven repository effects
- scheduled-job repository effects

### Trace strategy

The implementation is intentionally conservative.

- it prefers known summary artifacts and graph-backed node lookup
- it matches service candidates from deterministic service summaries
- it adds collaborator steps only when there is explicit summary evidence
- it adds repository steps for listeners and schedulers only when repository names can be extracted from deterministic effect descriptions

If no strong deterministic service match exists, the trace is still emitted, but it carries a warning.

### Step roles

Current step roles include:

- `entrypoint`
- `controller`
- `service`
- `validator`
- `mapper`
- `repository`
- `listener`
- `scheduler`
- `helper`

This becomes the `stages.flowTrace.traces` section in `source.flow-map.json`.

## Stage 3: Flow Boundary and Clustering

Raw traces are usually too granular to present directly.
The clustering stage groups related traces into higher-level flows.

### Current clustering logic

Each trace is grouped around an anchor:

1. primary service if available
2. otherwise controller, listener, or scheduler node
3. otherwise entrypoint target
4. otherwise the entrypoint id itself

This produces application-scoped clusters with:

- `clusterId`
- `applicationId`
- inferred `flowType`
- cluster `name`
- grouped `entrypointIds`
- grouped `traceIds`
- shared helpers
- supporting evidence

### Why this stage exists

Without clustering, the UI tends to produce one flat technical chain per entrypoint.
Clustering creates a more usable intermediate form for:

- related API routes
- scheduled job families
- listener-driven subflows
- shared helper-heavy traces

This becomes the `stages.flowBoundaryClustering.clusters` section in `source.flow-map.json`.

## Stage 4: Flow Semantic Interpreter

The semantic interpreter converts clustered technical traces into developer-readable flows.

### Current interpretation sources

The interpreter combines:

- cluster data
- primary deterministic trace
- known flow summaries from `analysis.flowSummary.flows`
- entrypoint evidence
- trace evidence
- cluster evidence
- optional local `flow-candidate-agent` outputs

### Output fields

Each semantic flow currently contains:

- `flowId`
- `applicationId`
- `name`
- `flowType`
- `trigger`
- `actor`
- `businessMeaning`
- `technicalPath`
- `outcome`
- `confidence`
- `evidence`
- `warnings`
- `candidateInterpretations`

### Local AI role

The local `flow-candidate-agent` is allowed to suggest candidate interpretations, but:

- deterministic meaning remains primary
- candidate interpretations are attached, not promoted to facts
- contradictory candidate types are later validated

The current slicer sends smaller deterministic subsets to the local agent:

- API flows
- scheduled flows
- event/listener flows

This becomes the `stages.flowSemanticInterpreter.flows` section in `source.flow-map.json`.

## Stage 5: Flow Validation

The final stage validates semantic flows back against the deterministic code graph.

### Current validation checks

- low evidence
- utility noise
- mixed flows
- missing node references
- broken graph edges between adjacent flow steps
- semantic contradictions between deterministic flow type and local candidate flow type

### Validation intent

This stage does not try to make flows prettier.
Its job is to reject or warn on flows that are structurally weak.

Typical failure patterns:

- the semantic path references a node that does not exist in the graph
- adjacent technical steps are not connected in the deterministic graph
- a trace is dominated by validators, helpers, or mappers
- one trace appears to mix several business flows

This becomes the `stages.flowValidation.issues` section in `source.flow-map.json`.

## `source.flow-map.json` structure

The generated flow artifact currently contains:

- `schemaVersion`
- `generatedAt`
- `projectName`
- `applications`
- `stages.entrypointDiscovery`
- `stages.flowTrace`
- `stages.flowBoundaryClustering`
- `stages.flowSemanticInterpreter`
- `stages.flowValidation`
- `triggers`
- `flows`
- `eventFlow`
- `scheduledJobs`
- `asyncListeners`
- `endpointFamilies`
- `flowTraces`

This file is intended as the machine-facing flow artifact for:

- graph preview
- future developer flow views
- semantic markdown assembly
- cloud review dossiers

## Relationship to semantic markdown

The flow map is not the final human document.
It is an intermediate structured artifact.

The intended layering is:

1. deterministic graph facts
2. structured flow artifact in `source.flow-map.json`
3. optional local enrichment candidates
4. human-readable semantic markdown

That separation matters because the markdown should stay readable, while the flow map can stay more explicit and machine-oriented.

## Current limits

The current implementation is materially better than the old single-pass flow summary, but it still has limits.

- trace building is summary-driven in several places, not full interprocedural call-graph execution
- interface and bean resolution is still intentionally conservative
- local AI interpretations are stored as candidates, not merged facts
- clustering is anchor-based and may still need finer subflow separation on complex services
- some frameworks are detected by heuristic annotation matching rather than deep framework modeling

## Expected next steps

The natural next improvements are:

- stronger deterministic bean/interface resolution in flow tracing
- better subflow splitting inside large service classes
- dedicated developer flow UI built directly from `source.flow-map.json`
- clearer linkage between flow steps and component cards
- better iteration support so human flow edits can be preserved and compared between rescans

## Summary

The current developer flow pipeline is a five-stage process:

1. discover entrypoints
2. build deterministic traces
3. cluster traces into meaningful flow boundaries
4. interpret flows into developer-readable semantics
5. validate the result against the deterministic graph

That gives the system a stable intermediate artifact, `source.flow-map.json`, which is structured enough for tools and still usable as the basis for later human-facing documentation.
