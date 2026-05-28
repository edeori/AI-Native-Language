# MCP Server Contracts

This document describes the current MVP tool contracts for the AI-native semantic workflow.

## Shared expectations

- transport: `stdio`
- provider-neutral behavior
- workspace-local artifact persistence
- JSON output payloads wrapped as text responses
- strict separation between semantic source, canonical graph, validation, and code generation

## `semantic-core`

### Tools

- `parse_semantic_markdown`
- `generate_canonical_graph`

### Inputs

- `path` optional file path to Semantic Markdown
- `content` optional raw Markdown content
- `persist` optional boolean

### Outputs

- parsed section list
- canonical graph JSON
- optional local cache path

### Local artifacts

- `.ai-native/cache/`
- `.ai-native/graph/`

## `validator`

### Tools

- `validate_semantic_markdown`

### Inputs

- `path` optional file path to Semantic Markdown
- `content` optional raw Markdown content
- `policyText` optional security policy input
- `persist` optional boolean

### Outputs

- validation status
- gaps
- conflicts
- warnings
- security violations
- graph preview
- local validation report path

### Local artifacts

- `.ai-native/validation/`

## `compiler`

### Tools

- `generate_spring_boot_skeleton`

### Inputs

- `path` optional file path to Semantic Markdown
- `content` optional raw Markdown content
- `outputDir` optional target directory
- `basePackage` optional Java package name
- `artifactName` optional artifact name
- `persist` optional boolean

### Outputs

- generated file list
- generated file previews
- manifest path
- output directory

### Local artifacts

- `.ai-native/generated/`
- chosen target output directory

