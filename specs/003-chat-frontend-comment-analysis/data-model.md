# Data Model: Chat Flow in the Dashboard

**Feature**: `003-chat-frontend-comment-analysis` | **Date**: 2026-11-14 | **Research**: [research.md](./research.md)

All changes are in PostgreSQL, in one additive migration (`<ts>_chat_workflow_pause_export`).
There are **no new Redis keys**: the existing `inbox:*`, `n8n:*` and `dmbuf:*` keys are reused
unchanged. The two existing client caches (`client:account:*`, `client:workflow:*`) are read on
the DM path only as a fallback when the database read fails (research R1, R16).

---

## 1. Client (changed)

| Field | Column | Type | Rules |
|---|---|---|---|
| `chatWorkflowEndpoint` | `chat_workflow_endpoint` | `VARCHAR(100) NULL UNIQUE` | `^[A-Za-z0-9_-]{1,100}$`. One path segment. Unique across clients (FR-032, FR-034, FR-035). `null` = none |
| `chatSubscribed` | `chat_subscribed` | `BOOLEAN NOT NULL DEFAULT false` | `true` only with an endpoint (FR-043, FR-045). Existing and new clients start `false` (FR-047) |

- **Database guard**: `CHECK (NOT chat_subscribed OR chat_workflow_endpoint IS NOT NULL)`
  (constraint `clients_chat_subscription_needs_endpoint`). The service checks first and answers
  with a field error (research R4).
- **Edit rules**: both fields go through `PATCH /clients/{id}` with `version` (compare-and-swap)
  and appear in the `UPDATED` activity entry as field names only (FR-036, FR-046).
- **Records**: `ClientRecord` and `ClientRecordSchema` gain both fields. The workflow payload
  (`ClientWorkflowData`) carries them too.

**Chat route** (read model, not stored): `{ clientId, name, chatSubscribed,
chatWorkflowEndpoint }`, read uncached by account ID or client ID (research R1).

State of a client's chat service:

```text
            set endpoint                 subscribe (needs endpoint)
[no endpoint] ─────────────▶ [endpoint, not subscribed] ─────────────▶ [subscribed]
      ▲        clear endpoint            ▲          unsubscribe (endpoint kept)  │
      └──────────────────────────────────┘◀─────────────────────────────────────┘
  Clearing the endpoint of a subscribed client is refused (422).
```

## 2. Chat (changed)

| Field | Column | Type | Rules |
|---|---|---|---|
| `pausedAt` | `paused_at` | `TIMESTAMP(3) NULL` | set by pause, cleared by resume or expiry |
| `pausedUntil` | `paused_until` | `TIMESTAMP(3) NULL` | `null` with `pausedAt` set = until resumed |
| `pausedById` | `paused_by_id` | `UUID NULL` | copied from the admin, no foreign key (outlives the user) |
| `pausedByName` | `paused_by_name` | `VARCHAR(255) NULL` | copied |

- **New indexes**: `@@index([updatedAt])` (all-clients list ordered by activity) and
  `@@index([pausedUntil])` (sweeper).
- **Effective pause** (research R5), used everywhere and never stored as a flag:

  ```text
  paused = pausedAt != null AND (pausedUntil == null OR pausedUntil > now)
  ```

Pause state machine:

```text
                 pause(d)                       pause(d') (replaces d)
[active] ───────────────────────▶ [paused] ◀────────────────────┐
   ▲                                 │  └───────────────────────┘
   │  resume (admin)                 │
   ├─────────────────────────────────┤
   │  now ≥ pausedUntil (no one acts; effective at once,
   └─ sweeper records the automatic RESUMED within PAUSE_SWEEP_INTERVAL_MS)
  resume on [active] = 200, no change, no event.
```

Durations (`PauseChatSchema.duration`): `until_resumed` → `pausedUntil = null`; `1h`, `24h`, `7d`
→ `now + d` (FR-009).

## 3. ChatPauseEvent (new, `chat_pause_events`): the spec's "Pause Record"

Append-only, like `client_activities`, so it has no `updated_at`.

| Field | Column | Type | Notes |
|---|---|---|---|
| `id` | `id` | `UUID` PK | |
| `chatId` | `chat_id` | `UUID` FK → `chats.id` `ON DELETE CASCADE` | indexed with `created_at` |
| `action` | `action` | enum `ChatPauseAction { PAUSED, RESUMED }` | |
| `duration` | `duration` | `VARCHAR(16) NULL` | `PAUSED` only: `until_resumed`, `1h`, `24h`, `7d` |
| `until` | `until` | `TIMESTAMP(3) NULL` | `PAUSED` only: the end time, `null` = until resumed |
| `actorId` | `actor_id` | `UUID NULL` | `null` = automatic resume after a timed pause (FR-014) |
| `actorName` | `actor_name` | `VARCHAR(255) NULL` | copied |
| `createdAt` | `created_at` | `TIMESTAMP(3)` | for an automatic resume: the scheduled end time |

`@@index([chatId, createdAt])`. Deleting a client cascades to its chats and their events.

## 4. MessageReply (changed)

| Field | Column | Type | Rules |
|---|---|---|---|
| `answered` | `answered` | `BOOLEAN NOT NULL DEFAULT true` | `false` = the assistant did not answer (paused, or a reply in flight was cancelled) |

- An unanswered exchange stores `reply = ''` (research R6). Existing rows stay `answered = true`.
- Writes: `CreateMessageReplySchema` (answered, unchanged) and the new
  `CreateUnansweredMessageSchema { chatId, message }`. Attachments of a paused conversation are
  stored as `[image]` or `[voice message]`.

## 5. CommentReply (changed)

| Field | Column | Type | Rules |
|---|---|---|---|
| `decisionBasis` | `decision_basis` | enum `CommentDecisionBasis { RULES, AI_MODEL, SAFE_FALLBACK, UNKNOWN }`, `NOT NULL DEFAULT 'UNKNOWN'` | set on every save, create and update (FR-021, FR-022) |
| `decisionModel` | `decision_model` | `VARCHAR(100) NULL` | the model's name for `AI_MODEL`, otherwise `null` |

- **New index**: `@@index([createdAt, id])` (all-clients list and export keyset).
- How the basis is set (research R8):

  | Path in `PriorityInboxService` | `classification` | `decisionBasis` | `decisionModel` |
  |---|---|---|---|
  | rules decided | rule's label | `RULES` | `null` |
  | rules `unsure` → LLM label | LLM's label | `AI_MODEL` | the model that answered |
  | LLM failed, retries used up | `SPAM` | `SAFE_FALLBACK` | `null` |
  | rows from before this feature | unchanged | `UNKNOWN` | `null` |

- `SaveCommentReplySchema` gains both fields. `ReclassifyCommentSchema` (the upsert's update
  branch) gains both too, so only the latest basis is kept.

## 6. CommentExportRecord (new, `comment_export_records`): the spec's "Download Record"

| Field | Column | Type | Notes |
|---|---|---|---|
| `id` | `id` | `UUID` PK | |
| `actorId` | `actor_id` | `UUID` | copied, no foreign key |
| `actorName` | `actor_name` | `VARCHAR(255)` | copied |
| `actorEmail` | `actor_email` | `VARCHAR(255)` | copied |
| `filters` | `filters` | `JSONB` | `ExportFiltersSchema`: `{ clientId?, platform?, classification?, decisionBasis?, commentId?, from?, to?, snapshotAt }`. Never comment text |
| `rowCount` | `row_count` | `INT NULL` | rows actually written; `null` until the stream ends |
| `completed` | `completed` | `BOOLEAN NOT NULL DEFAULT false` | `true` only after the last row is written |
| `createdAt` | `created_at` | `TIMESTAMP(3)` | download start |
| `updatedAt` | `updated_at` | `TIMESTAMP(3)` | download end |

`@@index([actorId])`, `@@index([createdAt])`. Lifecycle: insert at start (`completed = false`) →
stream → `finally` writes `rowCount` and, on success only, `completed = true` (research R10).

## 7. Business information, services and offers (no schema change)

Field rules are the existing Zod schemas (spec FR-038 to FR-040). Behavior added at the service
layer (research R11):

- `Service.offerId` must reference an offer whose `clientId` equals the service's `clientId`;
  otherwise `422` on `offerId`.
- `clientId` of a service or offer cannot change on update (`422` on `clientId` if it differs).
- Lists filter by `clientId` and order with `{ id: 'asc' }` as the tiebreaker.
- `GET /business-info/client/{clientId}` → `404 NOT_FOUND` when there is none.

## 8. API read models (not stored)

**ChatRecord** (`GET /chats`, `GET /chats/{chatId}`, pause, resume):

| Field | Type | Notes |
|---|---|---|
| `id`, `clientId`, `platform`, `senderId`, `receiverId`, `createdAt`, `updatedAt` | as today | unchanged; `platform` stays `FACEBOOK` / `INSTAGRAM` |
| `clientName` | string | |
| `paused` | boolean | effective state |
| `pausedAt`, `pausedUntil` | date-time \| null | `null` when not effectively paused |
| `pausedBy` | `{ id, name }` \| null | ADMIN readers only; `null` for CLIENT-role readers |
| `lastExchange` | `{ message, reply, answered, createdAt }` \| null | `message` and `reply` are the first 200 characters |

**ExchangeRecord** (`GET /chats/{chatId}/messages`): `id, chatId, message, reply, answered,
createdAt`. Unchanged apart from `answered`.

**CommentRecord** (`GET /comment-replies`): the current fields plus `clientName`,
`decisionBasis` and `decisionModel`.

**CSV row** (`GET /comment-replies/export`): `id, clientId, clientName, platform, commentId,
comment, classification, decisionBasis, decisionModel, reason, createdAt`.

## 9. Migration summary

One migration, all additive and safe for the running release (constitution VI):

1. `CREATE TYPE "ChatPauseAction"` and `"CommentDecisionBasis"`.
2. `ALTER TABLE clients ADD chat_workflow_endpoint VARCHAR(100), ADD chat_subscribed BOOLEAN NOT
   NULL DEFAULT false`, unique index on the endpoint, the `CHECK` constraint.
3. `ALTER TABLE chats ADD paused_at, paused_until, paused_by_id, paused_by_name` (all nullable),
   indexes on `updated_at` and `paused_until`.
4. `ALTER TABLE message_replies ADD answered BOOLEAN NOT NULL DEFAULT true`, index on
   `created_at` (retention).
5. `ALTER TABLE comment_replies ADD decision_basis … DEFAULT 'UNKNOWN', ADD decision_model`,
   index on `(created_at, id)`.
6. `CREATE TABLE chat_pause_events` and `comment_export_records` with their indexes and FK.

The previous release never reads the new columns, and every new `NOT NULL` column has a default,
so its inserts keep working. No backfill is needed: the defaults are the intended values
(`chat_subscribed = false` is the hard cut, `answered = true`, `decision_basis = UNKNOWN`).

## 10. Retention (FR-049, FR-050, research R15)

No stored state: the period comes from `RETENTION_MONTHS` (default 12, minimum 1).

| Table | Deleted when | Also removes |
|---|---|---|
| `chats` | `updated_at < cutoff` (no activity for the period) | its `message_replies` and `chat_pause_events` (cascade) |
| `message_replies` | `created_at < cutoff`, in chats that stay | |
| `comment_replies` | `created_at < cutoff` (first classification) | |
| `comment_export_records`, `client_activities` | never by this run (no customer text) | |

`cutoff = now − RETENTION_MONTHS`, computed once per run.
