# AI Native Semantic Programming Pilot - Working Notes

This is a living note file for the pilot discussion. The goal is to keep decisions, assumptions, and open questions traceable while the idea is refined.

The structured pilot specification lives in `AI_Native_Semantic_Pilot_Spec.md`.

## What We Can Prepare Without Running Code

- canonical terminology and primitive definitions
- semantic markdown structure and writing rules
- validation contract and severity model
- canonical IR schema and mapping rules
- security model and dependency model
- provider independence rules
- repo layout and branch workflow
- plugin command set and UX outline
- one complete semantic markdown example
- one complete canonical graph example
- one Spring Boot output skeleton example
- one security policy example
- one dependency integration example
- one validation failure example
- one end-to-end happy path for a system slice
- manual override policy
- acceptance test checklist

This is enough to create a solid initial state that can later be refined, extended, and used to generate the first pilot implementation for a real project.

## Goal

Build a very small pilot for an AI-native semantic programming platform that can eventually power a basic notes app.

## Current Direction

- Pilot order: specification and semantic model first, runtime second.
- Target demo: a minimal notes application.
- Primary representation should be semantic, not source-code-first.
- AI should help with modeling, transformation, and test generation, not act as an uncontrolled runtime.
- The application should be platform-independent by design.
- Platform targets are compiler / adapter concerns, not core application concerns.
- If a first execution target is needed for prototyping, use desktop as a temporary convenience layer.
- v0 should still produce one concrete, visible, demoable application target.
- The long-term business value may be legacy enterprise modernization, especially large JVM-heavy enterprise environments.

## What Is Already Clear

- This is not intended to be another traditional language like Java or Python.
- The project is closer to a new computing abstraction layer.
- The internal representation should be graph-based, typed, and semantic.
- Determinism and inspectability matter.
- The same semantic program should later be able to target server-side applications as well.

## Locked or Strongly Suggested Principles

- Source code is not the primary artifact.
- Intent is part of the program.
- Invariants are first-class.
- Platform-specific execution should happen through adapters.
- Keep programming and compiler terminology in English where possible so the canonical language stays aligned with standard technical usage.

## Current Assumptions

- The first version should stay intentionally small.
- The first useful milestone is an end-to-end path from intent to executable note behavior.
- The first implementation should probably use a simple, easy-to-change stack.
- Desktop is only a provisional first target if the team needs one concrete runtime to test against.
- A headless runtime is useful only as an internal reference and test harness, not as the final demo experience.

## Open Questions

- What should the first platform be: CLI, web, or desktop?
- How formal should the v0 DSL be?
- Should offline-first behavior be in v0?
- Should versioning be built in from day one?
- What is the exact boundary of the AI role?
- Should the first IR be JSON-based?
- What should the first compilation target be?

## Backend Strategy Discussion

- Option A: build a new platform-neutral target language or execution layer first, then add adapters for Windows, Linux, macOS, containers, and other targets.
- Option B: compile into an existing target platform or runtime first, for example a Dockerized Java application, to reduce initial platform work.
- The key tension is between long-term semantic control and short-term implementation speed.
- The desired outcome is to minimize token cost and iteration cost for AI-assisted development while keeping the program precisely defined and platform-independent.

## Current Lean

- The strongest long-term architecture is likely a semantic core plus a portable execution layer, with backend targets added later.
- For v0, a single concrete target is still useful to make the system demoable and observable.
- The first target should be treated as a reference backend, not as the identity of the whole platform.
- A fully platform-specific first design risks locking the paradigm to an existing ecosystem too early.
- A major envisioned use case is describing an existing internal knowledge portal or content workflow service semantically, then regenerating it into a modern Spring Boot service architecture with a web UI.

## MVP Gaps Still To Define

- Exact semantic file format and syntax rules.
- Minimum canonical primitive set for v0.
- Canonical IR schema and versioning policy.
- How much of the runtime is interpreter versus code generator.
- Which target backend is the first reference backend.
- How the plugin surfaces manual edits versus generated regions.
- Whether generated code is committed or treated as build output in v0.
- Exact validation rules for semantic-to-code correctness.
- How legacy code introspection is plugged in later.

## Pilot Readiness Estimate

- The conceptual model is now far enough along to plan a pilot architecture.
- The definition is not yet complete enough to implement without further decisions.
- The remaining gap is mostly in execution details, not in the high-level vision.
- The next step is to freeze a narrow v0 scope and define one end-to-end happy path.
- A usable pilot is likely feasible once the above MVP gaps are closed for one target application and one backend.

## First Reference Backend Preference

- The first target backend should be Java 17+ with a strong Spring Boot focus.
- Reasoning:
  - it matches the intended enterprise usage direction
  - it keeps the pilot aligned with real-world backend targets
  - it makes the semantic model immediately relevant for modern Java server-side applications
  - Spring Boot provides a practical structure for services, adapters, and application wiring
- The semantic runtime and compiler pipeline can still be prototyped with local tools, but the generated target should be Java-first.

## Java Target Direction

- The initial code generation target should concentrate on Spring Boot application structure.
- The Java baseline should be 17 or newer.
- Generated output should prefer modern Java patterns rather than legacy Java 8 style.
- The system should be able to produce service-oriented application code, controller or API layers, domain logic, repository adapters, and test scaffolding for Spring Boot.

## Security And Dependency Inputs

- Security must be a first-class concern in the semantic model and the generated target code.
- The system should be able to accept explicit security requirements such as:
  - authentication strategy
  - authorization rules
  - SSO integration
  - role or capability mapping
  - secure storage or secret handling constraints
- The system should also support external dependency inputs such as:
  - prebuilt modules
  - internal libraries
  - organization-specific SDKs
  - platform adapters that must be used for certain tasks
- These dependencies should be represented semantically so the generator knows when and how to use them.
- For the initial Java/Spring target, the system should understand Spring Security deeply enough to generate secure application scaffolding and security-aware integration points.
- The security model is not fixed forever; it should be extendable through additional interpreters, adapters, and semantic concepts later if the initial coverage is insufficient.

## External Documentation Inputs

- The system should accept supporting documentation from sources such as Confluence pages, internal wiki pages, PDFs, or module documentation pages.
- This documentation should be treated as contextual input for semantic extraction and normalization.
- The goal is to let the AI ground the semantic model in the real enterprise environment instead of guessing.
- Documentation should not become the source of truth by itself; it should feed the semantic model and then be validated against it.

## AI Provider Independence

- The language and workflow must be independent of any single AI provider or model family.
- The same semantic source should work whether the assistant is powered by Codex, Claude, or another capable AI engine.
- This means the system should define:
  - provider-neutral prompts or task schemas
  - provider-neutral tool interfaces where possible
  - canonical intermediate artifacts that do not depend on model-specific quirks
  - a fallback strategy when one provider is unavailable or underperforms
- The AI provider should be an execution detail, not part of the core language identity.
- If a prompt or workflow only works with one vendor, it is too brittle for the intended platform.

## Minimum Security Model For v0

- `Principal`: the authenticated actor that performs actions in the system.
- `Credential`: the proof used to establish identity, such as password, token, certificate, or SSO assertion.
- `Authentication`: the process of verifying identity.
- `Authorization`: the process of deciding whether a `Principal` may perform a `Transition` or access a `Resource`.
- `Authority`: a concrete granted permission or role-derived right.
- `Role`: a named grouping of authorities for coarse-grained access control.
- `Permission`: a fine-grained allow rule tied to a specific action or resource.
- `SecurityContext`: the runtime security state associated with the current request or session.
- `ProtectedResource`: any `Entity`, `Interface`, `Resource`, or operation that requires authorization.
- `SecurityPolicy`: a semantic rule that constrains authentication, authorization, session handling, or data access.

### How The Security Model Is Used

- The semantic source should be able to declare which `Transition` requires which `Permission`.
- The planner should verify that a requested operation is compatible with the declared `SecurityPolicy`.
- The runtime should resolve the current `SecurityContext` before executing protected transitions.
- The adapter should map the semantic security model to Spring Security constructs for the Java target.

### Security Scope For The Pilot

- Spring Security should be the primary target security framework.
- The pilot should support common enterprise patterns such as login, role-based access control, permission checks, and protected API endpoints.
- The model should remain extensible so later interpreters or adapters can support additional security frameworks or custom enterprise policies.

## Proposed Semantic Markdown Structure

The v0 semantic markdown should have a small, stable section set, but the sections should describe a system slice and its major processes, not low-level code structure.

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

### Section Purpose

- `system`: the name and scope of the semantic model
- `intent`: what the system is supposed to achieve
- `context`: external assumptions, domain boundaries, and constraints
- `interfaces`: the important external or internal interfaces and entry points
- `data_flows`: how information enters, moves through, and leaves the system
- `processes`: the main business or technical flows described in free-form prose
- `rules`: the key constraints, invariants, and operational rules that must hold
- `security`: authentication, authorization, and protection rules
- `dependencies`: required modules, libraries, or platform services
- `examples`: sample inputs, outputs, and expected behaviors
- `acceptance_criteria`: what must be true for the model to be considered correct

### Why This Structure Works

- It is small enough to write by hand.
- It is structured enough for AI to parse consistently.
- It describes a system slice at the right abstraction level.
- It leaves the detailed semantic expansion to the AI and the compiler pipeline.

### Process Writing Style

- Use free-form prose for process descriptions.
- Describe the important flows in plain language with enough detail for AI to infer the semantic model.
- Example level of detail:
  - where input arrives from
  - how source information is classified
  - what the main processing stages are
  - what the user can do through the UI
  - what external systems are involved
- Do not force every process into a low-level primitive list in the source file.

### Refinement Principle

- Start with a system slice description.
- Let the AI expand it into a more detailed semantic model where needed.
- If a flow needs more precision later, refine only that slice instead of atomizing the whole file upfront.

### Refinement Levels

- Level 1: system slice description in free-form prose.
- Level 2: explicit interfaces, major data flows, and main process steps.
- Level 3: detailed rule breakdown for one specific flow or concern.
- Level 4: canonical IR expansion for execution, validation, and code generation.

The source file should usually stay at Level 1 or Level 2.

Only the currently important or risky areas should be refined to Level 3.

The canonical IR and planner/runtime pipeline can then hold Level 4 detail.

### How To Ask For More Precision

- If a flow is ambiguous, ask for one more pass on that single flow.
- If a security concern is unclear, refine only the affected interfaces and rules.
- If a dependency is underspecified, add the module contract and expected usage.
- If a process is complex, split it into named subprocesses inside the same system slice.

### Rule Of Thumb

- Every meaningful semantic file should answer what the system is, what its main interfaces and flows are, what rules it follows, what must never break, and what external things it depends on.

### Validation Contract For Semantic Files

- A semantic file is valid when it is complete enough to describe one system slice without forcing the developer to write low-level code details.
- The validator should distinguish between:
  - **missing required information**
  - **ambiguous information**
  - **optional information not yet provided**
- The validator should report:
  - structural errors
  - semantic contradictions
  - incomplete flow descriptions
  - missing security or dependency information where required
- A file can be:
  - `draft` if major flows are still incomplete
  - `ready` if the main slice is clear enough for canonicalization
  - `validated` if it has been accepted for IR generation
- The goal is not perfect completeness in the markdown source; the goal is enough precision to reliably derive canonical IR from it.

### Validation Mode

- The validator should be able to run:
  - continuously while the developer edits
  - periodically as a background job
  - on demand from the plugin or CLI
- Its job is to read the semantic markdown, attempt canonical graph model generation, and then analyze the result for:
  - missing information
  - contradictions
  - ambiguous flows
  - unresolved dependencies
  - security gaps
  - inconsistent interface assumptions
- If a semantic file cannot be canonicalized cleanly, the validator should report exactly where the problem is and why the model is incomplete or inconsistent.

### Error Reporting

- Missing information should be reported as a gap.
- Contradictions should be reported as a conflict.
- Ambiguous phrasing should be reported as a clarification request.
- Invalid dependency or security assumptions should be reported as a policy or integration issue.
- The report should point back to the specific semantic slice, not just fail generically.

### Security Policy Validation

- The validator should also compare the semantic model against company security rules and security documentation.
- Security documentation and internal policy descriptions should be treated as enforcement inputs, not just reference material.
- If the semantic model violates a required security rule, the validator should report a `violation`.
- A `violation` is a blocking issue that must be resolved by the developer before the model can be considered `ready` or `validated`.
- The validator should support security policies such as:
  - authentication requirements
  - authorization constraints
  - SSO integration rules
  - secret handling requirements
  - data exposure restrictions
  - platform-specific security obligations
- Security violations should be explicit and actionable, not just vague warnings.

### Validation Output

- validation status
- generated graph model preview
- list of gaps
- list of contradictions
- list of security violations
- list of warnings
- suggested refinement targets

### Feedback Loop

- The validator should not only fail; it should guide refinement.
- After each run, the developer should know what to clarify, what to split, and what can already be canonicalized.
- Security violations should be treated as first-class blockers in the feedback loop until they are explicitly resolved.

## Canonical IR Shape Preference

- For AI processing, the easiest shape is usually a graph-shaped JSON document with stable identifiers, explicit node types, and explicit edges.
- This is easier for AI to normalize than free-form text and easier to diff than deeply nested ad hoc structures.
- The IR should stay deterministic and machine-friendly, but still readable by humans during review.

## Minimal Canonical Graph Model For v0

- The canonical graph should be a small property graph, not a deeply nested tree.
- The graph should normalize one semantic markdown file into a set of typed nodes and typed edges.
- The graph should describe the system slice, its flows, rules, dependencies, and security constraints.

### Recommended Node Types

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

### Recommended Edge Types

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

### Minimal Node Fields

- `id`
- `type`
- `name`
- `description`
- `status`
- `sourceRef`
- `version`

### Minimal Graph Rules

- Every `Process` should connect to at least one `Interface`, `DataFlow`, or `Dependency`.
- Every `Transformation` should connect an input `DataFlow` to an output `DataFlow`.
- Every `SecurityPolicy` should be traceable to one or more `Rule` or `Issue` records.
- Every `Dependency` should be linked to the process or interface that uses it.
- Every external integration such as a messaging system, event stream, relational database, search index, notification platform, or monitoring system should appear either as an `ExternalSystem`, `IntegrationEndpoint`, or `Dependency`.
- Every monitorable concern should be linked to a `Monitor`, `Metric`, or `Alert` node when relevant.
- Every `Issue` should point to the node or edge that caused the problem.
- Every `AcceptanceCriterion` should trace back to the `Intent` or `Process` it validates.

### Why This Shape Is Good

- It is small enough to implement v0 quickly.
- It is rich enough to represent enterprise Java system slices with integration, transformation, persistence, and monitoring concerns.
- It is explicit enough for AI validation and graph reasoning.
- It is flexible enough to grow later without redesigning the whole model.

## Artifact-Specific Versioning

- Artifact-level versioning means each semantic source file, IR snapshot, or generated target bundle carries its own `schemaVersion` or `formatVersion`.
- The version belongs to the artifact itself, not only to the whole project.
- This allows different artifacts in the same repo to evolve independently while still remaining compatible through migration rules.
- Example:
  - `intent.md` may be at one semantic source version
  - the canonical IR snapshot may be at another version
  - generated target code may reference the IR version it was produced from
- Backward compatibility means older artifacts should still be readable through a migration or adapter layer whenever possible.

## Planner vs Runtime vs Adapter

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

The planner:

- validates the IR structure
- checks invariants statically where possible
- determines whether a transition is allowed
- prepares an execution plan
- identifies required resources, capabilities, and dependencies

It does not primarily perform the actual domain execution.

### Minimal Runtime / Interpreter

The minimal runtime:

- loads the canonical IR
- applies allowed transitions
- mutates state in a controlled way
- emits events
- evaluates runtime invariants
- performs simple rollback if needed
- dispatches effects

It is the first component that actually "runs" the semantic model.

### Target Adapter / Compiler Backend

The adapter:

- maps the semantic runtime or generated plan to a specific platform
- translates semantic constructs into target-specific code or services
- handles platform concerns such as Java, React, containers, or host runtime details

### Why This Split Matters

- The planner keeps the model honest.
- The runtime makes the model executable.
- The adapter makes the executable model platform-specific.
- This keeps the semantic core independent from any one target stack.

## Simple Notes App Example

```text
Semantic Markdown
    ↓
Canonical IR
    ↓
Planner
    ↓
Runtime
    ↓
Adapter
    ↓
Concrete app
```

### Example Domain Objects

- `Entity`: `Note`
- `Resource`: `NotebookStorage`
- `State`: `Draft`, `Saved`, `Archived`
- `Transition`: `createNote`, `editNote`, `saveNote`, `archiveNote`
- `Invariant`: `note content must not be lost`
- `Event`: `NoteCreated`, `NoteUpdated`, `NoteSaved`
- `Capability`: `canEdit`, `canArchive`, `canSearch`
- `Interface`: `NotesRepository`, `SearchProvider`
- `Relation`: `Note belongsTo Notebook`, `Note hasMany Revision`

### Planner Example

The planner checks:

- whether `editNote` is allowed in the current `State`
- whether `saveNote` violates any `Invariant`
- whether the required `Capability` exists
- whether `NotebookStorage` is available
- whether the `Transition` creates any unresolved dependency

If the plan is valid, it emits an execution plan like:

```text
load Note
validate content
apply edit
check invariants
persist revision
emit NoteUpdated
```

### Runtime Example

The runtime then:

- loads the current `Note`
- applies the `editNote` transition
- updates `State` from `Draft` to `Draft` or `Saved`
- checks the runtime `Invariant`
- writes the revision to storage
- emits `NoteUpdated`
- returns the updated semantic result

### Adapter Example

The adapter maps this to a concrete platform:

- in a web target, it becomes React state, API calls, and browser storage or backend calls
- in a Java target, it becomes service methods, repository calls, and persistence code
- in a desktop target, it becomes local UI actions and file or database persistence

### What This Demonstrates

- The semantic source says what the app means.
- The planner checks whether the requested action is valid.
- The runtime performs the actual semantic state change.
- The adapter translates the result into the chosen platform.
- The developer sees one semantic model, not three unrelated implementations.

## Architecture Sketch

```text
Human intent
    ↓
Semantic DSL
    ↓
Canonical semantic IR / graph
    ↓
Reference runtime / execution engine
    ↓
Host adapter / target backend
    ↓
Concrete platform
```

- The DSL is the human-facing description layer.
- The IR is the real machine-facing meaning layer.
- The runtime executes or interprets the IR.
- The host adapter maps the runtime onto a concrete platform.

## Existing Language Question

- The architecture does not require an existing general-purpose language as the core identity of the system.
- An existing language can still be used as an implementation vehicle for the compiler or runtime.
- That means the core paradigm can stay language-independent while the implementation is built in TypeScript, Rust, Java, or another host language.

## Long-Term Transformation Goal

- The abstract semantic definition should be stable enough to outlive a specific runtime stack.
- A system described once at the semantic level should be able to re-target different platform shapes over time.
- The compiler is responsible for mapping one semantic definition into a concrete deployed application shape for the chosen host environment.

## Canonical Language Growth Model

- The language should not grow as a pile of one-off project-specific constructs.
- It should grow by accumulating reusable semantic primitives, patterns, and validated transformations.
- The core idea is to make the language improve through reuse, not through constant reinvention.

### What Should Be Canonical

- Core primitives such as state, transition, invariant, effect, entity, capability, and resource.
- Domain-agnostic semantic patterns, for example:
  - CRUD-like state handling
  - workflow transitions
  - validation rules
  - event emission
  - rollback behavior
- Normalization rules that map many human descriptions into fewer canonical forms.
- Reusable adapters and target templates.

### Primitive Definitions For v0

- `State`: az adott `entity` vagy rendszer aktuális semantic condition-je egy adott pillanatban. Arra válaszol, hogy "what is true right now?".
- `Transition`: engedélyezett change egyik `state`-ből a másikba, tipikusan `intent`, `command` vagy `event` által triggerelve. Arra válaszol, hogy "how may this state change?".
- `Invariant`: olyan constraint, amelynek true-nak kell maradnia a `transition` előtt, közben és után. Arra válaszol, hogy "what must never be violated?".
- `Effect`: a `transition` externally visible consequence-a. Arra válaszol, hogy mi történik a semantic model-en kívül a művelet hatására.
- `Entity`: stabil identity-vel rendelkező domain object, amelyhez `state`, `relation` és `transition` tartozhat. Arra válaszol, hogy "what thing are we talking about?".
- `Resource`: bounded vagy managed asset, amelyet allocate, consume, transfer vagy protect lehet. Arra válaszol, hogy "what limited thing is being controlled?".
- `Event`: recorded occurrence of something happened at a point in time; meaning-wise append-only. Arra válaszol, hogy "what happened?".
- `Capability`: deklarált ability egy actor, component vagy entity számára, amely műveleti osztályokat vagy resource access-t határoz meg. Arra válaszol, hogy "what is this actor allowed or able to do?".
- `Interface`: az a contract, amely meghatározza, hogyan interact-el egy semantic component egy másikkal. Arra válaszol, hogy "what input, output, or protocol boundary exists?".
- `Relation`: typed edge két vagy több semantic object között. Arra válaszol, hogy "how are these things connected?".

### How These Primitives Work Together

- `Entity` is the stable subject.
- `State` describes the subject now.
- `Transition` changes the subject.
- `Invariant` constrains the subject and its transitions.
- `Effect` describes the external consequence of the transition.
- `Event` records the occurrence of the transition or an external fact.
- `Capability` defines which transitions or effects are permitted.
- `Interface` defines a contract for how a component exposes or accepts semantics.
- `Relation` links `entity`, `state`, `event`, `resource`, or `capability` objects with a typed edge.
- `Resource` captures scarce or managed inputs and outputs around the `entity`.

### What Should Be Learned Over Time

- Repeated semantic shapes from multiple projects.
- Common enterprise workflows and state machines.
- Recurrent migration patterns.
- Validation and invariant templates.
- Compilation rules that repeatedly work well for specific target platforms.

### How The System Becomes More Efficient

- Each implementation should add reusable knowledge back into the canonical layer.
- The system should prefer extending the semantic library over re-creating logic per project.
- AI should assist in:
  - recognizing recurring patterns
  - proposing canonical forms
  - collapsing similar concepts into shared primitives
  - generating templates from prior successful translations

### Important Constraint

- The system should "learn" through curated reuse and canonicalization first, not through uncontrolled model drift.
- The growing knowledge base must stay deterministic, inspectable, and versioned.
- If a learned pattern cannot be explained, validated, or reused, it should not become canonical.

## AI Work Boundary

- AI should work at the semantic boundary, not inside the hot runtime path.
- AI should be used for:
  - extracting intent from legacy systems or human descriptions
  - normalizing ambiguous descriptions into canonical semantic form
  - generating or transforming IR and target code skeletons
  - proposing tests, invariants, and refactor plans
  - assisting migration between platform targets
- AI should not be required for:
  - every runtime request
  - deterministic state execution
  - invariant checking at execution time if a rules engine can handle it
  - repeated translation of already canonicalized models
- The main token-saving strategy is to convert AI work into a one-time or infrequent compilation step, then keep runtime deterministic and non-AI.

## Reuse Strategy

- Reuse should happen at three levels:
  - semantic primitives
  - reusable patterns and templates
  - target-specific generation rules
- The system should avoid encoding the same business structure differently in each project.
- The canonical layer should get stronger every time a new project is modeled, because the new project should contribute reusable structure back to the language.

## Practical Workflow Reference

- The daily working workflow is documented separately in `AI_Native_Semantic_Workflow.md`.
- The main practical idea is that senior developers write semantic markdown artifacts, and the workflow turns them into canonical IR, target code, and fast validation output.

## Language Growth Loop

```text
New project or change request
    ↓
Human intent or legacy behavior description
    ↓
AI-assisted semantic extraction
    ↓
Canonical normalization into IR
    ↓
Validation against known invariants and tests
    ↓
Target code or adapter generation
    ↓
Observed implementation outcome
    ↓
Pattern extraction / refinement
    ↓
Update canonical primitives, templates, and rules
    ↓
Next project becomes cheaper and more precise
```

- The loop should make the language better over time instead of larger in a chaotic way.
- Every successful implementation should feed reusable structure back into the canonical layer.
- The system should prefer general reusable semantics over project-specific one-offs.
- If a pattern repeats often enough, it should become a first-class canonical concept.

## Token Efficiency Goal

- One of the main reasons for the semantic layer is to reduce repeated AI iteration cost.
- The target is to avoid generating or repairing large amounts of raw target-language code directly from scratch on every change.
- Instead, the system should let AI operate on a smaller, more structured semantic surface and then compile that into target code.

## Token And Speed Comparison

```text
Manual coding by senior engineer
    ↓
Long implementation time, low AI token usage

Prompting a general-purpose model directly into Java
    ↓
Moderate to high implementation speed, high iteration and token cost

Semantic model first, then compile
    ↓
Higher upfront modeling cost, lower repeated token cost, better reuse on later iterations
```

- Manual coding is typically strongest for correctness when the system is already well understood.
- Direct prompting is fastest for small tasks, but can become token-expensive and brittle on larger systems.
- Semantic-first work is slower at the beginning, but should improve repeatability and reduce rework on larger or repeated transformations.

## Where The Token Savings Happen

```text
Human intent / legacy system description
    ↓
AI extraction
    ↓
Semantic normalization
    ↓
Canonical IR
    ↓
Target code generation
    ↓
Testing and refinement
```

- AI extraction: savings come from asking the model to summarize once, instead of repeatedly rewriting target code.
- Semantic normalization: savings come from canonicalizing ambiguous input into a reusable form.
- Canonical IR: savings come from reusing one compact internal representation across many future transformations.
- Target code generation: savings come from generating code from a stable model rather than re-prompting large codebases.
- Testing and refinement: savings come from the model being able to reason about invariants and transitions without scanning the whole application every time.

## ROI And Cost Shape

- There is an upfront cost to building the semantic layer, parser, IR, and compiler pipeline.
- The first application may cost more than direct code generation if the platform is simple and the scope is small.
- The payoff increases when:
  - the application is large
  - the system has many business rules
  - the target platform changes over time
  - the same semantic source must be reused across multiple targets
  - the codebase is legacy and expensive to modify directly
- The semantic approach becomes most valuable when rework, migration, and multi-target generation dominate the total cost.

## Incremental Adoption For Existing Systems

- The cheapest path is usually not full upfront IR extraction for the entire codebase.
- A better approach is to build the semantic layer around the parts of the system that are actively changing.
- The IR should be introduced incrementally:
  - start with a thin semantic shell around one domain or feature area
  - extract only the business-relevant state, transitions, and invariants
  - leave low-value technical plumbing as host-language implementation detail
  - grow the IR only where future change, risk, or platform migration justifies it
- The system should support mixed mode operation:
  - some parts are still legacy host code
  - some parts are represented semantically
  - new work is added through the semantic model when possible
- The main cost-saving principle is to avoid modeling everything equally.
- Model the business-critical surface first, not the entire codebase.

## Cost-Saving Strategies For Legacy Integration

- Use the existing codebase as a source of truth for execution, but not necessarily as a full source of truth for semantics.
- Derive the IR only for:
  - hot spots with frequent change
  - high-risk business logic
  - migration boundaries
  - interfaces that need re-targeting
- Prefer partial extraction over complete extraction when the system is large.
- Prefer explicit adapters over rewriting stable legacy internals.
- Use AI to summarize and propose semantic models, but validate those models against existing behavior with tests and traces.
- Capture knowledge in a reusable canonical model so future changes become cheaper than the first extraction.

## Example: Legacy Knowledge Portal Modernization

```text
Legacy internal knowledge portal
    ↓
Semantic extraction / domain modeling
    ↓
Platform-independent semantic specification
    ↓
AI-assisted normalization and validation
    ↓
Canonical semantic IR / graph
    ↓
Target compiler / backend selection
    ↓
Modern deployment shape
    ├── Spring Boot services
    ├── web UI
    ├── search/indexing adapter
    └── notification / integration layer
```

- The semantic specification captures business meaning, state, invariants, and transitions.
- The generated application is a concrete implementation of that semantic definition.
- The same semantic source can later be re-targeted to another host or deployment model.
- This is a modernization pipeline, not a raw source-code translation pipeline.

## Example: New Feature Or Bug Fix In Existing App

```text
Existing legacy application
    ↓
Select one change request or defect
    ↓
Extract the affected domain slice
    ↓
Map current behavior, state, and invariants
    ↓
AI-assisted semantic delta proposal
    ↓
Minimal IR update
    ↓
Target code or adapter patch
    ↓
Validation against expected behavior
```

- This use case is about changing an existing application safely without modeling the entire system at once.
- The semantic layer should isolate the affected business slice and reduce the risk of unintended side effects.
- Bug fixes become changes to a semantic delta, not only edits to raw source code.
- Feature work becomes the addition or modification of states, transitions, invariants, or effects in the affected domain slice.

## Next Refinement Targets

- Define the exact v0 scope.
- Define the minimal semantic primitives.
- Define the note app user stories.
- Define the IR shape.
- Define the runtime responsibilities.
- Define acceptance criteria for the pilot.

## Discussion Log

- Pilot focus chosen: specification first.
