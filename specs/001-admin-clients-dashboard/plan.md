# Implementation Plan: Admin Clients Dashboard

**Branch**: `001-admin-clients-dashboard` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-admin-clients-dashboard/spec.md`

## Summary

Build a bilingual (English/Arabic, RTL) admin-only web dashboard to list, search, create, edit,
delete and re-token client businesses and to edit every client setting, including the AI,
private-message and comment automation settings. The dashboard is a new React repository,
`fekra-dashboard`. It is served from the same origin as the API through a Caddy reverse proxy
on the GCP VM (`/` for the dashboard, `/api/*` for the API).

This repository supplies what the dashboard depends on:

- **Admin-only access**: `/clients` and the currently unprotected `/users/admin*` routes require
  the ADMIN role.
- **Sessions**: a server-side session in an `httpOnly` cookie with a 30-minute idle limit and a
  12-hour absolute limit, plus a 10-minute access token kept in memory.
- **Sign-in throttling**: a Redis counter per email.
- **Activity record**: a new table, written in the same transaction as each change.
- **Simultaneous-edit detection**: a `version` column that edits must match.
- **List search**.
- **OpenAPI contract**: generated from the Zod DTOs.
- **Delivery**: a Dockerfile, CI/CD workflows and a health endpoint.

Details and alternatives are in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5. Backend on Node.js 22 LTS. Dashboard with React 19 and Vite.
**Primary Dependencies**:
- **Backend**: NestJS 11, Prisma 7 (pg adapter), Zod 4 + nestjs-zod 5, passport-jwt, ioredis.
  New: `@nestjs/swagger`, `cookie-parser`.
- **Dashboard**: React Router, TanStack Query 5, React Hook Form + Zod 4, Mantine 8, i18next,
  `openapi-fetch` and `openapi-typescript`.

**Storage**: PostgreSQL. One additive migration: `clients.version`, two new columns on
`refresh_tokens`, and a new `client_activities` table. Redis holds the sign-in failure counters.
**Testing**:
- **Backend**: Jest + ts-jest (unit), supertest e2e against Postgres and Redis.
- **Dashboard**: Vitest + React Testing Library + MSW + vitest-axe; Playwright +
  @axe-core/playwright for end-to-end tests.

**Target Platform**: Linux GCP VM running Docker Compose (api, dashboard, caddy, redis and
postgres). Current desktop browsers; usable at tablet width.
**Project Type**: Web service plus a single-page app, in two repositories.
**Performance Goals**: List and detail pages show content in under 2 s for 95% of loads
(SC-005). API p95 under 300 ms for `GET /clients` with 500 clients.
**Constraints**:
- WCAG 2.2 AA in both languages.
- Access tokens never readable by browser JavaScript after entry; the access JWT is kept in
  memory only.
- Every change and its activity entry are written in one transaction.
- Migrations stay backward compatible.

**Scale/Scope**: About 500 clients and up to 10 admins. 7 dashboard routes and 9 API operations
(3 auth, 6 clients).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*Source: `.specify/memory/constitution.md` v1.0.0.*

| Gate | Pre-research | Post-design | Notes |
|---|---|---|---|
| **I. Feature modules** | ✅ | ✅ | Sessions and throttling in `src/auth/` (with `repositories/ISessionsRepository`); activity writes in `ClientsRepository`; a new global `src/redis/` module replaces `inbox/redis.provider.ts`; a `src/health/` module. No Prisma calls in controllers. |
| **II. Zod input contract** | ✅ | ✅ | New and changed schemas: `search` on the list query, `version` on update, the token DTO, a DM input refine, logo max 255. Login normalizes the email in the strategy, because guards run before pipes (R8). |
| **III. HTTP contract** | ⚠️ | ⚠️ justified | Same `{data, meta}` and error shapes, and one new code: `CLIENT_VERSION_CONFLICT`. **Breaking**: `/clients` is ADMIN-only, PATCH requires `version`, and PATCH no longer accepts `accessToken`. See Complexity Tracking. The Postman collection is updated in the same PR. |
| **IV. Security** | ✅ | ✅ | Class-level `RolesGuard` + `@Roles('ADMIN')` on clients and on users admin routes; this closes a privilege escalation (R9). Session cookie `HttpOnly`/`Secure`/`SameSite=Strict`; only a hash of the session token is stored; throttling; `Origin` check on refresh and logout. Single-tenant admin use, so no tenant scoping is needed for admins. |
| **V. Tests** | ✅ | ✅ | Unit specs for every new or changed service, guard and helper; e2e for 401, 403, 409 (both kinds), throttling, and the session idle, absolute and revoke limits. Dashboard: Vitest + Playwright + axe. |
| **VI. Migrations** | ✅ | ✅ | One additive migration (defaults and nullable columns, a new table and enum). No destructive changes. |
| **VII. Async reliability** | ✅ | ✅ | No new webhooks or queues. Redis keys use the `auth:login-fail:` prefix constant. Inbox behavior is unchanged: the DM refine is input-only, so stored configs still read the same way (R8). |
| **VIII. Observability & config** | ✅ | ✅ | New variables (session, throttle, cookie, CORS, OpenAPI) go through `ConfigService` and are listed in `.env.example`. `GET /health` is added. `enableShutdownHooks()`. Log lines never include tokens or emails in plaintext; throttle keys are hashed. |
| **Frontend integration** | ✅ | ✅ | Types generated from OpenAPI; the UI branches on `errorCode`; the access token stays in memory; CORS allowlist (empty in production, single origin). Release order: backend first; there is no deployed frontend yet. |
| **Delivery** | ✅ | ✅ | Dockerfile; `ci.yml` builds and publishes the image tagged with the commit hash only after all checks pass, and `deploy.yml` deploys that exact image (`workflow_run.head_sha`, no rebuild) via Workload Identity Federation, IAP SSH, `migrate deploy`, health gate and rollback; `deploy/compose.yml` and `deploy/Caddyfile`; a separate dashboard image and workflow. |

**Result**: PASS. The one ⚠️ is justified below. The design adds no unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-admin-clients-dashboard/
├── spec.md
├── plan.md                         # this file
├── research.md                     # R1–R16 decisions
├── data-model.md                   # Client.version, ClientActivity, sessions, Redis counter
├── quickstart.md                   # local run + manual and automated validation
├── contracts/
│   ├── admin-api.openapi.yaml      # API contract the generated OpenAPI must match
│   └── dashboard-ui.md             # routes, session behavior, errorCode → UI mapping
├── checklists/requirements.md
└── tasks.md                        # created by /speckit-tasks
```

### Source Code: this repository (`fekra-backend`)

```text
src/
├── main.ts                          # cookie-parser, CORS allowlist, Swagger (non-prod), enableShutdownHooks
├── app.module.ts                    # + RedisModule, HealthModule
├── redis/
│   └── redis.module.ts              # NEW global REDIS provider (from inbox/redis.provider.ts) via ConfigService
├── health/
│   ├── health.module.ts             # NEW
│   ├── health.controller.ts (+ .spec.ts)   # GET /health → Postgres SELECT 1 + Redis PING
├── auth/
│   ├── auth.controller.ts (+ .spec.ts)     # login sets cookie; NEW POST /auth/refresh, POST /auth/logout
│   ├── auth.service.ts (+ .spec.ts)        # issues access JWT with sid
│   ├── session.service.ts (+ .spec.ts)     # NEW create / refresh (idle + absolute) / revoke
│   ├── login-throttle.service.ts (+ .spec.ts) # NEW Redis per-email counter
│   ├── repositories/
│   │   ├── ISessionsRepository.repository.ts # NEW + SESSIONS_REPOSITORY token
│   │   └── sessions.repository.impl.ts       # NEW (prisma.refreshToken)
│   ├── strategies/jwt.strategy.ts           # rejects revoked or expired sid
│   ├── strategies/local.strategy.ts         # email normalize + throttle check
│   ├── guards/origin.guard.ts (+ .spec.ts)  # NEW Origin check for refresh/logout
│   └── consts/session.constants.ts          # NEW cookie name, Redis key prefix
├── clients/
│   ├── clients.controller.ts (+ .spec.ts)   # class-level JwtAuthGuard + RolesGuard + @Roles('ADMIN'); passes the actor
│   ├── clients.service.ts (+ .spec.ts)      # actor, duplicate-account check, version, diff
│   ├── schemas/client.schema.ts             # UpdateClientSchema: + version, − accessToken; logo max 255; DM refine
│   ├── schemas/query-client.schema.ts       # + search
│   ├── schemas/access-token.schema.ts       # NEW ReplaceAccessTokenDto
│   ├── repositories/IClientsRepository.repository.ts   # signatures take actor + expected version
│   ├── repositories/clients.repository.impl.ts         # search; transactions writing client + ClientActivity
│   ├── helpers/changed-fields.ts (+ .spec.ts)          # NEW deep-diff of top-level fields
│   └── types/client.types.ts                # ClientRecord + version; ClientActor; VersionConflict
├── users/
│   └── users.controller.ts                  # RolesGuard + @Roles('ADMIN') on admin routes; @Param() fix
└── inbox/
    ├── inbox.module.ts                      # imports the REDIS provider from RedisModule
    └── redis.provider.ts                    # keeps only REDIS_SUB

prisma/
├── schema.prisma                            # Client.version, RefreshToken.lastUsedAt/revokedAt, ClientActivity + enum
└── migrations/<ts>_admin_clients_dashboard/ # additive

test/
├── clients-admin.e2e-spec.ts                # 401/403/404/409/422, activity rows, search
└── auth-session.e2e-spec.ts                 # cookie, refresh idle/absolute, logout revoke, throttle

openapi/openapi.json                         # NEW exported contract (npm run openapi:export)
scripts/openapi-export.ts                    # NEW
scripts/seed-e2e.ts                          # NEW idempotent e2e seed (admin, client user, N clients)
src/app.setup.ts (+ .spec.ts)                # NEW configureApp(): cookie-parser, CORS allowlist, shutdown hooks
src/common/helpers/escape-like.ts            # NEW only if the literal %/_ search test needs it
test/utils/e2e-app.ts                        # NEW e2e helpers (app, resetDb, login, REDIS_DB=15)
deploy/remote-deploy.sh                      # NEW pull by sha, migrate, start, health gate, rollback
.env.example                                 # NEW every variable
Dockerfile                                   # NEW multi-stage, non-root
.github/workflows/ci.yml, deploy.yml         # NEW
deploy/compose.yml, deploy/Caddyfile         # NEW VM runtime (api, dashboard, caddy, redis, postgres)
postman/collections/Social Inbox Automation API/   # updated: auth refresh/logout, clients search/version/token
```

### Source Code: new repository (`fekra-dashboard`)

```text
src/
├── main.tsx, app/                   # providers: Mantine (theme + DirectionProvider), QueryClient, i18n, router
├── api/
│   ├── schema.d.ts                  # generated by openapi-typescript
│   ├── client.ts                    # openapi-fetch + bearer injection + single-flight refresh + 401 retry
│   └── errors.ts                    # errorCode → i18n key mapping (contracts/dashboard-ui.md)
├── auth/
│   ├── session-context.tsx          # in-memory token, user, broadcast sign-out
│   ├── use-idle-timer.ts            # 30-min idle + activity-driven refresh
│   ├── require-admin.tsx            # route guard → /login or /no-access
│   └── login-page.tsx
├── features/clients/
│   ├── list-page.tsx                # URL state, table, search, sort, pagination, empty state
│   ├── detail-page.tsx
│   ├── client-form/                 # profile, ai-settings, dm-settings, comment-settings, message-list editor
│   ├── replace-token-dialog.tsx
│   ├── delete-client-dialog.tsx
│   ├── conflict-banner.tsx
│   └── queries.ts                   # TanStack Query hooks and keys
├── components/                      # LanguageSwitch, PageState (loading/empty/error), ConfirmDialog
├── i18n/ en.json, ar.json
└── test/ msw handlers, render utils
e2e/                                 # Playwright specs per user story + axe (en, ar) + keyboard pass
Dockerfile                           # nginx:alpine serving dist with SPA fallback
.github/workflows/ci.yml, deploy.yml
```

**Structure Decision**: Backend changes follow the existing feature-module layout in this
repository. The dashboard is a separate repository with a feature-folder layout, as required by
the constitution's "Frontend Integration" section. The two repositories share the API contract
through `openapi/openapi.json`, and the VM runtime files (`deploy/`) live here, because the API
deploy owns migrations and the proxy.

## Delivery Order

1. **Backend foundation**: migration, RedisModule move, health endpoint, `.env.example`, ADMIN
   guards (clients and users admin routes).
2. **Backend features**: sessions (login cookie, refresh, logout, `sid` check), throttling,
   search, version and activity, token DTO, OpenAPI export, Postman update.
3. **Backend delivery**: Dockerfile, CI, deploy workflow, compose and Caddy. Deploy the backend
   first; it stays compatible because no frontend is deployed yet.
4. **Dashboard by story**: US1 (sign-in, guard, list, detail, language switch) → US2 → US3 →
   US4 → US5 → US6, each with its tests and axe checks.
5. **Dashboard delivery**: image, CI and deploy workflow; then update the Meta webhook URL to
   `/api/webhooks/meta` once Caddy serves the domain (R1).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Breaking change: `/clients/*` now requires the ADMIN role (403 for CLIENT users) | FR-001/FR-002, and constitution IV: CLIENT users currently can read and change every client | Keeping CLIENT access would violate the spec and leave a security hole. No deployed frontend depends on CLIENT access; Postman is updated in the same PR |
| Breaking change: PATCH `/clients/:id` requires `version` and no longer accepts `accessToken` | FR-029 needs the starting version on every edit; FR-016/FR-017/FR-028 need token changes to go only through the dedicated, recorded action | An optional `version` would let callers skip the conflict check, and expand → contract would add a release cycle with no consumer to migrate (the dashboard isn't built; Postman changes in the same PR) |
| New dependency `@nestjs/swagger` | Generate an OpenAPI contract from the Zod DTOs for a frontend in another repository (constitution "Frontend Integration" SHOULD) | Copying the Zod schemas by hand drifts across repositories, and the full settings editing makes the shapes large |
| New dependency `cookie-parser` | Read the `httpOnly` session cookie on `/auth/refresh` and `/auth/logout` | Parsing the `Cookie` header by hand is fragile; this is the standard Express middleware |
| `ClientsRepository` writes two tables (`clients` and `client_activities`) | Each change and its activity entry must commit in one transaction (FR-021, FR-028) | A separate activity repository would need transaction-client passing between repositories for a single insert |
