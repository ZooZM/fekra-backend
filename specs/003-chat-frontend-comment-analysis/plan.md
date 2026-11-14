# Implementation Plan: Chat Flow in the Dashboard: Conversations, Per-Client Chat Workflows, Client Data and Classified Comments

**Branch**: `003-chat-frontend-comment-analysis` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/003-chat-frontend-comment-analysis/spec.md`

## Summary

The dashboard gets the chat flow:

- administrators read customer conversations and pause the assistant per conversation;
- they review every classified comment and download it for a later check of the model;
- they give each client its own chat workflow and an explicit chat-service subscription;
- they enter a client's business information, services and offers.

Most of the data is already recorded. This feature adds the screens' needs, two new controls in
the pipeline (subscription and pause), and a few fixes that would otherwise block the screens.

This repository supplies:

- **Per-client chat workflow** (US5):
  - `clients` gets `chatWorkflowEndpoint` (unique path segment) and `chatSubscribed` (R3, R4).
  - `N8N_BASE_URL` replaces `N8N_WEBHOOK_URL`, and every delivery attempt resolves
    `{base}/{endpoint}` fresh. The URL is host-pinned (R3).
  - Only subscribed clients' DMs are stored, buffered or delivered (R2). The release is a hard
    cut, with rollback (R12).
- **Fresh data on the DM path**: the DM path reads the database first, so a saved change reaches
  the next message (R1, FR-048). The 30-minute client caches remain only as a fallback when the
  database is unavailable (R16, FR-025).
- **Conversations** (US1, US2):
  - `GET /chats` and the new `GET /chats/{chatId}` return a mapped record with `clientName`,
    effective pause state and `lastExchange` (one `DISTINCT ON` query per page) (R7).
  - New `paused` filter. The existing exact `senderId` filter is the customer search.
  - `POST /chats/{chatId}/pause|resume` (ADMIN). These are the only write actions on a
    conversation; nothing in the dashboard sends a message to a customer (FR-008).
  - Pause state lives on `chats`. Expiry is computed, a sweeper records automatic resumes in
    `chat_pause_events`, and four pipeline checkpoints enforce it (R2, R5).
  - Messages that arrive during a pause are stored with `answered = false` (R6).
- **Classified comments** (US3, US4):
  - `decisionBasis` (`RULES`, `AI_MODEL`, `SAFE_FALLBACK`, `UNKNOWN`) and `decisionModel` are
    set where the pipeline decides. Filter and fields on `GET /comment-replies` (R8).
  - Streaming CSV export at `GET /comment-replies/export` (ADMIN): no row cap, a snapshot bound
    and formula-injection protection (R9).
  - Each download is recorded in `comment_export_records` (R10).
- **Client data for the dashboard** (US6): a `clientId` filter on services and offers; the
  same-client offer rule; `clientId` immutable on update; validated id params; business-info
  404 and a partial `PUT` (R11).
- **Retention** (FR-049, FR-050): a new `retention` pipeline module runs daily. It deletes
  conversations with no activity, exchanges and classified comments older than
  `RETENTION_MONTHS` (default 12), in batches, through the owning services (R15).
- **One additive migration** (data-model §9). Postman, `openapi/openapi.json`, `.env.example`
  and e2e suites are updated in the same change.

The dashboard screens are built in `fekra-dashboard` against
[contracts/dashboard-ui.md](./contracts/dashboard-ui.md).

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 22 LTS (backend). React 19 + Vite (dashboard,
separate repository).
**Primary Dependencies**:
- **Backend**: NestJS 11, Prisma 7 (pg adapter), Zod 4 + nestjs-zod, ioredis, `@nestjs/swagger`.
  CSV is written by hand and streamed with `StreamableFile`. No new dependencies.
- **Dashboard**: TanStack Query 5, Mantine 8, i18next and `openapi-fetch`, as in features 001
  and 002.

**Storage**:
- **PostgreSQL**: one additive migration.
  - New columns: `clients` (2), `chats` (4), `message_replies` (1), `comment_replies` (2).
  - New tables: `chat_pause_events`, `comment_export_records`.
  - Two new enums, eight new indexes (including the unique endpoint index), one `CHECK`
    constraint.
  - Rows older than `RETENTION_MONTHS` are deleted daily (R15).
- **Redis**: no new keys. `n8n:pending` and `n8n:dead` gain two dead-letter reasons
  (`UNSUBSCRIBED`, `NO_ENDPOINT`).

**Testing**:
- **Unit**: Jest + ts-jest, with mocked repositories, `ClientsService`, `ConfigService` and
  Redis.
- **e2e**: supertest against real PostgreSQL and Redis, with a new `fetch` stub for the n8n base
  (like `graph-stub.ts`).
- **Dashboard**: Vitest + MSW, and Playwright + axe in English and Arabic.

**Target Platform**: the existing GCP VM (Docker Compose: api, dashboard, caddy, redis,
postgres). Desktop browsers.
**Project Type**: Web service plus a single-page app, in two repositories.
**Performance Goals**:
- A list's first page in < 2 s with 10,000 rows (SC-006). Each page is 2 queries (+1 `DISTINCT
  ON` for chats) on indexed columns.
- A pause takes effect on the next pipeline check (SC-003). A timed pause ends at `paused_until`
  exactly; its audit entry appears within 30 s.
- A 100,000-row export completes with constant memory (batches of 1,000), and DM handling is not
  slowed down (SC-013).
- The DM path adds 1 indexed `SELECT` per incoming message and 1 uncached workflow read per
  batch (R1).
- The daily retention run deletes in batches of 5,000 rows, so it never holds long locks on
  tables the DM path writes to (R15).

**Constraints**:
- **Hard cut at release** (FR-047), with rollback through the previous image (R12).
- **No host change from stored data** (FR-035, SC-016).
- **No customer text in logs** above `debug` (FR-028), and none in the download record.
- **Compatibility**: changes are additive for the deployed dashboard, which uses only
  `/clients` and `/clients/:id/posts`. The tightened cases on services, offers and business info
  are listed in Complexity Tracking.

**Scale/Scope**:
- **Volume**: about 500 clients, up to 10 admins, tens of thousands of conversations and
  comments.
- **API**: 4 new operations (`GET /chats/{chatId}`, pause, resume, export). About 20 changed
  operations, most of them with additive fields or validated id params: clients, chats, the
  comment list, and services, offers and business info. The list is in
  [contracts/chat-flow-api.openapi.yaml](./contracts/chat-flow-api.openapi.yaml).
- **Dashboard**: 7 new routes and 2 changed screens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*Source: `.specify/memory/constitution.md` v1.0.0.*

| Gate | Pre-research | Post-design | Notes |
|---|---|---|---|
| **I. Feature modules** | ✅ | ✅ | Each change stays in the module that owns the table: pause and the sweeper in `conversations`, the export in `comments`, the endpoint rules in `clients`. Cross-module calls use exported services only: `inbox` → `ClientsService.findChatRoute*` and `ConversationsService`; `ServicesService` → `OffersService` (new import, no cycle). `ConversationsRepository` and `CommentsRepository` return mapped records instead of raw rows (new mappers). Raw SQL (`DISTINCT ON`, `UPDATE … RETURNING`, batched `DELETE`) stays in repositories. The new `retention` pipeline module owns no tables and calls the exported `ConversationsService` and `CommentsService`. |
| **II. Zod input contract** | ⚠️ | ✅ | Pre-research: the services, offers and business-info controllers take unvalidated `@Param` strings, and business-info `PUT` uses the create schema. Post-design these use `IdParamDto` and a new `ClientIdParamDto`, and the `PUT` uses the update schema. New schemas: chat fields (regex), `PauseChatSchema`, the `paused` and `decisionBasis` filters (`decisionBasisField` in `@common/zod/meta-fields`), the export query, and `CreateUnansweredMessageSchema`. The new JSON column `comment_export_records.filters` gets `ExportFiltersSchema` and `readExportFilters`. |
| **III. HTTP contract** | ⚠️ | ⚠️ justified | Lists stay `PaginatedResult`. All errors use the standard shape and existing codes (`INPUT_VALIDATION_ERROR`, `DUPLICATE_KEY_ERROR`, `NOT_FOUND`, `FORBIDDEN`); no new `errorCode`. Most changes are additive. Deviations, justified in Complexity Tracking: (a) the export returns `text/csv` instead of JSON; (b) `GET /business-info/client/:clientId` now answers 404 when empty; (c) business-info `PUT` becomes partial; (d) tightened validation on services and offers. Postman and `openapi/openapi.json` are updated in the same PR. |
| **IV. Security** | ✅ | ✅ | `pause`, `resume`, `export` and the client fields are ADMIN-only (method-level `@Roles('ADMIN')` overrides the class-level `ADMIN, CLIENT`, checked in `RolesGuard`). CLIENT-role reads stay scoped by `clientId` in the services, and another client's chat is 404 (FR-027). `pausedBy` is hidden from CLIENT-role readers. The endpoint is one path segment and the URL builder checks the origin (no SSRF). CSV formula injection is neutralised. The base URL and the secret stay in the environment. The download record holds no text. |
| **V. Tests** | ✅ | ✅ | Unit specs for every new or changed unit (list in research R13). e2e covers: 401 and CLIENT 403 on pause, resume, export and client fields; wrong-tenant 404; routing for 3 clients; unsubscribed → nothing stored or sent; pause, expiry and resume; CSV content and a 100,000-row stream; services, offers and business-info rules. |
| **VI. Migrations** | ✅ | ✅ | One additive migration. Every new `NOT NULL` column has a default that is also the intended value (no backfill). `chat_pause_events.chat_id` has an FK with `ON DELETE CASCADE` and an index. `chat_pause_events` is append-only, so it has no `updated_at` (same exception as `client_activities`). The previous release keeps working against the new schema (rollback, R12). |
| **VII. Async reliability** | ✅ | ✅ | The webhook handoff is unchanged. The n8n POST keeps its 5 s timeout and `N8N_MAX_ATTEMPTS`, and gains terminal dead-letter reasons for unsubscribed and missing endpoints. The pause sweeper and the daily retention run start in `onModuleInit`, stop in `onModuleDestroy`, catch and log their errors, and are safe across instances (`UPDATE … RETURNING`; idempotent deletes). Rules still run before the LLM; the basis is only recorded. No unbounded loop: the export stops at the last keyset page. A database error on the DM path falls back to the cached client data, or ends in a logged drop; recording failures never block a reply (R16, FR-025). |
| **VIII. Observability & config** | ✅ | ✅ | `N8N_BASE_URL` is validated at construction and required in production; `PAUSE_SWEEP_INTERVAL_MS`, `COMMENT_EXPORT_BATCH` and `RETENTION_MONTHS` (an integer ≥ 1, validated at boot) have defaults. All four are in `.env.example` and the production secret store, and `N8N_WEBHOOK_URL` is retired after the release. One `Logger` per class. Dropped DMs log at `warn` with IDs only, pause and resume at `log`, export start and end at `log` with the row count. No message text above `debug`. `GET /health` is unchanged. |
| **Frontend integration** | ✅ | ✅ | The deployed dashboard only gets new fields (FR-029, SC-011). New screens follow [contracts/dashboard-ui.md](./contracts/dashboard-ui.md) and branch on `errorCode` and `fieldErrors`. Release order: backend first, then the dashboard in the same window, because of the hard cut (R12). CORS and auth are unchanged. |
| **Delivery** | ✅ | ✅ | The migration runs through `prisma migrate deploy`. The only VM step is adding `N8N_BASE_URL` to the env file through the secret-store update, which the constitution requires for any new variable. The rollback path is documented (quickstart §6). |

**Result**: PASS. The II ⚠️ before research is resolved by the design. The III ⚠️ is justified
below. No unjustified violation remains.

## Project Structure

### Documentation (this feature)

```text
specs/003-chat-frontend-comment-analysis/
├── spec.md
├── plan.md                               # this file
├── research.md                           # R1–R16 decisions
├── data-model.md                         # Client, Chat, ChatPauseEvent, MessageReply, CommentReply, CommentExportRecord
├── quickstart.md                         # local run, Postman/SQL checks, release steps (hard cut)
├── contracts/
│   ├── chat-flow-api.openapi.yaml        # new and changed operations; the generated OpenAPI must match
│   └── dashboard-ui.md                   # routes, screens, errors → UI
├── checklists/requirements.md
└── tasks.md                              # created by /speckit-tasks
```

### Source Code: this repository (`fekra-backend`)

```text
src/
├── clients/
│   ├── clients.service.ts (+ .spec.ts)          # + findChatRoute(accountId), findChatRouteById(id); endpoint free + subscribe-needs-endpoint rules
│   ├── schemas/client.schema.ts (+ .spec.ts)    # + chatWorkflowEndpoint (regex), chatSubscribed; create superRefine
│   ├── schemas/client-record.schema.ts          # + both fields in the response DTO
│   ├── schemas/query-client.schema.ts           # + chatSubscribed filter
│   ├── repositories/IClientsRepository.repository.ts  # + findChatRoute*, findChatEndpointConflict, findWorkflowDataFresh
│   ├── repositories/clients.repository.impl.ts  # + the above (uncached), list filter
│   └── types/client.types.ts                    # + ChatRoute
├── inbox/
│   ├── chat-workflow-url.ts (+ .spec.ts)        # NEW buildWorkflowUrl(base, endpoint), origin-pinned
│   ├── n8n-delivery.service.ts (+ .spec.ts)     # N8N_BASE_URL; route resolved on every attempt; dead-letter reasons
│   ├── priority-inbox.service.ts (+ .spec.ts)   # message/batch checkpoints (subscription, pause); decision basis
│   ├── message-sender.service.ts (+ .spec.ts)   # paused → do not send, record unanswered; drop the per-DM client log
│   ├── n8n-callback.controller.ts (+ .spec.ts)  # secret via ConfigService + timingSafeEqual (constitution IV/VIII follow-up)
│   ├── comment-classifier.service.ts            # Classification + optional model
│   └── comment-llm-classifier.service.ts (+ .spec.ts)  # returns the model with the label
├── conversations/
│   ├── conversations.controller.ts (+ .spec.ts) # + GET :chatId, POST :chatId/pause, POST :chatId/resume (ADMIN)
│   ├── conversations.service.ts (+ .spec.ts)    # pause/resume/isPaused, createUnansweredMessage, releaseExpiredPauses, scoping, pausedBy hiding
│   ├── chat-pause.sweeper.ts (+ .spec.ts)       # NEW interval in onModuleInit/onModuleDestroy
│   ├── conversations.module.ts                  # + sweeper
│   ├── repositories/IConversationsRepository.repository.ts  # + pause, resume, events, lastExchanges, releaseExpired, findById with client
│   ├── repositories/conversations.repository.impl.ts        # + the above ($queryRaw DISTINCT ON, UPDATE … RETURNING), purgeBefore (batched)
│   ├── schemas/chat.schema.ts (+ spec)          # + paused filter, PauseChatSchema, ChatRecord response schema
│   ├── schemas/message-reply.schema.ts          # + CreateUnansweredMessageSchema, answered in the response
│   ├── mappers/chat.mapper.ts                   # NEW row → ChatRecord (effective pause, lastExchange)
│   └── types/chat.types.ts                      # NEW ChatRecord, LastExchange, PauseDuration
├── comments/
│   ├── comments.controller.ts (+ .spec.ts)      # + GET export (ADMIN, StreamableFile)
│   ├── comments.service.ts (+ .spec.ts)         # + export (record lifecycle, snapshot), basis on save
│   ├── comment-export.csv.ts (+ .spec.ts)       # NEW header, RFC 4180 escaping, BOM, formula neutralisation
│   ├── repositories/ICommentsRepository.repository.ts  # + iterate (keyset), export record start/finish
│   ├── repositories/comments.repository.impl.ts        # + the above, decisionBasis filter, clientName include, purgeBefore (batched)
│   ├── schemas/comment-reply.schema.ts (+ .spec.ts)    # + decisionBasis/decisionModel, filter, ExportCommentsQuerySchema
│   └── mappers/comment.mapper.ts                # NEW row → CommentRecord
├── services/
│   ├── services.module.ts                       # + imports OffersModule
│   ├── services.controller.ts (+ .spec.ts)      # IdParamDto
│   ├── services.service.ts (+ .spec.ts)         # same-client offer rule; clientId immutable
│   ├── schemas/query-service.schema.ts          # + clientId
│   └── repositories/services.repository.impl.ts # clientId filter, id tiebreaker
├── offers/
│   ├── offers.controller.ts (+ .spec.ts)        # IdParamDto
│   ├── offers.service.ts (+ .spec.ts)           # clientId immutable
│   ├── schemas/query-offer.schema.ts            # + clientId
│   └── repositories/offers.repository.impl.ts   # clientId filter, id tiebreaker
├── business-info/
│   ├── business-info.controller.ts (+ .spec.ts) # ClientIdParamDto; GET 404; PUT uses the update schema
│   ├── business-info.service.ts (+ .spec.ts)    # NotFoundException on empty GET; route/body clientId check
│   └── schemas/business-info.schema.ts          # + UpdateBusinessInfoBodySchema (partial + optional clientId)
├── retention/                                   # NEW pipeline module (no tables), registered in app.module.ts
│   ├── retention.module.ts                      # imports ConversationsModule, CommentsModule
│   └── retention.service.ts (+ .spec.ts)        # RETENTION_MONTHS (validated), daily run, cutoff, counts logged
└── common/zod/
    ├── primitives.ts                            # + ClientIdParamSchema
    ├── dtos.ts                                  # + ClientIdParamDto
    ├── meta-fields.ts (+ .spec.ts)              # + decisionBasisField
    ├── json-columns.schema.ts                   # + ExportFiltersSchema
    └── json-readers.ts                          # + readExportFilters

prisma/
├── schema.prisma                                # see data-model.md
└── migrations/<ts>_chat_workflow_pause_export/  # additive (data-model §9)

test/
├── chat-workflow.e2e-spec.ts                    # NEW routing, subscription gate, endpoint change, dead-letter
├── conversations.e2e-spec.ts                    # NEW list/detail/messages, filters, tenant 404, 50-exchange order
├── chat-pause.e2e-spec.ts                       # NEW pause/resume/expiry, unanswered exchanges, roles, tenant 404
├── comment-replies.e2e-spec.ts                  # NEW list filters incl. decisionBasis, range 422, tenant
├── comments-export.e2e-spec.ts                  # NEW CSV, filters, 100k stream, formula prefix, record, roles
├── client-data.e2e-spec.ts                      # NEW services/offers/business-info rules
├── retention.e2e-spec.ts                        # NEW back-dated rows, one run (SC-021)
├── lists-performance.e2e-spec.ts                # NEW 10,000-row first pages < 2 s (SC-006)
├── clients-admin.e2e-spec.ts                    # + chat fields: rules, conflicts, filter, activity names
└── utils/n8n-stub.ts                            # NEW fetch stub for N8N_BASE_URL (+ e2e-env.ts sets it)

openapi/openapi.json                             # regenerated (npm run openapi:export)
.env.example                                     # N8N_BASE_URL (replaces N8N_WEBHOOK_URL), PAUSE_SWEEP_INTERVAL_MS, COMMENT_EXPORT_BATCH, RETENTION_MONTHS
postman/collections/Social Inbox Automation API/
├── Clients/Update Client.request.yaml           # chat fields example, 409/422 docs
├── Clients/List Clients.request.yaml            # chatSubscribed filter
├── Conversations/                               # NEW folder: List Chats, Get Chat, List Chat Messages, Pause Chat (ADMIN), Resume Chat (ADMIN)
├── Comments/                                    # NEW folder: List Classified Comments, Export Comments CSV (ADMIN)
├── Services/List Services.request.yaml          # clientId
├── Offers/List Offers.request.yaml              # clientId
└── Business Info/Get|Update Business Info By Client.request.yaml   # 404, partial PUT
```

### Source Code: `fekra-dashboard` (separate repository)

```text
src/
├── api/schema.d.ts                       # regenerated from openapi/openapi.json
├── app/navigation.tsx                    # + Conversations, Comments (admin)
├── features/clients/
│   ├── clients-list.tsx                  # + Chat service column, "Only not subscribed" switch
│   ├── client-form.tsx                   # + Chat service section (endpoint, subscription)
│   └── client-tabs.tsx                   # Details · Business info · Services · Offers · Posts
├── features/client-data/
│   ├── business-info-page.tsx            # 404 → create, PUT full form
│   ├── services-page.tsx, service-form.tsx
│   ├── offers-page.tsx, offer-form.tsx, delete-offer-dialog.tsx
│   └── queries.ts
├── features/conversations/
│   ├── conversations-page.tsx            # filters, exact search, load more, refresh
│   ├── conversation-row.tsx
│   ├── conversation-page.tsx             # header, thread (load earlier), pause banner
│   ├── pause-dialog.tsx
│   └── queries.ts
├── features/comments/
│   ├── comments-page.tsx                 # filters, total, expand, decided-by
│   ├── download-csv.ts                   # authenticated fetch, stream/blob, failure handling
│   └── queries.ts
├── i18n/ en.json, ar.json
└── test/ msw handlers
e2e/ conversations.spec.ts, comments.spec.ts, client-data.spec.ts, chat-service.spec.ts   # Playwright + axe (en, ar)
```

**Structure Decision**: Backend changes stay in the existing feature modules that own each table
(`clients`, `conversations`, `comments`, `services`, `offers`, `business-info`). The pipeline
checks stay in `inbox`. No new module is needed. The dashboard work goes in `fekra-dashboard`, by
feature folder, sharing the contract through `openapi/openapi.json`.

## Delivery Order

Each story ships its backend first, then its dashboard part (constitution release order). The
order matches the "Implementation Strategy" section of tasks.md:

1. **Foundation**:
   - the migration and Prisma schema;
   - the shared Zod pieces;
   - `.env.example`, `n8n-stub.ts` and `e2e-env.ts`.

   The migration is additive and blocks nothing on its own.
2. **US1** conversations (read only), then deploy the backend and the dashboard. This is the MVP.
3. **US2** pause, then deploy.
4. **US3** comment review, then **US4** decision basis and CSV export, then deploy.
5. **US6** client data screens and the services, offers and business-info fixes, then deploy.
6. **Retention** (FR-049), then deploy. With 12 months it deletes nothing yet.
7. **US5 last, in one release window**:
   - the backend: client fields, `findChatRoute*`, the URL builder, the delivery change and the
     inbox checkpoints;
   - its dashboard form and list, deployed together with the backend;
   - then subscribe every client (quickstart §6).

   This step is the hard cut, so it stays out of the earlier releases.
8. **Contract**: `openapi:export` and the Postman requests are done inside each story, and checked
   again in Polish.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `GET /comment-replies/export` returns `text/csv`, not JSON or `PaginatedResult` | FR-024: a file that opens in spreadsheet and data tools, with no row limit (clarification) and constant memory for 100,000 rows (SC-013) | A JSON array would have to be converted in the browser and held in memory. Paging the JSON list to build the file client-side makes the row count depend on rows arriving between pages (FR-024 requires the count to match) |
| Changed status: `GET /business-info/client/:clientId` answers `404 NOT_FOUND` instead of an empty `200` | The dashboard needs a clear "none yet" signal (US6-1). An empty body is not valid JSON for the generated client | Keeping the empty 200 would mean special-casing an empty body in the shared API layer. The only current consumer is the Postman request, updated in the same PR |
| Changed body: `PUT /business-info/client/:clientId` takes the partial update schema (`clientId` optional, must match the route) | Today it requires `clientId` in the body and resets every omitted array to `[]`, which can wipe data. That is the bug a form-driven client would trigger (R11) | Keeping the create schema for `PUT` keeps the data-loss behavior. Bodies that send every field (Postman, the dashboard) behave the same as before |
| Tightened validation on services and offers: malformed `:id` → 422; changing `clientId` on update → 422; a foreign or unknown `offerId` → 422 | Constitution II (UUID params) and the data rule "a service's offer belongs to the same client" (FR-039), which exists only as a code comment today. Moving a record to another client is never valid | Leaving it means a dashboard bug or a hand-made request could link one business's offer to another's service and leak prices into the wrong chat. Requests with the same `clientId` are still accepted. Only Postman uses these routes today |
| A DM-path read that goes to the database before the existing 30-minute Redis cache (the cache stays as an outage fallback, R16) | FR-046 and FR-048 need the next message to use saved data (R1) | Deleting cache keys on write races with readers, and versioned keys add a counter and a map for a low-traffic path |
