# Target Processing Pipeline

This document describes the intended fixed processing pipeline for source import, graph construction, and semantic generation.

The goal is to reduce unnecessary AI interaction, keep the graph build deterministic, and move AI usage toward verification and enrichment only.

## 0. Primary objective

The primary objective of this pipeline is not only to generate documentation.

Its main purpose is to create structured support artifacts that allow later AI-assisted implementation work to run:

- faster
- with less source rescanning
- with smaller context windows
- with fewer tokens
- with more deterministic grounding

In practice, this means the pipeline should produce artifacts that act as reusable execution memory for future AI-assisted development tasks.

## 0.1. AI-facing artifact strategy

The generated artifacts should help AI avoid reading the raw codebase again unless strictly necessary.

The intended usage model is:

1. deterministic tools scan and index the code
2. structured intermediate artifacts are written locally
3. later AI execution consumes those artifacts first
4. raw code access becomes the fallback, not the default

## 0.2. Artifact design rules

Every artifact produced by this pipeline should follow these rules:

- reduce future code scanning
- be easy to slice by application, module, class, or layer
- be stable enough to reuse across multiple tasks
- be readable by both machines and developers
- contain enough identifiers to support direct lookup
- help AI find exact locations with minimal re-analysis

## 0.3. AI-facing vs human-facing outputs

The pipeline should explicitly support two output groups.

### AI-facing execution artifacts

These are the primary optimization target.

Examples:

- AST indexes
- `jqassistant` structure graphs
- deterministic application graphs
- layer-specific graphs
- verification outputs
- class/module function summaries
- helper JSON and helper markdown files

### Human-facing artifacts

These are still useful, but secondary.

Examples:

- semantic markdown
- preview summaries
- architectural explanations

The human-facing outputs should ideally be generated from the AI-facing artifacts, not built as the first-class execution substrate.

## 1. Core principles

- deterministic graph building comes first
- AST and `jqassistant` are the primary technical evidence sources
- AI does not replace structural extraction
- AI is used only for:
  - verification
  - ambiguity handling
  - human-readable summarization
  - optional class/module semantic enrichment
- every major stage must persist structured artifacts locally
- generated graphs must be display-oriented and easy to verify from a developer perspective

## 2. Desired fixed pipeline

The intended processing order is:

1. AST generation
2. AST indexing and representative storage
3. `jqassistant` scan
4. `jqassistant` artifact extraction and indexing
5. deterministic heuristic analysis
6. deterministic graph generation in MCP
7. graph verification pass using AST + `jqassistant`
8. optional atomized AI enrichment per class/module/layer
9. display-oriented graph shaping
10. semantic description generation from produced artifacts

## 3. Stage 1: AST generation

### Purpose

The pipeline starts by generating the AST for the application source.

### Requirements

- this must run first
- the raw AST output must be persisted locally
- the AST output should be stored in a form that is:
  - queryable
  - indexed
  - representative enough to find exact locations during later development

### Expected artifact

At minimum:

- `source.ast.json`

### Desired enhancement

Besides the raw AST, we should also keep an indexed representation that makes later lookup easier.

Possible forms:

- symbol index
- package/class/method index
- annotation index
- import/dependency index
- endpoint and config index

### Execution note

This stage should remain deterministic.

AI may help index or compress the AST into a more usable representation, but it should not be required for the primary AST artifact.

## 4. Stage 2: `jqassistant` scan

### Purpose

After AST generation, `jqassistant` runs to collect structural and architectural evidence.

### Required output areas

`jqassistant` should gather, as far as it can:

- Maven module structure
- structural checks
- dependency structure
- architectural information
- package-level relationships
- application-level relationships
- and, if supported, flow-related information

### Requirements

- output must be persisted locally
- outputs must be structured
- outputs must be indexable and easy to query later
- outputs must be usable independently from AI

### Expected artifacts

At minimum:

- `source.jqassistant.json`

Preferred additional artifacts:

- application structure graph
- dependency graph
- module graph
- package relation graph
- flow graph if `jqassistant` can provide one
- any auxiliary indexed files that make later lookup cheaper for AI and deterministic tooling

## 5. Stage 3: deterministic heuristic analysis

### Purpose

The analysis phase should remain mostly as-is conceptually, but should become more explicitly deterministic and heuristic-driven.

### Evidence sources

The analysis phase should use:

- AST outputs
- AST indexes
- `jqassistant` outputs
- configuration files
- YAML files
- SQL files
- OpenAPI files
- Maven metadata

### Expected behavior

Layer and role recognition should be based on deterministic heuristics.

These should be recognizable without AI in most cases:

- API
- controller
- service
- persistence
- common
- security
- clients
- app/bootstrap
- config
- listeners
- schedulers
- websocket / realtime

### Important rule

Analysis should not depend on AI to identify these layers.

AI can only help later if:

- heuristics are ambiguous
- naming is poor
- package structure is non-standard

## 6. Stage 4: deterministic graph generation in MCP

### Purpose

After analysis, the system should build a deterministic graph using AST and `jqassistant` outputs.

### Requirements

- the graph should be built in an MCP server
- the graph should not depend on semantic markdown yet
- the graph should be developer-oriented and verifiable

### Inputs

- AST
- AST indexes
- `jqassistant` structured outputs
- deterministic analysis outputs
- config/YAML/OpenAPI/SQL summaries

### Expected graph characteristics

The graph should already be:

- categorized
- display-oriented
- stable enough for developer verification

### Developer verification goal

Developers should be able to check:

- whether components were recognized correctly
- whether dependencies are correct
- whether architectural grouping is correct
- whether the flow of the application is plausible from the code

## 7. Stage 5: graph verification pass

### Purpose

After deterministic graph generation, an agent should run to verify whether the generated graphs are actually traversable and consistent with the code evidence.

### Inputs

- AST outputs
- `jqassistant` outputs
- deterministic graph outputs
- deterministic analysis outputs

### Role of the agent

The agent should not invent structure.

It should:

- traverse the produced graph
- compare it with AST and `jqassistant` evidence
- mark routes as:
  - ok
  - unclear
  - inconsistent
  - needs correction

### Expected output

This stage must emit a reusable structured artifact for later semantic generation.

Possible form:

- graph verification report
- traversability report
- route verification notes
- correction candidates
- path-family verification slices that can be loaded independently

### Cost warning

This stage may become expensive.

The cost risk is highest when:

- the agent traverses the full graph repeatedly
- it works on very large applications
- it tries to validate too many paths in one pass

### Recommended constraint

To keep cost acceptable, verification should be:

- sliced
- path-family based
- incremental where possible

For example:

- API routes
- scheduler flows
- listener flows
- persistence-heavy areas

## 8. Stage 6: optional atomized AI enrichment

### Purpose

After deterministic graph and verification outputs exist, atomized AI enrichment may run on small slices.

### Intended granularity

This enrichment should be able to run per:

- class
- interface
- module
- package
- layer

### Example use cases

- summarize a class function
- summarize a module purpose
- explain the role of a layer
- attach semantic hints to graph nodes

### Current behavior: two separate enrichment tiers

AI enrichment is split into two independent tiers that run at different times and must be triggered separately.

**Tier 1 — Local Ollama enrichment (runs automatically during Source Import)**

When the Source Import action is triggered from the menu, local Ollama agents run inline as part of the import pipeline.

The following agents execute automatically:

- `moduleClassifier` — internal module boundary recognition
- `astComponentClassifier` — Java class component role detection
- `repositoryPurpose` — repository purpose description
- `sqlMigrationSemantics` — SQL migration semantics
- `flowCandidate` — flow candidate identification
- `componentPackaging` — component packaging hints
- `generalEnrichment` — general node enrichment

These agents call a locally running Ollama instance (default: `http://127.0.0.1:11434`).
They do not contact any external AI provider.
Model configuration lives in `.ai-native/config/models.yaml` inside the target project.

**Tier 2 — Cloud AI enrichment (separate manual action, does not run automatically)**

Cloud AI enrichment (Claude or Codex) does not run during Source Import.

It must be triggered explicitly via the "Run AI Enrichment" action in the plugin.

This action runs with:

- `enableOllamaEnrichment: false`
- `enableCloudEnrichment: true`

It does not re-run local Ollama agents.

### Important rule

The two tiers are mutually exclusive per action invocation.

Source Import runs Ollama only.
The separate enrichment action runs cloud AI only.

### Expected outputs

These should become AI-specific graph enrichments, not replacements of deterministic facts.

These outputs are primarily execution-support artifacts for later AI tasks.

## 9. Stage 7: display-oriented graph shaping

### Purpose

The graph must be shaped so it can be rendered and verified clearly in the UI.

### Requirement

The graph should not only be machine-correct.
It should also be easy to inspect.

### Developer-facing design goal

The graph must support:

- architectural verification
- heuristic verification
- deterministic interpretation verification
- efficient AI-assisted follow-up work

### Expected display structure

The graph should be categorizable into:

- applications
- modules
- layers
- flows
- dependencies
- security
- persistence
- integration clients

### Optional split

It may be useful to create separate or semi-separate graphs per layer, such as:

- API graph
- controller graph
- service graph
- persistence graph
- security graph
- common graph
- clients graph

## 10. Stage 8: semantic description generation

### Purpose

After all structured artifacts exist, AI should run on those artifacts to create semantic markdown.

### Inputs to semantic generation

The semantic writer should use:

- AST artifacts
- `jqassistant` artifacts
- deterministic graph
- AI-specific enrichment graph(s)
- verification reports
- helper JSON files
- helper markdown files

### Output style

The resulting semantic description should:

- contain keywords
- remain human-readable
- describe what is visible in the code
- rely on already produced artifacts rather than raw source whenever possible

The semantic description is not the only goal.

It is one derived output from a larger execution-support artifact system.

### Additional support

If there is already an MCP-based keyword or “how do I describe what I see in code” support layer, it should be reused here.

If it is incomplete, it needs further development.

## 11. Required artifact families

The following artifact groups are considered necessary.

### 11.1. AST artifacts

- raw AST
- AST indexes
- symbol/class/method/package lookups

### 11.2. `jqassistant` artifacts

- application structure graph
- dependency graph
- module graph
- architectural graph
- flow graph if available

### 11.3. Deterministic graph artifacts

- graph built from AST + `jqassistant`
- categorized graph for developer verification

### 11.4. AI-specific graph artifacts

These should extend, not replace, the deterministic graph.

Expected contents:

- class-level function summaries
- module-level purpose summaries
- layer-level semantic hints
- optional route/function notes

These are valuable because they help later AI-assisted implementation work operate on compact, reusable summaries instead of re-reading large code slices.

### 11.5. Layer-specific graphs

Potential split:

- API
- controller
- service
- persistence
- security
- common
- clients
- scheduler/listener

### 11.6. Verification artifacts

- graph verification report
- traversability notes
- correction candidates

### 11.7. Semantic artifacts

- semantic markdown
- semantic support files

## 12. Database schema path

The current database schema interpretation is considered good enough for now.

### Current decision

- keep the current behavior
- do not optimize this yet unless token cost becomes a real problem

### Future note

If cost becomes too high, this should be revisited separately.

## 13. Open technical questions

These questions are still open and should be clarified before or during implementation.

### 13.1. AST indexing format

We still need to decide:

- what exact indexed representation should be stored
- whether it is one file or several files
- how queryable it needs to be

### 13.2. `jqassistant` flow capability

We still need a concrete answer for:

- what exact flow-related outputs `jqassistant` can provide
- whether it has a usable flow model for our purpose
- whether we must supplement it with our own deterministic flow tracing

### 13.3. Graph verification cost

We still need to settle:

- how broad the verification pass should be
- how much of it is feasible with AI
- what granularity keeps it affordable

### 13.4. Deterministic graph MCP server scope

Decision:

- deterministic graph generation runs in-process via the shared library (`buildDeterministicGraphArtifacts`)

### 13.5. AI-specific graph split

We still need to decide:

- one AI-specific graph
- or multiple layer-specific AI graphs

## 14. Recommended implementation direction

The implementation direction implied by this document is:

1. keep AST as first deterministic source
2. strengthen `jqassistant` as second deterministic source
3. generate structured local artifacts at every major step
4. build the primary graph deterministically in MCP
5. add graph verification on top
6. only then use AI for enrichment and semantic writing

## 16. Optimization outcome we want

The expected end-state is that future AI-assisted implementation tasks should be able to work mostly from:

- indexed AST artifacts
- `jqassistant` graphs
- deterministic application graphs
- AI-specific enrichment graphs
- verification outputs
- helper structured summaries

Instead of repeatedly doing:

- full repo scanning
- repeated module reading
- large-context code interpretation
- expensive flow rediscovery

## 15. Main expected benefit

The main expected benefit is lower AI usage with stronger deterministic coverage.

The expected outcome is:

- less module-level AI scanning
- fewer oversized prompts
- easier developer verification
- better reproducibility
- more controllable graph generation
