<!--
Sync Impact Report
==================
Version change: (unversioned template) → 1.0.0
Bump rationale: first ratification. Every template placeholder is replaced with principles
derived from the existing codebase, plus rules for the planned React frontend and the
GitHub Actions → GCP VM delivery pipeline.

Template slots → adopted titles:
  [PRINCIPLE_1_NAME] → I. Feature-Module Layered Architecture
  [PRINCIPLE_2_NAME] → II. Zod Schemas Are the Input Contract
  [PRINCIPLE_3_NAME] → III. One HTTP Contract, Owned by the Backend
  [PRINCIPLE_4_NAME] → IV. Secure by Default
  [PRINCIPLE_5_NAME] → V. Tests Ship With the Code (NON-NEGOTIABLE)
Added principles:
  VI. Schema Changes Only Through Prisma Migrations
  VII. Acknowledge Fast, Process Reliably
  VIII. Observable and Configured From the Environment
Added sections:
  - Technology Stack & Platform Constraints        (was [SECTION_2_NAME])
  - Frontend Integration (React)                    (new)
  - Delivery Pipeline & Deployment (GitHub Actions → GCP VM) (new)
  - Development Workflow & Quality Gates            (was [SECTION_3_NAME])
Removed sections: none

Templates and guidance files:
  ✅ .specify/templates/plan-template.md  - Constitution Check lists concrete gates; source tree
                                            shows the NestJS feature-module layout
  ✅ .specify/templates/tasks-template.md - tests are required (Principle V); paths use
                                            src/<feature>/*.spec.ts; polish phase adds contract,
                                            env and migration tasks
  ✅ .specify/templates/spec-template.md  - no change needed (stays technology-agnostic)
  ✅ CLAUDE.md                            - points agents at this constitution
  ⚠ README.md                             - "Deployment" section is NestJS boilerplate (Mau/AWS);
                                            replace it when the GCP pipeline lands
  n/a .specify/templates/commands/        - directory does not exist in this project

Deferred placeholders: none.

Follow-up TODOs (existing code that does not yet comply; fix or justify):
  - IV:   /users/admin/* routes check JwtAuthGuard only; add RolesGuard + @Roles('ADMIN').
  - IV:   CLIENT-role users are not scoped to their own clientId on clients, services, offers
          and business-info endpoints.
  - IV:   n8n callback compares x-webhook-secret with !==; switch to timingSafeEqual.
  - II:   n8n callback body and PUT /clients/:id/access-token `token` bypass Zod schemas.
  - II:   retire class-validator leftovers (BaseQueryDto, ValidationPipe in main.ts) and the
          unused ResponseDto; drop the duplicate default ZodValidationPipe in main.ts.
  - VIII: add GET /health (PostgreSQL + Redis), app.enableShutdownHooks(), .env.example;
          move process.env reads in redis.provider.ts and n8n-callback.controller.ts to
          ConfigService.
  - Frontend Integration: enable CORS from a CORS_ORIGINS allowlist; implement the refresh-token
          flow (RefreshToken model exists, no endpoint yet).
  - Delivery: add Dockerfile, .github/workflows/ci.yml and deploy.yml, and a non-mutating lint
          script for CI (`npm run lint` currently runs with --fix).
  - Stack: remove unused mongoose and @nestjs/mongoose dependencies.
-->

# Fekra Backend Constitution

Fekra Backend is the NestJS API behind the social inbox automation platform: it manages
clients (businesses), their services, offers and business info, receives Meta (Facebook and
Instagram) webhooks, classifies and answers comments and DMs with rules, Gemini and n8n, and
serves the React dashboard. This document defines the non-negotiable engineering rules for
this repository and for its integration with the frontend and the deployment pipeline.

## Core Principles

### I. Feature-Module Layered Architecture

Every business capability lives in its own NestJS module under `src/<feature>/`, named with
plural kebab-case for resources (`clients`, `offers`, `business-info`).

- A CRUD module MUST follow the existing layout:
  `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`,
  `repositories/I<Feature>Repository.repository.ts` (interface + `<FEATURE>_REPOSITORY`
  injection token), `repositories/<feature>.repository.impl.ts`, `schemas/` (Zod),
  `interfaces/` (repository input data), `types/` (records returned), `mappers/` (row → record),
  and co-located `*.spec.ts` files.
- Dependencies point one way: Controller → Service → repository interface → `PrismaService`.
  Controllers MUST NOT inject `PrismaService` or a repository. Services MUST depend on the
  repository interface through `@Inject(<TOKEN>)`, never on the implementation class.
- Controllers are thin: bind DTOs, apply guards, delegate to one service call. No business
  rules and no Prisma types in controllers.
- Services own business rules (id generation, encryption, existence checks) and throw Nest
  HTTP exceptions (`NotFoundException`, `ConflictException`, ...).
- Repositories own every Prisma call, implement `IBaseRepository` for CRUD resources, return
  mapped records (never raw rows), and return `null` for "not found" on reads. List queries
  MUST page with `skip`/`take` and end `orderBy` with `{ id: 'asc' }` as a stable tiebreaker.
- Modules talk to each other only through exported services (e.g. `ClientsModule` exports
  `ClientsService`), never through another module's repository.
- Pipeline modules that own no tables (`inbox`, `meta-webhook`) MAY skip the repository
  layer but still keep controllers thin and logic in services.
- Feature-agnostic code lives in `src/common/` (`zod/`, `filters/`, `pipes/`, `helpers/`,
  `repositories/`) and is imported via `@common/*`; other cross-folder imports use `@app/*`.
- Development-only tooling (simulators, dashboard testers) lives in a `dev/` folder and MUST
  NOT be registered when `NODE_ENV=production`.

Rationale: this is the shape every module already has. The repository interface keeps
services unit-testable without a database and keeps Prisma out of business logic.

### II. Zod Schemas Are the Input Contract

- Every body, query and route param that crosses the HTTP boundary MUST be validated by a Zod
  schema exposed as a DTO with `createZodDto` (nestjs-zod). Raw `@Body('field')`, inline
  `@Body() body: { ... }` types and new class-validator DTOs are not allowed.
- Schemas live in `src/<feature>/schemas/`. An entity file exports `Create<X>Schema`,
  `Update<X>Schema` (`Create<X>Schema.partial()` unless a field is immutable), the
  `Create<X>Dto`/`Update<X>Dto` classes and the `z.infer` types `Create<X>Input`/
  `Update<X>Input`. List queries use `listQuery(orderFields, defaultOrderBy)` in
  `schemas/query-<entity>.schema.ts`, with an explicit allowlist of sortable fields.
- Object schemas MUST use `z.strictObject` so unknown keys are rejected.
- Reuse the primitives in `@common/zod/primitives` (`text()`, `emailField`, `passwordField`,
  `nameField`, `metaId`, `httpUrl`, `IdParamSchema`) before writing new ones. A primitive
  needed by two features moves there.
- UUID route params MUST be validated with `IdParamDto` so a malformed id fails with 422
  before it reaches the database.
- Every Prisma `Json` column MUST have a schema in `@common/zod/json-columns.schema.ts` and be
  parsed on read through the readers in `@common/zod/json-readers.ts`; stored JSON is never
  trusted.
- TypeScript input types come from `z.infer`. Do not hand-write a parallel interface for the
  same input.

Rationale: one schema gives runtime validation, static types and a machine-readable contract
the frontend can rely on.

### III. One HTTP Contract, Owned by the Backend

The React frontend, n8n and Postman all depend on these shapes; they are the public contract.

- Success bodies: single resources return the record itself. List endpoints return
  `PaginatedResult<T>` = `{ data: T[], meta: { total, page, limit, totalPages } }` built with
  `paginate()`. List query params are `page` (≥ 1, default 1), `limit` (1-100, default 20),
  `orderBy` (allowlisted) and `orderDir` (`asc` | `desc`, default `desc`).
- Error bodies: every error passes through `GeneralExceptionsFilter` and has the shape
  `{ statusCode, message, errorCode, details? }`. `errorCode` is a stable SCREAMING_SNAKE_CASE
  identifier that clients branch on; `message` is human-readable and may change. Validation
  failures are `422` with `INPUT_VALIDATION_ERROR` and `details` from `z.flattenError`
  (`formErrors`, `fieldErrors`).
- When a default code (`NOT_FOUND`, `CONFLICT`, ...) is not specific enough, throw an
  `HttpException` with a custom `errorCode`. Never return an error object with a 2xx status.
- Errors MUST NOT leak internals: no stack traces, Prisma or SQL messages, schema details,
  or the value that violated a unique constraint (field name only).
- Status codes: `201` create, `200` read/update/delete, `202` accepted background work, `200`
  webhook acknowledgement, `401` missing or invalid token, `403` insufficient role or wrong
  tenant, `404`, `409` conflict, `422` validation, `503` dependency unavailable.
- Routes use plural kebab-case nouns (`/clients`, `/business-info`); sub-resources and actions
  are path segments (`/clients/:id/access-token`, `/inbox/comments/backfill`).
- Changes to an existing endpoint MUST be backward compatible: new optional fields, new
  params, new endpoints. Removing or renaming a field, tightening validation, or changing a
  status code or `errorCode` is breaking and MUST go expand → migrate frontend → contract
  across releases, or move to a versioned route (`/v2/...`).
- The Postman collection in `postman/collections/Social Inbox Automation API/` is the living
  contract. A PR that adds or changes an endpoint MUST update its request file (example body,
  auth mode, saved variables) and keep `npm run postman:export` working.

Rationale: the frontend lives in another repository and deploys separately. Stable shapes
and stable error codes let it evolve without lockstep releases.

### IV. Secure by Default

- Authentication: controllers are protected with `@UseGuards(JwtAuthGuard)` at class level.
  The only public routes are login/register, health, and machine endpoints that authenticate
  the caller another way (Meta webhooks, n8n callback). A new public route MUST state why in
  its PR.
- Authorization: admin operations MUST use `RolesGuard` + `@Roles('ADMIN')`; a path segment
  such as `/admin` is not protection. A `CLIENT`-role user MUST only read or write rows whose
  `clientId` equals their own; tenant scoping is enforced in the service layer from the
  authenticated user, never from a client-supplied id alone.
- JWTs are bearer tokens. Tokens issued before `passwordChangedAt` are rejected. Refresh tokens
  are stored only as SHA-256 hashes (`RefreshToken.tokenHash`).
- Passwords use bcrypt (12 rounds) through `auth.contants.ts` helpers, are capped at 72 bytes
  and never trimmed. Login compares against a dummy hash when the user does not exist and
  returns the same error for unknown email and wrong password.
- Third-party secrets (Meta page access tokens) are encrypted with `TokenCryptoService`
  (AES-256-GCM, row id as AAD, versioned `v1:` prefix) before they reach a repository, and are
  never logged or returned in a response.
- Sensitive columns are hidden with Prisma's global `omit` in `PrismaService`. A new secret or
  credential column MUST be added there in the same PR.
- Inbound webhooks are verified before any processing: Meta via `X-Hub-Signature-256` HMAC
  over the raw body, n8n via `x-webhook-secret`. Every secret or signature comparison MUST be
  constant-time (`timingSafeEqual`).
- Secrets come only from the environment. `.env*` files, real tokens in Postman examples,
  secrets baked into Docker images and secrets echoed in GitHub Actions logs are forbidden.
- User-supplied URLs are restricted to `http`/`https` (`httpUrl`).

Rationale: the platform holds Meta page tokens for many businesses. One leak or one missing
role check exposes all of them.

### V. Tests Ship With the Code (NON-NEGOTIABLE)

- Every added or changed service, controller, guard, filter, pipe and helper MUST have a
  co-located `*.spec.ts` covering the success path and each error branch it introduces. Zod
  schemas with custom refinements or transforms get tests too (see `primitives.spec.ts`).
- Unit tests construct the class directly with `jest.fn()` mocks for its dependencies
  (repository interface, `ConfigService`, Redis, external clients) and use `src/test-mocks/`
  for Nest packages. They MUST NOT touch a real database, Redis, Meta Graph API, Gemini or n8n.
- A bug fix starts with a test that reproduces the bug.
- Rejection paths at trust boundaries (missing token, wrong role, wrong tenant, bad webhook
  signature or secret) MUST be covered by e2e tests in `test/*.e2e-spec.ts` (supertest)
  running against real PostgreSQL and Redis.
- `npm test` and the e2e suite MUST pass in CI before merge. Changed files SHOULD NOT lose
  coverage.

Rationale: the codebase already pairs nearly every unit with a spec; automated deployment
to production is only safe if that discipline holds.

### VI. Schema Changes Only Through Prisma Migrations

- PostgreSQL through Prisma 7 with the `@prisma/adapter-pg` driver adapter is the only primary
  datastore. `prisma/schema.prisma` is the single source of truth. The generated client in
  `src/generated/prisma` is gitignored, regenerated by `prisma generate` (dev, CI, Docker
  build) and never edited by hand.
- Every schema change ships as a committed migration created with
  `prisma migrate dev --name <change>`. Merged migrations are immutable. Production applies
  migrations only with `prisma migrate deploy` from the pipeline, never `db push`.
- Conventions: models PascalCase singular; tables snake_case plural via `@@map`; fields
  camelCase mapped to snake_case columns via `@map`; primary keys
  `@id @default(uuid()) @db.Uuid`; every table has `createdAt` and `updatedAt`; every foreign
  key has an `@@index` and an explicit `onDelete`; string columns are bounded
  (`@db.VarChar(n)`) and match the Zod `max`.
- Migrations MUST be backward compatible with the release currently running, because the
  pipeline migrates before switching traffic. Destructive changes (drop or rename a column,
  add `NOT NULL`) use expand → backfill → contract over separate deploys.
- Multi-statement writes that must succeed or fail together use `prisma.$transaction`.

Rationale: the database can't be rolled back with the image, so the schema has to stay
compatible with both the old and new code during a deploy.

### VII. Acknowledge Fast, Process Reliably

- Webhook endpoints (Meta, n8n callback) verify the caller, hand the work off, and respond
  within the provider's timeout (`200 { received: true }`, `{ acknowledged }`). Slow work
  (Gemini, Graph API, n8n) runs asynchronously.
- Asynchronous work runs on Redis (ioredis). Keys are namespaced constants in the module's
  `*.constants.ts` (`inbox:*`, `n8n:*`, `dmbuf:*`), never inline strings. Pub/sub uses its own
  connection (`REDIS_SUB`).
- Every handoff is idempotent. Deliveries carry an id; a callback for an unknown or expired
  id returns `{ acknowledged: false }` instead of an error; duplicate provider events are
  harmless.
- Every outbound call (Meta Graph API, Gemini, n8n) MUST have a timeout, a bounded and
  configurable retry count (e.g. `N8N_MAX_ATTEMPTS`), and a terminal state: a dead list, a
  safe default, or a logged drop. Unbounded retry loops are forbidden.
- AI is the last resort, not the first: deterministic rules run first (e.g. the
  `CommentClassifierService` lexicon), the LLM runs only when the rules can't decide, and an
  LLM failure falls back to a safe default (e.g. ambiguous comment → `spam`, like only).
  Model names, timeouts and fallback models come from configuration. LLM output is untrusted
  and validated before use.
- Fire-and-forget calls (`void this.x()`) MUST catch and log their own errors so a failure
  never becomes an unhandled rejection. `no-floating-promises` warnings are fixed, not
  silenced.
- Outbound rate limits (`RATE_LIMIT_*`) and timing windows (`DM_WINDOW_SEC`, ...) are
  configuration, not literals.
- Background loops and subscribers start in `onModuleInit` and stop in `onModuleDestroy`, so
  the process exits cleanly during a deploy.

Rationale: Meta retries and eventually disables slow webhooks, and LLM quotas fail often.
Customers must still get a correct, non-duplicated reply.

### VIII. Observable and Configured From the Environment

- Logging uses Nest `Logger` with one instance per class (`new Logger(ClassName.name)`);
  `console.*` is not allowed in `src/`. Levels: `error` with stack for 5xx and unexpected
  failures, `warn` for client errors and dropped events, `log` for lifecycle, `debug` for
  per-event detail.
- Never log secrets, tokens, password material or encryption keys. Customer message content
  is logged only at `debug`, which is disabled in production.
- Configuration is read through `ConfigService`. Required values use `getOrThrow` or are
  validated at construction (as `TOKEN_ENCRYPTION_KEY` is), so a misconfigured process fails
  at boot, not on the first request. Optional values have defaults in code. Direct
  `process.env` reads are limited to bootstrap code (`main.ts`, module-level `NODE_ENV`
  switches).
- Every variable the app reads is listed in `.env.example` with a placeholder and a short
  comment. A PR that adds a variable updates `.env.example` and the production secret store
  in the same change.
- `GET /health` is unauthenticated, returns `200` only when PostgreSQL and Redis are
  reachable, reveals no internals, and is the deployment gate.
- The app enables shutdown hooks and closes Prisma and Redis connections in
  `onModuleDestroy`.

Rationale: the API runs unattended on a single VM. Logs and the health endpoint are the only
ways to tell a good deploy from a bad one.

## Technology Stack & Platform Constraints

- Runtime: Node.js 22 LTS, TypeScript 5, NestJS 11 on Express. Path aliases `@app/*` and
  `@common/*`.
- Data: PostgreSQL with Prisma 7 (`prisma-client` generator, `pg` driver adapter); Redis via
  ioredis for queues, buffers and TTL keys.
- Validation: Zod 4 with nestjs-zod.
- Auth: `@nestjs/passport`, `passport-jwt`, `passport-local`, bcrypt.
- Integrations: Meta Graph API (Facebook Pages, Instagram), Google Gemini through
  `@google/generative-ai`, n8n through secret-authenticated webhooks.
- Quality: Jest + ts-jest, supertest; Prettier (single quotes, trailing commas); ESLint flat
  config with `typescript-eslint` `recommendedTypeChecked`.
- API documentation and manual testing: Postman Native Git collection in `postman/`, exported
  with `npm run postman:export`.
- A new runtime dependency, datastore or external service MUST be justified in the plan's
  Complexity Tracking table. Prefer what is already in the stack. Unused dependencies are
  removed, not accumulated.

## Frontend Integration (React)

The React dashboard lives in a separate repository and is an API consumer like any other: it
gets no private endpoints or shortcuts. Its own constitution SHOULD restate these
obligations from the frontend side.

- Contract: frontend API types and calls come from the backend contract (Principle III). The
  backend SHOULD publish an OpenAPI document generated from the Zod DTOs so the frontend can
  generate its types. Until then the frontend mirrors the Zod schemas in one API layer, and
  components never call `fetch` with ad-hoc shapes.
- Base URL: the frontend reads the API base URL from build-time environment
  (e.g. `VITE_API_BASE_URL`) and never hard-codes a host.
- CORS: the backend enables CORS only for an explicit allowlist read from `CORS_ORIGINS`.
  `*` is forbidden. In production the SPA and API are served over HTTPS under the same
  registrable domain (an `/api` path behind the reverse proxy, or an `api.` subdomain) so auth
  cookies stay same-site.
- Auth: requests send `Authorization: Bearer <accessToken>`. The access token is kept in
  memory and MUST NOT be written to `localStorage`. Refresh tokens, once implemented, are
  `httpOnly; Secure; SameSite` cookies set by the backend. On `401` the frontend refreshes
  once, then signs the user out.
- Errors: the UI branches on `errorCode`, never on `message`; maps `422`
  `details.fieldErrors` onto form fields; shows a generic message for `5xx` and `503`.
- Lists: pagination UI is driven by `meta.total` and `meta.totalPages`, with `limit` ≤ 100.
- Roles: hiding admin UI from `CLIENT` users is a convenience only. The backend guards
  (Principle IV) are the authority.
- Release order: backend changes deploy first and stay compatible with the deployed frontend;
  the frontend deploys after; old shapes are removed only when no deployed frontend uses them.
- Development-only endpoints (`src/meta-webhook/dev/**`) do not exist in production, and the
  frontend MUST NOT depend on them.

## Delivery Pipeline & Deployment (GitHub Actions → GCP VM)

- CI (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`:
  `npm ci` → `npx prisma generate` → lint without `--fix` → `npm run build` → `npm test` →
  e2e tests against PostgreSQL and Redis service containers. Any failure blocks the merge;
  `main` is a protected branch.
- Packaging: the API ships as a Docker image from a multi-stage `Dockerfile`. The build stage
  installs dependencies, generates the Prisma client and compiles. The runtime stage holds
  production dependencies, `dist/` and `prisma/`, runs as a non-root user with
  `NODE_ENV=production`, and starts with `node dist/main`.
- Images are tagged with the full git commit SHA and pushed to GCP Artifact Registry. The
  image that passed CI is the one deployed. Nothing is built on the VM, and `latest` is never
  a deploy reference.
- CD (`.github/workflows/deploy.yml`) runs on push to `main` after CI passes, in a GitHub
  Environment named `production` that holds the deploy secrets (optionally with required
  reviewers).
- GitHub → GCP auth uses Workload Identity Federation (`google-github-actions/auth`) with a
  dedicated least-privilege service account. Long-lived service-account JSON keys are
  forbidden. The workflow reaches the VM with `gcloud compute ssh`, preferably over IAP.
- On the VM, Docker Compose runs the API and a reverse proxy (Nginx or Caddy) that terminates
  TLS for the API and serves the React build. Only ports 80 and 443 are open to the internet.
  PostgreSQL and Redis, whether containers or managed (Cloud SQL, Memorystore), are never
  reachable from a public interface.
- Deploy sequence, in order:
  1. pull the image by SHA;
  2. run `prisma migrate deploy` in a one-off container of the new image;
  3. start the new API container;
  4. poll `GET /health` until it returns `200` or the timeout expires;
  5. on failure, redeploy the previously recorded SHA and fail the workflow;
  6. on success, record the deployed SHA on the VM for the next rollback.
- Runtime configuration is an env file on the VM (mode `600`, owned by the deploy user) or
  GCP Secret Manager, rendered at deploy time. It is never baked into the image or printed
  in workflow logs.
- The Meta webhook URL in production is `https://<api-host>/webhooks/meta`. Its verify token
  and app secret are production secrets, separate from development values.
- The frontend deploys from its own repository and workflow, independently of backend
  deploys, following the release order in Frontend Integration.

## Development Workflow & Quality Gates

- Features follow the Spec Kit flow: `/speckit-specify` → `/speckit-clarify` (when the spec is
  ambiguous) → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`, on sequentially
  numbered feature branches (`NNN-short-name`). Small fixes may skip the spec but never tests
  or review.
- Commit messages follow Conventional Commits (`feat(inbox): ...`, `fix: ...`, `docs: ...`).
- All changes reach `main` through a pull request. A PR is mergeable only when:
  - CI is green (lint, build, unit, e2e);
  - layering and validation rules hold (I, II);
  - contract changes are additive or follow expand → contract, and the Postman collection is
    updated (III);
  - new public routes are justified, role and tenant checks are in place, secrets are
    encrypted and omitted, and secret comparisons are constant-time (IV);
  - tests are added or updated (V);
  - schema changes come with a committed, backward-compatible migration (VI);
  - new environment variables are in `.env.example` and the production secret store (VIII).
- Code is formatted with Prettier and ESLint-clean. A new `eslint-disable` needs a comment
  explaining why.
- Any deviation from a principle (new dependency, bypassed layer, new datastore) is recorded
  with its justification in the plan's Complexity Tracking table.

## Governance

- This constitution supersedes conflicting practices and documents in this repository. When
  code and constitution disagree, the code is fixed or the constitution is amended; the
  conflict is never silently ignored.
- Amendments are made by a pull request that edits `.specify/memory/constitution.md`
  (through `/speckit-constitution`), updates the Sync Impact Report, propagates changes to
  `.specify/templates/*`, and lists the migration steps for code that becomes
  non-compliant. A project maintainer approves it.
- Versioning follows semantic versioning: MAJOR for removing or redefining a principle, MINOR
  for a new principle or section or materially expanded guidance, PATCH for wording and
  clarifications.
- Compliance: the Constitution Check in `/speckit-plan` MUST pass, or have each violation
  justified in Complexity Tracking, before research and again after design.
  `/speckit-analyze` treats a constitution conflict as CRITICAL. Reviewers check the PR gates
  above.
- Known non-compliant code is tracked in the Sync Impact Report follow-ups until it is fixed.
- Runtime development guidance for agents lives in `CLAUDE.md` and the current feature plan.

**Version**: 1.0.0 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-07
