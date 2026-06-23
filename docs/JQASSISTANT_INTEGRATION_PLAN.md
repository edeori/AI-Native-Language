# jQAssistant Integration Plan

This document captures the execution plan for introducing `jQAssistant` into the current source import pipeline without replacing the existing `tree-sitter` and deterministic graph flow.

## Goal

Use `jQAssistant` as a second deterministic evidence source before AI-based interpretation.

The intended effect is:

- less module-level AI scanning
- stronger application and dependency evidence
- better graph inputs for preview and flow generation
- lower token usage during import and iteration

## Target architecture

The target pipeline is:

1. filesystem and build scan
2. current Java AST / `tree-sitter`-backed scan
3. `jQAssistant` scan
4. deterministic merge layer
5. code graph / preview / component / flow artifacts
6. local AI only for enrichment and wording

The important rule is:

- `jQAssistant` is deterministic evidence
- AI is not allowed to replace deterministic graph facts

## Why this is worth doing

The expensive part of the current workflow is not only graph generation.
The real cost comes from asking AI to interpret modules that are still under-described.

If `jQAssistant` gives us better structural evidence up front, we can remove or narrow AI from:

- module interpretation
- package grouping hints
- dependency guessing
- some component packaging ambiguity

## What stays as-is

These parts should remain in place:

- current source import pipeline
- current AST / code graph generation
- current artifact layout under `source.*`
- current local enrichment layer

This is not a rewrite.
It is a deterministic augmentation step.

## What `jQAssistant` should contribute

The first useful outputs are:

- Maven and module structure evidence
- application boundary evidence
- package and dependency evidence
- Java type and structural relationship evidence
- future query support for architectural rules

Later, it can support:

- stronger call/dependency correlation
- framework-specific structure rules
- more accurate component grouping

## Integration point

The current best insertion point is:

- after `analyzeProject()`
- after `buildSnapshot()`
- before `buildCodeKnowledgeGraph()`

That gives `jQAssistant` access to already known project context, but still keeps it in the deterministic half of the pipeline.

## Execution phases

### Phase 1: MCP scaffold and artifact wiring

Goal:

- add a dedicated `jqassistant` MCP server
- add `source.jqassistant.json`
- add a pipeline hook that does not break existing imports

Success criteria:

- import still works with `jQAssistant` disabled
- a stable artifact is always written
- build stays green

### Phase 2: MCP runtime validation

Goal:

- detect whether `jQAssistant` is available in the MCP runtime
- report version and command path from the MCP host
- expose explicit status in the artifact

Success criteria:

- no hidden failure
- clear skipped / failed / completed status

### Phase 3: First real scan integration

Goal:

- execute a deterministic scan against the source project
- capture machine-usable summary data
- keep the output decoupled from AI

Success criteria:

- no import failure if scan is unavailable
- reproducible scan output
- project-level structural evidence becomes queryable

### Phase 4: Deterministic merge layer

Goal:

- merge `tree-sitter` findings with `jQAssistant` findings
- prefer deterministic facts over guesses

Merge policy:

- file/package/type facts remain source-of-truth from the existing parser unless `jQAssistant` adds stronger structural evidence
- dependency and module relations may be enriched by `jQAssistant`
- no AI merge at this layer

### Phase 5: AI reduction pass

Goal:

- shrink or remove AI tasks that become redundant after deterministic merge

Candidates for reduction:

- module classifier scope
- AST component ambiguity prompts
- component packaging prompts
- some repository-purpose prompts

## First implementation slice

The first slice is intentionally narrow:

1. add a `jqassistant` MCP server
2. add `source.jqassistant.json`
3. run a deterministic `jQAssistant` MCP hook during import
4. record:
   - MCP-provided command
   - binary availability
   - version probe result
   - current project summary

This gives the pipeline a place to attach real scan output next, without blocking the existing workflow.

## Planned artifact contract

`source.jqassistant.json` should evolve into:

- status
- command
- version
- scan mode
- warning/error state
- project summary
- later: extracted structural evidence
- later: merge-ready deterministic facts

## What not to do

- do not replace the existing AST pipeline
- do not make AI depend on raw `jQAssistant` output directly
- do not require `jQAssistant` for successful import
- do not couple the first implementation to Neo4j UI assumptions

## Near-term follow-up tasks

After the scaffold lands, the next concrete tasks should be:

1. connect the `jqassistant` MCP output to a real parsed structural summary
2. add explicit MCP-side health and capability reporting
3. decide whether scan execution is pure CLI wrapping or richer server-side orchestration
4. define the minimal extracted summary needed for deterministic merge
5. connect merged facts to preview/component generation

## Expected savings

Savings should come from:

- fewer AI module scans
- smaller AI prompts
- fewer retries due to weak deterministic context
- narrower flow and component interpretation tasks

The expected cost reduction does not come from replacing one AI with another.
It comes from moving more of the understanding step into deterministic graph evidence.
