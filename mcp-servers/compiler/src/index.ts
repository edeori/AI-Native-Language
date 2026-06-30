import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  generateCanonicalGraph,
  generateSpringBootSkeleton,
  parseSemanticMarkdown,
  parseSemanticMarkdownFromFile,
  startMcpServer,
  storeDownload,
} from '@ai-native/semantic-shared';

function createServer() {
  const server = new McpServer({
    name: 'ai-native-compiler',
    version: '0.1.0',
  });

  const compileInputSchema = z.object({
    path: z.string().optional(),
    content: z.string().optional(),
    basePackage: z.string().optional(),
    artifactName: z.string().optional(),
  });

  server.registerTool(
    'get_maven_project_conventions',
    {
      description:
        'Returns the standard Maven multi-module project conventions for Spring Boot backends. ' +
        'Call this whenever creating a new module, class, package, or when you need to know the canonical project layout, naming rules, or dependency versions.',
      inputSchema: z.object({}),
    },
    async () => {
      const conventions = `# Maven multi-module Spring Boot — project conventions

## Module layout

\`\`\`
{root-app}/                        ← parent POM (aggregator, groupId: {groupId})
  versions/                        ← BUILD: Java + library version properties ONLY
  bom/                             ← BUILD: spring-boot-dependencies import + extra dep pins
  app/                             ← BUILD: plugin management + internal dep management (POM only, no src)
  api/                             ← RUNTIME: OpenAPI YAML-first → generated interfaces + DTOs
  common/                          ← RUNTIME: shared security / JWT / cross-cutting infra
  persistence/                     ← RUNTIME: JPA entities + Spring Data repositories
  service/                         ← RUNTIME: business logic services
  web/                             ← RUNTIME: REST controllers implementing api interfaces
  build/                           ← RUNTIME: @SpringBootApplication + application.yml + Flyway + spring-boot-maven-plugin → executable fat JAR
\`\`\`

**IMPORTANT: Do NOT add business logic to versions / bom / app.**
The deployable artifact (fat JAR) is produced by the \`build\` module, NOT by \`app\`.
\`app\` is a POM-only coordinator; \`build\` is what you deploy.

## POM parent chain

\`\`\`
versions  ← bom (imports spring-boot-dependencies)
versions  ← app (plugin management, internal dep management)
app       ← api, common, persistence, service, web, build
\`\`\`

When creating a new runtime module its \`<parent>\` must reference \`app\`.
Add it to: root parent POM \`<modules>\` AND \`app\`'s \`<dependencyManagement>\`.

## Dependency chain

\`\`\`
build → web → service → persistence → common
                    ↘ api ↗
\`\`\`
- \`api\` and \`common\` have no internal module dependencies
- \`persistence\` depends on: api + common
- \`service\` depends on: persistence + api + common
- \`web\` depends on: api + service
- \`build\` depends on: web (brings everything transitively)

## API-first (OpenAPI) pattern

1. Define endpoint in \`api/src/main/resources/openapi/{name}.yaml\`
2. \`mvn generate-sources\` → generates \`*Api\` Spring interfaces + DTOs into \`{groupId}.api\` / \`{groupId}.dto\`
3. Implement in \`web\`: \`class FooApiImpl implements FooApi { ... }\` (delegate to service)
4. Service interface lives in \`service\` or \`common\`; impl is \`*ServiceImpl\` in \`service\`

## Package naming per module

| Module        | Base package                           | What lives here                                   |
|---------------|----------------------------------------|---------------------------------------------------|
| \`api\`         | \`{groupId}.api\`                        | OpenAPI-generated \`*Api\` Spring interfaces        |
|               | \`{groupId}.dto\`                        | OpenAPI-generated DTOs (Lombok + Jackson)         |
| \`common\`      | \`{groupId}.common.security\`            | SecurityConfig, JWT classes                       |
|               | \`{groupId}.common.{domain}\`            | Shared utilities, cross-cutting concerns          |
| \`persistence\` | \`{groupId}.persistence.entity\`         | \`@Entity\` classes                                |
|               | \`{groupId}.persistence.repository\`     | \`*Repository extends JpaRepository<T, ID>\`       |
| \`service\`     | \`{groupId}.service.{domain}\`           | \`*Service\` interface + \`*ServiceImpl\`            |
|               | \`{groupId}.service.jobs\`               | \`*Job\` (scheduled tasks)                         |
| \`web\`         | \`{groupId}.web.controller\`             | \`*ApiImpl implements *Api\`                        |
|               | \`{groupId}.web.config\`                 | \`*Config\`, \`*Properties\`                        |
| \`build\`       | \`{groupId}\`                            | \`*Application\` (@SpringBootApplication main)     |
|               | \`{groupId}.config\`                     | App-level @Configuration beans                    |

## DB migrations (Flyway)

Location: \`build/src/main/resources/db/migration/V{n}__{description}.sql\`
Naming: \`V1__init.sql\`, \`V2__add_user_table.sql\`

## Dependency versions — always use latest stable compatible with Spring Boot 3.x / Jakarta EE 10

| Dependency             | Reference version | Notes                                              |
|------------------------|-------------------|----------------------------------------------------|
| Java                   | 21                | LTS; use records, sealed classes where appropriate |
| Spring Boot            | 3.3.x+            | Jakarta EE (\`jakarta.*\`, never \`javax.*\`)         |
| springdoc-openapi      | 2.6.x+            | \`springdoc-openapi-starter-webmvc-ui\`             |
| PostgreSQL driver      | 42.7.x+           |                                                    |
| Lombok                 | 1.18.x+           | \`scope: provided\` everywhere                      |
| jjwt (JJWT)           | 0.12.x+           | api + impl (runtime) + jackson (runtime)           |
| AWS SDK v2             | 2.x (latest)      | \`software.amazon.awssdk:{service}\`                |
| Flyway                 | via Spring BOM    | + \`flyway-database-postgresql\` for PG             |
| openapi-generator      | 7.x (latest)      | Maven plugin                                       |

**Version management rules:**
- New dep version property → \`versions/pom.xml\` \`<properties>\`
- New dep pin → \`bom/pom.xml\` \`<dependencyManagement>\`
- Module poms must NEVER hardcode versions — always via BOM
- Lombok is excluded from spring-boot-dependencies BOM and re-pinned explicitly in \`bom/pom.xml\`

## Class naming conventions

- Controller: \`*ApiImpl\` (implements OpenAPI-generated interface)
- Service interface: \`*Service\`; implementation: \`*ServiceImpl\`
- Repository: \`*Repository\` (extends JpaRepository)
- Entity: class name = table name in PascalCase (no \`Entity\` suffix needed)
- Config: \`*Config\` or \`*Configuration\`
- Scheduled task: \`*Job\`
- DTO: as generated by OpenAPI generator (do not rename)
`;

      return {
        content: [{ type: 'text', text: conventions }],
      };
    },
  );

  server.registerTool(
    'generate_spring_boot_skeleton',
    {
      description: 'Generate a limited Java 17+ Spring Boot skeleton from the canonical graph model. Returns a downloadPath (e.g. /download/uuid.tar.gz) — combine with this server\'s base URL to download the archive: curl "<base-url><downloadPath>" | tar -xz -C <target-dir>',
      inputSchema: compileInputSchema,
    },
    async ({ path, content, basePackage, artifactName }) => {
      const document = content ? parseSemanticMarkdown(content, path) : await parseSemanticMarkdownFromFile(path ?? '');
      const graph = generateCanonicalGraph(document);
      const generated = generateSpringBootSkeleton(graph, { basePackage, artifactName });

      const downloadId = storeDownload(
        generated.files.map((f) => ({ path: f.path, content: f.content })),
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                downloadPath: `/download/${downloadId}.tar.gz`,
                files: generated.files.map((f) => ({ path: f.path, size: f.content.length })),
                graph,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_openapi_yaml_conventions',
    {
      description:
        'Returns the standard OpenAPI YAML authoring conventions for REST APIs: URL patterns, DTO/schema naming, property naming, response structures, security, and header rules. ' +
        'Call this when writing or extending an OpenAPI YAML spec, defining new DTOs, or adding new REST endpoints.',
      inputSchema: z.object({}),
    },
    async () => {
      const conventions = `# OpenAPI YAML conventions — REST API

## URL path conventions

- Paths are **kebab-case**, no version prefix on the base path: \`/events\`, \`/event-collaborators\`
- Resource collections: plural noun → \`/events\`, \`/organizers\`, \`/users\`
- Sub-resources: \`/events/{id}/collaborators\`, \`/organizers/{id}/admins\`
- **Actions on a resource**: colon-separator on the same segment — \`/events/{id}:publish\`, \`/auth/password:reset:request\`, \`/auth/verify-email:resend\`
  - Do NOT use \`/events/{id}/publish\` (that looks like a sub-resource, not an action)
- Path parameters: \`{id}\` for primary key, \`{organizerId}\` / \`{userId}\` for typed foreign keys

## Schema (DTO) naming

| Pattern              | Convention           | Example                                          |
|----------------------|----------------------|--------------------------------------------------|
| Read model           | Noun (PascalCase)    | \`Event\`, \`Organizer\`, \`CohostInvitation\`   |
| Paginated list       | \`Paged*\`           | \`PagedLocations\`, \`PagedEvents\`              |
| Create/update body   | \`*Request\`         | \`RegisterRequest\`, \`EventCreateRequest\`      |
| Upsert body          | \`Upsert*Request\`   | \`UpsertLocationRequest\`                        |
| Response wrapper     | \`*Response\`        | \`AuthResponse\`, \`AccessTokenResponse\`        |
| Enum type            | Noun (PascalCase)    | \`OrganizerRole\`, \`EventStatus\`               |
| Flags/capabilities   | \`*Flags\`           | \`PermissionFlags\`                              |

## Property naming in schemas

- **camelCase** for domain fields: \`eventId\`, \`organizerId\`, \`createdAt\`, \`updatedAt\`, \`displayName\`
- **snake_case** only for form/user-input fields where the frontend form key is snake_case: \`display_name\`, \`accept_tos\`, \`turnstile_token\`
- IDs: always \`{ type: string, format: uuid }\`
- Timestamps: always \`{ type: string, format: date-time }\`
- Nullable fields: add \`nullable: true\` explicitly
- Enum values: UPPER_CASE → \`[PENDING, ACCEPTED, DECLINED, REVOKED, EXPIRED]\`

## Standard response structures

### Single resource
\`\`\`yaml
'200':
  content:
    application/json:
      schema: { $ref: '#/components/schemas/Event' }
\`\`\`

### Paginated list
\`\`\`yaml
schema:
  type: object
  properties:
    items:
      type: array
      items: { $ref: '#/components/schemas/Event' }
    meta:
      type: object
      properties:
        total:  { type: integer }
        limit:  { type: integer }
        offset: { type: integer }
\`\`\`

### Error response (all 4xx/5xx)
\`\`\`yaml
schema: { $ref: '#/components/schemas/Error' }
# Error schema: { code: string, message: string, details?: object }
\`\`\`

### 201 Created — include Location header
\`\`\`yaml
'201':
  headers:
    Location:
      schema: { type: string, format: uri }
      description: URL of the created resource
  content:
    application/json:
      schema: { $ref: '#/components/schemas/Foo' }
\`\`\`

### Auth cookie endpoints
\`\`\`yaml
headers:
  Set-Cookie:
    schema: { type: string }
    description: HttpOnly; Secure; SameSite=Lax refresh token cookie
\`\`\`

## Security

- Global default: \`security: - AppToken: []\` (JWT Bearer)
- Public endpoints override with: \`security: []\`
- Security scheme definition:
\`\`\`yaml
components:
  securitySchemes:
    AppToken:
      type: http
      scheme: bearer
      bearerFormat: JWT
\`\`\`

## Reusable parameters (define in components/parameters, reference with $ref)

\`\`\`yaml
components:
  parameters:
    IdParam:
      in: path
      name: id
      required: true
      schema: { type: string, format: uuid }
\`\`\`

Reference: \`parameters: - $ref: '#/components/parameters/IdParam'\`

## Tag and grouping conventions

- Tag names: PascalCase or Title Case → \`Auth\`, \`Profile\`, \`Organizer Admins\`
- Use \`x-tagGroups\` to visually group tags in API docs:
\`\`\`yaml
x-tagGroups:
  - name: Identity
    tags: [Auth, Profile, Users]
  - name: Organizing
    tags: [Organizers, Events]
\`\`\`

## Inline vs $ref

- Inline \`{}  \` style for simple single-property schemas: \`{ type: string, format: uuid }\`
- Use \`$ref\` for any schema used in 2+ places
- Request/response bodies always use \`$ref\` to named schemas — never define complex schemas inline in path operations

## operationId

- Only add \`operationId\` when the auto-generated name from path+method would be ambiguous
- Format: camelCase verb + noun → \`verifyEmail\`, \`publishEvent\`, \`uploadLogo\`

## HTTP method → semantic mapping

| Method   | Semantics                              | Body    | Typical status |
|----------|----------------------------------------|---------|----------------|
| GET      | Read, idempotent                       | none    | 200            |
| POST     | Create or action                       | yes     | 201 / 200      |
| PUT      | Full replace                           | yes     | 200            |
| PATCH    | Partial update                         | yes     | 200            |
| DELETE   | Remove                                 | no      | 204            |

- Actions (non-CRUD) use POST: \`POST /events/{id}:publish\`
- 204 No Content: do NOT include a response body schema
`;

      return {
        content: [{ type: 'text', text: conventions }],
      };
    },
  );

  return server;
}

async function main() {
  await startMcpServer(createServer, { serviceName: 'compiler' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
