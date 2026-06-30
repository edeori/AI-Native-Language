# OpenAPI YAML conventions — REST API

MCP tool: `get_openapi_yaml_conventions`  
Triggered automatically when: `isApi` topic detected — no button, no manual call needed.

**Trigger kulcsszavak** (magyar és angol egyaránt):
`végpont`, `végpontot`, `endpointot`, `új endpoint`, `új végpont`, `dto-t`, `openapi`, `yaml`, `api spec`, `api leíró`, `api specifikáció`, `api yaml`, `api definíció`, `api-hoz`, `api-t bővít`, `swagger`, `controller`, `request body`, `response schema`, `kérés séma`, `válasz séma`, `útvonal`

---

## URL path szabályok

- **kebab-case**, verzió-prefix nélkül: `/events`, `/event-collaborators`
- Kollekciók: többes szám → `/events`, `/organizers`, `/users`
- Al-erőforrások: `/events/{id}/collaborators`, `/organizers/{id}/admins`
- **Akciók erőforráson**: kettőspont-szeparátor ugyanazon a szegmensen:
  - `POST /events/{id}:publish`
  - `POST /auth/password:reset:request`
  - `POST /auth/verify-email:resend`
  - **NE** `/events/{id}/publish` — az al-erőforrásnak néz ki, nem akciónak
- Path paraméterek: `{id}` primary key-hez, `{organizerId}` / `{userId}` typed FK-khoz

## Schema (DTO) elnevezés

| Minta              | Konvenció            | Példa                                              |
|--------------------|----------------------|----------------------------------------------------|
| Read model         | Főnév (PascalCase)   | `Event`, `Organizer`, `CohostInvitation`           |
| Lapozható lista    | `Paged*`             | `PagedLocations`, `PagedEvents`                    |
| Create/update body | `*Request`           | `RegisterRequest`, `EventCreateRequest`            |
| Upsert body        | `Upsert*Request`     | `UpsertLocationRequest`                            |
| Response wrapper   | `*Response`          | `AuthResponse`, `AccessTokenResponse`              |
| Enum típus         | Főnév (PascalCase)   | `OrganizerRole`, `EventStatus`                     |
| Jogosultság flags  | `*Flags`             | `PermissionFlags`                                  |

## Property elnevezés schemákban

- **camelCase** domain fieldekhez: `eventId`, `organizerId`, `createdAt`, `updatedAt`
- **snake_case** csak form/user-input fieldekhez ahol a frontend form key snake_case: `display_name`, `accept_tos`, `turnstile_token`
- ID-k: mindig `{ type: string, format: uuid }`
- Timestampek: mindig `{ type: string, format: date-time }`
- Nullable fieldek: explicit `nullable: true`
- Enum értékek: UPPER_CASE → `[PENDING, ACCEPTED, DECLINED, REVOKED, EXPIRED]`

## Standard response struktúrák

### Egyszeres erőforrás
```yaml
'200':
  content:
    application/json:
      schema: { $ref: '#/components/schemas/Event' }
```

### Lapozható lista
```yaml
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
```

### Error (minden 4xx/5xx)
```yaml
schema: { $ref: '#/components/schemas/Error' }
# Error schema: { code: string, message: string, details?: object }
```

### 201 Created — Location header
```yaml
'201':
  headers:
    Location:
      schema: { type: string, format: uri }
      description: URL of the created resource
  content:
    application/json:
      schema: { $ref: '#/components/schemas/Foo' }
```

### Auth cookie endpointok
```yaml
headers:
  Set-Cookie:
    schema: { type: string }
    description: HttpOnly; Secure; SameSite=Lax refresh token cookie
```

## Security

- Globális default: `security: - AppToken: []` (JWT Bearer)
- Publikus endpointok override: `security: []`
- Security scheme definíció:
```yaml
components:
  securitySchemes:
    AppToken:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

## Újrahasználható paraméterek

Definíció `components/parameters`-ben, hivatkozás `$ref`-fel:
```yaml
components:
  parameters:
    IdParam:
      in: path
      name: id
      required: true
      schema: { type: string, format: uuid }
```

Használat: `parameters: - $ref: '#/components/parameters/IdParam'`

## Tag és csoportosítás

- Tag nevek: PascalCase / Title Case → `Auth`, `Profile`, `Organizer Admins`
- `x-tagGroups` a vizuális csoportosításhoz API docs-ban:
```yaml
x-tagGroups:
  - name: Identity
    tags: [Auth, Profile, Users]
  - name: Organizing
    tags: [Organizers, Events]
```

## Inline vs $ref

- Inline `{}` stílus egyszerű egyetlen-property schemákhoz: `{ type: string, format: uuid }`
- `$ref` minden schemához ami 2+ helyen szerepel
- Request/response body-k **mindig** named schemát referálnak — komplex séma soha ne legyen inline path operációban

## operationId

- Csak akkor add, ha az auto-generált név path+method alapján kétértelmű lenne
- Formátum: camelCase ige + főnév → `verifyEmail`, `publishEvent`, `uploadLogo`

## HTTP method → szemantika

| Method   | Szemantika                              | Body    | Tipikus státusz |
|----------|-----------------------------------------|---------|-----------------|
| GET      | Olvasás, idempotens                     | nincs   | 200             |
| POST     | Létrehozás vagy akció                   | igen    | 201 / 200       |
| PUT      | Teljes csere                            | igen    | 200             |
| PATCH    | Részleges módosítás                     | igen    | 200             |
| DELETE   | Törlés                                  | nincs   | 204             |

- Nem-CRUD akciók → POST: `POST /events/{id}:publish`
- 204 No Content: ne legyen response body schema
