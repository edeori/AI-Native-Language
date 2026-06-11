# Event-App-BE

This is a reference project for improving the AI-native graph model and MCP workflow.

## Why this project matters

It contains the kinds of enterprise signals that the current MVP needs to understand better:

- multi-module Maven structure
- Spring Boot application layering
- REST and WebSocket-style interfaces
- JWT and feature-guarded security
- PostgreSQL persistence with Flyway migrations
- Redis-based runtime state / pub-sub style integration
- mail, storage, and external service integration
- notification-oriented flows and background jobs

## What we want to learn from it

- how to identify module boundaries
- how to distinguish external dependencies from internal layers
- how to represent security gates and protected flows
- how to show service orchestration and persistence in the graph
- how to make the graph useful for humans and for code generation

## Source material

- Maven modules under `event-backend/`
- the separate notification microservice under `event-notification/`

