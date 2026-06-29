# AI-Native Semantic Programming Platform

## Vision

The goal is not to create another programming language like Java or Python.

The goal is to create a new computing abstraction layer optimized for:
- human intent expression
- AI semantic reasoning
- platform-independent execution
- semantic state modeling

This is closer to a new computing paradigm than a traditional language.

---

# Core Idea

Traditional programming:

human → source code → compiler → machine

Proposed paradigm:

human intent
    ↓
AI-shaped semantic model
    ↓
semantic graph / executable state system
    ↓
runtime / adapters
    ↓
platform execution

The primary representation is NOT source code.

The primary representation is:
- semantic state
- relationships
- invariants
- transitions
- intent
- constraints

Source text is only one possible view of the system.

---

# Paradigm Shift

Traditional programming focuses on algorithms and implementation details.

Semantic State Programming focuses on:
- system meaning
- constraints
- state transitions
- executable semantics

---

# Fundamental Principles

1. Source code is not primary.
2. Intent is part of the program.
3. Invariants are first-class citizens.
4. Platform is only an adapter.
5. AI participates in compilation and semantic transformation.

---

# Core Semantic Primitives

Canonical primitives:
- State
- Transition
- Invariant
- Entity
- Capability
- Effect
- Event
- Resource
- Interface
- Relation

---

# Internal Representation

The internal representation should be:
- typed
- semantic
- graph-based

Instead of plain source code.

The semantic graph becomes the true program.

---

# Human Interface Layer

Humans interact through descriptive semantic syntax.

Example:

system Notes

intent:
  offline-first note system

state:
  notes form a versioned graph

invariant:
  no note history may be lost

transition:
  edit note using patch merge

---

# Semantic Compiler Pipeline

Human Intent
↓
Semantic Parsing
↓
Normalization
↓
Constraint Resolution
↓
Semantic Graph
↓
Optimization
↓
Execution Graph
↓
Runtime / Platform Adapters

---

# Semantic Runtime

The runtime executes:
- states
- transitions
- invariants
- effects

Responsibilities:
- persistence
- synchronization
- scheduling
- validation
- rollback
- execution planning

---

# Platform Abstraction

semantic runtime
    ↓
linux adapter
browser adapter
mobile adapter
distributed adapter

---

# Visual Tooling

Implemented:
- graph explorer (GraphPreviewPanel — interactive graph webview)
- endpoint summary (EndpointSummaryPanel — REST/SOAP/GraphQL/Events/gRPC)
- semantic diff (versioned artifacts with sourceHash tracking)

Future:
- semantic debugger
- invariant inspector
- execution visualizer

---

# Determinism

The runtime should remain:
- deterministic
- inspectable
- reproducible
- testable

AI assists semantic modeling, not uncontrolled runtime execution.

---

# Suggested Architecture

Human Intent Layer
        ↓
AI Semantic Compiler
        ↓
Semantic Program Graph
        ↓
Execution Graph / Semantic Bytecode
        ↓
Semantic Runtime / VM
        ↓
Platform Adapters

---

# Current Technology Stack

- TypeScript / Node.js
- MCP servers over Streamable HTTP (Docker bridge network)
- JSON-based canonical IR (`source.codegraph.json`)
- VSCode extension (WebviewViewProvider panels)

---

# Possible Names

- Semantic State Programming
- Intent-Oriented Programming
- Semantic Graph Programming
- AI-Shaped Programming

---

# Final Insight

The real shift is not:

AI writes code.

The real shift is:

The abstraction of programming itself changes.
