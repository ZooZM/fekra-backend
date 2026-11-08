---

description: "Task list for 001-admin-clients-dashboard"
---

# Tasks: Admin Clients Dashboard

**Input**: Design documents from `specs/001-admin-clients-dashboard/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED by Constitution Principle V (non-negotiable). In every story phase, test
tasks come first and MUST fail before the implementation tasks start. Backend unit specs mock
dependencies, as in the existing `*.spec.ts` files, using `src/test-mocks/` for `@nestjs/config`,
`@nestjs/jwt` and `@nestjs/passport`. Backend e2e tests use supertest against real PostgreSQL and
Redis.

**Organization**: Tasks are grouped by user story (US1–US6 from spec.md) so each story can be
built, tested and demonstrated on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1–US6)

## Path Conventions

- **This repository (`fekra-backend`)**: paths are relative to its root (`src/…`, `prisma/…`,
  `test/…`).
- **Dashboard (`fekra-dashboard`)**: a NEW repository, created as a sibling folder
  (`E:\zeyad\fekra-dashboard`). Its paths are written `fekra-dashboard/…`.
- **Decisions**: a reference like "R2" points to research.md. Shapes and error codes come from
  [contracts/admin-api.openapi.yaml](./contracts/admin-api.openapi.yaml) and
  [contracts/dashboard-ui.md](./contracts/dashboard-ui.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and scaffolding in both repositories.

- [X] T001 Add runtime dependencies `@nestjs/swagger` and `cookie-parser`, and the dev dependency `@types/cookie-parser`. In package.json, add these scripts: `"lint:check": "eslint \"{src,apps,libs,test}/**/*.ts\""` (no `--fix`, for CI), `"openapi:export": "ts-node -r tsconfig-paths/register scripts/openapi-export.ts"` and `"seed:e2e": "ts-node -r tsconfig-paths/register scripts/seed-e2e.ts"`
- [X] T002 [P] Create .env.example listing every variable the app reads. Find them with `grep -rhoE "(process\.env\.[A-Z_0-9]+|get(OrThrow)?(<[^>]+>)?\('[A-Z_0-9]+')" src` and include the DISPATCH_* and RATE_LIMIT_* keys from .env.development.local. Add the new keys with their defaults: SESSION_IDLE_MINUTES=30, SESSION_MAX_HOURS=12, SESSION_COOKIE_PATH=/auth, APP_ORIGIN=http://localhost:5173, CORS_ORIGINS=, LOGIN_MAX_FAILURES=5, LOGIN_BLOCK_MINUTES=15 and OPENAPI_ENABLED=true. Use placeholders (`change-me`) for secrets and add a one-line comment per key
- [X] T003 [P] Add `moduleNameMapper` entries to test/jest-e2e.json (`"^@app/(.*)$": "<rootDir>/src/$1"`, `"^@common/(.*)$": "<rootDir>/src/common/$1"`) so e2e specs can import `AppModule`, then confirm `npm run test:e2e` still runs test/app.e2e-spec.ts
- [X] T004 Create the `fekra-dashboard` repository as a sibling folder: `npm create vite@latest fekra-dashboard -- --template react-ts`, `git init`, add a .gitignore, and set package.json scripts `dev`, `build`, `preview`, `lint` (`eslint .`), `typecheck` (`tsc -b --noEmit`), `test` (`vitest run`), `e2e` (`playwright test`) and `api:types` (`openapi-typescript ../fekra-backend/openapi/openapi.json -o src/api/schema.d.ts`)
- [X] T005 Install the dashboard dependencies in fekra-dashboard/package.json, pinning exact versions. Runtime: `react-router`, `@tanstack/react-query`, `@mantine/core`, `@mantine/hooks`, `@mantine/notifications`, `react-hook-form`, `@hookform/resolvers`, `zod@4`, `i18next`, `react-i18next`, `i18next-browser-languagedetector`, `openapi-fetch`. Dev: `openapi-typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`, `vitest-axe`, `@playwright/test`, `@axe-core/playwright`, `eslint-plugin-jsx-a11y`, `eslint-plugin-i18next`, `postcss`, `postcss-preset-mantine`, `prettier`
- [X] T006 [P] Configure linting in fekra-dashboard/eslint.config.js (typescript-eslint, `jsx-a11y` recommended, `i18next/no-literal-string` set to error for JSX text) and formatting in fekra-dashboard/.prettierrc (`singleQuote: true`, `trailingComma: "all"`)
- [X] T007 [P] Configure Vitest in fekra-dashboard/vitest.config.ts (environment jsdom, setupFiles `src/test/setup.ts`). In fekra-dashboard/src/test/setup.ts, register `@testing-library/jest-dom`, the `vitest-axe` matchers, and an MSW `setupServer()` started and stopped in `beforeAll`/`afterAll`, with `onUnhandledRequest: 'error'`
- [X] T008 [P] Configure Playwright in fekra-dashboard/playwright.config.ts (baseURL `http://localhost:5173`, `webServer: npm run dev`, projects `en` and `ar` that set the `fekra.lang` value in localStorage through `storageState`, and `globalSetup: e2e/global-setup.ts`). Create fekra-dashboard/e2e/fixtures.ts exporting `expectNoA11yViolations(page)`, which runs `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa'])` and expects 0 violations
- [X] T009 [P] Configure the dev proxy in fekra-dashboard/vite.config.ts: `server.proxy['/api'] = { target: 'http://localhost:3000', rewrite: p => p.replace(/^\/api/, '') }`. Create fekra-dashboard/.env.example with `VITE_API_BASE_URL=/api`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, shared infrastructure, admin-only access, sessions and sign-in
throttling, the API contract export, and the dashboard shell. Every user story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Backend: data and infrastructure

- [X] T010 Update prisma/schema.prisma as described in data-model.md: add `version Int @default(1)` to `Client`; add `lastUsedAt DateTime @default(now()) @map("last_used_at")` and `revokedAt DateTime? @map("revoked_at")` to `RefreshToken`; add `enum ClientActivityAction { CREATED UPDATED DELETED ACCESS_TOKEN_REPLACED }`; add `model ClientActivity` (id, clientId, clientName VarChar(255), actorId, actorName VarChar(255), actorEmail VarChar(255), action, changedFields String[] @default([]), createdAt) with snake_case `@map`s, `@@map("client_activities")`, `@@index([clientId, createdAt])`, `@@index([actorId])` and `@@index([createdAt])`, and **no relations**. Run `npx prisma migrate dev --name admin_clients_dashboard` and check that prisma/migrations/*_admin_clients_dashboard/migration.sql only adds columns, tables and enums
- [X] T011 [P] Move the main Redis connection into a global module. Create src/redis/redis.constants.ts (`export const REDIS = 'REDIS'`) and src/redis/redis.module.ts (`@Global()`, a provider `REDIS` built from `ConfigService` values REDIS_HOST, REDIS_PORT, REDIS_PASSWORD and REDIS_DB with the current defaults, `quit()` in `onModuleDestroy`, exported). In src/inbox/inbox.constants.ts, change `REDIS` to `export { REDIS } from '@app/redis/redis.constants'` so inbox services don't change. Reduce src/inbox/redis.provider.ts to the `REDIS_SUB` provider only, reading its settings through `ConfigService`. Import `RedisModule` in src/app.module.ts
- [X] T012 Create the health endpoint: src/health/health.module.ts and src/health/health.controller.ts with an unauthenticated `GET /health`. It runs ``prisma.$queryRaw`SELECT 1` `` and `redis.ping()`, returns 200 `{ status: 'ok' }` when both succeed, and otherwise throws `ServiceUnavailableException({ message: 'Service unavailable', errorCode: 'DEPENDENCY_UNAVAILABLE' })` without exposing internals. Add the spec src/health/health.controller.spec.ts with mocked Prisma and Redis (ok, DB down, Redis down) and register the module in src/app.module.ts
- [X] T013 Create src/app.setup.ts exporting `configureApp(app: INestApplication)`. It applies `cookie-parser`, enables CORS only when `CORS_ORIGINS` is non-empty (`origin: list, credentials: true`), and calls `app.enableShutdownHooks()`. Refactor src/main.ts to call it before `listen`. When `NODE_ENV !== 'production'` and `OPENAPI_ENABLED !== 'false'`, serve `cleanupOpenApiDoc(SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Fekra API').addBearerAuth().build()))` at `/docs-json` (use `SwaggerModule.setup('docs', …)`). Add src/app.setup.spec.ts with a mocked app (CORS enabled only for a non-empty list, `enableShutdownHooks` called, `cookie-parser` applied)
- [X] T014 Create test/utils/e2e-app.ts with these helpers:
  - `createE2eApp()`: compiles `AppModule` with `REDIS_DB=15` (a dedicated Redis database; the inbox's `ExpiryService` sets `notify-keyspace-events` at startup), then applies `configureApp` and the same global pipes as src/main.ts.
  - `resetDb(prisma)`: truncates `client_activities, offers, services, business_info, refresh_tokens, users, clients` with CASCADE.
  - `flushLoginFailures(redis)`: deletes the `auth:login-fail:*` keys.
  - `createUser(prisma, { email, roles })`: inserts a user with a bcrypt hash made by `hash()` from src/auth/consts/auth.contants.ts.
  - `login(app, email, password)`: returns `{ token, cookie }`.
- [X] T015 [P] Create scripts/seed-e2e.ts, an idempotent seed that the dashboard e2e suite runs. It upserts `admin@e2e.test` (ADMIN) and `client@e2e.test` (CLIENT), both with password `e2e-password-123`, and creates `SEED_CLIENTS` clients (default 45). Each seeded client has a varied name or category in Arabic or English, an encrypted dummy token (via `TokenCryptoService`), and unique `fbPageId` values

### Backend: admin-only access (FR-001, FR-002, research R9)

- [X] T016 Write test/admin-access.e2e-spec.ts, which must FAIL before T017–T019:
  - With no token, every `/clients` operation and every `/users/admin*` route returns 401.
  - With a CLIENT-role token, they all return 403 with `errorCode: FORBIDDEN`. This includes `POST /users/admin` with `roles: ['ADMIN']`, which must not create a user.
  - With an ADMIN token, `GET /clients` returns 200.
  - `GET /users/me` still works for CLIENT users.
  - Role removal: after an admin's roles are changed to `['CLIENT']` in the database, the same still-valid token gets 403 on `/clients`.
- [X] T017 [P] In src/clients/clients.controller.ts, apply `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('ADMIN')` at class level. Remove the method-level guards from `setAccessToken` and the unused `BaseQueryDto` import. In src/clients/clients.controller.spec.ts, assert that the class metadata contains `ROLES_KEY = ['ADMIN']` and both guards
- [X] T018 [P] In src/users/users.controller.ts, add `@UseGuards(RolesGuard)` and `@Roles('ADMIN')` to every `admin*` handler (`/users/me` stays available to any signed-in user). Change `@Param('id') { id }: IdParamDto` to `@Param() { id }: IdParamDto` on `admin/:id` (GET, PUT, DELETE). Extend src/users/users.controller.spec.ts to assert the role metadata on the admin handlers and not on `getMe`/`updateMe`
- [X] T019 [P] In src/auth/decorators/current-user.decorator.ts, extend the `AuthUser` interface with `name: string` and `email: string` (the request user is already the full `SafeUser`). Add `export type ClientActor = Pick<AuthUser, 'id' | 'name' | 'email'>` to src/clients/types/client.types.ts

### Backend: sessions and sign-in throttling (FR-003, FR-027, research R2, R4, R16)

- [X] T020 Write test/auth-session.e2e-spec.ts, which must FAIL before T021–T029:
  - Login returns 201 with `token` and a `Set-Cookie` header for `fekra_session` with `HttpOnly`, `SameSite=Strict` and `Path=/auth`.
  - `POST /auth/refresh` with the cookie and `Origin: APP_ORIGIN` returns 200 with a new token.
  - Refresh without an allowed Origin returns 403.
  - Idle expiry (set `last_used_at` 31 minutes back with Prisma) and absolute expiry (set `expires_at` in the past) both return 401 with `errorCode: SESSION_EXPIRED` and clear the cookie.
  - `POST /auth/logout` returns 204. After it, the old access token gets 401 on `GET /users/me`, and refresh returns 401.
  - Throttling: after 5 wrong passwords, the correct password returns 401 with a body identical to a wrong password. An unknown email gets the same body. After `flushLoginFailures`, the correct password returns 201 (SC-010).
- [X] T021 [P] Create src/auth/consts/session.constants.ts exporting `SESSION_COOKIE = 'fekra_session'`, `LOGIN_FAIL_KEY_PREFIX = 'auth:login-fail:'` and the defaults `SESSION_IDLE_MINUTES = 30`, `SESSION_MAX_HOURS = 12`, `LOGIN_MAX_FAILURES = 5` and `LOGIN_BLOCK_MINUTES = 15`
- [X] T022 [P] Create src/auth/repositories/ISessionsRepository.repository.ts with the interface and the `SESSIONS_REPOSITORY` token, and src/auth/repositories/sessions.repository.impl.ts implementing it with `prisma.refreshToken`. Methods: `create({ userId, tokenHash, expiresAt })` → `{ id }`; `findByTokenHash(hash)` → `{ id, userId, expiresAt, lastUsedAt, revokedAt } | null`; `touch(id, at)`; `revoke(id, at)`; `findById(id)` → `{ expiresAt, revokedAt } | null`
- [X] T023 Create src/auth/session.service.ts with these methods:
  - `start(userId)`: makes a 32-byte `randomBytes` value encoded as base64url, stores its SHA-256 hash with `expiresAt = now + SESSION_MAX_HOURS`, and returns `{ sessionId, cookieValue, expiresAt }`.
  - `refresh(cookieValue)`: throws `UnauthorizedException({ message: 'Session expired', errorCode: 'SESSION_EXPIRED' })` when the session is missing, revoked, at or past `expiresAt`, or idle for `SESSION_IDLE_MINUTES` or more. Otherwise it calls `touch` and returns `{ sessionId, userId, expiresAt }`.
  - `revoke(cookieValue?)`: idempotent.
  - `isActive(sessionId)`: true when the session exists, is not revoked and is before `expiresAt`.

  Read the limits with `ConfigService.get` and fall back to the constants. Inject a clock (`() => Date`) so tests can control time. Write src/auth/session.service.spec.ts covering every branch.
- [X] T024 [P] Create src/auth/login-throttle.service.ts, injecting `REDIS`, with these methods:
  - `isBlocked(email)`: count ≥ `LOGIN_MAX_FAILURES`.
  - `recordFailure(email)`: `INCR`; on the first failure, `EXPIRE` with `LOGIN_BLOCK_MINUTES*60`; when the count reaches the maximum, `EXPIRE` again to restart the block window.
  - `reset(email)`: `DEL`.

  The key is `LOGIN_FAIL_KEY_PREFIX + sha256(email.trim().toLowerCase())`. Write src/auth/login-throttle.service.spec.ts with a mocked Redis.
- [X] T025 [P] Create src/auth/guards/origin.guard.ts. It reads `APP_ORIGIN` and `CORS_ORIGINS` through `ConfigService` and allows a request when its `Origin` header equals `APP_ORIGIN` or appears in `CORS_ORIGINS`, and otherwise throws `ForbiddenException`. Write src/auth/guards/origin.guard.spec.ts
- [X] T026 Update src/auth/auth.service.ts:
  - `generateJwt` accepts an optional `sid`.
  - `validateUser(email, password)` first checks `throttle.isBlocked`. When blocked, it still runs `compare(password, getDummyHash())` so timing doesn't reveal the block, then throws the same `UnauthorizedException('Invalid credentials')`.
  - On a failed check it calls `recordFailure`; on success it calls `reset`.
  - A new `login(user)` calls `sessions.start(user.id)` and returns `{ user, token (with sid), session: { cookieValue, expiresAt } }`.

  In src/auth/strategies/local.strategy.ts, normalize the email (trim, lowercase) before calling `validateUser`. Update src/auth/auth.service.spec.ts.
- [X] T027 Update src/auth/strategies/jwt.strategy.ts: add an optional `sid` to the payload type, and when `sid` is present and `sessionService.isActive(sid)` is false, throw `UnauthorizedException`. Create src/auth/strategies/jwt.strategy.spec.ts covering a token without sid, an active sid, a revoked sid, and the existing password-changed rule
- [X] T028 Update src/auth/auth.controller.ts:
  - `login` uses `@Res({ passthrough: true })` to set the `fekra_session` cookie (`httpOnly`, `secure` when `NODE_ENV === 'production'`, `sameSite: 'strict'`, `path` from `ConfigService` `SESSION_COOKIE_PATH`, `maxAge = expiresAt - now`) and returns `{ user, token }`.
  - New `POST /auth/refresh` (`@UseGuards(OriginGuard)`, `@HttpCode(200)`) reads the cookie, refreshes the session, loads the user with `UsersService.findById`, and returns `{ user, token }`. On `SESSION_EXPIRED` it clears the cookie, then rethrows.
  - New `POST /auth/logout` (`@UseGuards(OriginGuard)`, `@HttpCode(204)`) revokes the session and clears the cookie.

  Register `SessionService`, `LoginThrottleService`, `OriginGuard` and `{ provide: SESSIONS_REPOSITORY, useClass: SessionsRepository }` in src/auth/auth.module.ts, and update src/auth/auth.controller.spec.ts.
- [X] T029 [P] Update the Postman auth requests in postman/collections/Social Inbox Automation API/Auth/. Login.request.yaml documents the session cookie. Add Refresh Session.request.yaml and Logout.request.yaml (No Auth, `Origin: {{appOrigin}}` header). Add the `appOrigin` variable to postman/collections/Social Inbox Automation API/.resources/definition.yaml and note there that every Clients request needs an ADMIN user

### Backend: contract export (research R10)

- [X] T030 Create scripts/openapi-export.ts. It runs `NestFactory.create(AppModule, { logger: false })`, applies `configureApp`, builds the document exactly as in src/main.ts, writes it to openapi/openapi.json (pretty-printed, stable key order) and closes the app. Run `npm run openapi:export` and commit openapi/openapi.json

### Dashboard: app shell, sessions and shared parts

- [X] T031 [P] Create the translations: fekra-dashboard/src/i18n/index.ts (i18next + react-i18next + `LanguageDetector` with `supportedLngs: ['en','ar']`, `fallbackLng: 'en'`, detection order `['localStorage','navigator']`, `lookupLocalStorage: 'fekra.lang'`, `caches: ['localStorage']`). On `languageChanged`, set `document.documentElement.lang` and `dir` (`ar` → `rtl`). Add fekra-dashboard/src/i18n/en.json and fekra-dashboard/src/i18n/ar.json with common keys (app name, sign in, sign out, loading, empty, retry, not found, no access), plus one key per `errorCode` listed in contracts/dashboard-ui.md
- [X] T032 Run `npm run api:types` to generate fekra-dashboard/src/api/schema.d.ts from ../fekra-backend/openapi/openapi.json. Create fekra-dashboard/src/api/errors.ts: an `ApiError` class (`status`, `errorCode`, `details`), `toApiError(response, body)`, `fieldErrorsFrom(details)` (reads `fieldErrors` for 422 and `details.field` for `DUPLICATE_KEY_ERROR`) and `errorMessageKey(errorCode)` (maps to i18n keys and never shows the server's `message`)
- [X] T033 Create fekra-dashboard/src/auth/session-store.ts, an in-memory store with `getToken`, `setSession({ token, user })`, `clear()`, `subscribe(fn)` and `lastRefreshAt`. It MUST NOT touch localStorage, sessionStorage or document.cookie. Then create fekra-dashboard/src/api/client.ts with `openapi-fetch`'s `createClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api', credentials: 'same-origin' })` and middleware that:
  - adds `Authorization: Bearer <token>`;
  - on a 401 from any path except `/auth/*`, runs **one shared** `POST /auth/refresh`, then retries the original request once;
  - turns non-2xx responses into `ApiError`.
- [X] T034 [P] Create typed MSW handlers in fekra-dashboard/src/test/handlers.ts, using `schema.d.ts` types and an in-memory client store. They cover login, refresh, logout, list (page, sort and search), get, create, patch (version check → 409 `CLIENT_VERSION_CONFLICT`), delete and access-token, with overridable failure modes. Also create fekra-dashboard/src/test/render.tsx, `renderWithProviders(ui, { route, lang })`, which wraps the UI in Mantine, Query, i18n, the router and the session providers
- [X] T035 Create fekra-dashboard/src/auth/session-context.tsx, a `SessionProvider` with these functions:
  - **On mount**: `bootstrap()` calls `POST /auth/refresh`; 200 → store the session, 401 → anonymous.
  - `signIn(email, password)`.
  - `signOut(reason?)`: calls `POST /auth/logout`, clears the store, and posts `'signed-out'` on `BroadcastChannel('fekra-auth')`, which other tabs listen to.
  - `useSession()`.

  Write fekra-dashboard/src/auth/session-context.test.tsx using MSW.
- [X] T036 Create fekra-dashboard/src/auth/use-idle-timer.ts. It treats `pointerdown`, `keydown`, `wheel` and `touchstart` as activity. On activity, when `lastRefreshAt` is more than 5 minutes ago, it refreshes in the background. After 30 minutes without activity it calls `signOut('idle')` and navigates to `/login?reason=idle` (research R3). Write fekra-dashboard/src/auth/use-idle-timer.test.ts with fake timers
- [X] T037 [P] Create the shared components, each with a `*.test.tsx` that includes an `axe` check:
  - fekra-dashboard/src/components/language-switch.tsx: an accessible select for English/العربية that calls `i18n.changeLanguage`.
  - fekra-dashboard/src/components/page-state.tsx: loading, empty and error states with a retry button.
  - fekra-dashboard/src/components/confirm-dialog.tsx: a Mantine Modal that traps focus and returns it to the control that opened it.
  - fekra-dashboard/src/components/app-shell.tsx: a header with the app name, the language switch, the signed-in user and a sign-out button.
- [X] T038 Create fekra-dashboard/src/app/providers.tsx (`MantineProvider` + `DirectionProvider` following `i18n.dir()`, `Notifications` with a live region, `QueryClientProvider` with `retry: 1` for queries and none for mutations, and `SessionProvider`) and fekra-dashboard/src/main.tsx. Create fekra-dashboard/src/app/router.tsx with the routes from contracts/dashboard-ui.md (pages loaded lazily; client pages are placeholders until their story), plus these route-guard pages:
  - fekra-dashboard/src/auth/require-admin.tsx: no session → `/login?next=<path>`; signed in but not ADMIN → `/no-access`.
  - fekra-dashboard/src/auth/no-access-page.tsx.
  - fekra-dashboard/src/app/not-found-page.tsx.
- [X] T039 Create fekra-dashboard/src/auth/login-page.tsx. It is a React Hook Form + Zod form (email, password with a reveal toggle) that shows the one generic "Email or password is incorrect" message on 401 (FR-027). It shows a notice for `?reason=idle` or `?reason=expired`, includes the language switch, and goes to `next` after sign-in. Write fekra-dashboard/src/auth/login-page.test.tsx (success, 401, notices, axe)
- [X] T040 [P] Create fekra-dashboard/e2e/global-setup.ts. It runs `npm --prefix ../fekra-backend run seed:e2e`, or, when `E2E_SEED_CMD` is set, that command (used in CI). Add `loginAs(page, 'admin' | 'client')` to fekra-dashboard/e2e/fixtures.ts

**Checkpoint**: Run `npm test`, `npm run test:e2e` (test/admin-access and test/auth-session) and the dashboard's `npm test`; all are green. An admin can sign in, reload without being signed out, sign out, and reach the shell in both languages.

---

## Phase 3: User Story 1 - Find and review clients (Priority: P1) 🎯 MVP

**Goal**: Admins list, page, sort and search clients and open a detail view. Non-admins are
refused.

**Independent Test**: With 45 seeded clients, an admin sees 20 per page and a total of 45; sorting
and search work; the detail view shows "Access token: on file". A CLIENT user lands on
`/no-access` and gets 403 from the API.

### Tests for User Story 1 (required) ⚠️

- [X] T041 [P] [US1] Create test/clients-admin.e2e-spec.ts with a `describe('list')` block:
  - Paging and the `meta` totals.
  - `orderBy` name, businessCategory and createdAt in both directions, with `id` as the tie-break.
  - `search` matches name OR businessCategory, case-insensitively, and `meta.total` counts only matches.
  - A `search` of `%` or `_` matches only names that contain that literal character.
  - An empty `search` and a 101-character `search` both return 422.
  - Responses include `version` and never `accessToken`.
- [X] T042 [P] [US1] Write fekra-dashboard/src/features/clients/list-page.test.tsx:
  - Rows show name, category, Facebook/Instagram connection state and creation date, plus the total.
  - Changing page, page size, sort or search updates the URL query string, and invalid query values fall back to the defaults.
  - Both the empty state and the "no match" state (with a "Clear search" action) render.
  - A 255-character name is shortened but keeps a `title` with the full name.
  - axe passes.
- [X] T043 [P] [US1] Write fekra-dashboard/src/features/clients/detail-page.test.tsx:
  - Every profile field and setting renders.
  - "Access token: on file" is shown, and no token value appears in the DOM.
  - A broken logo falls back to a placeholder.
  - A 404 shows "This client no longer exists" with a link back to the list.
  - User-entered values use `dir="auto"`.
  - axe passes in en and ar.
- [X] T044 [P] [US1] Write fekra-dashboard/e2e/us1-find-clients.spec.ts:
  - An admin pages, sorts and searches (searching finds a client in under 10 s, SC-002) and opens a detail view.
  - A deep link without a session goes to `/login` and then returns to the original page.
  - A CLIENT user is sent to `/no-access`.
  - Switching to Arabic flips the layout to RTL and the choice survives a reload.
  - `expectNoA11yViolations` passes on `/login`, `/clients` and `/clients/:id` in both projects.

### Implementation for User Story 1

- [X] T045 [US1] In src/clients/schemas/query-client.schema.ts, extend `QueryClientSchema` with `.extend({ search: z.string().trim().min(1).max(100).optional() })`, keeping it a strict object
- [X] T046 [US1] In src/clients/repositories/clients.repository.impl.ts `findAll`, build `where` from `search` as `OR: [{ name: { contains, mode: 'insensitive' } }, { businessCategory: { contains, mode: 'insensitive' } }]` and use the same `where` in both `findMany` and `count`. If the literal-`%`/`_` case in T041 fails, add `escapeLike()` in src/common/helpers/escape-like.ts, escaping `\`, `%` and `_`, with src/common/helpers/escape-like.spec.ts. Remove the unused `BaseQueryDto` import
- [X] T047 [US1] Re-run `npm run openapi:export` (openapi/openapi.json), then `npm run api:types` in fekra-dashboard (src/api/schema.d.ts)
- [X] T048 [P] [US1] Create fekra-dashboard/src/features/clients/queries.ts with query keys and the hooks `useClientsList(params)` (keeps the previous page's data while loading) and `useClient(id)`, built on `api/client.ts`
- [X] T049 [US1] Create fekra-dashboard/src/features/clients/list-page.tsx:
  - List state is read from and written to the URL with Zod and the defaults from contracts/dashboard-ui.md.
  - A Mantine `Table` has sortable headers with `aria-sort`.
  - The search input applies after a 300 ms pause.
  - Pagination plus a page-size select (20/50/100) and the total count.
  - Connection badges, `dir="auto"` cells, and `PageState` for loading, empty, no-match and error.
  - Register the page at `/clients` in fekra-dashboard/src/app/router.tsx.
- [X] T050 [US1] Create fekra-dashboard/src/features/clients/detail-page.tsx:
  - Profile, logo (placeholder on error), Facebook/Instagram IDs or "Not connected", and "Access token: on file".
  - Read-only summaries of the AI, private-message and comment settings.
  - Created and updated dates formatted for the current language.
  - `PageState` for 404 and errors.
  - Register the page at `/clients/:id`.
- [X] T051 [US1] Add the US1 strings (list headers, sort labels, search, pagination, empty and no-match states, detail labels, "on file") to fekra-dashboard/src/i18n/en.json and fekra-dashboard/src/i18n/ar.json
- [X] T052 [P] [US1] Add a `search` query parameter (disabled by default) and a note that ADMIN is required to postman/collections/Social Inbox Automation API/Clients/List Clients.request.yaml

**Checkpoint**: US1 is fully usable and testable. This is the MVP: a read-only admin dashboard.

---

## Phase 4: User Story 2 - Onboard a new client (Priority: P2)

**Goal**: Admins create clients with profile fields and the access token. Duplicate accounts and
invalid input are explained on the fields, and each creation is recorded.

**Independent Test**: Creating a valid client opens its detail view, which shows "Access token:
on file". A duplicate Facebook Page ID shows a field error and creates nothing. A `CREATED`
activity row exists for the new client.

### Tests for User Story 2 (required) ⚠️

- [X] T053 [P] [US2] Extend src/clients/clients.service.spec.ts. `create(input, actor)` throws `ConflictException` with `errorCode: 'DUPLICATE_KEY_ERROR'` and `details.field` set to `'fbPageId'` or `'instaAccountId'` when `repo.findMetaAccountConflict` returns a match, and otherwise calls `repo.create(data, actor)` with the token encrypted
- [X] T054 [P] [US2] Add a `describe('create')` block to test/clients-admin.e2e-spec.ts:
  - Success: 201, `version: 1`, and exactly one `client_activities` row with action `CREATED` and the admin's id, name and email.
  - A duplicate `fbPageId` returns 409 with `details.field = 'fbPageId'` and no row is created.
  - A non-digit `fbPageId` returns 422.
  - A 256-character `brandLogo` returns 422 instead of a database error.
  - A missing `accessToken` returns 422.
- [X] T055 [P] [US2] Write fekra-dashboard/src/features/clients/create-page.test.tsx:
  - Required-field errors appear.
  - A 422 `fieldErrors` response maps onto the matching fields.
  - A 409 `DUPLICATE_KEY_ERROR` shows "Already connected to another client" on the right field.
  - Success navigates to the detail view and shows a notification.
  - The token input is hidden by default.
  - Leaving with unsaved input asks for confirmation (FR-015).
  - axe passes.
- [X] T056 [P] [US2] Write fekra-dashboard/e2e/us2-create-client.spec.ts covering create success, duplicate page ID, invalid ID, and axe on `/clients/new` (en and ar)

### Implementation for User Story 2

- [X] T057 [US2] In src/clients/schemas/client.schema.ts, set `brandLogo: httpUrl.max(255).nullish()` so the limit matches `brand_logo VARCHAR(255)` (research R8)
- [X] T058 [US2] In src/clients/repositories/IClientsRepository.repository.ts, change the method to `create(data: CreateClientData, actor: ClientActor): Promise<ClientRecord>` and add `findMetaAccountConflict(ids: { fbPageId?: string | null; instaAccountId?: string | null }, excludeId?: string): Promise<'fbPageId' | 'instaAccountId' | null>`
- [X] T059 [US2] Implement both in src/clients/repositories/clients.repository.impl.ts. `create` runs in `prisma.$transaction(async (tx) => …)`: `tx.client.create`, then `tx.clientActivity.create({ action: 'CREATED', clientId, clientName, actorId, actorName, actorEmail })` through a private `recordActivity(tx, entry)` helper. `findMetaAccountConflict` checks each non-null id, skipping `excludeId`
- [X] T060 [US2] Update `create(input, actor)` in src/clients/clients.service.ts to check `findMetaAccountConflict` first. On a conflict it throws `new ConflictException({ message: 'Account already connected to another client', errorCode: 'DUPLICATE_KEY_ERROR', details: { field } })`; otherwise it encrypts the token (existing logic) and calls `repo.create(data, actor)`
- [X] T061 [US2] In src/clients/clients.controller.ts, have `create` take `@CurrentUser() user: AuthUser` and pass `{ id, name, email }` as the actor
- [X] T062 [P] [US2] Create fekra-dashboard/src/features/clients/client-form/schema.ts with Zod rules mirroring the contract (`text(255)`, `metaId` `/^\d{5,30}$/`, an http(s) URL of at most 255 characters, empty strings → `null`), with error messages as i18n keys. Create fekra-dashboard/src/features/clients/client-form/profile-section.tsx with the name, category, Facebook Page ID, Instagram account ID and logo URL inputs, labelled, using `aria-describedby` for errors and `dir="auto"`
- [X] T063 [P] [US2] Create fekra-dashboard/src/features/clients/use-unsaved-changes.ts, using React Router `useBlocker` with `ConfirmDialog` plus a `beforeunload` listener while the form is dirty (FR-015)
- [X] T064 [US2] Create fekra-dashboard/src/features/clients/create-page.tsx: the profile section, an access token `PasswordInput` that is hidden by default and can be revealed (FR-018), a `useCreateClient` mutation in queries.ts, and server errors mapped with `fieldErrorsFrom`. On success it invalidates the list and navigates to `/clients/:id`. Add the "New client" button to list-page.tsx and the `/clients/new` route
- [X] T065 [US2] Add the US2 strings (form labels, field errors, duplicate account, created notification, discard-changes dialog) to fekra-dashboard/src/i18n/en.json and fekra-dashboard/src/i18n/ar.json
- [X] T066 [P] [US2] Update the example body (no real token) and the 409 example in postman/collections/Social Inbox Automation API/Clients/Create Client.request.yaml, then re-run `npm run openapi:export` and commit openapi/openapi.json

**Checkpoint**: US1 and US2 both work on their own.

---

## Phase 5: User Story 3 - Update a client's details (Priority: P3)

**Goal**: Admins edit profile fields. Saves based on an outdated version are refused with "who
changed it and when", account changes ask for confirmation first, and each edit is recorded with
its changed field names.

**Independent Test**: An edit saves and increments `version`. A second tab's save gets 409 and
keeps its input. Changing the Facebook Page ID asks for confirmation. An `UPDATED` activity row
lists the changed fields.

### Tests for User Story 3 (required) ⚠️

- [X] T067 [P] [US3] Write src/clients/helpers/changed-fields.spec.ts: `changedFields(current, input)` returns the top-level keys of `input` whose values differ by deep equality, so JSON columns and arrays are compared by value. Keys absent from `input` are ignored, and `undefined` values are ignored
- [X] T068 [P] [US3] Extend src/clients/clients.service.spec.ts for `update(id, input, actor)`:
  - The repository returning `null` → `NotFoundException`.
  - `{ status: 'conflict' }` → `ConflictException` with `errorCode: 'CLIENT_VERSION_CONFLICT'` and `details { currentVersion, updatedAt, updatedBy }`.
  - `unchanged` and `updated` → the record is returned.
  - The duplicate-account check passes `excludeId = id`.
- [X] T069 [P] [US3] Add a `describe('update')` block to test/clients-admin.e2e-spec.ts:
  - The correct version → 200, `version` + 1, and one `UPDATED` row whose `changed_fields` is exactly the changed keys.
  - A stale version → 409 `CLIENT_VERSION_CONFLICT` with the latest actor's name.
  - A missing `version` → 422.
  - `accessToken` in the body → 422.
  - Identical values → 200, version unchanged, no new row.
  - A duplicate `instaAccountId` from another client → 409 with `details.field`.
  - The client's own ids → OK.
- [X] T070 [P] [US3] Write fekra-dashboard/src/features/clients/edit-page.test.tsx:
  - The form is prefilled.
  - The PATCH sends only changed fields plus `version`.
  - Removing or changing `fbPageId`/`instaAccountId` shows the account-change warning first (FR-014).
  - A 409 shows `ConflictBanner` with the name and time, keeps the typed values, and "Load latest version" reloads the form after confirmation.
  - The unsaved-changes prompt works.
  - axe passes.
- [X] T071 [P] [US3] Write fekra-dashboard/e2e/us3-edit-client.spec.ts: two browser contexts edit the same client; the second save is refused and keeps its input (SC-012). Also cover the account-change warning flow and axe on `/clients/:id/edit` (en and ar)

### Implementation for User Story 3

- [X] T072 [P] [US3] Create src/clients/helpers/changed-fields.ts with `changedFields()`, using `node:util` `isDeepStrictEqual`
- [X] T073 [US3] In src/clients/schemas/client.schema.ts, set `UpdateClientSchema = CreateClientSchema.omit({ accessToken: true }).partial().extend({ version: z.number().int().min(1) })`, keeping it strict. Update `UpdateClientInput` and src/clients/interfaces/update-client-data.interface.ts so the data the repository stores excludes `version` and `accessToken`
- [X] T074 [US3] Add the types `ClientUpdateResult = { status: 'updated' | 'unchanged'; record: ClientRecord } | { status: 'conflict'; currentVersion: number; updatedAt: Date; updatedBy: { id: string; name: string } | null }` and `VersionConflictDetails` to src/clients/types/client.types.ts
- [X] T075 [US3] Implement the new signature `update(id, data, expectedVersion, actor): Promise<ClientUpdateResult | null>` in src/clients/repositories/IClientsRepository.repository.ts and src/clients/repositories/clients.repository.impl.ts. Inside `prisma.$transaction`:
  1. Load the row; return `null` if it is missing.
  2. If `version !== expectedVersion`, return a conflict whose `updatedBy` comes from the latest `clientActivity` for that `clientId`.
  3. Compute `changedFields`; if there are none, return `unchanged`.
  4. Run `tx.client.update({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } })`, catching P2025 and returning a conflict.
  5. Record an `UPDATED` activity entry with `changedFields`.
- [X] T076 [US3] Update `update(id, input, actor)` in src/clients/clients.service.ts: run the duplicate check with `excludeId`, split `version` from the data, call the repository, and map the result: `null` → `NotFoundException('Client not found')`, conflict → `ConflictException({ message: 'Client was changed by someone else', errorCode: 'CLIENT_VERSION_CONFLICT', details })`, otherwise return the record. Remove the old `accessToken` branch. In src/clients/clients.controller.ts, pass the actor to `update`
- [X] T077 [US3] Re-run `npm run openapi:export` (openapi/openapi.json) and `npm run api:types` in fekra-dashboard (src/api/schema.d.ts)
- [X] T078 [P] [US3] Create fekra-dashboard/src/features/clients/conflict-banner.tsx: an `Alert` with `role="alert"` reading "{name} changed this client at {time}" (time formatted for the current language) with a "Load latest version" button. When `updatedBy` is null, read "This client was changed by someone else at {time}"
- [X] T079 [US3] Create fekra-dashboard/src/features/clients/edit-page.tsx:
  - Prefill from `useClient`; keep the `version` the form started from.
  - On submit, send the changed fields plus `version`.
  - If `fbPageId` or `instaAccountId` is cleared or changed, show the account-change `ConfirmDialog` before saving (FR-014).
  - On 409 `CLIENT_VERSION_CONFLICT`, show `ConflictBanner` and keep the form state.
  - Use `use-unsaved-changes`.
  - Add the `useUpdateClient` mutation to queries.ts, register `/clients/:id/edit`, and add the "Edit" button to detail-page.tsx.
- [X] T080 [US3] Add the US3 strings (edit title, account-change warning, conflict banner, saved notification) to fekra-dashboard/src/i18n/en.json and fekra-dashboard/src/i18n/ar.json
- [X] T081 [P] [US3] Add `version` to the body and a stale-version 409 example in postman/collections/Social Inbox Automation API/Clients/Update Client.request.yaml, and note that `accessToken` is no longer accepted there

**Checkpoint**: US1–US3 each work on their own.

---

## Phase 6: User Story 4 - Replace a client's access token (Priority: P4)

**Goal**: A dedicated, confirmed, write-only token replacement that is recorded and does not
change the client's version.

**Independent Test**: Replacing the token shows a success message, leaves `version` unchanged and
creates an `ACCESS_TOKEN_REPLACED` row. No response or DOM ever contains the token value.

### Tests for User Story 4 (required) ⚠️

- [X] T082 [P] [US4] Extend src/clients/clients.service.spec.ts: `setAccessToken(id, token, actor)` encrypts the token with the client id as AAD and calls `repo.setAccessToken(id, encrypted, actor)`, and when the repository returns `false` it throws `NotFoundException`. Also spy on Nest `Logger` (log, warn, error, debug) during `create` and `setAccessToken` and assert that no logged argument contains the plaintext token (FR-016)
- [X] T083 [P] [US4] Add a `describe('access token')` block to test/clients-admin.e2e-spec.ts:
  - `PUT` returns 200 with an empty body.
  - `version` is unchanged afterwards.
  - Exactly one `ACCESS_TOKEN_REPLACED` row exists, and no `client_activities` column contains the token.
  - `GET` list and detail responses don't contain the token string (SC-004).
  - An empty `token` returns 422.
  - An unknown id returns 404.
- [X] T084 [P] [US4] Write fekra-dashboard/src/features/clients/replace-token-dialog.test.tsx:
  - The input is hidden by default and can be revealed.
  - Submit is disabled while the input is empty.
  - Confirmation calls `PUT`.
  - The value is cleared from component state after success or cancel.
  - A success notification is announced.
  - axe passes.
- [X] T085 [P] [US4] Write fekra-dashboard/e2e/us4-replace-token.spec.ts: replace a token, then assert that the typed token appears in no DOM node and in no `GET /api/clients*` response body captured with `page.on('response')`

### Implementation for User Story 4

- [X] T086 [P] [US4] Create src/clients/schemas/access-token.schema.ts exporting `ReplaceAccessTokenSchema = z.strictObject({ token: z.string().trim().min(1).max(4096) })`, `ReplaceAccessTokenDto` and `ReplaceAccessTokenInput`
- [X] T087 [US4] Change the repository's `setAccessToken` to `setAccessToken(id, encryptedToken, actor): Promise<boolean>` in src/clients/repositories/IClientsRepository.repository.ts and implement it in clients.repository.impl.ts. Inside `$transaction`: load the name (missing → return `false`), update `accessToken` only (no version increment), and record an `ACCESS_TOKEN_REPLACED` entry
- [X] T088 [US4] Change the service to `setAccessToken(id, token, actor)` in src/clients/clients.service.ts (encrypt, then `false` → `NotFoundException`). In src/clients/clients.controller.ts, change the `PUT :id/access-token` handler to take `@Body() { token }: ReplaceAccessTokenDto` and the actor
- [X] T089 [US4] Create fekra-dashboard/src/features/clients/replace-token-dialog.tsx: a `ConfirmDialog` with a `PasswordInput` (hidden by default, can be revealed), a `useReplaceToken` mutation in queries.ts, the value cleared on close, and a success notification. Add the "Replace access token" button to detail-page.tsx
- [X] T090 [US4] Add the US4 strings to fekra-dashboard/src/i18n/en.json and fekra-dashboard/src/i18n/ar.json
- [X] T091 [P] [US4] Document the `{ token }` body, the 422 for an empty token and the activity behavior in postman/collections/Social Inbox Automation API/Clients/Set Client Access Token (ADMIN).request.yaml

**Checkpoint**: US1–US4 each work on their own.

---

## Phase 7: User Story 5 - Remove a client (Priority: P5)

**Goal**: Permanent deletion after a confirmation that lists the consequences and requires typing
the client's name. The activity record survives the deletion.

**Independent Test**: Deleting a client removes it from the list and its detail link shows
"no longer exists". The `DELETED` row with the client's name remains. Cancelling changes nothing.

### Tests for User Story 5 (required) ⚠️

- [X] T092 [P] [US5] Extend src/clients/clients.service.spec.ts: `remove(id, actor)` calls `repo.delete(id, actor)`, and when it returns `false` throws `NotFoundException`
- [X] T093 [P] [US5] Add a `describe('delete')` block to test/clients-admin.e2e-spec.ts:
  - Seed a client with business info, a service, an offer and a linked CLIENT user.
  - `DELETE` returns 200.
  - The client, business info, service and offer are gone.
  - The user's `client_id` is null.
  - A `DELETED` row with `client_name` still exists.
  - A second `DELETE` returns 404.
- [X] T094 [P] [US5] Write fekra-dashboard/src/features/clients/delete-client-dialog.test.tsx:
  - The consequences list renders.
  - The confirm button stays disabled until the typed text equals the client name (after trimming).
  - Cancel makes no request.
  - Success navigates to `/clients` with a notification.
  - axe passes.
- [X] T095 [P] [US5] Write fekra-dashboard/e2e/us5-delete-client.spec.ts: delete from the detail view and from the list row menu (SC-007: both entry points require confirmation); afterwards the detail URL shows "no longer exists"

### Implementation for User Story 5

- [X] T096 [US5] Change the repository's `delete` to `delete(id, actor): Promise<boolean>` in src/clients/repositories/IClientsRepository.repository.ts and clients.repository.impl.ts. Inside `$transaction`: load the name (missing → `false`), `tx.client.delete`, then record a `DELETED` entry with `clientName`
- [X] T097 [US5] Change the service to `remove(id, actor)` in src/clients/clients.service.ts (`false` → `NotFoundException`), and pass the actor from the `DELETE :id` handler in src/clients/clients.controller.ts
- [X] T098 [US5] Create fekra-dashboard/src/features/clients/delete-client-dialog.tsx. It lists the consequences (business info, services and offers removed; users unlinked; automation stopped), has a type-the-name input and a red confirm button, and uses the `useDeleteClient` mutation in queries.ts (removes the cached client and invalidates the list). Wire it into detail-page.tsx and a row action menu in list-page.tsx
- [X] T099 [US5] Add the US5 strings to fekra-dashboard/src/i18n/en.json and fekra-dashboard/src/i18n/ar.json
- [X] T100 [P] [US5] Document the cascade and the activity record in postman/collections/Social Inbox Automation API/Clients/Delete Client.request.yaml

**Checkpoint**: US1–US5 each work on their own.

---

## Phase 8: User Story 6 - Configure a client's automated replies (Priority: P6)

**Goal**: Admins edit the AI, private-message and comment settings, including the message lists.
The rules on input are enforced, and the defaults are explained.

**Independent Test**: Turn comment replies on, add three thank-you messages, set the language
to Arabic and English, and save. The detail view shows exactly those values. Turning private
messages on with an empty list is blocked.

### Tests for User Story 6 (required) ⚠️

- [X] T101 [P] [US6] Write src/clients/schemas/client.schema.spec.ts:
  - `dmReplyConfig` with `enabled: true` and `replies: []` fails on `replies`; `enabled: false` with an empty list passes.
  - A list of 51 items fails, and a 1001-character message fails.
  - An empty comment list passes.
  - `brandVoice` over 400 characters fails.
  - `readDmConfig({ enabled: true, likes_enabled: false, replies: [] })` from @common/zod/json-readers still returns that object, not the fallback (research R8).
- [X] T102 [P] [US6] Add a `describe('settings')` block to test/clients-admin.e2e-spec.ts:
  - A client created without settings reads back the defaults (Arabic, all switches off, empty lists; FR-025).
  - PATCHing all three settings objects reads back identical values (SC-009) and adds one `UPDATED` row listing `aiConfig`, `dmReplyConfig` and `commentReplyConfig`.
  - Extra `aiConfig` keys survive a round trip.
- [X] T103 [P] [US6] Write fekra-dashboard/src/features/clients/client-form/message-list-editor.test.tsx:
  - Messages can be added, edited and removed with the keyboard alone.
  - The counter shows "n/50", and adding a 51st message is blocked with an explanation.
  - Messages over 1000 characters show an error.
  - Empty messages are rejected.
  - axe passes.
- [X] T104 [P] [US6] Write fekra-dashboard/src/features/clients/client-form/settings-sections.test.tsx:
  - The AI language select and the brand voice counter (400) work.
  - Turning on private messages with an empty list shows an error and blocks submit (FR-026).
  - An empty comment list shows the "built-in default messages will be used" notice.
  - With automation on but no connected account, the "nothing will be sent" notice appears.
  - axe passes in en and ar.
- [X] T105 [P] [US6] Write fekra-dashboard/e2e/us6-automation-settings.spec.ts: edit every setting, save, and check that the detail view shows exactly the saved values. Also check that the create page keeps the defaults when the settings section stays collapsed

### Implementation for User Story 6

- [X] T106 [US6] In src/clients/schemas/client.schema.ts, add `DmReplyConfigInputSchema = DmReplyConfigSchema.refine(c => !c.enabled || c.replies.length > 0, { message: 'Add at least one message when private messages are on', path: ['replies'] })` and use it in `CreateClientSchema` (and through it in `UpdateClientSchema`). Leave src/common/zod/json-columns.schema.ts and json-readers.ts unchanged
- [X] T107 [US6] Re-run `npm run openapi:export` (openapi/openapi.json) and `npm run api:types` in fekra-dashboard (src/api/schema.d.ts)
- [X] T108 [P] [US6] Create fekra-dashboard/src/features/clients/client-form/message-list-editor.tsx, an accessible list editor built on `useFieldArray`. Each row is a labelled textarea with a character counter and a remove button. It has an add button, enforces at most 50 items and 1–1000 characters, and announces changes through a live region
- [X] T109 [P] [US6] Create fekra-dashboard/src/features/clients/client-form/ai-settings-section.tsx: a language select (Arabic, English, Arabic and English) and a brand voice textarea with a 400-character counter. It keeps unknown `aiConfig` keys by merging edits into the original object
- [X] T110 [US6] Create fekra-dashboard/src/features/clients/client-form/dm-settings-section.tsx (switches for private messages and likes, plus the message list) and fekra-dashboard/src/features/clients/client-form/comment-settings-section.tsx (switches for replies/hide and likes, plus three message lists with explanatory help text and the default-messages notice when a list is empty). Extend fekra-dashboard/src/features/clients/client-form/schema.ts with the settings rules, including the FR-026 refine
- [X] T111 [US6] Add the three settings sections to fekra-dashboard/src/features/clients/edit-page.tsx, and to fekra-dashboard/src/features/clients/create-page.tsx as a collapsed "Automation settings (optional)" section prefilled with the FR-025 defaults. On detail-page.tsx, show the full settings and the "nothing will be sent until an account is connected" notice
- [X] T112 [US6] Add the US6 strings (all setting labels, help text and notices) to fekra-dashboard/src/i18n/en.json and fekra-dashboard/src/i18n/ar.json

**Checkpoint**: All six user stories work on their own.

---

## Phase 9: Polish, Delivery and Cross-Cutting Concerns

**Purpose**: Deploy through GitHub Actions to the GCP VM, check bilingual completeness,
accessibility and performance, and update the documentation.

### Backend delivery (research R15)

- [X] T113 [P] Create Dockerfile and .dockerignore with these stages:
  - `deps`: `node:22-bookworm-slim`, `npm ci`.
  - `build`: `npx prisma generate`, `npm run build`.
  - `migrate`: full dependencies plus `prisma/` and `prisma7.config.ts`; `CMD ["npx","prisma","migrate","deploy"]`.
  - `runtime`: `npm ci --omit=dev`, copies `dist/`, runs as `USER node` with `ENV NODE_ENV=production`, `EXPOSE 3000`, `CMD ["node","dist/main"]`.

  Exclude `.env*`, `node_modules`, `dist`, `coverage`, `postman-export` and `specs`.
- [X] T114 [P] Create the VM runtime files deploy/compose.yml, deploy/Caddyfile and deploy/remote-deploy.sh:
  - deploy/compose.yml with these services:
    - `caddy` (ports 80/443, Caddyfile and data volumes);
    - `api` (`${API_IMAGE}`, `env_file: /opt/fekra/.env`, not published to the host);
    - `dashboard` (`${DASHBOARD_IMAGE}`);
    - `redis` (`redis:7`, no published port, AOF volume);
    - `postgres` under the `local-db` profile (`postgres:16`, no published port, volume).
  - deploy/Caddyfile: `{$DOMAIN} { handle_path /api/* { reverse_proxy api:3000 } handle { reverse_proxy dashboard:8080 } }`.
  - deploy/remote-deploy.sh `<api|dashboard> <image-ref>`. For `api` it first runs the migrate image. It then runs `docker compose up -d <service>`, polls `https://$DOMAIN/api/health` (or the dashboard's `/`) for up to 60 s, re-deploys the previous image from `/opt/fekra/RELEASE_<service>` and exits 1 on failure, and writes the new ref to that file on success.
- [X] T115 [P] Create .github/workflows/ci.yml, triggered on pull requests and pushes to `main`:
  - Service containers `postgres:16` and `redis:7`; Node 22 with npm cache.
  - `npm ci`, `npx prisma generate`, `npm run lint:check`, `npm run build`, `npm test`.
  - `npx prisma migrate deploy`, then `npm run test:e2e` with these variables: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN=10m`, `TOKEN_ENCRYPTION_KEY` (64 hex characters), `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB=15` (a dedicated database, because the app sets `notify-keyspace-events` on startup), `APP_ORIGIN=http://localhost:5173`, `NODE_ENV=test`.
  - `npm run openapi:export` followed by `git diff --exit-code openapi/openapi.json` to catch contract drift.
  - A `publish` job that runs only on pushes to `main`, after all checks pass: authenticate with Workload Identity Federation, then build and push the `runtime` and `migrate` image targets to Artifact Registry tagged with the full commit hash (`${{ github.sha }}`). This is the image that passed CI and the only one that is deployed (constitution "Delivery").
- [X] T116 Create .github/workflows/deploy.yml, which runs after CI succeeds on `main` (`workflow_run`), in `environment: production`, with `permissions: id-token: write, contents: read`:
  - Authenticate with `google-github-actions/auth` using Workload Identity Federation (vars `GCP_WIF_PROVIDER`, `GCP_SERVICE_ACCOUNT`) and `setup-gcloud`, then configure Docker for Artifact Registry.
  - Use `github.event.workflow_run.head_sha` (never `github.sha`) as the image tag, and run only when `github.event.workflow_run.conclusion == 'success'` on `main`. Do NOT build anything here: verify with `gcloud artifacts docker images describe` that the image CI published for that commit exists, and fail if not.
  - Copy deploy/ to the VM, then run `gcloud compute ssh $VM --zone $ZONE --tunnel-through-iap --command "bash /opt/fekra/deploy/remote-deploy.sh api <image>@sha"`.
  - No JSON keys, and no secrets echoed in the logs.
- [X] T117 [P] Replace the NestJS boilerplate "Deployment" section of README.md with: the production topology (Caddy, `/` and `/api`), required GitHub variables and GCP setup (WIF pool, service account roles, Artifact Registry, IAP firewall rule), the `/opt/fekra/.env` layout (including the production values `SESSION_COOKIE_PATH=/api/auth`, `JWT_EXPIRES_IN=10m`, `APP_ORIGIN=https://<host>` and an empty `CORS_ORIGINS`), the GitHub setting that makes `main` a protected branch requiring the CI checks, rollback, and the **Meta webhook URL change to `https://<host>/api/webhooks/meta`** (research R1)

### Dashboard delivery and quality gates

- [X] T118 [P] Create fekra-dashboard/Dockerfile (a Node 22 build stage running `npm ci && npm run build`, then an `nginxinc/nginx-unprivileged:alpine` runtime on port 8080) and fekra-dashboard/nginx.conf:
  - SPA fallback `try_files $uri /index.html`.
  - Long-cache headers for `/assets/*`, and `no-cache` for `index.html`.
  - Headers: `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- [X] T119 [P] Create fekra-dashboard/scripts/check-i18n.ts, which fails when `en.json` and `ar.json` have different key sets or empty values (SC-008), and add `"i18n:check"` to fekra-dashboard/package.json
- [X] T120 [P] Write fekra-dashboard/e2e/keyboard.spec.ts: complete every user story (sign in, find, create, edit, replace token, delete, settings) using only `page.keyboard`, in en and ar, and assert that focus is visible on every focused element (SC-013)
- [X] T121 [P] Write fekra-dashboard/e2e/performance.spec.ts: with `SEED_CLIENTS=500`, measure from navigation start until the first table row (list) or heading (detail) is visible, over 20 loads each, and assert that the 95th percentile is under 2000 ms (SC-005)
- [X] T122 Create fekra-dashboard/.github/workflows/ci.yml:
  - Checks: `npm ci`, `lint`, `typecheck`, `i18n:check`, `test` and `build`.
  - e2e job: pulls the backend `runtime` and `migrate` images from Artifact Registry through WIF, at the backend commit hash pinned in fekra-dashboard/backend-version.txt (updated by hand when the dashboard needs a newer backend; never `latest`), starts them with `postgres:16` and `redis:7` service containers, sets `E2E_SEED_CMD` to the migrate image running `npm run seed:e2e`, and runs `npx playwright test` for the `en` and `ar` projects.
- [X] T123 Create fekra-dashboard/.github/workflows/deploy.yml (after CI on `main`, in `environment: production`): authenticate with WIF, build and push `fekra-dashboard:${{ github.sha }}`, then run `gcloud compute ssh --tunnel-through-iap … remote-deploy.sh dashboard <image>` (reusing deploy/remote-deploy.sh from T114)

### Documentation and final validation

- [X] T124 [P] Run `npm run postman:export` to regenerate postman-export/social-inbox-automation-api.postman_collection.json after the Postman changes in T029, T052, T066, T081, T091 and T100
- [X] T125 [P] In the Sync Impact Report follow-ups of .specify/memory/constitution.md, mark these as done: health endpoint, CORS allowlist, `.env.example`, Dockerfile and workflows, `lint:check`, the `/users/admin` role guard, Redis through `ConfigService`, and the access-token DTO. Leave the remaining items listed
- [ ] T126 Run every row of the manual table in specs/001-admin-clients-dashboard/quickstart.md section 3 and both automated pipelines in section 4; record the results in specs/001-admin-clients-dashboard/checklists/requirements.md under a new "Validation" note

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T004 → T005 → T006–T009.
- **Foundational (Phase 2)**: depends on Setup and **blocks every user story**.
  - Backend order: T010 → T011 → T012 → T013 → T014.
  - T016 (failing test) → T017–T019.
  - T020 (failing test) → T021, T022, T024, T025 → T023 → T026 → T027 → T028.
  - T030 needs T028.
  - Dashboard: T031 → T032 (needs T030) → T033 → T034 → T035 → T036, T037 → T038 → T039. T040 needs T015.
- **User stories (Phases 3–8)**: all need Phase 2. They touch the same backend files
  (clients.service.ts, clients.repository.impl.ts, clients.controller.ts, clients-admin.e2e-spec.ts)
  and dashboard files (queries.ts, detail-page.tsx, i18n JSON), so **build them in priority
  order** (US1 → US6), or merge carefully if working in parallel.
- **Polish (Phase 9)**: T113–T117 can start right after Phase 2, so delivery can go live with
  the MVP. T118–T123 need the dashboard to build. T124–T126 come last.

### User story dependencies

| Story | Depends on | Builds on (not required for its test) |
|---|---|---|
| US1 (P1) | Phase 2 | - |
| US2 (P2) | Phase 2 | US1 list ("New client" button) and detail (landing page) |
| US3 (P3) | Phase 2, US2's `recordActivity` helper (T059) | US1 detail ("Edit" button) |
| US4 (P4) | Phase 2, T059 | US1 detail |
| US5 (P5) | Phase 2, T059 | US1 list and detail |
| US6 (P6) | Phase 2, US2 create page (T064), US3 edit page (T079) | - |

### Within each story

Tests (they fail) → schema/DTO → repository → service → controller → OpenAPI export → dashboard
hooks → pages and components → i18n strings → Postman.

---

## Parallel Examples

### Phase 2 (after T014)

```text
T016 test/admin-access.e2e-spec.ts   |  T020 test/auth-session.e2e-spec.ts
T021 session.constants.ts            |  T022 sessions repository  |  T025 origin.guard.ts
T031 dashboard i18n                  |  T034 MSW handlers (after T032)
```

### User Story 1

```text
# Tests first, all at once:
T041 test/clients-admin.e2e-spec.ts (list)
T042 list-page.test.tsx   T043 detail-page.test.tsx   T044 e2e/us1-find-clients.spec.ts
# Then, alongside the backend T045–T046:
T048 queries.ts           T052 Postman List Clients
```

### User Story 6

```text
T101 client.schema.spec.ts   T102 e2e settings   T103 message-list-editor.test.tsx
T104 settings-sections.test.tsx   T105 e2e/us6-automation-settings.spec.ts
# Then:
T108 message-list-editor.tsx   T109 ai-settings-section.tsx   (T110 waits for T108)
```

### Delivery (can start right after Phase 2)

```text
T113 Dockerfile   T114 deploy/ files   T115 ci.yml   T117 README   → then T116 deploy.yml
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 (setup), then Phase 2 (foundation: admin-only access, sessions, throttling, shell).
2. Phase 3 (US1): a read-only admin dashboard in both languages.
3. **Stop and validate**: the US1 rows of quickstart.md, plus the e2e and axe runs.
4. Deliver: T113–T117 for the backend, T118 and T122–T123 for the dashboard. The backend
   deploys first.

### Incremental delivery

US2 (onboarding) → US3 (editing with conflict detection) → US4 (token rotation) → US5 (delete)
→ US6 (automation settings). Each story is deployed after its checkpoint. The backend always
deploys before the dashboard, and each backend change stays compatible with the dashboard
already deployed.

### Notes

- Re-run `npm run openapi:export` whenever a DTO changes (T030, T047, T066, T077, T107). CI fails
  on drift (T115).
- Never log or return token values. Spec SC-004 is tested in T083 and T085.
- Commit after each task or logical group. Commit the backend and dashboard repositories
  separately.

---

## Implementation notes (deviations from the plan)

- **Dashboard repo** is `E:\zeyad\fekra-dashboard` (sibling of the backend). Versions in use: React 19, Mantine 9, React Router 7, TanStack Query 5, Zod 4, msw 3, Vitest 5, TypeScript 5.9 (pinned: `openapi-typescript` does not support 7).
- **T006**: the Vite template ships `oxlint`, so linting uses it instead of ESLint. `eslint-plugin-jsx-a11y` and `eslint-plugin-i18next` are installed but not wired up; accessibility is checked by axe in the component tests. Wire the i18n literal-string rule or drop the two packages.
- **T014 / e2e**: the e2e tests use a separate database (`<name>-e2e`, created and migrated by `test/utils/e2e-global-setup.ts`) and Redis db 15. The helper refuses any database whose name lacks "e2e" or "test". `test/jest-e2e.json` transforms the ESM-only `@nestjs/config`, `@nestjs/jwt` and `@nestjs/passport` packages with `esModuleInterop`.
- **T016 found a pre-existing bug**: `GET /users/me` and `PUT /users/me` always returned 422 (`@CurrentUser('id') { id }: IdParamDto` validated a string against an object schema). Fixed in src/users/users.controller.ts.
- **T046**: Prisma's `contains` does not escape `%` and `_`, so `src/common/helpers/escape-like.ts` was added (with a spec).
- **T047**: the generated OpenAPI turns three nullable response fields (`fbPageId`, `instaAccountId`, `brandLogo`) into `string[]`. `fekra-dashboard/src/features/clients/queries.ts` restates those three types. Look for the cause in how nestjs-zod converts `z.string().nullable()` in response DTOs before this grows.
- **T010**: the migration SQL was generated with `prisma migrate diff` and applied with `prisma migrate deploy` (directory `20261107220000_admin_clients_dashboard`).
- **Not done yet in Phase 2**: T015 (e2e seed script), T019 (`ClientActor` type, needed by US2), T029 (Postman auth requests), T036/T037 (idle-timer and shared-component tests), T040 (Playwright login helper needs the seed).

### Phases 4 to 9: deviations and findings

- **Settings sections are one file.** T109/T110 asked for `ai-settings-section.tsx`,
  `dm-settings-section.tsx` and `comment-settings-section.tsx`; they live together in
  `client-form/settings-sections.tsx` (three small components and the wrapper `AutomationSettings`).
- **i18n check is a plain Node script**: `scripts/check-i18n.mjs` (not `.ts`), so it runs without a
  TypeScript runner. It also checks that `{{placeholders}}` match in both languages.
- **Request body types are written by hand** in `features/clients/queries.ts` (like `ClientRecord`):
  the generated types make nullable fields non-nullable and `aiConfig` unassignable. The cause is
  in how the backend's Zod schemas become OpenAPI (the recursive `z.json()` catch-all and
  nullable fields). Fixing it at the source is still open.
- **Delete returns 200** with an empty body (not 204), as before; the dashboard handles both.
- **`start:e2e` and the Playwright backend**: `playwright.config.ts` now starts the API itself
  (`npm --prefix ../fekra-backend run start:e2e`, on the e2e database, cookie path `/api/auth`).
- **Dashboard CI runs the API from source**, not from the images: the `migrate` image does not contain
  `scripts/` or `test/utils/`, which `seed:e2e` needs. CI checks out the backend repository at the
  commit in `backend-version.txt` (variable `BACKEND_REPOSITORY`, secret `BACKEND_CHECKOUT_TOKEN` with
  read-only access). `backend-version.txt` holds a placeholder until it is set by hand.
- **`remote-deploy.sh` takes a third argument** (the migrate image) for `api`.
- **CSP**: `default-src 'self'` alone breaks Mantine (inline styles) and client logos, so the nginx
  policy adds `style-src 'self' 'unsafe-inline'` and `img-src 'self' https: data:`.
- **Theme**: a real browser (axe in Playwright) found text-contrast failures that jsdom cannot see.
  `src/app/theme.ts` darkens the "dimmed" grey and the primary blue; the "Connected" badges use `teal.9`.
- **Bugs found on the way**: the stale Nest scaffold test `test/app.e2e-spec.ts` (expects `GET /`
  to return "Hello World!") was removed; `users.repository.impl.ts` logged `UpdateUserData` (which can
  hold a password hash) as `[object Object]`, now it logs only the id.
- **Lint**: `npm run lint:check` has 0 errors. The `no-unsafe-*` and `no-base-to-string` rules are
  warnings (47) because of legacy code; see the constitution follow-ups.
- **Tests are heavy on a loaded machine**: `vite.config.ts` caps `maxWorkers` at 4 and uses a 30 s
  test timeout, otherwise a few Mantine tests time out when all files run at once.
- **Not done: T126.** The automated pipelines were run (results in `checklists/requirements.md`).
  Manual rows that need a person (SC-001 usability timing) or a clean production-like setup
  (log search in the API container) were not run.
- **Sessions can be unlimited.** `SESSION_IDLE_MINUTES=0` and `SESSION_MAX_HOURS=0` remove the
  inactivity and absolute limits (spec FR-003 describes the defaults, 30 minutes and 12 hours,
  which still apply when the variables are unset). The session cookie is then renewed on every
  refresh for up to 400 days (the most browsers keep), and the server tells the dashboard its
  policy (`idleTimeoutMinutes`, absent when there is no limit) so the dashboard's own idle
  sign-out follows it. Sign-out still ends the session at once. The 10-minute access token is
  unchanged: it is renewed silently from the cookie.
