# system

Enterprise event platform backend with a layered Maven architecture and a separate notification microservice.

## intent
Model events, organizers, users, media, RSVPs, search, tracking, and notifications in a Spring Boot backend.

## context
- inbound: REST APIs and WebSocket notifications
- outbound: PostgreSQL, Redis, mail, object storage, and external identity or feature control systems
- external systems: PostgreSQL, Redis, mail delivery, object storage, OAuth or JWT identity boundary

## modules
- api: OpenAPI-facing contract and DTO layer
- web: REST controllers and HTTP entry points
- service: business orchestration, guards, jobs, listeners, and notification dispatch
- persistence: repositories, entities, row mappers, and query objects
- common: security, notification, redis, and shared utilities
- app: Spring Boot bootstrap and application wiring
- notification: separate real-time notification microservice

## interfaces
- rest api: events, users, organizers, tags, search, stats, tracking, auth
- websocket: real-time notification channel
- application config: security, cors, mail, minio, and runtime wiring
- persistence: repositories and query interfaces

## data_flows
- A user request enters the REST API.
- Security and feature guards validate access.
- The service layer orchestrates domain work.
- The persistence layer loads and stores records.
- Optional mail, object storage, or Redis interactions support side effects.
- Notification events are published for real-time delivery.
- The API returns an updated resource, statistics, or an error response.

## processes
- authenticate the request with JWT or cookie-backed access
- authorize feature-gated actions
- validate and transform incoming DTOs
- load and update event, organizer, user, media, or RSVP state
- persist transactional changes through the repository layer
- publish notification events for downstream consumers
- dispatch mail, storage, or background jobs when needed
- expose data back through REST or websocket responses

## rules
- write actions require authenticated access
- feature policies can block specific actions
- invalid payloads must be rejected before persistence
- protected resources must not leak across ownership boundaries
- notification side effects must not break the main transaction path

## security
- JWT-based authentication boundary
- feature guards for protected actions
- resource-level authorization
- notification and admin flows require explicit access checks

## dependencies
- Spring Boot
- Spring Security
- PostgreSQL
- Redis
- Flyway
- WebSocket runtime
- mail service
- object storage
- OpenAPI tooling
- feature policy layer

## examples
- a user creates an event and receives a refreshed event view
- a follow or RSVP action emits a notification event
- a protected admin action is rejected without the right feature policy

## acceptance_criteria
- the graph shows module boundaries, external systems, and security gates
- the flow trace shows request → auth → service → persistence → side effects → response
- notification behavior is visible as a separate path
- the model is useful for both review and code generation

