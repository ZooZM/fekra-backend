# Research: Admin Clients Dashboard

**Feature**: `001-admin-clients-dashboard` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

Each entry resolves an open technical question from the plan's Technical Context. Facts about
the current code were checked in the repository on 2026-11-07.

---

## R1. Repository split and production topology

- **Decision**: The backend changes live in this repository (`fekra-backend`). The dashboard is a
  new repository, `fekra-dashboard`. In production, one Caddy reverse proxy on the GCP VM serves
  both under a single origin: `https://<host>/` serves the dashboard, and `https://<host>/api/*`
  is proxied to the NestJS API with the `/api` prefix stripped. In development, the Vite dev
  server proxies `/api` the same way, so dev and production behave alike.
- **Rationale**: A single origin needs no CORS for the dashboard and keeps the session cookie
  same-site (`SameSite=Strict` works). It also leaves the existing backend routes unchanged
  (`/clients`, `/webhooks/meta`, ...), so nothing breaks. Caddy obtains and renews TLS
  certificates on its own. The constitution allows Nginx or Caddy.
- **Alternatives considered**: An `api.` subdomain plus an `admin.` subdomain (needs CORS on
  every request and more DNS/TLS setup). A global `/api` prefix inside NestJS (breaks the Meta
  webhook URL already registered with Meta, and the n8n callback URL).
- **Consequence**: The production Meta webhook URL becomes `https://<host>/api/webhooks/meta`.
  It is updated in the Meta app settings when the proxy goes live.

## R2. Session model (FR-003: survives reloads, 30 min idle, 12 h max, sign-out is immediate)

- **Decision**: Use a server-side session identified by an opaque refresh token in an
  `httpOnly; Secure; SameSite=Strict` cookie, plus a short-lived access JWT kept in memory.
  - Login creates a session row (the existing `RefreshToken` model, extended). Its token is 32
    random bytes, and only its SHA-256 hash is stored. `expiresAt` is login time + 12 h (the
    absolute limit), and `lastUsedAt` is the login time.
  - `POST /auth/refresh` accepts the cookie when the session is not revoked,
    `now < expiresAt` and `now - lastUsedAt < 30 min`. It sets `lastUsedAt = now` and returns
    a new access JWT and the user. The cookie value itself is not rotated.
  - The access JWT lives 10 minutes (`JWT_EXPIRES_IN=10m` in production) and carries a `sid`
    claim. `JwtStrategy` already loads the user on every request; it now also rejects a token
    whose session is revoked or past `expiresAt`. Tokens without `sid` (issued before this
    change) stay valid until they expire.
  - `POST /auth/logout` revokes the session (`revokedAt = now`) and clears the cookie. Every
    tab's access token stops working on its next request, which satisfies "the same browser
    cannot continue it".
- **Rationale**: The cookie value never changes, so several tabs refreshing at once can't race
  each other. Rotation with reuse detection would log users out when two tabs refresh together
  unless refresh is coordinated across tabs. The cookie is `httpOnly`, `Secure` and
  `SameSite=Strict`, so it is hard to steal. Idle and absolute limits are enforced on the
  server, and the existing `RefreshToken` table only needs two extra columns. This matches the
  constitution: access token in memory, refresh token in an httpOnly cookie.
- **Alternatives considered**: Rotating refresh tokens with reuse detection (stronger against
  stolen cookies, but needs cross-tab locking; can be added later without changing the
  contract). A long-lived JWT in `localStorage` (forbidden by the constitution). Pure in-memory
  tokens (fail FR-003, because a reload signs the user out).

## R3. Idle detection and activity-driven refresh in the dashboard

- **Decision**: The dashboard counts any `pointerdown`, `keydown`, `wheel` or `touchstart`
  event as activity. It refreshes the session whenever there was activity and the last refresh
  is more than 5 minutes old, and also when a request returns `401` with an expired access
  token (one shared in-flight refresh per tab). After 30 minutes without activity it calls
  `/auth/logout` and shows the sign-in page with a "signed out after inactivity" notice.
- **Rationale**: Refreshing only on API calls would let the server's idle window expire while
  an admin spends 30+ minutes typing a long message list. Refreshing on activity keeps the
  server's notion of "idle" aligned with real use, and the client-side timer makes sign-out
  happen on time even without a request.
- **Alternatives considered**: Refreshing on a fixed background timer (defeats the idle rule).
  Server-only idle enforcement (the admin would discover it only when a save fails).

## R4. Sign-in throttling (FR-027)

- **Decision**: Use a Redis counter per email: `auth:login-fail:<sha256(lowercased email)>`.
  The first failure sets a TTL of 900 s, and each later failure increments the counter. When the
  counter reaches 5, its TTL is reset to 900 s, starting the 15-minute block. While the counter
  is ≥ 5, sign-in is refused before the password is checked, with the same
  `401 UNAUTHORIZED "Invalid credentials"` response as a wrong password. A successful sign-in
  deletes the key. Unknown emails are counted the same way.
- **Shared Redis connection**: The `REDIS` provider moves from `src/inbox/redis.provider.ts` to a
  new global `src/redis/redis.module.ts`. It keeps the same `'REDIS'` injection token, so inbox
  services do not change, and it now reads its settings through `ConfigService` (a constitution
  VIII follow-up). The subscriber connection (`REDIS_SUB`) stays in the inbox module.
- **Rationale**: Redis is already in the stack, TTL keys match the inbox patterns, and keys are
  hashed so they don't store emails in plaintext. An identical response for blocked and wrong
  attempts meets "the message MUST NOT reveal whether the block is active".
- **Alternatives considered**: `@nestjs/throttler` (per-route and IP-based, not per-email with
  a block window). Columns in Postgres (an extra write on every failure; Redis TTLs are simpler).
- **Accepted trade-off**: An attacker who knows an admin's email can block that admin's sign-in
  for 15 minutes at a time. This is temporary, matches the clarified requirement, and other
  admins are unaffected.

## R5. Detecting simultaneous edits (FR-029)

- **Decision**: Add `version Int @default(1)` to `Client`, and include it in every
  `ClientRecord` response. `PATCH /clients/:id` requires `version` in the body. Inside a
  transaction, the repository loads the row (missing → 404), compares versions (different →
  409), then runs `update({ where: { id, version }, data: { ...changes,
  version: { increment: 1 } } })`. If that update finds no row because of a race, the result is
  also 409. The 409 body is
  `{ errorCode: "CLIENT_VERSION_CONFLICT", details: { currentVersion, updatedAt, updatedBy } }`,
  where `updatedBy` comes from the latest activity entry (R6). Token replacement and deletion
  do not check or increment the version.
- **Rationale**: An integer version is explicit, has no timestamp-precision problems, and Prisma
  7 accepts non-unique fields alongside `id` in `update`'s `where`. Token replacement changes
  nothing visible in the edit form, so it should not invalidate an admin's open form.
- **Alternatives considered**: Comparing `updatedAt` (precision and serialization pitfalls).
  `ETag`/`If-Match` headers (more standard, but the field can't be seen in the Postman body and
  needs CORS header exposure). Locking (rejected in clarification).
- **Contract impact**: Requiring `version` on PATCH is a breaking change to an existing endpoint
  (constitution III). It is justified in the plan's Complexity Tracking.

## R6. Activity record storage (FR-028)

- **Decision**: Add a new Postgres table `client_activities` (Prisma model `ClientActivity`). Its
  columns are `id`, `clientId`, `clientName`, `actorId`, `actorName`, `actorEmail`, `action`
  (enum `CREATED | UPDATED | DELETED | ACCESS_TOKEN_REPLACED`), `changedFields String[]` and
  `createdAt`. It has **no foreign keys**, so entries outlive the client and the admin account;
  names are copied in at write time. Each entry is written in the **same transaction** as the
  change it records. `ClientsRepository` performs both writes because it owns the transaction.
  No update or delete method exists, and nothing deletes entries, which meets "at least 1 year".
  For edits, `changedFields` lists the top-level fields whose values differ by deep equality.
  An edit with no differences writes nothing and does not increment the version.
- **Rationale**: Writing in one transaction makes "no partial saves" (FR-021) cover the record
  too. Postgres is the only primary datastore (constitution VI). Copying names in avoids
  dangling references after deletion.
- **Alternatives considered**: Application log lines only (not queryable, and lost with log
  rotation). A separate repository with transaction passing (more plumbing for one insert).
  Database triggers (the actor isn't known at the database level).

## R7. Client search (FR-007)

- **Decision**: `GET /clients` accepts an optional `search` (1–100 characters, trimmed). The
  repository filters with `OR: [{ name: { contains, mode: 'insensitive' } },
  { businessCategory: { contains, mode: 'insensitive' } }]` and uses the **same `where` for the
  count**. `%`, `_` and `\` in the search are escaped before matching. No new index is added.
- **Rationale**: At up to 500 clients, a scan with `ILIKE` stays in the low milliseconds.
  Case-insensitivity doesn't apply to Arabic letters, and Arabic text still matches by exact
  characters.
- **Alternatives considered**: A `pg_trgm` index (unneeded at this scale; revisit beyond about
  50k rows). Full-text search (different matching semantics than the spec's partial match).

## R8. Input-validation adjustments

- **DM settings rule (FR-026)**: The rule "at least one message when private messages are on"
  is applied with a `.refine()` on the **input** schemas used by create and update only, not on
  `DmReplyConfigSchema` itself. The database readers in `json-readers.ts` use that base schema.
  If the rule were added there, existing rows that break it would silently be read back as the
  fallback config, which would switch off automation for those clients.
- **Logo link (FR-009)**: The client schema uses `httpUrl.max(255)`, matching
  `brand_logo VARCHAR(255)`. The shared `httpUrl` primitive allows 500 characters, which caused
  a database error for links between 256 and 500 characters.
- **Access token body**: `PUT /clients/:id/access-token` gets a Zod DTO
  `{ token: string (1–4096, trimmed) }` in place of the unvalidated `@Body('token')`. The body
  shape is unchanged.
- **Duplicate Facebook/Instagram IDs (FR-012)**: The service checks for an existing client with
  the same `fbPageId` or `instaAccountId` before writing. On a match it throws
  `409 DUPLICATE_KEY_ERROR` with `details.field` set to `"fbPageId"` or `"instaAccountId"`. The
  database unique constraint remains the backstop for races. This is the error code the global
  filter already uses, so clients see no new code, and the field name the dashboard needs is
  guaranteed.
- **Login body**: Passport's guard runs before pipes, so `LocalStrategy` normalizes the email
  (trim and lowercase) before the throttle check and the user lookup.

## R9. Enforcing admin-only access (FR-001, FR-002)

- **Decision**: `ClientsController` gets `@UseGuards(JwtAuthGuard, RolesGuard)` and
  `@Roles('ADMIN')` at class level. This feature also fixes `UsersController`, where every
  `/users/admin*` route checks only the JWT. Because `AdminCreateUserSchema` accepts `roles`,
  any CLIENT-role user can currently create an ADMIN account, which defeats FR-001/FR-002. The
  admin routes get the same role guard, and `@Param('id') { id }: IdParamDto` (which validates a
  string against an object schema) becomes `@Param() { id }: IdParamDto`.
- **Rationale**: The constitution says roles are enforced by guards, not by route names. Admin
  access can't be secure while any user can promote themselves.

## R10. API contract shared with the dashboard

- **Decision**: Add `@nestjs/swagger` and publish an OpenAPI 3.1 document generated from the
  existing nestjs-zod DTOs (`SwaggerModule.createDocument` → `cleanupOpenApiDoc`, which is
  exported by nestjs-zod 5 and supports `@nestjs/swagger` 11). It is served at `/docs-json` when
  `OPENAPI_ENABLED=true` (the default outside production). `npm run openapi:export` writes
  `openapi/openapi.json`, which is committed. The dashboard generates types from that snapshot
  with `openapi-typescript` and calls the API with `openapi-fetch`.
  [contracts/admin-api.openapi.yaml](./contracts/admin-api.openapi.yaml) is the reviewed design
  that the generated document must match.
- **Rationale**: Constitution "Frontend Integration" says the backend SHOULD publish OpenAPI
  generated from Zod. With full settings editing, hand-copying types across repositories would
  drift quickly.
- **Alternatives considered**: Copying the Zod schemas into the dashboard (drifts). A shared npm
  package (versioning overhead for a two-repository project).

## R11. Dashboard technology stack

- **Decision**:
  - **Language and build**: React 19 + TypeScript 5 + Vite.
  - **Routing and server state**: React Router (library mode) for routes; TanStack Query 5 for
    server state (caching, refetching, mutation state).
  - **Forms**: React Hook Form + Zod 4 resolvers, with field rules mirrored from the generated
    contract.
  - **UI library**: Mantine 8 (accessible components with built-in RTL support through
    `DirectionProvider`, plus tables, forms, modals and notifications).
  - **Translations**: i18next + react-i18next.
  - Exact versions are pinned when the repository is created.
- **Rationale**: Mantine covers the admin-dashboard needs (data table, forms, dialogs, toasts)
  with RTL and accessibility built in. That shortens the WCAG 2.2 AA + RTL work (FR-023,
  FR-030). TanStack Query handles loading, empty and error states and retries consistently
  (FR-021, FR-022).
- **Alternatives considered**:
  - Material UI (RTL needs an extra Emotion/stylis plugin setup).
  - Radix + Tailwind (shadcn/ui) (strong accessibility primitives, but more components to build
    and RTL styling to own).
  - Next.js (server rendering adds nothing to an authenticated admin SPA, and needs a Node
    runtime on the VM).

## R12. Bilingual interface and RTL (FR-023, FR-024)

- **Decision**:
  - **Translations**: English and Arabic resource files. Every visible string, including
    validation messages, goes through `t()`. A lint rule blocks raw string literals in JSX.
  - **Direction**: Switching language sets `<html lang dir>` (`ar` → `rtl`) and Mantine's
    `DirectionProvider`. Styles use logical properties only (`margin-inline-start`, ...).
  - **First visit and persistence**: The browser language is used when it is `ar` or `en`,
    otherwise English. The choice is saved in `localStorage` (`fekra.lang`). That is allowed
    because it is a preference, not a secret.
  - **Client data**: User-entered values are rendered with `dir="auto"`, so Arabic names
    display right-to-left inside the English interface, and English data left-to-right inside
    the Arabic one.
  - **Unsaved input**: Switching language keeps form state, because React Hook Form state is
    independent of the locale.
- **Rationale**: This meets each part of FR-023 and the mixed-direction edge cases.

## R13. Verifying accessibility (FR-030, SC-013)

- **Decision**:
  - **Static checks**: `eslint-plugin-jsx-a11y`.
  - **Component tests**: `vitest-axe` assertions on every page component.
  - **End-to-end**: Playwright with `@axe-core/playwright`, configured with the `wcag22aa`
    rules, runs on every route in both languages.
  - **Keyboard**: A scripted keyboard-only Playwright pass walks through every user story.
  - **Messages**: Toasts and form errors are announced through ARIA live regions (Mantine
    notifications plus `aria-describedby` on fields).
- **Rationale**: Automated checks catch regressions in CI, and the keyboard pass covers what
  axe can't detect (SC-013).

## R14. Dashboard tests

- **Decision**:
  - **Unit and component tests**: Vitest + React Testing Library + MSW. Handlers are typed
    from the OpenAPI types.
  - **End-to-end tests**: Playwright against the backend running in Docker Compose (Postgres,
    Redis and API). They cover the six user stories, the session limits (with a shortened idle
    window set through test configuration), throttling, and the version conflict.
- **Rationale**: These mirror the backend's discipline from constitution Principle V. Each
  user story stays independently testable.

## R15. Delivery

- **Decision**:
  - **Backend**: A multi-stage `Dockerfile` (Node 22, non-root, `prisma generate` in the build
    stage) plus `.github/workflows/ci.yml` and `deploy.yml`. Deployment follows the constitution:
    authenticate with Workload Identity Federation, push the image tagged with the commit SHA
    to Artifact Registry, connect with `gcloud compute ssh` over IAP, run
    `prisma migrate deploy`, `docker compose up -d api`, poll `GET /health`, and roll back on
    failure.
  - **Dashboard**: `fekra-dashboard` builds an image of `nginx:alpine` serving the static build
    (with an SPA fallback to `index.html`), tagged with its own commit SHA and deployed by its
    own workflow.
  - **Shared VM files**: `deploy/compose.yml` (api, dashboard, caddy, redis, and postgres or
    Cloud SQL) and `deploy/Caddyfile` live in the backend repository.
  - **Health endpoint**: `GET /health` checks Postgres (`SELECT 1`) and Redis (`PING`).
- **Rationale**: This implements the constitution's Delivery section. The two repositories
  deploy independently, backend first.

## R16. CORS, cookies and request-forgery protection

- **Decision**:
  - **CORS**: `CORS_ORIGINS` (comma-separated, empty by default) enables CORS only for listed
    origins, with credentials. The single-origin setup from R1 leaves it empty in production.
  - **Cookie**: named `fekra_session`, with `Path` set from `SESSION_COOKIE_PATH` (default
    `/auth`; production `/api/auth` behind the proxy), plus `HttpOnly`, `Secure` (outside
    development), `SameSite=Strict` and `Max-Age` equal to the remaining absolute lifetime.
  - **Origin check**: `/auth/refresh` and `/auth/logout` additionally require an `Origin` header
    matching the app origin (`APP_ORIGIN`) or `CORS_ORIGINS`.
  - **Parsing**: Cookies are read with `cookie-parser`.
- **Rationale**: `SameSite=Strict` already blocks cross-site cookie sending, and the `Origin`
  check adds a second layer for the two cookie-authenticated endpoints. A narrow cookie `Path`
  keeps the cookie off every other request.
- **Alternatives considered**: CSRF tokens (unneeded with `SameSite=Strict` plus the Origin
  check on two endpoints). Parsing the `Cookie` header by hand (fragile; `cookie-parser` is the
  standard Express middleware).
