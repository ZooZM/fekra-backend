---

description: "Task list for 003-chat-frontend-comment-analysis"
---

# Tasks: Chat Flow in the Dashboard: Conversations, Per-Client Chat Workflows, Client Data and Classified Comments

**Input**: Design documents from `specs/003-chat-frontend-comment-analysis/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED by Constitution Principle V (non-negotiable). In every phase, test tasks come
first and MUST fail before the implementation tasks start.

- **Backend unit specs** mock their dependencies (`jest.fn()`, `src/test-mocks/`) and never touch
  a real database, Redis, Meta Graph API, Gemini or n8n.
- **Backend e2e specs** use supertest against real PostgreSQL and Redis
  (`test/utils/e2e-app.ts`). n8n is stubbed by `test/utils/n8n-stub.ts` (T003) and Meta by
  `test/utils/graph-stub.ts`. DMs and comments are fed in with
  `app.get(PriorityInboxService).push(item)`, and tests poll the database until the item is
  handled (no fixed sleeps).
- **Dashboard tests** use Vitest + MSW (`fekra-dashboard/src/test/handlers.ts`). Its Playwright
  specs mock the API with `page.route` and run axe in English and Arabic.

**Organization**: Tasks are grouped by user story (US1–US6 from spec.md, in priority order). Data
retention (FR-049, FR-050) is cross-cutting and has its own phase before Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1–US6)

## Path Conventions

- **This repository (`fekra-backend`)**: paths are relative to its root (`src/…`, `prisma/…`,
  `test/…`, `postman/…`).
- **Dashboard**: the sibling repository `E:\zeyad\fekra-dashboard`, written `fekra-dashboard/…`.
  Its client edit route is `/clients/:id/edit` and the form lives in
  `fekra-dashboard/src/features/clients/client-form/`.
- **Decisions**: "R7" means research.md R7, "§2" means data-model.md §2. Shapes and error codes
  come from [contracts/chat-flow-api.openapi.yaml](./contracts/chat-flow-api.openapi.yaml) and
  [contracts/dashboard-ui.md](./contracts/dashboard-ui.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration and the test helper the e2e suites of this feature use.

- [ ] T001 [P] Update .env.example:
  - in the `# --- n8n ---` block, replace `N8N_WEBHOOK_URL=` with `N8N_BASE_URL=` and a comment
    "Fixed base address of the n8n chat workflows; each client's endpoint is appended (required
    in production)";
  - under the inbox variables, add `PAUSE_SWEEP_INTERVAL_MS=30000` ("how often expired pauses are
    recorded"), `COMMENT_EXPORT_BATCH=1000` ("rows per database read while exporting comments") and
    `RETENTION_MONTHS=12` ("customer messages and comments older than this are deleted daily,
    minimum 1").

  Research R3, R5, R9, R15.
- [ ] T002 [P] In test/utils/e2e-env.ts set only the values that cannot change the existing suites:
  - `N8N_BASE_URL = 'http://n8n.e2e.test/webhook/'` and `N8N_WEBHOOK_SECRET ??= 'e2e-n8n-secret'`;
  - `PAUSE_SWEEP_INTERVAL_MS = '3600000'`, so tests call the sweeper themselves;
  - `RETENTION_MONTHS = '12'`.

  The pipeline speed settings (`DM_WINDOW_SEC='1'`, `DISPATCH_INTERVAL_MS='100'`,
  `COMMENT_LLM_MAX_ATTEMPTS='1'`) are **not** global: each new suite that needs them sets them at
  the top of its own file, before `createE2eApp()`. test/backfill-runs.e2e-spec.ts sends comments
  through the LLM path and must keep today's values. After this task, run
  `npm run test:e2e -- backfill-runs` and confirm it is unchanged.
- [ ] T003 [P] Create test/utils/n8n-stub.ts, modelled on test/utils/graph-stub.ts. It exports:
  - `stubN8n(handler?: (url: URL, body: unknown) => { status?: number } | undefined)`: wraps the
    **current** `global.fetch`, so it works together with `stubGraph`. Requests whose origin
    equals `new URL(process.env.N8N_BASE_URL).origin` are recorded and answered with the handler's
    status (default 200, body `{}`). Every other URL goes to the wrapped fetch.
  - `n8nCalls(): { url: string; body: any; headers: Record<string, string> }[]`.
  - `restoreN8n()`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one additive migration and the shared Zod pieces that several stories use.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Edit prisma/schema.prisma exactly as data-model.md §1–§6:
  - `Client`: `chatWorkflowEndpoint String? @unique @map("chat_workflow_endpoint")
    @db.VarChar(100)` and `chatSubscribed Boolean @default(false) @map("chat_subscribed")`.
  - `Chat`: `pausedAt`, `pausedUntil` (`DateTime?`), `pausedById` (`String? @db.Uuid`),
    `pausedByName` (`String? @db.VarChar(255)`), all mapped to snake_case; `pauseEvents
    ChatPauseEvent[]`; `@@index([updatedAt])` and `@@index([pausedUntil])`.
  - New enum `ChatPauseAction { PAUSED RESUMED }` and model `ChatPauseEvent` (§3) with a relation
    to `Chat` (`onDelete: Cascade`), `@@index([chatId, createdAt])`, `@@map("chat_pause_events")`.
  - `MessageReply`: `answered Boolean @default(true)` and `@@index([createdAt])`.
  - New enum `CommentDecisionBasis { RULES AI_MODEL SAFE_FALLBACK UNKNOWN }`. `CommentReply`:
    `decisionBasis CommentDecisionBasis @default(UNKNOWN) @map("decision_basis")`,
    `decisionModel String? @map("decision_model") @db.VarChar(100)`, `@@index([createdAt, id])`.
  - New model `CommentExportRecord` (§6), `@@map("comment_export_records")`, with
    `@@index([actorId])` and `@@index([createdAt])`.
  - Update the comment above `model Chat` that says "decide a retention period": it is now
    `RETENTION_MONTHS` (FR-049).
- [ ] T005 Run `npx prisma migrate dev --create-only --name chat_workflow_pause_export`. In the
  generated prisma/migrations/<ts>_chat_workflow_pause_export/migration.sql, append:

  ```sql
  ALTER TABLE "clients" ADD CONSTRAINT "clients_chat_subscription_needs_endpoint"
    CHECK (NOT "chat_subscribed" OR "chat_workflow_endpoint" IS NOT NULL);
  ```

  Then apply it with `npx prisma migrate dev` and run `npx prisma generate`.
  - Check that the SQL only creates types, tables and indexes and adds columns that are nullable or
    have a default, with no `DROP` (data-model §9, constitution VI).
  - Run `npm run build` and fix any compile error from the regenerated client. There should be
    none: every new column is optional or has a default.
- [ ] T006 [P] Create src/common/zod/meta-fields.spec.ts. These tests MUST fail before T007:
  - `decisionBasisField` accepts `rules`, `AI_MODEL`, ` safe_fallback ` and `Unknown`, and outputs
    `RULES`, `AI_MODEL`, `SAFE_FALLBACK` and `UNKNOWN`;
  - it rejects `ai-model` and `model`;
  - add a check of the existing `classificationField`, which has no test today.
- [ ] T007 In src/common/zod/meta-fields.ts add `decisionBasisField`, following
  `classificationField`: lowercase input enum `['rules','ai_model','safe_fallback','unknown']` →
  `CommentDecisionBasis`. Use a `satisfies Record<Lowercase<CommentDecisionBasis>, …>` map so a new
  enum value fails to compile.
- [ ] T008 [P] Add tests to src/common/zod/primitives.spec.ts for `ClientIdParamSchema`: it
  accepts `{ clientId: <uuid> }`, rejects a non-UUID and rejects extra keys. They MUST fail
  before T009.
- [ ] T009 Add `ClientIdParamSchema = z.strictObject({ clientId: z.uuid() })` to
  src/common/zod/primitives.ts and `ClientIdParamDto` to src/common/zod/dtos.ts.
- [ ] T010 [P] Create src/common/zod/json-readers.spec.ts for `readExportFilters`:
  - a valid object round-trips (dates as ISO strings);
  - an invalid stored value falls back the same way the other readers do. Read
    src/common/zod/json-readers.ts for the existing `reader(...)` behavior and mirror it.

  These tests MUST fail before T011.
- [ ] T011 Add `ExportFiltersSchema` to src/common/zod/json-columns.schema.ts: `z.strictObject({
  clientId?: uuid, platform?, classification?, decisionBasis?, commentId?, from?: iso datetime,
  to?: iso datetime, snapshotAt: iso datetime })`. Store the enums as their database values. Add
  the type `ExportFilters`, and `readExportFilters` to src/common/zod/json-readers.ts.

**Checkpoint**: Migration applied, client regenerated, shared Zod pieces tested. Stories can start.

---

## Phase 3: User Story 1 - Browse customer conversations (Priority: P1) 🎯 MVP

**Goal**: Administrators list conversations (newest activity first, with a latest-exchange
preview, client name and pause badge), filter by platform, client and pause state, search by
exact customer identifier, and read a conversation's exchanges.

**Independent Test**: Seed a client with a conversation of 3 exchanges. `GET /chats` lists it
with `lastExchange`, and `GET /chats/{id}/messages?orderDir=asc` returns the 3 exchanges in order.
In the dashboard, `/conversations` and `/conversations/:chatId` show the same (quickstart §3
row 7).

### Tests for User Story 1 (REQUIRED - Constitution Principle V) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T012 [P] [US1] Extend src/conversations/schemas/reply-schemas.spec.ts:
  - `QueryChatSchema` accepts `paused=true|false` (→ boolean), trims `senderId`, and rejects
    `paused=yes`;
  - the default order stays `updatedAt desc`.
- [ ] T013 [P] [US1] Create src/conversations/mappers/chat.mapper.spec.ts for
  `toChatRecord(row, lastExchange, { isAdmin, now })`:
  - **paused**: `pausedAt` set and `pausedUntil` null → `paused: true`; `pausedUntil` in the
    future → paused; `pausedUntil` in the past → `paused: false`, and `pausedAt`, `pausedUntil` and
    `pausedBy` are all `null`;
  - **pausedBy**: `{ id, name }` only when `isAdmin`, else `null`;
  - **clientName**: comes from `row.client.name`;
  - **lastExchange**: `null` when missing; otherwise the message and reply are passed through
    (already cut to 200 characters by SQL) with `answered`.
- [ ] T014 [P] [US1] Extend src/conversations/conversations.service.spec.ts (mock
  `IConversationsRepository`):
  - **`findAll`**: the ADMIN `clientId` filter is passed through; a CLIENT user is scoped to their
    own `clientId`. It calls `repo.lastExchanges(pageIds)` once per page and maps the rows with
    `toChatRecord`.
  - **`findOne`**: returns the mapped record; a missing chat or another client's chat →
    `NotFoundException`.
  - **`findMessages`**: unchanged scoping; items include `answered`.
- [ ] T015 [P] [US1] Create src/conversations/conversations.controller.spec.ts:
  - `findAll`, `findOne` and `findMessages` delegate with `@CurrentUser`;
  - class-level `ROLES` metadata is `['ADMIN','CLIENT']` (read with `Reflector`, as in
    src/clients/clients.controller.spec.ts).
- [ ] T016 [P] [US1] Create test/conversations.e2e-spec.ts. Setup: an ADMIN, a CLIENT user linked
  to client A, and clients A and B, each with chats and `message_replies` created through Prisma.
  Cases:
  - **Access**: 401 without a token.
  - **Admin list**: an ADMIN sees both clients' chats ordered by `updatedAt desc`, with
    `clientName`, `paused: false` and `lastExchange` (the newest exchange, a 300-character message
    cut to 200).
  - **Filters**: `senderId` (exact, spaces trimmed) and `platform` filter correctly; an unknown
    `senderId` gives an empty `data` with `meta.total: 0`.
  - **Tenant**: the CLIENT user sees only client A, and `GET /chats/{chatOfB}` → 404 `NOT_FOUND`.
  - **Thread order**: `GET /chats/{id}/messages?orderDir=asc` with 50 seeded exchanges returns
    them in order with identical text (SC-002), each with `answered: true`.
  - **Empty chat**: a chat with no exchange has `lastExchange: null`.

### Implementation for User Story 1

- [ ] T017 [P] [US1] Create src/conversations/types/chat.types.ts:
  - `LastExchange { message; reply; answered; createdAt }`;
  - `ChatRecord` (data-model §8);
  - `ChatRowWithClient = Prisma.ChatGetPayload<{ include: { client: { select: { id: true; name:
    true } } } }>`.
- [ ] T018 [P] [US1] In src/conversations/schemas/chat.schema.ts:
  - extend `QueryChatSchema` with `paused: z.enum(['true','false']).transform(v => v ===
    'true').optional()`;
  - add the response schemas `ChatRecordSchema`, `ChatPageSchema` (contract `ChatRecord`,
    `ChatPage`) and the DTOs `ChatRecordDto`, `ChatPageDto`.
- [ ] T019 [P] [US1] In src/conversations/schemas/message-reply.schema.ts add the response schemas
  `ExchangeRecordSchema` (with `answered`), `ExchangePageSchema` and the DTO `ExchangePageDto`.
- [ ] T020 [US1] Create src/conversations/mappers/chat.mapper.ts with `isEffectivelyPaused(chat,
  now)` (R5 rule) and `toChatRecord(...)`, to pass T013.
- [ ] T021 [US1] Repository changes in src/conversations/repositories/IConversationsRepository.repository.ts
  and conversations.repository.impl.ts:
  - **`findAll`**: adds `include: { client: { select: { id, name } } }`. When `paused` is set, the
    where clause adds the effective-pause condition (`pausedAt not null AND (pausedUntil null OR
    pausedUntil > now)`, or its negation).
  - **`findById(chatId, clientId?)`**: includes the client.
  - **New `lastExchanges(chatIds: string[]): Promise<Map<string, LastExchange>>`**: one
    `$queryRaw` with `SELECT DISTINCT ON (chat_id) chat_id, left(message, 200) AS message,
    left(reply, 200) AS reply, answered, created_at FROM message_replies WHERE chat_id =
    ANY(${ids}::uuid[]) ORDER BY chat_id, created_at DESC, id DESC`. It returns an empty map for
    an empty list and does no query (R7).
  - **`findMessages`**: returns `answered`.
- [ ] T022 [US1] In src/conversations/conversations.service.ts:
  - `findAll` and `findMessages` return mapped records (T020, T021);
  - add `findOne(chatId, user)`, which throws `NotFoundException('Conversation not found')`;
  - pass `isAdmin = user.roles.includes('ADMIN')` to the mapper.
- [ ] T023 [US1] In src/conversations/conversations.controller.ts:
  - add `@Get(':chatId')` (`ChatIdParamDto`, `@ApiOkResponse({ type: ChatRecordDto })`);
  - set the response types `ChatPageDto` and `ExchangePageDto` on the existing routes.

  Run `npm run openapi:export`.

### Dashboard for User Story 1 (`fekra-dashboard`)

- [ ] T024 [US1] Run `npm run api:types` in fekra-dashboard (after T023) and commit
  fekra-dashboard/src/api/schema.d.ts.
- [ ] T025 [P] [US1] Add conversation fixtures and handlers:
  - fekra-dashboard/src/test/fixtures/conversations.ts: a page with a paused row, an unanswered
    last exchange, an Arabic message and a chat with `lastExchange: null`;
  - MSW handlers for `GET /chats`, `GET /chats/:chatId` and `GET /chats/:chatId/messages` in
    fekra-dashboard/src/test/handlers.ts.
- [ ] T026 [P] [US1] Create fekra-dashboard/src/features/conversations/queries.ts (+ queries.test.ts):
  - `useConversations(filters)`: infinite, 20 per page, `meta.page < meta.totalPages`;
  - `useConversation(chatId)`;
  - `useExchanges(chatId)`: infinite, `orderDir=desc`, reversed for display.

  Filters come from the URL search params (`platform`, `clientId`, `paused`, `senderId`).
- [ ] T027 [US1] Create the list in fekra-dashboard/src/features/conversations/:
  conversations-page.tsx, conversation-row.tsx and conversations-page.test.tsx, as
  contracts/dashboard-ui.md "Conversations list":
  - filters, the exact search box (trimmed), **Load more** and **Refresh**;
  - each row shows the platform icon, client name, customer identifier, relative time,
    message and reply previews (`dir="auto"`), and "Not answered" / "No exchange recorded yet";
  - states: empty, "No conversation found for this identifier", loading skeleton.

  Tests cover each of these states and the filter → URL sync.
- [ ] T028 [US1] Create fekra-dashboard/src/features/conversations/conversation-page.tsx (+
  conversation-page.test.tsx): header (client, platform, identifier), thread oldest-at-top with
  **Load earlier**, bubbles with `white-space: pre-wrap` and `dir="auto"`, "Not answered by the
  assistant" for `answered: false`, and a 404 state with a link back (FR-003 to FR-006).
- [ ] T029 [US1] Wire the routes and navigation:
  - add `conversations` and `conversations/:chatId` under the admin routes in
    fekra-dashboard/src/app/router.tsx;
  - add a **Conversations** link in fekra-dashboard/src/components/app-shell.tsx;
  - add every new string to fekra-dashboard/src/i18n/en.json and ar.json, then run
    `npm run i18n:check`.
- [ ] T030 [US1] Create fekra-dashboard/e2e/conversations-us1.spec.ts:
  - search by identifier → open the thread → the latest exchange is visible (SC-001);
  - load earlier, filters, the empty state;
  - an axe check in English and Arabic.

**Checkpoint**: Conversations are readable end to end (MVP).

---

## Phase 4: User Story 2 - Pause the assistant for one conversation (Priority: P2)

**Goal**: Administrators pause a conversation for a chosen duration or until resumed. While it is
paused, nothing is sent and new messages are stored as not answered. Resuming, by an
administrator or when a timed pause ends, restarts replies for new messages only. Every change is
recorded.

**Independent Test**: Pause a test chat for 1 h and push 3 DMs: no n8n call, 3 exchanges with
`answered: false`. Resume, push 1 DM: it reaches n8n. Back-date a timed pause and run the sweeper:
an automatic `RESUMED` event (quickstart §3 rows 8–10).

### Tests for User Story 2 (REQUIRED - Constitution Principle V) ⚠️

- [ ] T031 [P] [US2] Extend src/conversations/schemas/reply-schemas.spec.ts:
  - `PauseChatSchema` accepts only `until_resumed|1h|24h|7d` and rejects extra keys;
  - `CreateUnansweredMessageSchema` requires `chatId` and a non-empty `message`, and strips NUL.
- [ ] T032 [P] [US2] Extend src/conversations/conversations.service.spec.ts:
  - **`pause`**:
    - each duration's `until`: `null`, now + 1 h, + 24 h, + 7 d (use jest fake timers for `now`);
    - pausing an already paused chat replaces `until` and writes a new event;
    - the actor `{id,name}` is passed to `repo.pause`;
    - a missing chat → `NotFoundException`.
  - **`resume`**: on a paused chat it calls `repo.resume(actor)`. On an active chat (including an
    expired timed pause) it returns the record and does **not** call the repository.
  - **`isPaused(chat)`**: delegates to `isEffectivelyPaused`.
  - **`createUnansweredMessage`**: parses with the schema.
  - **`releaseExpiredPauses`**: returns the repository count.
- [ ] T033 [P] [US2] Create src/conversations/chat-pause.sweeper.spec.ts:
  - `onModuleInit` starts an interval from `PAUSE_SWEEP_INTERVAL_MS` (default 30000);
  - each tick calls `conversations.releaseExpiredPauses()`;
  - an error is caught and logged with `error`, and the next tick still runs;
  - `onModuleDestroy` clears the interval.
- [ ] T034 [P] [US2] Extend src/conversations/conversations.controller.spec.ts:
  - `pause` passes `chatId`, the parsed body and the actor; `resume` passes `chatId` and the
    actor;
  - both have method-level `ROLES` metadata `['ADMIN']`.
- [ ] T035 [P] [US2] Extend src/inbox/priority-inbox.service.spec.ts with the pause paths (R2
  checkpoints 1–2, R6, R16). Mock `ConversationsService.findOrCreate` to return a chat, and `isPaused`.
  - **Message, paused**: `createUnansweredMessage` with the text; attachments stored as `[image]`
    and `[voice message]` with **no** call to `AttachmentHandlerService`; no `dmBuffer.add`.
  - **Message, not paused**: unchanged flow.
  - **Batch, paused**: the messages are joined with `\n` into one unanswered exchange, and
    `delivery.send` is not called.
  - **Chat read error**: `findOrCreate` throws → handled as not paused, with a `warn` log (fail
    open).
  - **Recording error**: `createUnansweredMessage` throws → logged with `error`, and nothing is
    thrown out of `handle` (FR-025).
- [ ] T036 [P] [US2] Extend src/inbox/message-sender.service.spec.ts:
  - **Paused** (`conversations.isPaused` true after a fresh `findOrCreate`): no `graph.post`;
    `createUnansweredMessage` with the batch text; nothing recorded as answered.
  - **Not paused**: unchanged.
  - **Chat read error**: send anyway, with a `warn` log (R16).
- [ ] T037 [P] [US2] Create test/chat-pause.e2e-spec.ts (`stubN8n`, `stubGraph`). At the top of the
  file set `DM_WINDOW_SEC='1'` and `DISPATCH_INTERVAL_MS='100'` (T002). Use a client
  with an encrypted token, and a chat created by pushing one DM.
  - **Access**: pause and resume → 401 without a token, 403 for a CLIENT user, 404 for an unknown
    chat, 422 for `duration: '2h'`.
  - **Pause**: `POST /chats/{id}/pause {duration:'1h'}` → 200 with `paused: true` and
    `pausedUntil` ≈ now + 1 h; a `chat_pause_events` row `PAUSED` with the admin's name.
  - **While paused**: push 3 DMs → after processing, `n8nCalls()` is empty and there are 3
    `message_replies` rows with `answered = false` (SC-003).
  - **Resume**: `POST …/resume` → `paused: false`, event `RESUMED` with the actor. Push 1 DM →
    exactly one n8n call (SC-004).
  - **Timed expiry**: pause `1h`, then `UPDATE chats SET paused_until = now() - interval '1
    minute'`. The chat reads `paused: false` immediately. After
    `app.get(ConversationsService).releaseExpiredPauses()`, there is an event `RESUMED` with
    `actor_id IS NULL`, and its `created_at` equals the old `paused_until`.
  - **Callback while paused**: a DM delivered to n8n, then the chat is paused, then the n8n
    callback arrives (`POST /n8n/callback` with the secret) → no Graph send, and an unanswered
    exchange is stored.
  - **List filter**: `GET /chats?paused=true` returns only paused chats.
  - **Other conversations**: while chat A is paused, a DM from another customer of the same client
    produces exactly one n8n call (FR-015, US2-5).

### Implementation for User Story 2

- [ ] T038 [P] [US2] Add pause types and schemas:
  - in src/conversations/types/chat.types.ts: `PauseDuration = 'until_resumed'|'1h'|'24h'|'7d'`
    and `PAUSE_DURATION_MS` (`until_resumed` → null);
  - in src/conversations/schemas/chat.schema.ts: `PauseChatSchema = z.strictObject({ duration:
    z.enum([...]) })`, `PauseChatDto` and `PauseChatInput`.
- [ ] T039 [P] [US2] In src/conversations/schemas/message-reply.schema.ts add
  `CreateUnansweredMessageSchema = z.strictObject({ chatId: z.uuid(), message:
  storableText(MAX_MESSAGE_LENGTH) })` and its type.
- [ ] T040 [US2] Repository additions in IConversationsRepository.repository.ts and
  conversations.repository.impl.ts:
  - **`pause(chatId, until, duration, actor)`**: in one `$transaction`, updates the four pause
    columns and creates a `ChatPauseEvent { action: PAUSED, duration, until, actorId, actorName }`.
    Returns the chat with its client.
  - **`resume(chatId, actor)`**: clears the columns and creates `RESUMED` with the actor, in one
    transaction.
  - **`releaseExpiredPauses()`**: in one interactive transaction, run `$queryRaw` `UPDATE chats SET
    paused_at = NULL, paused_until = NULL, paused_by_id = NULL, paused_by_name = NULL WHERE
    paused_until IS NOT NULL AND paused_until <= now() RETURNING id, paused_until`, then
    `chatPauseEvent.createMany` with `RESUMED`, no actor, `createdAt = paused_until`. Returns the
    count (R5).
  - **`createUnansweredMessage({chatId, message})`**: creates a `MessageReply` with `reply: ''`
    and `answered: false`.
- [ ] T041 [US2] In src/conversations/conversations.service.ts add `pause(chatId, input, actor)`
  (scoped `findById`, then `until` from `PAUSE_DURATION_MS`), `resume(chatId, actor)` (no-op when
  not effectively paused), `isPaused(chat)`, `createUnansweredMessage(input)` and
  `releaseExpiredPauses()`, to pass T032. Log pause and resume at `log` with IDs only.
- [ ] T042 [US2] Create src/conversations/chat-pause.sweeper.ts (`OnModuleInit`/`OnModuleDestroy`,
  `ConfigService`, `Logger`), to pass T033. Register it in src/conversations/conversations.module.ts.
- [ ] T043 [US2] In src/conversations/conversations.controller.ts add `@Post(':chatId/pause')` and
  `@Post(':chatId/resume')`. Both use `@HttpCode(200)` and `@Roles('ADMIN')` at method level, and
  get the actor from `@CurrentUser()` (`{ id, name, email }`). Response type `ChatRecordDto`.
- [ ] T044 [US2] In src/inbox/priority-inbox.service.ts, implement the pause half of checkpoints 1
  and 2 (R2, R6, R16), to pass T035:
  - **`message`**: after `findOrCreate` (keep it inside its try/catch), if
    `conversations.isPaused(chat)` → store each text and each attachment placeholder as an
    unanswered exchange (catch and log) and `return` before buffering or attachment processing.
  - **`batch`**: find the chat (same keys) and, if paused, store the joined text as one unanswered
    exchange and skip `delivery.send`.
  - On a chat read error: `warn` and continue as not paused.
- [ ] T045 [US2] In src/inbox/message-sender.service.ts implement checkpoint 4, to pass T036. Before
  the Graph loop, `findOrCreate` the chat and check `isPaused`. When paused, store the batch as
  unanswered and return without sending. Reuse the chat for the existing recording step. Also
  delete the line `this.logger.log(req.client)`: it logs the whole client data at `log` level on
  every DM (constitution VIII).

### Dashboard for User Story 2 (`fekra-dashboard`)

- [ ] T046 [US2] Run `npm run openapi:export` in the backend and `npm run api:types` in
  fekra-dashboard. Add MSW handlers for `POST /chats/:chatId/pause` and `/resume` in
  fekra-dashboard/src/test/handlers.ts.
- [ ] T047 [P] [US2] Create fekra-dashboard/src/features/conversations/pause-dialog.tsx (+
  pause-dialog.test.tsx):
  - a radio group (Until I resume · 1 hour · 24 hours · 7 days), confirm and cancel;
  - focus is trapped and returns to the trigger;
  - it calls a `usePauseConversation` mutation, added to queries.ts, that invalidates the
    conversation and the list.
- [ ] T048 [US2] In fekra-dashboard/src/features/conversations/conversation-page.tsx (+ test) add the
  pause control from contracts/dashboard-ui.md "Pause control":
  - **active**: a **Pause assistant** button;
  - **paused**: a `role="status"` banner with `pausedBy.name`, `pausedAt`, and `pausedUntil` or
    "until you resume it", plus **Resume** and **Change duration**;
  - a past `pausedUntil` renders as active.
- [ ] T049 [US2] In conversation-row.tsx and conversations-page.tsx (+ test) add the **Paused** badge
  ("until 18:30" / "until resumed") and the **Only paused** switch (`paused=true` in the URL).
- [ ] T050 [US2] Create fekra-dashboard/e2e/conversations-us2.spec.ts: pause with 24 hours → banner
  and badge; change duration; resume; keyboard-only flow; axe in English and Arabic.

**Checkpoint**: US1 and US2 work together. Pausing stops replies and is recorded.

---

## Phase 5: User Story 3 - Review every classified comment (Priority: P3)

**Goal**: Administrators list every classified comment, newest first, with its label, decision
basis, reason, platform, client and time. They filter by label, decision basis, platform, client
and date, and see the total.

**Independent Test**: Seed one comment of each label (with mixed decision bases) for two clients.
`GET /comment-replies?classification=complaint&decisionBasis=rules` returns exactly the matching
rows with `clientName`, and `meta.total` matches. The dashboard `/comments` shows the same.

### Tests for User Story 3 (REQUIRED - Constitution Principle V) ⚠️

- [ ] T051 [P] [US3] Create src/comments/schemas/comment-reply.schema.spec.ts:
  - `QueryCommentReplySchema` accepts `decisionBasis=ai_model` (→ `AI_MODEL`) and rejects
    `decisionBasis=x`;
  - `to` before `from` → an issue on `to`;
  - unknown keys are rejected;
  - add tests for the existing `SaveCommentReplySchema`: an empty comment is allowed, and
    `classification: 'inquiry'` → `INQUIRY`.
- [ ] T052 [P] [US3] Create src/comments/mappers/comment.mapper.spec.ts: `toCommentRecord(row)`
  copies every field, sets `clientName` from `row.client.name`, and keeps `decisionBasis` and
  `decisionModel` (`null` → `null`).
- [ ] T053 [P] [US3] Extend src/comments/comments.service.spec.ts:
  - `findAll` maps the rows with `toCommentRecord`;
  - the ADMIN `clientId` is passed through and a CLIENT user is scoped;
  - `decisionBasis` is passed to the repository.
- [ ] T054 [P] [US3] Create test/comment-replies.e2e-spec.ts. Seed through Prisma: clients A and B,
  comments of every label, with `decisionBasis` RULES, AI_MODEL (`decisionModel` set),
  SAFE_FALLBACK and UNKNOWN. Cases:
  - **Access**: 401 without a token.
  - **Admin list**: an ADMIN sees all comments, newest first, each with `clientName`.
  - **Filters**: `classification`, `decisionBasis`, `platform`, `clientId`, `from` and `to`, each
    with `meta.total` checked.
  - **Range**: `to < from` → 422 `INPUT_VALIDATION_ERROR` with `details.fieldErrors.to`.
  - **Tenant**: a CLIENT user only sees their own client's comments.
  - **Empty comment**: a comment `''` comes back as `''`.

### Implementation for User Story 3

- [ ] T055 [P] [US3] Create src/comments/types/comment.types.ts with `CommentRecord` (contract
  `CommentRecord`) and `CommentRowWithClient`.
- [ ] T056 [P] [US3] In src/comments/schemas/comment-reply.schema.ts:
  - extend `QueryCommentReplySchema` with `decisionBasis: decisionBasisField.optional()`;
  - add the response schemas `CommentRecordSchema`, `CommentPageSchema` and `CommentPageDto`.
- [ ] T057 [US3] Create src/comments/mappers/comment.mapper.ts (`toCommentRecord`), to pass T052.
- [ ] T058 [US3] In src/comments/repositories/ICommentsRepository.repository.ts and
  comments.repository.impl.ts, `findAll` now:
  - adds the `decisionBasis` where clause;
  - includes `client: { select: { name: true } }`;
  - returns mapped `CommentRecord`s, with order `[{ createdAt: dir }, { id: 'asc' }]` as today.
- [ ] T059 [US3] Update src/comments/comments.service.ts (`findAll` returns
  `PaginatedResult<CommentRecord>`) and src/comments/comments.controller.ts
  (`@ApiOkResponse({ type: CommentPageDto })`). Run `npm run openapi:export`.

### Dashboard for User Story 3 (`fekra-dashboard`)

- [ ] T060 [P] [US3] Run `npm run api:types`. Add fekra-dashboard/src/test/fixtures/comments.ts
  (every label and basis, an empty comment, a 3,000-character Arabic comment) and a `GET
  /comment-replies` handler.
- [ ] T061 [P] [US3] Create fekra-dashboard/src/features/comments/queries.ts (+ queries.test.ts):
  `useComments(filters)`, infinite by 20, with the filters from the URL (`classification`,
  `decisionBasis`, `platform`, `clientId`, `from`, `to`).
- [ ] T062 [US3] Create fekra-dashboard/src/features/comments/comments-page.tsx (+
  comments-page.test.tsx), as contracts/dashboard-ui.md "Comments" items 1–4 and 6:
  - columns: date, client, platform, comment (`dir="auto"`, "No text", **Show all**), label tag,
    **Decided by** (Rules · AI model ({model}) · Safe fallback · Unknown) and reason;
  - filters and the total "{n} comments";
  - `to` < `from` is blocked in the form, and the server 422 is shown on the field;
  - the FR-020 note and the empty state.
- [ ] T063 [US3] Add the `comments` route to fekra-dashboard/src/app/router.tsx, a **Comments** link
  to app-shell.tsx, and the strings to i18n en.json and ar.json (`npm run i18n:check`).
- [ ] T064 [US3] Create fekra-dashboard/e2e/comments-us3.spec.ts: filter by label and decided-by →
  the total updates; expand a long comment; axe in English and Arabic.

**Checkpoint**: Collected comments are visible and filterable.

---

## Phase 6: User Story 4 - Collect comments so the model can be judged later (Priority: P4)

**Goal**: Every classified comment records how its label was decided (rules, AI model with its
name, or safe fallback). Administrators download any filtered set as a CSV with no row limit, and
every download is recorded.

**Independent Test**: Push a rule-decided comment (`"بكام؟"`) and an ambiguous one with the LLM
failing: rows `RULES` and `SAFE_FALLBACK` exist once each. `GET
/comment-replies/export?decisionBasis=rules` downloads a CSV whose row count equals the list
total, and a `comment_export_records` row says `completed = true` (quickstart §3 rows 12–13).

### Tests for User Story 4 (REQUIRED - Constitution Principle V) ⚠️

- [ ] T065 [P] [US4] Extend src/inbox/comment-llm-classifier.service.spec.ts:
  - a successful label returns `model` equal to the model that answered: the primary, or the
    fallback when the primary failed;
  - failures return no `model`.
- [ ] T066 [P] [US4] Extend src/inbox/priority-inbox.service.spec.ts, comment branch (R8):
  - the rules decide → `comments.save` receives `decisionBasis: 'RULES', decisionModel: null`;
  - rules `unsure` and the LLM labels → `AI_MODEL` and the model;
  - the LLM fails with retries used up → `SPAM`, `SAFE_FALLBACK`, and a reason ending in
    `, fallback to spam`;
  - `comments.save` throws → `error` is logged and `commentReply.handle` is still called (FR-025,
    SC-010).
- [ ] T067 [P] [US4] Create src/comments/comment-export.csv.spec.ts for `csvHeader()`, `csvRow(record)`
  and `BOM` (R9):
  - quoting of commas, quotes (`"` → `""`) and CR/LF;
  - Arabic and emoji unchanged;
  - formula neutralisation: cells starting with `=`, `+`, `-`, `@`, a tab or CR get a `'` prefix,
    and `-5` in a reason also gets it;
  - `null` → an empty cell; dates as ISO; CRLF line ends;
  - the column order exactly as the contract.
- [ ] T068 [P] [US4] Extend src/comments/schemas/comment-reply.schema.spec.ts:
  - `SaveCommentReplySchema` and `ReclassifyCommentSchema` accept `decisionBasis` and
    `decisionModel` (≤ 100);
  - `ExportCommentsQuerySchema` accepts the list filters, rejects `page` and `limit` (strict), and
    has the same `to`/`from` rule.
- [ ] T069 [P] [US4] Extend src/comments/comments.service.spec.ts:
  - **`save`** passes the basis fields;
  - **`export(query, actor)`**:
    - calls `repo.startExport` with the filters and `snapshotAt` before reading;
    - the generator yields the BOM, the header, then rows from `repo.iterateForExport(filters,
      snapshotAt, batch)` with `COMMENT_EXPORT_BATCH`;
    - `finishExport(id, rowCount, true)` after the last row;
  - **abort**: if the consumer stops early (`return()` on the iterator) or the repository throws,
    `finishExport(id, rowsSoFar, false)` is called and the error is rethrown;
  - **filename**: `comments-<yyyymmdd-hhmmss>.csv`.
- [ ] T070 [P] [US4] Create src/comments/comments.controller.spec.ts:
  - `findAll` delegates;
  - `export` has `ROLES` `['ADMIN']` at method level and returns a `StreamableFile` with type
    `text/csv; charset=utf-8`, `Content-Disposition` with the filename, and `Cache-Control:
    no-store`;
  - the class-level `ROLES` stay `['ADMIN','CLIENT']`.
- [ ] T071 [P] [US4] Create test/comments-export.e2e-spec.ts:
  - **Access**: 401; CLIENT → 403; `to < from` → 422.
  - **Content**: the CSV starts with the UTF-8 BOM, then the header in contract order. An Arabic
    comment round-trips, and a comment `=HYPERLINK("x")` comes out as `'=HYPERLINK(""x"")` quoted.
  - **Filters**: the row count equals `GET /comment-replies` `meta.total` for the same filters
    (SC-008).
  - **Download record**: a `comment_export_records` row with the actor, filters (no text),
    `row_count` and `completed = true` (SC-014).
  - **Large export**: seed 100,000 rows with `createMany` in chunks of 5,000; the stream returns
    100,000 data lines (SC-013).
  - **Snapshot**: a comment created after the request starts is not in the file.
  - **Pipeline**: push the rule comment `"بكام؟"` and a comment the rules leave `unsure` (LLM key
    unusable in e2e) → the rows have `RULES`, and `SAFE_FALLBACK` with `SPAM` (SC-005, SC-007).
    This suite sets `COMMENT_LLM_MAX_ATTEMPTS='1'` and `DISPATCH_INTERVAL_MS='100'` at the top of
    the file (T002).

### Implementation for User Story 4

- [ ] T072 [P] [US4] Record the model with the label:
  - in src/inbox/comment-classifier.service.ts add `model?: string` to `Classification`;
  - in src/inbox/comment-llm-classifier.service.ts return `{ type, reason: \`llm ${model}\`, model
    }` on success.
- [ ] T073 [P] [US4] In src/comments/schemas/comment-reply.schema.ts:
  - add `decisionBasis` (`z.enum` of the database values, default `UNKNOWN`) and `decisionModel`
    (`z.string().trim().max(100).nullish()`) to `SaveCommentReplySchema`, and include them in
    `ReclassifyCommentSchema`'s pick;
  - add `ExportCommentsQuerySchema` (the filters only, `strictObject`, range refine) and
    `ExportCommentsQueryDto`.
- [ ] T074 [US4] In src/comments/repositories/* (interface and impl):
  - **`save`**: the upsert's `update` branch also sets `decisionBasis` and `decisionModel`.
  - **`iterateForExport(filters, snapshotAt, batch)`**: an `AsyncGenerator<CommentRecord>`. It
    reads keyset pages ordered `createdAt desc, id asc`, using `(createdAt < last.createdAt) OR
    (createdAt = last.createdAt AND id > last.id)` and `createdAt <= snapshotAt`, and includes the
    client name.
  - **`startExport({actor, filters}) → id`**.
  - **`finishExport(id, rowCount, completed)`**.
- [ ] T075 [US4] In src/inbox/priority-inbox.service.ts, comment branch: work out `decisionBasis`
  and `decisionModel` as in data-model §5 and pass them to `comments.save`, keeping the existing
  catch-and-log (to pass T066).
- [ ] T076 [P] [US4] Create src/comments/comment-export.csv.ts (`BOM`, `CSV_COLUMNS`, `csvHeader`,
  `csvRow`, `neutralise`), pure functions to pass T067.
- [ ] T077 [US4] In src/comments/comments.service.ts add `export(query, actor): Promise<{ filename;
  stream: Readable }>`:
  - it applies the CLIENT scoping helper (the route is ADMIN-only anyway);
  - sets `snapshotAt = new Date()`;
  - calls `startExport` with `ExportFiltersSchema.parse(...)`;
  - builds `Readable.from(generator)`, with a `finally` that calls `finishExport`;
  - logs start and end at `log` with the row count.

  It reads `COMMENT_EXPORT_BATCH` through `ConfigService` (default 1000). Add `ConfigService` to
  the constructor and to the module if needed.
- [ ] T078 [US4] In src/comments/comments.controller.ts add `@Get('export')`, declared **before** any
  parameterised route:
  - `@Roles('ADMIN')`, `ExportCommentsQueryDto`, `@CurrentUser`;
  - `@Header('Cache-Control','no-store')`;
  - returns `new StreamableFile(stream, { type: 'text/csv; charset=utf-8', disposition:
    \`attachment; filename="${filename}"\` })`.

  Run `npm run openapi:export`.

### Dashboard for User Story 4 (`fekra-dashboard`)

- [ ] T079 [P] [US4] Create fekra-dashboard/src/features/comments/download-csv.ts (+
  download-csv.test.ts):
  - an authenticated `fetch` of `/comment-replies/export?…` with the session's bearer token;
  - it reads the body to the end, then saves a blob with the server's filename;
  - it uses `showSaveFilePicker` streaming when available;
  - it throws on `!ok`, on a stream error and on a network error, and saves nothing on failure.

  Tests with MSW: success; a 403; a stream that errors midway.
- [ ] T080 [US4] On fekra-dashboard/src/features/comments/comments-page.tsx (+ test) add **Download
  CSV** with the current filters:
  - a spinner and "Preparing {meta.total} rows…" with `aria-live="polite"`;
  - on failure the toast "The download did not finish. Try again." (contracts/dashboard-ui.md
    item 5).
- [ ] T081 [US4] Create fekra-dashboard/e2e/comments-us4.spec.ts: filter, then download → a file
  saved with the expected name (Playwright `download` event); a mocked aborted stream → the error
  toast and no download; time under 1 min (SC-008).

**Checkpoint**: Every new comment carries its decision basis, and data leaves the platform only
through recorded downloads.

---

## Phase 7: User Story 5 - Give each client its own chat workflow (Priority: P5)

**Goal**: Each client has an endpoint (one path segment) and an explicit chat-service
subscription. Only a subscribed client's DMs are stored and delivered, to `{N8N_BASE_URL}{endpoint}`,
with the endpoint and the data read fresh on every attempt.

**Independent Test**: Two subscribed clients with different endpoints and one unsubscribed client
each get DMs. The stub sees each subscribed client's DMs at its own URL only. The unsubscribed
client's DMs produce no call and no rows. A price change appears in the next payload (quickstart
§3 rows 1–6 and 17).

**⚠️ Release note**: shipping this story's backend starts the hard cut (FR-047). Deploy it
together with its dashboard tasks (T098–T103), following quickstart §6.

### Tests for User Story 5 (REQUIRED - Constitution Principle V) ⚠️

- [ ] T082 [P] [US5] Extend src/clients/schemas/client.schema.spec.ts:
  - **Endpoint**: `chatWorkflowEndpoint` accepts `chat-acme`, `A_1` and 100 characters. It rejects
    the 20 values of SC-016: `https://evil.test/x`, `//evil`, `a/b`, `..`, `.`, `a b`, `a?b`,
    `a#b`, `a%2Fb`, `a@b`, `a:b`, `a\b`, `a.b`, `''`, `' '`, 101 characters, `ñ`, `a\nb`, `a;b`,
    `a&b`.
  - **Create**: `chatSubscribed: true` without an endpoint → an issue on `chatWorkflowEndpoint`;
    the default is `false`.
  - **Update**: accepts `chatWorkflowEndpoint: null`.
- [ ] T083 [P] [US5] Create src/clients/schemas/query-client.schema.spec.ts: `chatSubscribed=false`
  → `false`, `true` → `true`, `maybe` → an error; existing `search` behavior unchanged.
- [ ] T084 [P] [US5] Create src/inbox/chat-workflow-url.spec.ts for `buildWorkflowUrl(base,
  endpoint)`:
  - `http://h/webhook/` + `chat-acme` → `http://h/webhook/chat-acme`; a base without a trailing
    slash gets one;
  - the endpoint is encoded;
  - it throws when the result's origin differs from the base's (simulate with a crafted endpoint
    that bypasses the regex);
  - it throws on a base with a query or fragment, or a non-http(s) base.
- [ ] T085 [P] [US5] Extend src/clients/clients.service.spec.ts:
  - **Create**: an endpoint taken by another client → 409 `DUPLICATE_KEY_ERROR` with
    `details.field = 'chatWorkflowEndpoint'`.
  - **Update rules**: `chatSubscribed: true` on a client without an endpoint → 422
    `INPUT_VALIDATION_ERROR` with `details.fieldErrors.chatWorkflowEndpoint`.
    `chatWorkflowEndpoint: null` on a subscribed client → the same 422. Setting both together →
    OK. The merge uses the current record from `repo.findById`.
  - **Update conflict**: an endpoint taken → 409 (excluding the client itself).
  - **Lookups**: `findChatRoute` and `findChatRouteById` delegate to the repository.
- [ ] T086 [P] [US5] Create src/clients/repositories/clients.repository.impl.spec.ts (mock
  `PrismaService` and the Redis client) for R1 and R16:
  - **`findChatRoute`**: reads Prisma first and writes `client:account:{id}` with a 30-min TTL. On
    a Prisma error it returns the cached copy with a `warn`. With no cache and a Prisma error it
    returns `null` and logs `error`.
  - **`findWorkflowDataFresh`**: the same rule with `client:workflow:{id}`.
  - **`findChatRouteById`**: reads Prisma by ID.
  - **`findAll`**: filters by `chatSubscribed` when given.
- [ ] T087 [P] [US5] Create src/inbox/n8n-delivery.service.spec.ts (mock Redis, `ConfigService`,
  `ClientsService`, and `global.fetch`):
  - **Construction**: an invalid `N8N_BASE_URL` → throws; missing in production → throws; missing
    outside production → `warn`.
  - **`post`**: resolves `findChatRouteById(payload.client.id)` on **every** attempt and POSTs to
    `buildWorkflowUrl(base, endpoint)` with the unchanged `x-webhook-secret` and body.
  - **Terminal cases**: not subscribed → the item is removed from `n8n:pending`, pushed to
    `n8n:dead` with `reason: 'UNSUBSCRIBED'`, and fetch is not called. No endpoint →
    `reason: 'NO_ENDPOINT'`. No base → `reason: 'NO_BASE_URL'`.
  - **Resend**: `onExpire` resend uses the endpoint current at that moment (change the mock
    between attempts).
  - **Unchanged**: `send`, `ack` and `take` behave as before.
- [ ] T088 [P] [US5] Extend src/inbox/priority-inbox.service.spec.ts with the subscription half of
  checkpoints 1–2:
  - **Message**:
    - `findChatRoute` null or not subscribed → a `warn` with IDs only (assert the text is
      absent), no `findOrCreate`, no buffer, no attachment processing;
    - subscribed → the normal flow, with `findOrCreate` using `route.clientId`.
  - **Batch**:
    - re-checks `findChatRoute`, and drops with a `warn` when it is now unsubscribed;
    - a subscribed batch uses `findWorkflowDataFresh(accountId)` (not
      `getClientDataForWorkFlow`) for the payload.
  - **Comments**: the comment branch still uses `getClientDataForWorkFlow`.
- [ ] T089 [P] [US5] Create test/chat-workflow.e2e-spec.ts (`stubN8n`). At the top of the file set
  `DM_WINDOW_SEC='1'` and `DISPATCH_INTERVAL_MS='100'` (T002). Create clients through
  `POST /clients` as ADMIN, then `PATCH` the chat fields. Cases:
  - **Routing**: 3 subscribed clients with endpoints `chat-a`, `chat-b`, `chat-c`; 50 DMs spread
    across them → each call's URL matches its client's endpoint, and the body's `client.id` matches
    (SC-015).
  - **Unsubscribed**: 50 DMs → 0 calls, 0 `chats` rows and 0 `message_replies` rows for it
    (SC-018).
  - **Endpoint change**: change client A's endpoint → its next DM goes to the new URL.
  - **Fresh data**: make four saves, then send one DM after each. Each payload carries the new value
    and none carries an old one (FR-048, SC-020):
    - a client setting: `aiConfig.brandVoice` through `PATCH /clients/{id}`;
    - business information: `phone` through `PUT /business-info/client/{id}`, with `clientId` in
      the body so it works before and after US6;
    - a service price through `PUT /services/{id}`;
    - an offer's `discountValue` through `PATCH /offers/{id}`.
  - **Unsubscribe while pending**: a DM delivered with the stub returning 500 (no ack), then the
    client is unsubscribed, then the ack TTL expires (trigger `delivery.onExpire(id)`) → the item
    is in `n8n:dead` with `UNSUBSCRIBED`, with no new call.
- [ ] T090 [P] [US5] Extend test/clients-admin.e2e-spec.ts:
  - **Existing clients**: a client created before the chat fields are used has `chatSubscribed:
    false` and `chatWorkflowEndpoint: null`.
  - **Subscribe rules**: `PATCH {chatSubscribed:true}` → 422 on the field; with an endpoint →
    200, and `client_activities.changed_fields` contains `chatWorkflowEndpoint` and
    `chatSubscribed` with no values.
  - **Conflicts**: a duplicate endpoint → 409 `DUPLICATE_KEY_ERROR`; clearing the endpoint while
    subscribed → 422.
  - **Filter**: `GET /clients?chatSubscribed=false` lists only unsubscribed clients (SC-019).
  - **Access**: a CLIENT user → 403 on these routes.

### Implementation for User Story 5

- [ ] T091 [P] [US5] Client schemas:
  - in src/clients/schemas/client.schema.ts add `chatWorkflowEndpoint:
    z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Use letters, digits, - and _ only (max
    100)').nullish()` and `chatSubscribed: z.boolean().optional()` to `CreateClientSchema`, plus a
    `superRefine` (subscribed ⇒ endpoint). `UpdateClientSchema` inherits both fields without the
    refine (the service checks the merged state);
  - in src/clients/schemas/client-record.schema.ts add both fields;
  - in src/clients/schemas/query-client.schema.ts add `chatSubscribed: z.enum(['true','false'])
    .transform(v => v === 'true').optional()`.
- [ ] T092 [P] [US5] In src/clients/types/client.types.ts add `ChatRoute { clientId; name;
  chatSubscribed; chatWorkflowEndpoint: string | null }`.
- [ ] T093 [P] [US5] Create src/inbox/chat-workflow-url.ts (`buildWorkflowUrl`), to pass T084.
- [ ] T094 [US5] In src/clients/repositories/IClientsRepository.repository.ts and
  clients.repository.impl.ts add:
  - `findChatRoute(accountId)` and `findWorkflowDataFresh(accountId)`: database first, then
    refresh the cache; on error, the cached copy or `null` (R16);
  - `findChatRouteById(clientId)`;
  - `findChatEndpointConflict(endpoint, excludeId?)`;
  - the `chatSubscribed` filter in `findAll`.

  Keep `findByAccountId` and `getClientDataForWorkFlow` unchanged for the comment path.
- [ ] T095 [US5] In src/clients/clients.service.ts:
  - **`create`**: add `assertEndpointFree` (409 `DUPLICATE_KEY_ERROR`, field
    `chatWorkflowEndpoint`).
  - **`update`**: reads the current record, merges `chatSubscribed` and `chatWorkflowEndpoint`,
    and throws `UnprocessableEntityException({ message: 'Validation failed', errorCode:
    'INPUT_VALIDATION_ERROR', details: { formErrors: [], fieldErrors: { chatWorkflowEndpoint:
    [...] } } })` when the merged state is subscribed without an endpoint. Then the endpoint
    conflict check, then the existing version compare-and-swap.
  - Add `findChatRoute`, `findChatRouteById` and `findWorkflowDataFresh`.
- [ ] T096 [US5] In src/inbox/n8n-delivery.service.ts, to pass T087:
  - inject `ClientsService` with `@Inject(forwardRef(() => ClientsService))`;
  - validate `N8N_BASE_URL` in the constructor;
  - in `post`, resolve the route by ID, take the terminal dead-letter path when it is not
    deliverable, and otherwise build the URL with `buildWorkflowUrl`;
  - remove every read of `N8N_WEBHOOK_URL`.
- [ ] T097 [US5] In src/inbox/priority-inbox.service.ts add the subscription half of checkpoints 1
  and 2, and switch the batch payload to `findWorkflowDataFresh` (to pass T088). Replace the
  `findByAccountId` call in the message branch with `findChatRoute`, and log drops as
  `Dropped DM ${item.id} for ${item.accountId}: chat service not subscribed`.

### Dashboard for User Story 5 (`fekra-dashboard`)

- [ ] T098 [US5] Run `npm run openapi:export` and `npm run api:types`. Update the client fixtures in
  fekra-dashboard/src/test/ with `chatSubscribed` and `chatWorkflowEndpoint`.
- [ ] T099 [P] [US5] Form schema and errors in fekra-dashboard/src/features/clients/client-form/:
  - schema.ts: endpoint regex and "subscribed needs endpoint";
  - server-errors.ts: map `DUPLICATE_KEY_ERROR` with `details.field = chatWorkflowEndpoint` and
    the 422 `fieldErrors.chatWorkflowEndpoint` onto the field;
  - extend the existing tests next to them.
- [ ] T100 [US5] In fekra-dashboard/src/features/clients/client-form/settings-sections.tsx (+
  settings-sections.test.tsx) add the **Chat service** section from contracts/dashboard-ui.md:
  - the endpoint field (`dir="ltr"`, helper text, no base address);
  - the subscription switch, disabled with "Enter an endpoint first";
  - "Unsubscribe first" when the endpoint is cleared while subscribed.

  The section is used by both create-page.tsx and edit-page.tsx.
- [ ] T101 [P] [US5] On the clients list:
  - in fekra-dashboard/src/features/clients/list-page.tsx (+ list-page.test.tsx) add the **Chat
    service** badge column and the **Only not subscribed** switch (`chatSubscribed=false` in the
    URL);
  - in queries.ts, pass the filter through.
- [ ] T102 [US5] In fekra-dashboard/src/features/clients/detail-page.tsx (+ detail-page.test.tsx)
  show the endpoint and the subscription in the client's details.
- [ ] T103 [US5] Create fekra-dashboard/e2e/chat-service.spec.ts:
  - set an endpoint and subscribe → saved; a duplicate endpoint → field error;
  - subscribe without an endpoint is impossible;
  - the **Only not subscribed** filter;
  - axe in English and Arabic.

**Checkpoint**: Each subscribed client's DMs reach only its own workflow with fresh data. Nothing
is processed for unsubscribed clients.

---

## Phase 8: User Story 6 - Manage a client's business information, services and offers (Priority: P6)

**Goal**: Administrators manage a client's business information, services and offers from the
client's page, with per-client lists, same-client offer links, an immutable `clientId`, validated
ids, a 404 for missing business information, and a partial `PUT`.

**Independent Test**: For a new client, `GET /business-info/client/{id}` → 404. Create it,
create 2 services and 1 offer, and link the offer to one service. Linking another client's offer →
422. `GET /services?clientId=` returns only this client's services. The dashboard tabs show and
edit all three (quickstart §3 rows 14–16).

### Tests for User Story 6 (REQUIRED - Constitution Principle V) ⚠️

- [ ] T104 [P] [US6] Extend src/services/services.service.spec.ts (mock `IServicesRepository` and
  `OffersService`):
  - **Create**: an `offerId` of another client → `UnprocessableEntityException` with
    `fieldErrors.offerId`; an unknown `offerId` (`OffersService.findById` throws 404) → the same
    422; `offerId: null` → OK.
  - **Update**: a different `clientId` → 422 on `clientId`; the same `clientId` → OK; the offer
    check uses the stored `clientId`.
- [ ] T105 [P] [US6] Extend src/offers/offers.service.spec.ts: an update with a different `clientId`
  → 422 on `clientId`; the same value → OK; a missing offer → `NotFoundException`.
- [ ] T106 [P] [US6] Extend src/business-info/business-info.service.spec.ts:
  - `findByClientId` with no record → `NotFoundException`;
  - **`update`**: a body `clientId` different from the route's → 422; an omitted field is not sent
    to the repository; `null` clears a nullable field.
- [ ] T107 [P] [US6] Update the controller specs for the new parameters, and check that each route
  delegates with the parsed values:
  - src/services/services.controller.spec.ts and src/offers/offers.controller.spec.ts:
    `IdParamDto`;
  - src/business-info/business-info.controller.spec.ts: `ClientIdParamDto` and the update body
    DTO.
- [ ] T108 [P] [US6] Schema tests:
  - create src/services/schemas/query-service.schema.spec.ts and
    src/offers/schemas/query-offer.schema.spec.ts: `clientId` is an optional UUID;
  - create src/business-info/schemas/business-info.schema.spec.ts: `UpdateBusinessInfoBodySchema`
    accepts a partial body, an optional `clientId`, `null` for nullable fields, and rejects `{}`.
- [ ] T109 [P] [US6] Create test/client-data.e2e-spec.ts (ADMIN, CLIENT user, clients A and B):
  - **Access**: 401 without a token and 403 for the CLIENT user on every route.
  - **Malformed ids**: `GET /services/not-a-uuid` and `GET /business-info/client/x` → 422.
  - **Business info**: `GET` for A → 404, then `POST` → 201, then a second `POST` → 409. A `PUT`
    with only `phone` keeps `paymentMethods`.
  - **Per-client lists**: services and offers of A and B; `?clientId=A` lists only A's.
  - **Links**: B's offer on A's service → 422 on `offerId`. Moving a service to B → 422 on
    `clientId`.
  - **Offer delete**: deleting an offer linked to 3 services → the services stay, with `offerId
    null`.
  - **Offer rules**: `endDate` before `startDate` → 422; a 120% discount → 422.

### Implementation for User Story 6

- [ ] T110 [P] [US6] Per-client lists:
  - add `clientId: z.uuid().optional()` to src/services/schemas/query-service.schema.ts and
    src/offers/schemas/query-offer.schema.ts;
  - in src/services/repositories/services.repository.impl.ts and
    src/offers/repositories/offers.repository.impl.ts, filter by `clientId` and order with `[{
    [orderBy]: dir }, { id: 'asc' }]`.
- [ ] T111 [US6] Service rules:
  - in src/services/services.module.ts import `OffersModule`;
  - in src/services/services.service.ts:
    - `create` checks the offer with `OffersService.findById` (`clientId` must match);
    - `update` loads the service (404 if missing), rejects a changed `clientId`, and checks a new
      `offerId` against the stored `clientId`;
    - both throw a 422 with the `fieldErrors` shape.
- [ ] T112 [P] [US6] In src/offers/offers.service.ts `update` loads the offer (404 if missing) and
  rejects a changed `clientId` with a 422 on `clientId`.
- [ ] T113 [P] [US6] In src/services/services.controller.ts and src/offers/offers.controller.ts
  replace `@Param('id') id: string` with `@Param() { id }: IdParamDto` on every route.
- [ ] T114 [US6] Business info:
  - in src/business-info/schemas/business-info.schema.ts add `UpdateBusinessInfoBodySchema` (the
    partial fields plus `clientId: z.uuid().optional()`, refine "at least one field") and its DTO;
  - in src/business-info/business-info.controller.ts use `@Param() { clientId }: ClientIdParamDto`
    on all four routes, and the new body DTO on `PUT`;
  - in src/business-info/business-info.service.ts, `findByClientId` throws
    `NotFoundException('Business information not found')`, and `update` checks the body's
    `clientId` against the route's and passes only the fields that were sent.

  Run `npm run openapi:export`.

### Dashboard for User Story 6 (`fekra-dashboard`)

- [ ] T115 [US6] Run `npm run api:types`. Add fekra-dashboard/src/test/fixtures/client-data.ts and
  MSW handlers for business-info, services and offers, including the 404 and 422 cases.
- [ ] T116 [P] [US6] Create fekra-dashboard/src/features/client-data/queries.ts (+ queries.test.ts):
  - `useBusinessInfo(clientId)`, where a 404 means `null`;
  - `useServices(clientId)` and `useOffers(clientId)`, infinite by 20 and sortable;
  - the mutations, which invalidate the matching lists.
- [ ] T117 [US6] Add client tabs and routes:
  - tabs **Details · Business info · Services · Offers · Posts** on
    fekra-dashboard/src/features/clients/detail-page.tsx;
  - routes `clients/:id/business-info`, `clients/:id/services` and `clients/:id/offers` in
    fekra-dashboard/src/app/router.tsx.
- [ ] T118 [P] [US6] Create fekra-dashboard/src/features/client-data/business-info-page.tsx (+
  test):
  - a 404 shows an empty form and **Create**; otherwise **Save** sends a full `PUT`;
  - **Delete** with confirmation;
  - row editors for social links, map links and work hours, and tag inputs for payment and
    installment options;
  - `dir="auto"` on text fields.
- [ ] T119 [P] [US6] Create fekra-dashboard/src/features/client-data/services-page.tsx and
  service-form.tsx (+ tests):
  - a table with sorting and **Load more**;
  - variants as rows with names unique per service;
  - an offer select showing only this client's offers;
  - the 422 errors on `offerId` and `clientId` mapped onto the fields;
  - **Delete** with a confirmation dialog (FR-041).
- [ ] T120 [P] [US6] Create fekra-dashboard/src/features/client-data/offers-page.tsx, offer-form.tsx
  and delete-offer-dialog.tsx (+ tests):
  - the linked-services count;
  - discount type and value rules, and the date order checked before sending;
  - the delete dialog text "This offer covers N services. They will stay, without an offer."
- [ ] T121 [US6] Add every string to i18n en.json and ar.json (`npm run i18n:check`), then create
  fekra-dashboard/e2e/client-data.spec.ts: create business info, 5 services and 2 offers within
  10 minutes (SC-017); edit one; delete an offer; axe in English and Arabic.

**Checkpoint**: All of a client's information can be entered from the dashboard.

---

## Phase 9: Data Retention (Cross-Cutting, FR-049, FR-050)

**Purpose**: Delete customer texts older than `RETENTION_MONTHS` once a day (R15).

- [ ] T122 [P] Create src/retention/retention.service.spec.ts (mock `ConfigService`,
  `ConversationsService`, `CommentsService`; jest fake timers):
  - **Config**: a `RETENTION_MONTHS` of `0`, `-1` or `abc` → the constructor throws; the default is
    12.
  - **Schedule**: the first run 60 s after `onModuleInit`, then every 24 h.
  - **Cutoff**: now minus N calendar months in UTC (31 March minus 1 month → 28 or 29 February).
  - **Calls**: both `purgeBefore(cutoff)` calls.
  - **Log**: one `log` line with the three counts and no text.
  - **Errors**: an error → `error` log, and the next run still happens.
  - **Shutdown**: `onModuleDestroy` clears both timers.
- [ ] T123 [P] Extend src/conversations/conversations.service.spec.ts and
  src/comments/comments.service.spec.ts: `purgeBefore(cutoff)` delegates to the repository and
  returns its counts.
- [ ] T124 [P] Create test/retention.e2e-spec.ts (SC-021). Seed through Prisma:
  - a chat with `updated_at` 13 months ago, with exchanges and a pause event;
  - an active chat with one exchange from 13 months ago and one from 11 months ago;
  - comments from 13 and 11 months ago;
  - a `comment_export_records` row from 13 months ago.

  Call `app.get(RetentionService).runOnce()`. Expect:
  - the old chat and its children are gone;
  - the active chat keeps only its 11-month exchange;
  - only the 11-month comment remains;
  - the export record remains.
- [ ] T125 Add `purgeBefore(cutoff): Promise<{ chats; exchanges }>` to the
  src/conversations/repositories/* interface and implementation. It loops `$executeRaw` `DELETE
  FROM chats WHERE id IN (SELECT id FROM chats WHERE updated_at < ${cutoff} LIMIT 5000)` until it
  deletes 0 rows (the cascade removes children), then does the same for `message_replies` on
  `created_at`. Add `purgeBefore(cutoff): Promise<number>` to the src/comments/repositories/*
  interface and implementation for `comment_replies.created_at`. Expose both through
  `ConversationsService.purgeBefore` and `CommentsService.purgeBefore`.
- [ ] T126 Create the retention module:
  - src/retention/retention.service.ts (`RetentionService`, `OnModuleInit`/`OnModuleDestroy`, a
    public `runOnce()`, to pass T122);
  - src/retention/retention.module.ts (imports `ConversationsModule` and `CommentsModule`);
  - register `RetentionModule` in src/app.module.ts.

**Checkpoint**: Customer data older than the period is removed daily, with counts in the logs.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Contract, configuration, verification and release.

- [ ] T127 [P] Update the Postman `Clients` requests in
  postman/collections/Social Inbox Automation API/Clients/:
  - **Update Client**: an example body with `chatWorkflowEndpoint` and `chatSubscribed`, and the
    docs for 409 `DUPLICATE_KEY_ERROR` and the 422 field errors;
  - **List Clients**: the `chatSubscribed` query param;
  - **Create Client**: the optional fields.
- [ ] T128 [P] Create the Postman folder postman/collections/Social Inbox Automation API/Conversations/
  (with `.resources/definition.yaml`). Requests:
  - **List Chats** (filters `paused` and `senderId`; saves `{{chatId}}`);
  - **Get Chat**;
  - **List Chat Messages**;
  - **Pause Chat (ADMIN)** with body `{ "duration": "1h" }`;
  - **Resume Chat (ADMIN)**.

  Each has status tests and its error codes documented, in the style of the Inbox requests.
- [ ] T129 [P] Create the Postman folder postman/collections/Social Inbox Automation API/Comments/
  with **List Classified Comments** (all filters, including `decisionBasis`) and **Export Comments
  CSV (ADMIN)** (it checks `content-type` and the BOM).
- [ ] T130 [P] Update the Postman `Services`, `Offers` and `Business Info` requests:
  - the `clientId` query on the lists;
  - the 422 cases for a malformed id, a foreign `offerId` and a changed `clientId`;
  - Get Business Info By Client: the 404 when none exists;
  - Update Business Info By Client: a partial body.

  Then run `npm run postman:export`.
- [ ] T131 Run `npm run openapi:export` and commit openapi/openapi.json. Compare it with
  contracts/chat-flow-api.openapi.yaml: every path, operation and field listed in the contract
  exists with the same shape. Then run `npm run api:types` in fekra-dashboard and commit.
- [ ] T132 Constitution VI: re-read the migration SQL. Confirm that the previous release's code
  needs none of the new columns, and that its inserts work because every new `NOT NULL` column has
  a default. Note the result in the PR description, with the rollback path (quickstart §6).
- [ ] T133 [P] Security pass (constitution IV, VIII):
  - grep the new and changed code in src/inbox, src/conversations and src/comments for `logger.`
    calls that include `text`, `message`, `comment` or `reply` above `debug`, and fix any you find
    (FR-028, SC-012);
  - confirm that `N8N_BASE_URL` never appears in a response or log;
  - confirm that pause, resume and export have method-level `@Roles('ADMIN')`.
- [ ] T134 [P] Create test/lists-performance.e2e-spec.ts (SC-006): seed 10,000 chats (one exchange
  each) and 10,000 comments with `createMany`, and assert that the first page of `GET /chats` and
  of `GET /comment-replies` each respond in under 2,000 ms.
- [ ] T135 Run everything CI runs: `npm run lint:check`, `npm run build`, `npm test`,
  `npm run test:e2e`. In fekra-dashboard run `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run i18n:check` and `npm run e2e`, including the 001 and 002 suites unchanged (SC-011).
- [ ] T136 Walk through quickstart.md §3 (Postman rows 1–17) and §4 (SQL checks) against a local
  stack, then fix any mismatch with the spec.
- [ ] T137 Prepare the release (quickstart §6, research R12):
  - list each client's planned endpoint and create the n8n workflows;
  - add `N8N_BASE_URL` (and the optional variables) to the production secret store and the VM env
    file, keeping `N8N_WEBHOOK_URL`;
  - schedule the backend and dashboard deploys in one window;
  - after the deploy, subscribe every client using the **Only not subscribed** filter, and send
    one test DM per client;
  - remove `N8N_WEBHOOK_URL` in a later change.
- [ ] T138 [P] Fix the constitution IV and VIII follow-ups in src/inbox/n8n-callback.controller.ts,
  and create src/inbox/n8n-callback.controller.spec.ts:
  - read `N8N_WEBHOOK_SECRET` through `ConfigService` instead of `process.env`;
  - compare with `crypto.timingSafeEqual` on equal-length buffers; different lengths → 401 without
    comparing;
  - tests: the correct secret is handled; a wrong, missing or different-length secret →
    `UnauthorizedException`;
  - the Postman request "Callback- Invalid secret (expect 401)" still passes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every story** (the migration and the
  shared Zod pieces).
- **User stories (Phases 3–8)**: depend on Foundational. They can proceed in priority order or in
  parallel, with the shared-file notes below.
- **Retention (Phase 9)**: depends on Foundational. It edits the conversation and comment
  repositories, so schedule it after US1 (T021) and US3 (T058), or coordinate the edits.
- **Polish (Phase 10)**: after the stories that will ship.

### User Story Dependencies

- **US1 (P1)**: independent. MVP.
- **US2 (P2)**: the backend is independent of US1 (the pause works on any chat). The dashboard
  tasks T047–T049 extend the US1 pages (T027, T028).
- **US3 (P3)**: independent.
- **US4 (P4)**: the backend is independent (the decision basis and the export). The dashboard
  tasks T079–T080 extend the US3 comments page (T062).
- **US5 (P5)**: independent in code. **Operationally it must ship last or alone**, together with
  its dashboard tasks (T098–T103), because it starts the hard cut (FR-047).
- **US6 (P6)**: independent. US5's e2e T089 "fresh data" case uses `PUT /services/{id}`, which
  exists today, so it does not wait for US6.

### Shared files (do not edit in parallel across stories)

| File | Stories / phases |
|---|---|
| src/inbox/priority-inbox.service.ts (+ spec) | US2 (T035, T044), US4 (T066, T075), US5 (T088, T097) |
| src/conversations/repositories/* | US1 (T021), US2 (T040), Retention (T125) |
| src/conversations/conversations.service.ts (+ spec) | US1, US2, Retention |
| src/comments/repositories/*, comments.service.ts | US3, US4, Retention |
| src/comments/schemas/comment-reply.schema.ts (+ spec) | US3 (T056), US4 (T073) |
| fekra-dashboard/src/app/router.tsx, components/app-shell.tsx, i18n | US1, US3, US6 |

### Within Each Story

- Tests first; they MUST fail before the implementation.
- Types and schemas → mappers → repositories → services → controllers → pipeline wiring.
- Run `npm run openapi:export` before the story's dashboard tasks, then `npm run api:types`.

### Parallel Opportunities

- **Setup**: T001–T003 all [P].
- **Foundational**: the test tasks T006, T008 and T010 in parallel, after the migration (T004,
  T005).
- **Within a story**: all test tasks marked [P] together; then the [P] type and schema tasks.
- **Across stories**: US1, US3 and US6 touch disjoint backend files, and can be built in parallel
  by different people.

---

## Parallel Example: User Story 1

```bash
# Tests together (they fail first):
Task: "T012 [US1] QueryChatSchema paused/senderId tests in src/conversations/schemas/reply-schemas.spec.ts"
Task: "T013 [US1] chat.mapper.spec.ts effective pause, pausedBy, lastExchange"
Task: "T014 [US1] conversations.service.spec.ts findAll/findOne mapping and scoping"
Task: "T015 [US1] conversations.controller.spec.ts delegation and ROLES"
Task: "T016 [US1] test/conversations.e2e-spec.ts"

# Then the independent building blocks:
Task: "T017 [US1] src/conversations/types/chat.types.ts"
Task: "T018 [US1] chat.schema.ts paused filter + ChatRecord DTOs"
Task: "T019 [US1] message-reply.schema.ts ExchangeRecord DTOs"
```

## Parallel Example: User Story 4

```bash
Task: "T065 [US4] comment-llm-classifier.service.spec.ts returns model"
Task: "T067 [US4] comment-export.csv.spec.ts escaping + formula neutralisation"
Task: "T068 [US4] comment-reply.schema.spec.ts basis fields + export query"
Task: "T070 [US4] comments.controller.spec.ts export headers + ADMIN"
Task: "T071 [US4] test/comments-export.e2e-spec.ts"
# then
Task: "T072 [US4] Classification.model + LLM returns model"
Task: "T076 [US4] src/comments/comment-export.csv.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational (the migration is additive; with no US5 code nothing is
   gated yet).
2. Phase 3 (US1): backend, then dashboard.
3. **STOP and VALIDATE**: quickstart §3 row 7, and e2e `conversations`.
4. Deploy the backend, then the dashboard. Administrators can read conversations.

### Incremental Delivery

1. US1 → deploy (read conversations).
2. US2 → deploy (pause control; changes the DM pipeline only for paused chats).
3. US3 → US4 → deploy (comments review, decision basis, CSV).
4. US6 → deploy (client data screens and the service, offer and business-info fixes).
5. Retention → deploy (FR-049; with 12 months it deletes nothing for now).
6. **US5 last, as one release window** (backend + dashboard + subscribing every client, quickstart
   §6). This is the only step with a customer-visible risk.

This order differs from the plan's delivery order (which built US5's data first) only to keep
the hard cut out of the early releases. The design does not change.

### Parallel Team Strategy

- After Foundational: Dev A does US1 → US2; Dev B does US3 → US4; Dev C does US6 → Retention.
- US5 is picked up by whoever finishes first, coordinating on priority-inbox.service.ts with
  US2 and US4.

---

## Notes

- [P] tasks touch different files and do not depend on an unfinished task.
- The [Story] label maps each task to its user story for traceability.
- Every task that adds or changes an endpoint is followed (within its story or in Polish) by
  `openapi:export`, a Postman update and `api:types`.
- Commit after each task or logical group, with Conventional Commits (`feat(conversations): …`).
- Stop at any checkpoint to validate a story on its own.
