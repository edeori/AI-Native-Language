# system

Simple notes service with one web UI and one API.

## intent
Create, edit, list, and search notes.

## context
- inbound: browser UI
- outbound: persistence layer
- outbound: audit log service for write events
- external systems: audit log service for create, update, and delete actions

## interfaces
- ui: note editor, note list, search field
- api: create note, update note, delete note, list notes
- audit: write event to the audit log service
- persistence: local file or database persistence layer for notes

## data_flows
- User submits create or update input through the UI.
- The service validates the request and checks access before any write.
- The service reads the existing note state if an update is requested.
- The service builds the write request and sends an audit event to the audit log service.
- The service persists the note through the persistence layer.
- The service returns the updated list or a failure response.

## processes
- authenticate the user locally
- authorize create and update actions
- validate the note payload and required fields
- load the current note state when updating or deleting
- call the audit log service for create, update, and delete actions
- persist notes through the Spring Boot service using the local file or database persistence layer
- return the updated notes list or an error response
- search notes by title or content

## rules
- note title is required
- note content may be empty
- note ids must be stable
- search is read-only
- invalid payloads are rejected before persistence

## security
- local authentication only for v0
- no external SSO integration yet
- create, update, and delete actions require authenticated access
- protect note data by default
- note ownership is enforced for write actions

## dependencies
- Spring Boot backend for the note service
- audit log service for write operations
- local file or database persistence layer for notes
- note repository adapter for persistence
- audit log client adapter for the external service

## entities
- note: id, title, content, owner_id, status, created_at, updated_at
- user: id, email, display_name, role, status, created_at, updated_at
- audit_log: id, action, actor_id, subject_type, subject_id, payload, created_at

## database_schema
- notes table stores the note domain object and write-state snapshot
- users table stores the authenticated user and ownership context
- audit_log table stores audit events for create, update, and delete actions
- notes.id is the stable primary key
- notes.owner_id references the owning user
- audit_log.subject_id references the affected note or user record

## examples
- user creates a note called "Shopping"
- user searches for notes containing "project"
- user updates a note and the service returns the refreshed list

## acceptance_criteria
- notes can be created, updated, deleted, and searched
- security checks are visible in the flow
- persistence is explicit in the graph
- graph validation passes
- Spring Boot skeleton is generated
