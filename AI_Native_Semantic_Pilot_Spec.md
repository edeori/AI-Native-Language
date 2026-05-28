# AI Native Semantic Pilot Specification

This document is the structured pilot specification derived from the working notes.
It is intended to be the main source for generating the first pilot implementation.

## 1. Goal

Build an AI-native semantic programming system that can describe, validate, and generate enterprise Java applications from a higher-level semantic source.

The first visible target is a Spring Boot application on Java 17+.

## 2. Core Direction

- The source of truth is a semantic description, not raw Java code.
- The semantic description is written in a human-readable `Semantic Markdown`.
- The system canonicalizes that description into a graph-shaped JSON IR.
- A planner validates the IR.
- A minimal runtime/interpreter can execute the semantic model.
- A target adapter / compiler backend generates Java 17+ Spring Boot output.
- The entire system should be independent of any single AI provider.

## 3. Scope For v0

### In scope

- enterprise system-slice descriptions
- security-aware semantic modeling
- external documentation ingestion
- dependency-aware generation
- continuous or triggerable validation
- graph-based canonical IR
- Java 17+ / Spring Boot target generation
- provider-neutral AI workflow
- VSCode-friendly development workflow

### Out of scope for v0

- fully general-purpose programming language design
- distributed runtime execution
- multi-platform code generation beyond the Java target
- uncontrolled autonomous agents
- low-level source-code-first development as the primary workflow

## 4. Target Environment

- Java baseline: 17+
- Target framework: Spring Boot
- Security framework: Spring Security
- Enterprise integrations may include:
  - messaging systems
  - event streams
  - relational databases
  - search indexes
  - notification platforms
  - monitoring and alerting systems

## 5. Semantic Markdown Source

The developer writes system slices in `Semantic Markdown`.

### Required sections

```text
# system
# intent
# context
# interfaces
# data_flows
# processes
# rules
# security
# dependencies
# examples
# acceptance_criteria
```

### Section meaning

- `system`: system name and slice boundary
- `intent`: what the system should achieve
- `context`: domain boundaries, assumptions, constraints
- `interfaces`: external and internal entry points, sources, sinks, APIs
- `data_flows`: how data enters, moves through, and leaves the slice
- `processes`: free-form descriptions of the important flows
- `rules`: constraints, invariants, and operational rules
- `security`: authentication, authorization, SSO, secrets, access rules
- `dependencies`: required modules, libraries, platform services, docs
- `examples`: sample inputs, outputs, and behavior examples
- `acceptance_criteria`: what must be true for the slice to be considered correct

### Writing style

- Write at the system-slice level, not at source-code level.
- Use free-form prose for processes.
- Include enough detail for the AI to infer structure, but do not atomize the whole system into low-level primitives.
- Refine only the specific process or rule that needs more precision.

### Refinement levels

- Level 1: system slice description
- Level 2: main interfaces, data flows, processes, rules
- Level 3: targeted detail for one ambiguous or risky area
- Level 4: canonical IR expansion

## 6. Validation Model

Validation runs continuously, periodically, or on demand.

### Validator responsibilities

- parse the semantic markdown
- attempt canonical graph generation
- detect missing information
- detect contradictions
- detect ambiguous flows
- detect unresolved dependencies
- detect security gaps and policy violations
- point to the exact slice that needs refinement

### Validation outputs

- status: `draft`, `ready`, `validated`
- graph preview
- gaps
- conflicts
- warnings
- security violations
- suggested refinements

### Security validation

- Company security rules are enforcement inputs.
- The validator must report a `violation` when the model breaks a required security rule.
- Violations are blocking issues.
- Security coverage must include:
  - authentication
  - authorization
  - SSO
  - secret handling
  - data exposure constraints

## 7. Canonical IR

The canonical IR is a graph-shaped JSON document.

### Why graph-shaped JSON

- easy for AI to normalize
- easy to diff
- easy to cache
- easy to version
- easy to inspect during review

### Node types

- `SystemSlice`
- `Interface`
- `Process`
- `Transformation`
- `Rule`
- `SecurityPolicy`
- `Dependency`
- `ExternalSystem`
- `IntegrationEndpoint`
- `DataFlow`
- `Monitor`
- `Metric`
- `Alert`
- `Example`
- `AcceptanceCriterion`
- `Issue`

### Edge types

- `contains`
- `uses`
- `dependsOn`
- `flowsTo`
- `readsFrom`
- `writesTo`
- `guardedBy`
- `requires`
- `violates`
- `refines`
- `supports`
- `publishesTo`
- `consumesFrom`
- `persistsTo`
- `transformsInto`
- `observes`
- `emits`
- `triggers`

### Minimal node fields

- `id`
- `type`
- `name`
- `description`
- `status`
- `sourceRef`
- `version`

### Minimal graph rules

- Every `Process` connects to at least one `Interface`, `DataFlow`, or `Dependency`.
- Every `Transformation` connects an input `DataFlow` to an output `DataFlow`.
- Every `SecurityPolicy` traces to one or more `Rule` or `Issue` records.
- Every `Dependency` links to the process or interface that uses it.
- Every external integration appears as an `ExternalSystem`, `IntegrationEndpoint`, or `Dependency`.
- Every monitorable concern links to `Monitor`, `Metric`, or `Alert` where relevant.
- Every `Issue` points to the node or edge that caused it.
- Every `AcceptanceCriterion` traces back to the `Intent` or `Process` it validates.

### Versioning

- Every artifact carries its own `schemaVersion` or `formatVersion`.
- The version belongs to the artifact itself, not only the project.
- Backward compatibility is required through migration or adapter layers wherever possible.

## 8. Mapping Rules

The compiler should map `Semantic Markdown` sections to graph nodes and edges consistently.

### Primary mappings

- `system` -> `SystemSlice`
- `intent` -> `SystemSlice` description and `AcceptanceCriterion` anchors
- `context` -> `SystemSlice` metadata and `ExternalSystem` references
- `interfaces` -> `Interface` nodes, linked to `ExternalSystem` or internal boundaries
- `data_flows` -> `DataFlow` nodes, connected by `flowsTo`, `readsFrom`, `writesTo`
- `processes` -> `Process` nodes, optionally refined into `Transformation` nodes
- `rules` -> `Rule` nodes, connected by `guardedBy` or `violates`
- `security` -> `SecurityPolicy`, `Rule`, `Issue`, `Capability`, `Authorization` related nodes
- `dependencies` -> `Dependency` nodes and usage edges
- `examples` -> `Example` nodes
- `acceptance_criteria` -> `AcceptanceCriterion` nodes

### Expansion rules

- A single prose `Process` can expand into multiple graph nodes if needed.
- A single `Interface` can map to multiple integration endpoints.
- A single `rules` section can produce multiple `Rule` and `SecurityPolicy` nodes.
- Validation-generated problems must become `Issue` nodes.

## 9. Planner / Runtime / Adapter

```text
Semantic Markdown
    ↓
Canonical IR
    ↓
Planner
    ↓
Minimal Runtime / Interpreter
    ↓
Target Adapter / Compiler Backend
    ↓
Concrete Platform
```

### Planner

- validates IR structure
- checks invariants statically where possible
- determines whether a transition is allowed
- prepares an execution plan
- identifies required resources, capabilities, and dependencies

### Minimal runtime / interpreter

- loads canonical IR
- applies allowed transitions
- mutates state in a controlled way
- emits events
- evaluates runtime invariants
- performs simple rollback if needed
- dispatches effects

### Target adapter / compiler backend

- maps semantic runtime or generated plan to a specific platform
- translates semantic constructs into Java / Spring Boot code or services
- handles platform concerns

## 10. Security And Dependency Inputs

- Security is a first-class concern.
- The system must understand Spring Security deeply enough for secure scaffolding and integration points.
- The security model must remain extendable.
- The system must accept dependency inputs such as:
  - prebuilt modules
  - internal libraries
  - organization-specific SDKs
  - platform adapters
- The system must accept documentation inputs such as:
  - Confluence pages
  - internal wiki pages
  - PDFs
  - module documentation

Documentation is contextual input, not the final source of truth.

## 11. AI Provider Independence

- The workflow must not depend on a single AI vendor.
- The same semantic source should work with Codex, Claude, or another model family.
- Provider-neutral task schemas and tool interfaces are required.
- The AI provider is an execution detail, not part of the language identity.

## 12. Tooling And Repo Workflow

- The semantic files should live in the same repository as the application during active development.
- The developer should see semantic diffs and Java diffs in the same branch.
- Manual edits in generated Java are allowed only when explicitly classified:
  - temporary local fix
  - target-specific override
  - semantic requirement that must be lifted back into the model
- The preferred development loop is:
  1. edit semantic markdown
  2. validate locally
  3. generate graph IR
  4. generate or update Java
  5. review diffs
  6. refine the semantic model if needed

## 13. Recommended Validation And Execution Modes

- Continuous validation while editing
- Periodic background validation
- On-demand validation from the plugin or CLI
- Local runners for deterministic work
- Remote/cloud AI only when necessary for complex interpretation or generation

## 14. Pilot Acceptance Criteria

The pilot is acceptable when it can:

- read a system-slice `Semantic Markdown`
- generate canonical graph IR
- detect missing information, contradictions, and security violations
- represent enterprise integrations and transformations
- generate Spring Boot / Java 17+ target code
- remain provider-agnostic
- keep semantic source and generated target code reviewable in the same branch

## 15. Pre-Implementation Artifacts

The following can be prepared before any real code execution exists:

### Stable artifacts

- canonical terminology and primitive definitions
- semantic markdown structure and writing rules
- validation contract and severity model
- canonical IR schema and mapping rules
- security model and dependency model
- provider independence rules
- repo layout and branching workflow
- plugin command set and UX outline

### Example artifacts

- one complete semantic markdown example
- one complete canonical graph example
- one Spring Boot output skeleton example
- one security policy example
- one dependency integration example
- one validation failure example with gaps and violations

### Planning artifacts

- end-to-end happy path for one system slice
- incremental refinement strategy
- manual override policy
- acceptance test checklist
- no-code pilot generation plan

### Example artifacts location

- `examples/team_knowledge_publishing_service.semantic.md`
- `examples/team_knowledge_publishing_service.graph.json`

### What this enables

- a seed state that can later be used to generate the pilot
- a reusable semantic foundation for a real project
- a structured starting point for future AI-assisted refinement and training
- a clear separation between specification work and implementation work
