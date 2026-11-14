# Research: Chat Flow in the Dashboard

**Feature**: `003-chat-frontend-comment-analysis` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

Each entry resolves an open technical question from the plan's Technical Context. Facts about the
current code were checked in the repository on 2026-11-14 (branch base `e8edfe4`).

Terms: the spec's "assistant" is the n8n chat workflow for private messages (DMs). The spec's
"endpoint" is the per-client path, stored as `chatWorkflowEndpoint`.

---

## R1. Fresh reads for everything the chat path decides on

- **Decision**: The DM path reads the database first and uses the two Redis caches only as an
  outage fallback (R16). Two new narrow reads
  are added to `ClientsService`: `findChatRoute(accountId)` and `findChatRouteById(clientId)`.
  Each returns `{ clientId, name, chatSubscribed, chatWorkflowEndpoint }` from one indexed
  `SELECT` (`fbPageId` and `instaAccountId` are unique). The batch delivery also reads the
  workflow data (client, services, offers, business info) without the cache. The comment path
  (`getClientDataForWorkFlow` for classification and replies) keeps its 30-minute cache.
- **Rationale**: FR-046 and FR-048 say a saved change applies to the very next delivery attempt.
  Today `ClientsRepository` caches `client:account:{id}` and `client:workflow:{id}` for 30
  minutes, and nothing deletes them when a client, service, offer or business info is saved.
  Without this change a price edit would reach customers up to 30 minutes late, and an
  unsubscribe would not stop the workflow for up to 30 minutes. The DM path is low frequency: one
  light query per incoming message (already rate limited to 20 per minute per sender) and one
  heavier read per DM batch (at most one per sender per `DM_WINDOW_SEC`, default 10 s).
- **Alternatives considered**:
  - *Delete the cache keys on every write.* Keys are by account ID, not client ID, so every write
    in four modules would need the client's old and new account IDs. A reader that loaded the old
    row before the commit can still write it back after the delete, so the stale value would
    survive for the TTL. This fails "no waiting period".
  - *Versioned cache keys (a generation counter per client).* Race-free, but it adds a Redis
    round trip, a counter and an account → client map to keep, for a path that is not hot.
  - *A short TTL (for example 5 s).* Still a waiting period, and a flaky test target.
- **Side effect**: the comment path's stale-cache behavior is unchanged. It is not in this
  feature's scope.

## R2. Where the checks sit in the pipeline

- **Decision**: Four checkpoints, each reading fresh state.

  | # | Where | Check | If it fails |
  |---|---|---|---|
  | 1 | `PriorityInboxService.handle` `message`, before anything is stored, buffered or sent to Gemini | route found and `chatSubscribed`; then the chat's effective pause state | not subscribed or unknown account: log `warn` "dropped" (ids only), return (FR-044). Paused: record the message as unanswered, return (FR-011) |
  | 2 | `handle` `batch`, before `delivery.send` | route subscribed again; chat not paused | not subscribed: drop and log. Paused: record the batch as unanswered |
  | 3 | `N8nDeliveryService.post`, on every attempt including resends | route by client ID: subscribed, endpoint present | terminal: remove from `n8n:pending` and push to `n8n:dead` with the reason (FR-046, edge case "unsubscribed while waiting") |
  | 4 | `MessageSenderService.reply`, before the Graph call (the workflow's answer) | chat not paused | do not send, record the batch as unanswered (FR-010: "a reply being prepared when the pause takes effect MUST NOT be sent") |

- **Rationale**: The DM window (10 s) and the workflow's own time create two gaps in which an
  administrator can pause or unsubscribe. Checking only at entry would break FR-010 and
  FR-046. Checkpoint 1 runs before `findOrCreate`, so a client that is not subscribed stores
  nothing (spec decision) and attachment processing (Gemini image and voice calls) is skipped.
- **Alternatives considered**: One check at entry (misses the two gaps). A Redis flag per chat
  (a second source of truth that can disagree with the database, and it needs invalidation).

## R3. The endpoint, the base address and the request URL

- **Decision**:
  - Columns on `clients`: `chat_workflow_endpoint VARCHAR(100) NULL UNIQUE` and
    `chat_subscribed BOOLEAN NOT NULL DEFAULT false`.
  - Format (Zod, `z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)`): one path segment. No slash, dot,
    space, `@`, `?`, `#` or `%`, so no host change, traversal or query is possible (FR-035).
  - New pure helper `buildWorkflowUrl(base, endpoint)` in `src/inbox/chat-workflow-url.ts`: it
    parses the base with `new URL`, makes sure its path ends with `/`, appends
    `encodeURIComponent(endpoint)`, and throws if the result's origin differs from the base's.
    The check is defense in depth behind the Zod format (SC-016).
  - `N8N_BASE_URL` replaces `N8N_WEBHOOK_URL`. It is read through `ConfigService`, validated at
    construction of `N8nDeliveryService` (must be `http`/`https`, no query or fragment), and in
    production a missing value fails at boot (constitution VIII). Outside production it logs a
    warning, and a delivery with no base becomes a terminal dead-letter, as today.
  - `N8N_WEBHOOK_SECRET` and the `x-webhook-secret` header are unchanged: one secret for all
    workflows.
- **Rationale**: The user decided on a fixed base and a per-client endpoint typed by an
  administrator. A single path segment is the smallest shape that is easy to type, easy to
  validate and cannot escape the base. The base stays in the environment, never in the dashboard
  (FR-031). Each request still carries only its own client's data, as today (FR-033).
- **Alternatives considered**: A full URL per client (breaks the fixed base and allows SSRF to any
  host). Deriving the path from the client ID (rejected in clarification: n8n workflows have
  free names). Allowing nested paths with `/` (more validation, no need).
- **Compatibility**: n8n workflows must exist at `{base}/{endpoint}`. Today the single workflow is
  at `N8N_WEBHOOK_URL`, so the team creates or renames one workflow per client. Rollback keeps
  `N8N_WEBHOOK_URL` in the env file (R12).

## R4. Rules that need the stored state: subscribe needs an endpoint, endpoints are unique

- **Decision**: `ClientsService` enforces both.
  - `chatSubscribed: true` without an endpoint, and clearing the endpoint of a subscribed client,
    answer `422 INPUT_VALIDATION_ERROR` with `details.fieldErrors.chatWorkflowEndpoint`, the same
    shape the dashboard already maps to form fields (FR-045). On create, a Zod `superRefine` does
    it. On update, the service merges the request over the current record and checks the result.
  - Uniqueness uses the same pattern as `assertAccountsFree`: a pre-check
    (`findChatEndpointConflict`) answering `409 DUPLICATE_KEY_ERROR` with `details.field =
    "chatWorkflowEndpoint"`, with the unique index as the final guard (the global filter already
    maps `P2002` to the same code).
  - The existing version check (compare-and-swap in `ClientsRepository.update`) protects the
    read-merge-write: a concurrent edit changes `version`, so the save is refused with
    `CLIENT_VERSION_CONFLICT` and the merged check is never trusted on stale data.
  - Both fields go through the existing `changedFields` activity entry (names only, never values),
    which satisfies FR-036 and FR-046 with no new code.
- **Rationale**: The cross-field rule depends on stored data, so Zod alone cannot do it for a
  partial update. Reusing the 422 and 409 shapes keeps the dashboard code the same as for FR-012
  and FR-013 of feature 001.
- **Alternatives considered**: A database `CHECK (NOT chat_subscribed OR chat_workflow_endpoint IS
  NOT NULL)` as an extra guard. Adopted: it is in the migration, as a last line of defense.
  Rejected as the only guard: a `CHECK` violation gives a generic error without a field.

## R5. Pause state: model, expiry and the audit trail

- **Decision**:
  - State on `chats`: `paused_at`, `paused_until` (null = until resumed), `paused_by_id`,
    `paused_by_name` (copied, no foreign key, like `ClientActivity`).
  - **Effective state is computed, never trusted from a flag**: a chat is paused when
    `paused_at IS NOT NULL AND (paused_until IS NULL OR paused_until > now())`. This is evaluated
    in the pipeline checks (R2), in the list filter (`paused=true|false`) and in the API mapper.
    A timed pause therefore ends exactly on time, with no timer (FR-013, SC-004).
  - Durations map in the service: `until_resumed` → null, `1h`, `24h`, `7d`.
  - Audit table `chat_pause_events` (append-only): `PAUSED` with the chosen duration and
    `until`, `RESUMED` by an administrator, or `RESUMED` with no actor (`automatic`).
  - `ChatPauseSweeper` (`OnModuleInit`/`OnModuleDestroy`, interval `PAUSE_SWEEP_INTERVAL_MS`,
    default 30 s) writes the automatic `RESUMED` events and clears the columns. It runs one
    statement in a transaction: `UPDATE chats SET paused_* = NULL WHERE paused_until <= now()
    RETURNING id, paused_until`, then `createMany` for the events, with `created_at` set to the
    scheduled end. Two instances cannot both claim a row, so each expiry is recorded once.
  - Pausing a paused chat replaces the duration (new `PAUSED` event). Resuming an active chat is a
    200 no-op with no event.
- **Rationale**: Correctness never depends on the sweeper, only the audit entry does, and that
  appears within the interval (FR-014). No new Redis keys.
- **Alternatives considered**: A Redis TTL key per paused chat (lost on a Redis flush, a second
  source of truth, and the keyspace-expiry listener is best effort, see `ExpiryService`). A
  `BullMQ` delayed job (a new dependency, rejected by the constitution's stack rule). Reusing
  `client_activities` (its actor columns are NOT NULL, so an automatic resume has no valid actor,
  and the table means "who changed a client").

## R6. Recording messages that the assistant does not answer

- **Decision**: `message_replies` gets `answered BOOLEAN NOT NULL DEFAULT true`. An unanswered
  exchange stores the customer's text and `reply = ''`, with `answered = false`. A new
  `CreateUnansweredMessageSchema` (`chatId`, `message`) and `ConversationsService
  .createUnansweredMessage` write it; the existing schema (reply required) is unchanged.
  - While paused, each incoming message becomes its own unanswered exchange (no batching).
    Attachments are not sent to Gemini: the stored text is `[image]` or `[voice message]`.
  - A batch that was waiting when the pause started (checkpoints 2 and 4) is stored as one
    unanswered exchange with its messages joined by a line break, like an answered batch.
- **Rationale**: `reply` stays a non-null string, so the response shape that exists today does not
  change for any consumer. `answered` is a new additive field. Spending LLM calls on a paused
  conversation would cost money for nothing.
- **Alternatives considered**: Make `reply` nullable (changes an existing field's type, which
  constitution III treats as breaking). A second table for unanswered messages (two sources for
  one thread view, and the thread would need a union query).

## R7. Conversations list and detail for the dashboard

- **Decision**:
  - New `GET /chats/{chatId}` (a header for the thread, deep links). `GET /chats` and the new
    route return a mapped `ChatRecord` instead of the raw row: the old fields plus `clientName`,
    `paused`, `pausedAt`, `pausedUntil`, `pausedBy` and `lastExchange`. All additions.
  - `lastExchange` for a page comes from one `DISTINCT ON (chat_id)` query over the page's chat
    IDs (`$queryRaw` in the repository, typed rows, `left(message, 200)` and `left(reply, 200)`
    for the preview). It uses the existing `(chat_id, created_at)` index.
  - Search by customer identifier is the existing exact `senderId` filter (FR-002). New filter
    `paused=true|false`.
  - `pausedBy` is returned to ADMIN only; a CLIENT-role reader gets `null` (do not expose an
    administrator's name to a customer's business).
  - `pause` and `resume` are `POST /chats/{chatId}/pause` and `/resume`, method-level
    `@Roles('ADMIN')` (the guard uses `getAllAndOverride`, handler first). They answer `200` with
    the updated `ChatRecord`.
  - Indexes: `chats(updated_at)` for the all-clients list, `chats(paused_until)` for the sweeper.
- **Rationale**: One extra query per page, not one per chat. Mapping the row fixes the "return
  mapped records" rule of constitution I for this repository.
- **Alternatives considered**: Denormalize `last_message` columns onto `chats` (an extra write on
  every exchange and a backfill). Prisma `distinct` plus `orderBy` (depends on `nativeDistinct`,
  and otherwise fetches every exchange of the page's chats).

## R8. Decision basis for classified comments

- **Decision**:
  - Enum `CommentDecisionBasis { RULES, AI_MODEL, SAFE_FALLBACK, UNKNOWN }` and two columns on
    `comment_replies`: `decision_basis NOT NULL DEFAULT 'UNKNOWN'` and `decision_model
    VARCHAR(100) NULL`. Existing rows keep `UNKNOWN`.
  - `Classification` (rules and LLM services) gains optional `model`. The LLM service returns it
    with the label (`{ type, reason: 'llm <model>', model }`). `PriorityInboxService` derives the
    basis where it already decides: rules result → `RULES`; LLM label → `AI_MODEL` + `model`;
    LLM `unsure` that falls back to spam → `SAFE_FALLBACK` (the existing `", fallback to
    spam"` reason text is kept). The empty-comment guard in the LLM service is unreachable (rules
    decide empty comments first) and counts as `RULES`.
  - `CommentsRepository.save` writes both columns in the `create` and `update` branches, so a
    re-classification keeps only the latest basis (FR-021).
  - `GET /comment-replies` accepts `decisionBasis` (case-insensitive, same pattern as
    `classificationField`) and returns `decisionBasis`, `decisionModel` and `clientName`.
  - `@@index([created_at, id])` on `comment_replies` (all-clients list and the export's keyset).
- **Rationale**: The reason text already names the model (`llm gemini-…`) but only as free text,
  which cannot be filtered or counted. A column can (FR-022, FR-023, SC-007).
- **Alternatives considered**: Parse the `reason` string (fragile: it changes with wording).
  Store the whole classifier trace as JSON (more than the analysis needs).

## R9. Comments export: streaming CSV

- **Decision**: `GET /comment-replies/export`, method-level `@Roles('ADMIN')`.
  - **Query**: the list's filters only (`clientId`, `platform`, `classification`,
    `decisionBasis`, `commentId`, `from`, `to`). No `page`, `limit` or order. Output order is
    `created_at DESC, id ASC`.
  - **Streaming**: the controller returns a `StreamableFile` built from `Readable.from(asyncGen)`.
    The generator reads with keyset pages of `COMMENT_EXPORT_BATCH` rows (default 1,000) on
    `(created_at, id)`, so memory stays flat for any size (FR-024, SC-013) and Node back-pressure
    paces the database.
  - **Snapshot**: `created_at <= startedAt` is added to the filter, so rows that arrive during the
    export are not included and the file matches the list total at the start (FR-024).
  - **Format**: `text/csv; charset=utf-8`, a UTF-8 BOM (Excel then shows Arabic correctly), a
    header row, CRLF line ends, and RFC 4180 quoting. Columns: `id, clientId, clientName,
    platform, commentId, comment, classification, decisionBasis, decisionModel, reason,
    createdAt`. Headers: `Content-Disposition: attachment; filename="comments-<yyyymmdd-hhmmss>.csv"`
    and `Cache-Control: no-store`.
  - **Formula injection**: a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return
    is prefixed with `'`. Comment text and reasons are customer-controlled and analysts open the
    file in a spreadsheet, so this is a security requirement (constitution IV), not polish.
  - **Failure**: no `Content-Length`, chunked transfer. A database error mid-stream destroys the
    stream, so the client sees a failed download and never a file that looks complete (FR-024).
    The audit record (R10) says `completed = false`.
  - No row cap (clarification). Concurrency is bounded by the single read pattern and the batch
    size, not by a limit. SC-013 is checked with 100,000 rows.
- **Rationale**: No new dependency. `fast-csv`-style libraries add little for 11 columns, and the
  escaping and the formula rule need our own tests anyway.
- **Alternatives considered**: Build the file in memory (a 100,000-row file is tens of MB per
  request). A background job that emails a link (a new subsystem, and out of scope). Offset
  paging inside the generator (each page rescans the skipped rows).

## R10. The download record

- **Decision**: Table `comment_export_records`: `id`, `actor_id`, `actor_name`, `actor_email`
  (copied, no foreign key), `filters JSONB` (validated by `ExportFiltersSchema`, read through
  `readExportFilters`), `row_count INT NULL`, `completed BOOLEAN NOT NULL DEFAULT false`,
  `created_at`, `updated_at`.
  - `CommentsService.export` inserts the row before the first byte (`completed = false`), and the
    generator's `finally` updates `row_count` with the rows actually written and sets
    `completed = true` only when the last page was written. A request that is aborted or a
    process that dies leaves `completed = false`, which is the correct record.
  - The record holds filters and counts only: no comment text, no client name (FR-030). No screen
    reads it; operators query the table.
- **Rationale**: One row per download, written in two steps, answers "who, when, what filters,
  how many rows, did it finish" with no log parsing.
- **Alternatives considered**: Log lines only (not queryable, and logs rotate). `client_activities`
  (a download spans several clients and is not a client change).

## R11. Business information, services and offers for the dashboard

Checked against the current code. These gaps would block the screens, so they are fixed here.

| Gap found | Decision |
|---|---|
| `GET /services` and `GET /offers` have no client filter (`where = {}`), so the dashboard cannot list one client's data | Add optional `clientId` (UUID) to both query schemas. Add `{ id: 'asc' }` as the order tiebreaker (constitution I). Additive |
| `ServicesService` never checks that `offerId` belongs to the service's client (the schema comment says "app-level rule") | `ServicesModule` imports `OffersModule` and `ServicesService` calls the exported `OffersService.findById`. A missing or foreign offer is `422 INPUT_VALIDATION_ERROR` on `offerId` (FR-039, US6-6) |
| `UpdateServiceSchema` and `UpdateOfferSchema` accept `clientId`, so a record can be moved to another client | The service rejects an update whose `clientId` differs from the stored one (`422` on `clientId`). The same value is still accepted, so existing requests keep working |
| `@Param('id') id: string` is not validated in the services and offers controllers; `business-info` takes `clientId` the same way | `IdParamDto` for `:id` and a new `ClientIdParamDto` for `:clientId`, so a bad id is `422` (constitution II) |
| `GET /business-info/client/:clientId` answers `200` with an empty body when none exists | `404 NOT_FOUND`. The dashboard shows an empty form on a 404 |
| `PUT /business-info/client/:clientId` takes `CreateBusinessInfoDto`: it needs `clientId` in the body and resets array fields that are not sent | The body becomes `UpdateBusinessInfoSchema` plus an optional `clientId` that must equal the route's. An omitted field is unchanged, `null` clears a nullable field |
| Deleting an offer: FK is `ON DELETE SET NULL` | Already correct (US6-5). The dashboard's confirmation counts the linked services from the services list |

- **Rationale**: These modules are ADMIN-only and their only consumer today is Postman (updated in
  the same change), so the tightened cases are documented in Complexity Tracking. No cache
  eviction is needed because the DM path reads fresh (R1).
- **Not done (kept out of scope)**: CLIENT-role tenant scoping on these routes (a known follow-up
  of the constitution), and activity-record entries for service, offer and business-info edits
  (spec assumption).

## R12. Release order and rollback (hard cut)

- **Decision**:
  1. Prepare: one n8n workflow per client at `{base}/{endpoint}`, and the dashboard build ready.
  2. Add `N8N_BASE_URL` (and the two optional variables) to the VM env file. **Keep
     `N8N_WEBHOOK_URL`** until the release is final.
  3. Deploy the backend. The migration is additive and every existing client becomes
     `chat_subscribed = false`: from this moment no client gets automatic DM replies (FR-047).
  4. Deploy the dashboard within the same window. The backend deploys first (constitution), but
     until the dashboard form exists the only way to subscribe is the API, so the gap must be
     short. A stop-gap is `PATCH /clients/{id}` from the Postman collection.
  5. Subscribe each client from the dashboard, using the "not subscribed" filter as the checklist.
  6. After a quiet period, remove `N8N_WEBHOOK_URL` from the env file.
- **Rollback**: the previous image ignores the new columns and tables (all additive) and reads
  `N8N_WEBHOOK_URL`, so chats resume through the shared workflow. The migration stays applied.
- **Rationale**: The hard cut is the product decision. The rollback path is what keeps it safe.
  The release steps go into [quickstart.md](./quickstart.md).

## R13. Test strategy

- **Unit** (co-located `*.spec.ts`, mocks only): `chat-workflow-url` (valid, trailing slash,
  encoded, origin mismatch); `N8nDeliveryService` (per-attempt route, unsubscribed → dead list,
  missing base); `PriorityInboxService` (drop, paused, normal, basis per path); `MessageSenderService`
  (paused before send); `ConversationsService` (pause durations, effective state, resume,
  `pausedBy` hidden, scoping); `ChatPauseSweeper`; `ClientsService` (the two rules, conflicts);
  schemas (endpoint regex, `decisionBasisField`, export query, pause body); CSV encoder (quotes,
  newlines, Arabic, BOM, formula prefixes); `CommentsService.export` (record lifecycle, snapshot
  bound, abort).
- **e2e** (supertest, real PostgreSQL and Redis; a `fetch` stub for the n8n base like
  `graph-stub.ts`): `chat-workflow` (routing for 3 clients, unsubscribed = nothing sent and
  nothing stored, endpoint change applies to the next message, dead-letter on unsubscribe),
  `chat-pause` (pause blocks and records, timed expiry through the sweeper with back-dated
  timestamps, resume), `comments-export` (CSV content, filters, 100,000-row stream, formula
  prefix, record), `client-data` (services, offers and business-info rules), `retention` (rows back-dated 13 and
  11 months, one run, SC-021), and rejections:
  401, CLIENT 403 on pause/resume/export/clients, wrong-tenant 404 on `GET /chats/{id}`.
- **Time**: pause expiry is tested by writing `paused_until` in the past and calling the sweeper,
  never by sleeping.

## R14. Dashboard approach

- **Decision**: The dashboard is built in `fekra-dashboard` from the regenerated
  `openapi/openapi.json` (as in features 001 and 002). It adds `/conversations`,
  `/conversations/:chatId`, `/comments`, the chat service section on the client form, a
  subscription column and filter on the clients list, and `/clients/:id/business-info`,
  `/services`, `/offers`. The CSV download uses an authenticated `fetch`, and it treats a stream
  that fails as an error. The details are in [contracts/dashboard-ui.md](./contracts/dashboard-ui.md).
- **Rationale**: Same stack, same error handling (`errorCode`, 422 `fieldErrors`) as before, so
  the new screens reuse the 001 form and list patterns.

## R15. Data retention (FR-049, FR-050)

- **Decision**: A new pipeline module, `src/retention/`, that owns no tables.
  - `RetentionService` (`OnModuleInit`/`OnModuleDestroy`) runs once 1 minute after boot, then
    every 24 hours.
  - It computes `cutoff = now − RETENTION_MONTHS` (calendar months, UTC) and calls two exported
    services: `ConversationsService.purgeBefore(cutoff)` and `CommentsService.purgeBefore(cutoff)`.
  - `RETENTION_MONTHS` is an integer ≥ 1, default 12. It is validated at construction, so a bad
    value fails at boot (constitution VIII).
  - Each repository deletes in batches of 5,000 rows (`DELETE … WHERE id IN (SELECT id … LIMIT
    5000)`, repeated until nothing is left), so locks stay short and DM handling is not slowed
    down:
    1. `chats` with `updated_at < cutoff`, which cascades to their exchanges and pause events;
    2. `message_replies` with `created_at < cutoff` in the remaining chats;
    3. `comment_replies` with `created_at < cutoff` (the first classification time).
  - The run logs the three counts at `log`, never any text. A failing run logs `error` and the
    next run retries; deletes are idempotent, so two instances running at once are harmless.
  - New index `message_replies(created_at)`. `chats(updated_at)` and `comment_replies(created_at,
    id)` already come from R7 and R8.
  - `comment_export_records` is not purged (it holds no customer text).
- **Rationale**: The same "interval in `onModuleInit`, stop in `onModuleDestroy`" pattern as the
  pause sweeper and the existing `ExpiryService`, with no new dependency. Keeping the deletes in
  the modules that own the tables respects constitution I. A chat's `updated_at` already moves on
  every customer message and every pause or resume, so it measures activity.
- **Alternatives considered**: A PostgreSQL `pg_cron` job (an extension the managed or container
  database may not have, and it bypasses the app's logging). A cron container on the VM (a manual
  VM step, which the constitution's delivery rules avoid). One huge `DELETE` per table (long locks
  on tables the DM path writes to).
- **Edge**: an export that runs during the deletion may write fewer rows than the total shown when
  it started. The download record keeps the true count. With one run a day this is rare, and the
  dashboard shows the file's own row count.

## R16. Database errors on the DM path (FR-025)

- **Decision**:
  - The route and workflow-data reads (R1) go to the database first. A successful read also
    refreshes the existing cache key (`client:account:{accountId}`, `client:workflow:{accountId}`,
    30 minutes, as today).
  - When the read throws (database unavailable), the reader falls back to that cached copy and
    logs `warn`. With no cached copy, the item is dropped with an `error` log (IDs only). A logged
    drop is the terminal state, and the message stays in the page's own Meta inbox.
  - The pause check (checkpoints 1, 2 and 4) fails open: if the chat cannot be read, the message
    is handled as not paused, with a `warn` log.
  - Recording never blocks handling (FR-025): `createUnansweredMessage`, the comment save with its
    decision basis, and the exchange recording all stay inside the existing catch-and-log pattern.
- **Rationale**: Before this feature the 30-minute cache let DMs be answered through a short
  database outage. Reading fresh first keeps FR-046 and FR-048 in normal operation, and the cache
  keeps the old resilience during an outage. During an outage the subscription or a pause can be
  up to 30 minutes stale. Pauses and outages are both rare, and blocking every reply during an
  outage to protect a possible pause is the worse trade.
- **Alternatives considered**:
  - Fail closed: no replies during any database blip, a regression from today.
  - A retry queue for messages: new Redis keys and a promote loop for a case the cache already
    covers.

## Deferred and open

- **Activity record** for service, offer and business-info edits: not recorded in this version
  (clarification).
- **Tenant scoping** of services, offers and business info for CLIENT-role users.
- **Tenant scoping** of services, offers and business info for CLIENT-role users.
