# AI Native Semantic Workflow

This document describes the practical development workflow for using the semantic language and compiler pipeline.

## Core Idea

The senior or lead developer should write intent and semantic constraints, not handcraft full target code as the primary workflow.

The workflow is:

```text
human intent
    ↓
semantic description in markdown
    ↓
AI-assisted normalization
    ↓
canonical IR
    ↓
validation and test generation
    ↓
target code generation
    ↓
fast verification
    ↓
review and refinement
```

## Desired Developer Experience

The workflow should feel closer to classical coding than to a chat-only prompt loop.

The developer should be able to:

- edit semantic files in the IDE
- get instant local validation feedback
- trigger generation on demand
- inspect semantic diffs and generated diffs
- keep working while background generation runs

The goal is not "ask, wait, inspect, ask again" as the main interaction pattern.

## Developer Adoption Strategy

The system should not rely on forcing developers to write semantic markdown.

Instead, it should win on experience:

- faster feedback than chat
- clearer diffs than chat
- better reuse than repeated prompting
- better traceability than ad hoc agent output
- less waiting by moving expensive work into background jobs

### Adoption Path

1. Start with familiar markdown files that are easy to edit and review.
2. Add a plugin that makes semantic edits feel interactive and visual.
3. Show immediate validation and semantic diffs on every change.
4. Let the developer trigger generation without leaving the editor.
5. Make the semantic source the easiest way to express durable changes.
6. Keep chat as an auxiliary tool for exploration, not the main development surface.

### What Will Make Developers Actually Use It

- If the markdown workflow is slower than chat, it will fail.
- If the markdown workflow is more precise, more visible, and less repetitive than chat, it can win.
- The key product goal is to make semantic editing feel like real development, not documentation writing.

## Latency Strategy

- Put the fastest checks locally and make them synchronous.
- Put expensive generation and transformation steps in the background.
- Avoid asking the AI to do work that a deterministic parser, validator, or template engine can do.
- Prefer incremental regeneration over full regeneration.
- Regenerate only the affected semantic slice and its downstream targets.
- Use cached canonical IR and cached intermediate artifacts wherever possible.

## Runner Architecture

The current implementation uses MCP (Model Context Protocol) servers running in Docker containers on a local bridge network (`10.9.0.2`). These cover the deterministic, in-process work:

- Java AST parsing and caching
- jQAssistant bytecode analysis
- Canonical graph generation
- Semantic validation
- Doc-code alignment checks
- Reconnaissance prompt generation

Cloud AI (Claude via Anthropic API) handles:
- Complex semantic enrichment (agentic review bundle)
- Ambiguous intent extraction
- Cases requiring reasoning beyond local model capability

Local Ollama can substitute for cloud AI for:
- Semantic enrichment when the Ollama endpoint is configured
- Offline or privacy-sensitive environments

### Practical Split

```text
Developer edit
    ↓
MCP servers (Docker, local): parse / validate / graph / alignment
    ↓
only if needed: Ollama (local) or Claude API (cloud)
    ↓
enriched canonical IR
    ↓
versioned artifacts saved to .ai-native/
```

The best cost model is MCP-first (fast, no token cost), cloud-when-necessary.

## What Can Realistically Run On A Developer Laptop

The pilot should assume that a developer laptop can comfortably run:

- semantic file parsing
- schema validation
- invariant checks
- diff generation
- cache lookup and artifact storage
- incremental IR normalization for small or medium slices
- lightweight local code generation
- local smoke tests

The laptop should not be assumed to handle well:

- whole-codebase normalization on very large repos
- heavyweight analysis across massive legacy systems
- large-model inference unless a compact local model is intentionally chosen
- broad multi-target recompilation on every small edit

### Practical Boundary

- small semantic slices should run locally
- large migrations should be split into chunks
- cloud or server-side runners should handle heavy batch steps
- the developer should be able to keep working while the larger jobs continue elsewhere

## What An Agent Means Here

An agent is a controlled worker that can:

- read context
- choose from a bounded set of tools
- execute a small sequence of steps
- report results
- stop at a policy boundary

It is not a fully free-form autonomous developer.

### Agent Behavior Model

```text
input context
    ↓
plan within bounded scope
    ↓
call tools or local runners
    ↓
collect results
    ↓
apply small step
    ↓
emit diff / validation / next action
```

### Good Agent Properties

- bounded scope
- explicit inputs and outputs
- deterministic tool use where possible
- stop conditions
- diff-based feedback
- no silent edits outside the allowed area
- strict task definition before execution
- policy-limited action space
- reproducible steps and traceable outputs
- no "do it however you feel" autonomy

### Agent Control Principle

- Every agent task should be specified as a constrained job, not a vague goal.
- The agent should know:
  - what it is allowed to read
  - what it is allowed to write
  - which tools it may call
  - when it must stop
  - what output format is expected
- If a task cannot be bounded clearly, it should be split into smaller tasks instead of being left open-ended.

### Where Agents Fit Best

- semantic extraction
- normalization
- code generation
- validation orchestration
- legacy code inspection
- background repair tasks

### Where Agents Should Not Be Unbounded

- editing the whole repository freely
- making large cross-cutting changes without review
- silently overwriting generated code
- mutating the semantic source without traceability

## Best Practical Interaction Model

The most usable model is:

1. developer edits semantic markdown or semantic UI fields
2. the system validates immediately
3. the system shows semantic errors inline
4. generation is queued automatically or triggered manually
5. generated code appears as a diff, not as a surprise rewrite
6. developer accepts, rejects, or refines the semantic model

This keeps the experience close to normal coding while reducing repeated prompt loops.

## What Should Be Synchronous

- parsing
- syntax validation
- schema validation
- invariant validation on the semantic model
- dependency resolution
- deterministic template expansion

### Validator Operating Modes

- continuous mode while the developer edits semantic files
- periodic background mode for re-checking the workspace
- on-demand mode from the plugin or CLI

### Validator Responsibilities

- read semantic markdown
- attempt canonical graph generation
- detect missing information
- detect contradictions
- detect ambiguous flows
- detect unresolved dependencies
- report security gaps
- point to the exact slice that needs refinement

## What Should Be Asynchronous

- AI extraction from vague descriptions
- large semantic normalization passes
- code generation for big targets
- migration planning
- test generation at scale
- refactoring suggestions

## Why This Reduces Waiting

- The developer no longer waits for the AI on every micro-step.
- Most routine feedback is provided by deterministic tooling.
- AI is used only where semantic interpretation or transformation actually adds value.
- Background generation allows the developer to continue working instead of blocking on the model.

## Recommended UX Direction

The best experience is likely a hybrid of:

- markdown-based semantic editing
- live validation panel
- generated artifact panel
- background job queue
- semantic diff view
- one-click recompile / regenerate

This gives a classical development feel without forcing the developer into pure chat interaction.

## Minimal MCP Server Set

The optimal setup should stay small at first. A practical minimal MCP stack is:

### 1. Semantic Core Server

Purpose:

- parse semantic markdown or structured intent
- normalize into canonical semantic IR
- validate schemas and invariants
- return semantic diffs

This is the central server for the language itself.

### 2. Compile And Generate Server

Purpose:

- compile canonical IR into target artifacts
- generate code skeletons and adapters
- produce incremental outputs for affected slices only

This is the bridge from semantic model to concrete implementation.

### 3. Validation And Test Server

Purpose:

- run fast deterministic checks
- execute invariant checks
- generate and run smoke tests
- compare expected and actual behavior

This server keeps the feedback loop fast and trustworthy.

### 4. Artifact And Cache Server

Purpose:

- store canonical IR snapshots
- store generated code artifacts
- cache previous successful translations
- provide historical diffs and reusable patterns

This reduces repeated work and token waste.

### Optional 5. Legacy Introspection Server

Purpose:

- read existing codebases, docs, traces, or schemas
- extract domain slices from legacy systems
- feed context into semantic extraction

This is useful for modernization work, but not required for a small greenfield pilot.

## Minimal First Recommendation

For the first pilot, the smallest useful set is:

1. Semantic Core Server
2. Compile And Generate Server
3. Validation And Test Server

The artifact/cache layer can be folded into the first implementation if needed, and legacy introspection can be added later when the modernization use case becomes primary.

## VSCode Plugin Direction

Yes, a VSCode plugin is a strong fit for making the methodology visible and usable.

The plugin should act as the developer-facing control surface for the semantic workflow.

### What The Plugin Should Show

- semantic markdown editor
- parsed semantic tree
- canonical IR preview
- validation errors and warnings
- generated code diff
- test and invariant results
- background job progress

### What The Plugin Should Do

- watch semantic files for changes
- trigger local validation on save or debounce
- send compile and generate requests to MCP servers
- display semantic diffs and target diffs
- let the developer accept, reject, or refine generated output
- keep project artifacts synchronized

### Why This Makes The System Clearer

- The developer sees the semantic model as a first-class artifact.
- The workflow feels like editing code, not chatting with a model.
- Fast feedback becomes visible in the editor.
- The AI and compiler pipeline becomes inspectable instead of hidden.

### Best UI Structure

- left panel: semantic files and navigation
- center editor: markdown or structured semantic form
- right panel: validation, IR, and job status
- bottom panel: generated diff, logs, and test output

### Suggested Plugin Responsibilities

- present the semantic model as a tree or graph view
- expose commands like `Validate Model`, `Compile Slice`, `Show Diff`, `Run Checks`
- call the MCP servers as the backend layer
- avoid implementing compiler logic directly in the plugin

### Key Principle

The plugin should be thin. The semantic core, compiler, and validation logic should live in services or servers, not inside the UI plugin.

## How A Senior Developer Uses It

The developer works with small, structured markdown artifacts.

Typical files:

- `intent.md`
- `domain_model.md`
- `semantic_delta.md`
- `invariants.md`
- `test_expectations.md`
- `target_plan.md`

The senior developer's job is to:

- describe the desired behavior precisely
- define boundaries and non-goals
- write or refine invariants
- approve semantic deltas
- review generated target code and test output

The developer should not need to manually write every platform-specific implementation detail unless the compiler cannot yet cover that area.

## Recommended Workflow

### 1. Define The Change

Write the request in markdown:

- what changes
- why it changes
- what must stay true
- what must not change
- examples of expected behavior

### 2. Map It To Semantics

Convert the request into:

- entities
- states
- transitions
- invariants
- effects
- resources

The goal is to describe meaning, not syntax.

### 3. Normalize Into Canonical IR

The workflow should reduce many human descriptions into one canonical semantic form.

This stage should:

- remove ambiguity
- detect conflicts
- merge duplicates
- assign stable identifiers
- preserve traceability back to the original request

### 4. Generate Target Artifacts

From the canonical IR, generate:

- implementation skeletons
- adapters
- target-specific code
- deployment definitions where needed
- tests

### 5. Validate Quickly

The fastest checks should run before any full demo or manual review.

Validation layers:

- syntax validation
- semantic validation
- invariant checks
- dependency checks
- generated test execution
- snapshot or golden-file comparison
- smoke test execution

### 6. Review The Diff

The senior developer reviews:

- semantic diff
- generated target diff
- test results
- trace output

The review should focus on whether the meaning is preserved, not whether the generated code looks hand-written.

## Fast Verification Strategy

The system should provide a short feedback loop.

Best practice:

1. validate the semantic model first
2. compile to IR
3. run deterministic checks
4. generate target code
5. run smoke tests
6. compare expected vs actual behavior

Fast verification should answer these questions:

- Did the semantic model parse cleanly?
- Are the invariants consistent?
- Did the generated output change only where expected?
- Does the runtime behavior match the intended transition?
- Is the target application still stable?

## What The Workflow Should Avoid

- editing target code first as the default habit
- rebuilding the whole IR for unrelated parts of the system
- using AI in the runtime hot path
- allowing ambiguous markdown to pass without semantic normalization
- mixing platform concerns into the core semantic model

## Practical Rule

If a change request cannot be expressed clearly in a small semantic delta, the model is not yet canonical enough.

## Repo Placement Model

The semantic artifacts should usually live inside the same repository as the application code during active development.

Recommended layout:

```text
repo/
  app/                    # existing Java or target application code
  semantic/               # semantic source artifacts
    intent.md
    domain_model.md
    invariants.md
    semantic_delta.md
    target_plan.md
    generated/            # generated IR snapshots and reports
  generated/              # generated target code, if checked in
  tools/                  # plugin hooks, scripts, MCP client, helpers
```

Key idea:

- the semantic layer is versioned in the same git branch as the application change
- the generated Java diff stays visible in the same pull request
- the canonical IR can be checked in if it is useful for traceability and review
- generated target code can be either checked in or regenerated on demand, depending on team policy

## Practical Branch Workflow

Use a single feature branch for one change request.

Recommended flow:

1. create branch from the existing application repo
2. add or update semantic files under `semantic/`
3. run validation and normalize to canonical IR
4. generate or update target code under `app/` or `generated/`
5. inspect the Java diff alongside the semantic diff
6. fix the semantic model or the generated output as needed
7. commit semantic artifacts and target changes together

This keeps the semantic definition and the implementation change coupled in one reviewable unit.

## Where To Version The Canonical IR

There are three workable options:

1. checked in alongside semantic files
2. generated on demand but stored in cache
3. stored in a separate artifact store linked by commit hash

For early development, the simplest option is usually to check in the canonical IR together with the semantic source so that reviews stay transparent.

## Practical Guidance

- Do not put semantic artifacts in a completely separate repository for the first version unless multiple apps must share the same canonical language immediately.
- Keep the semantic source close to the application so the developer can see the semantic delta and the Java diff together.
- Use separate repositories later only if the canonical language becomes a shared platform with versioned releases across many products.

## When A Developer Edits Generated Java By Hand

Hand edits will happen, so the workflow should treat them as a first-class event instead of a failure.

Recommended rule:

- generated code is not the only source of truth
- any manual edit must be classified as either:
  - a temporary local fix
  - a deliberate target-specific override
  - a new semantic requirement that should be lifted back into the semantic model

### Safe Handling Model

1. The plugin detects that a generated region was edited manually.
2. The diff is marked as `manual override` or `divergence`.
3. The developer decides whether the change belongs in:
   - the semantic model
   - the target adapter only
   - or a one-off hotfix layer
4. If the change is semantically important, the semantic source is updated and the code is regenerated.
5. If the change is target-specific, it stays in an explicit override zone.
6. If the change is temporary, it is tracked as technical debt and should not become the new canonical behavior silently.

### Important Principle

- Never let manual edits silently become the hidden truth.
- Either the semantic source absorbs the change, or the change is explicitly isolated as target-specific.

### Recommended File Policy

- generated code should have clearly marked generated regions
- manual override regions should be separated from generated regions
- the semantic source should remain the preferred place for durable behavior changes
- the plugin should warn if a manual edit makes the generated artifact diverge from the semantic source

### Best Practice In Enterprise Use

For legacy modernization, manual edits should be used only when:

- the generator does not yet support the needed target detail
- the change is inherently platform-specific
- a rapid workaround is required before the semantic model is updated

If the same manual pattern appears more than once, it should be promoted back into the canonical layer.

## Acceptance Criteria For The Workflow

The workflow is good if:

- a senior developer can express a change in markdown
- the system can normalize it into a canonical semantic form
- generated output can be verified quickly
- the same semantic pattern can be reused later
- the amount of rework drops over time
