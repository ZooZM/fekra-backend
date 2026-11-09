# Data Model: Client Posts and Unreplied Comment Replies

**Feature**: `002-client-posts-backfill` | **Date**: 2026-11-09 | **Research**: [research.md](./research.md)

Three kinds of data:

- **Transient**: read live from the Meta Graph API and never stored.
- **Redis**: run state, kept up to 24 hours after a run ends.
- **PostgreSQL**: activity record entries, kept as feature 001 requires.

---

## 1. ClientPost (transient)

Built from one Graph page of posts (research R3). It is returned by `GET /clients/:id/posts`.

| Field | Type | Source (Facebook / Instagram) | Notes |
|---|---|---|---|
| `id` | string | `id` / `id` | Facebook: `{pageId}_{postId}`. Instagram: media ID |
| `platform` | `facebook` \| `instagram` | request | |
| `publishedAt` | ISO date-time | `created_time` / `timestamp` | |
| `text` | string \| null | `message` / `caption` | first 500 characters; `null` when the post has no text |
| `textTruncated` | boolean | | true when the text was cut at 500 |
| `thumbnailUrl` | string \| null | `full_picture` / `thumbnail_url` (video) or `media_url` | `https` only; `null` when absent |
| `permalink` | string | `permalink_url` / `permalink` | opens the post in a new tab (FR-005) |
| `commentsCount` | integer ≥ 0 | `comments.summary.total_count` / `comments_count` | display only. On Instagram it includes replies |
| `replyRun` | BackfillRun \| null | Redis `backfill:post:*` | the latest run on this post if it is running or ended < 24 h ago |

List envelope: `{ data: ClientPost[], meta: { limit, nextCursor: string | null, fetchedAt } }`.

## 2. UnrepliedCount (transient)

Returned by `GET /clients/:id/posts/:postId/unreplied-count`.

| Field | Type | Notes |
|---|---|---|
| `postId` | string | |
| `platform` | `facebook` \| `instagram` | |
| `checked` | integer ≥ 0 | top-level comments read, at most `COMMENT_BACKFILL_MAX` (500) |
| `unrepliedCount` | integer ≥ 0 | comments matching the rule below |
| `truncated` | boolean | true when the post has more than `checked` comments, so the count is a minimum (FR-007) |
| `checkedAt` | ISO date-time | |

**Unreplied rule** (FR-006): it is shared by the count and the run through
`PostCommentsService`. A top-level comment counts when all of these hold:

- `from.id ≠ accountId`;
- it is not hidden;
- none of its replies has `from.id = accountId`;
- on Instagram, its text is not empty.

## 3. PostComment (in memory, existing)

Unchanged shape, moved from `comment-backfill.service.ts` to `post-comments.service.ts`:
`{ id, text?, senderId?, createdAt (ms), hidden, replierIds[] }`.

Re-check result (research R7):
`'needs_reply' | 'answered' | 'hidden' | 'deleted' | 'check_failed'`, or a thrown access error.

## 4. BackfillRun (Redis hash `backfill:run:{runId}`)

The spec calls this a "reply run". It is returned by the run endpoints, embedded in `ClientPost.replyRun`,
and embedded in the start response as `run`.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | `runId` |
| `clientId` | UUID | |
| `accountId` | string | Facebook Page ID or Instagram account ID |
| `platform` | `facebook` \| `instagram` | |
| `postId` | string | |
| `state` | `running` \| `finished` \| `stopped` \| `interrupted` | see transitions below |
| `interruptReason` | `SERVER_RESTART` \| `COMMENT_REPLIES_DISABLED` \| `ACCOUNT_DISCONNECTED` \| `META_ACCESS_LOST` \| null | only when `interrupted` |
| `total` | integer | comments checked at start |
| `toAnswer` | integer ≥ 1 | unreplied comments at start (N in "handled X of N") |
| `handled` | integer | `queued + dropped + skipped` (computed on read, not stored) |
| `queued` | integer | accepted by the inbox |
| `dropped` | integer | refused by the inbox (duplicate or blocked sender) |
| `skipped` | integer | the re-check found it answered, hidden or deleted, or the check failed |
| `delaySeconds` | number | pause between two comments |
| `startedAt` | ISO date-time | |
| `estimatedEndAt` | ISO date-time | `startedAt + (toAnswer − 1) × delay` |
| `endedAt` | ISO date-time \| null | |
| `startedBy` | `{ id, name }` | admin who started it |
| `stoppedBy` | `{ id, name }` \| null | admin who stopped it |

Stored as flat hash fields (`startedById`, `startedByName`, ...). Counters are updated with
`HINCRBY`. The hash also keeps an internal `clientName`, which is never returned, so a stop
can be recorded in the activity record even after the client is deleted. No email or token is
stored in Redis.

### State transitions

```text
                 ┌─────────── worker reaches end of list ───────────► finished
                 │
start ──► running ┼─── admin stop (Lua CAS: state == running) ──────► stopped
                 │
                 └─── comment replies off / account disconnected /
                      token rejected / lock lost (restart) ─────────► interrupted(reason)
```

- Only `running` can change. The three end states are final.
- Every change out of `running` sets `endedAt`, sets the hash and pointer TTL to
  `COMMENT_BACKFILL_RESULT_TTL_SEC`, and releases the lock if this run still holds it.
- **Stale detection**: a `running` run whose lock is missing or holds another `runId` becomes
  `interrupted` (`SERVER_RESTART`) on its next read.

### Related Redis keys (constants in `src/inbox/inbox.constants.ts`)

| Constant | Key | Type | TTL |
|---|---|---|---|
| `BACKFILL_RUN` | `backfill:run:{runId}` | hash | 48 h while running; 24 h after it ends |
| `BACKFILL_LOCK` | `backfill:lock:{platform}:{postId}` | string = runId | `delay + 60 s`, renewed each comment |
| `BACKFILL_POST` | `backfill:post:{platform}:{postId}` | string = runId (latest) | same as the run hash |

## 5. ClientActivity (PostgreSQL, changed)

Existing table `client_activities` from feature 001. The migration
`<timestamp>_reply_run_activity` is additive:

```prisma
enum ClientActivityAction {
  CREATED
  UPDATED
  DELETED
  ACCESS_TOKEN_REPLACED
  REPLY_RUN_STARTED   // new
  REPLY_RUN_STOPPED   // new
}

model ClientActivity {
  // ...existing fields unchanged...
  // REPLY_RUN_* only, validated by ReplyRunActivityDetailsSchema; null for other actions
  details Json? @map("details")
}
```

```sql
ALTER TYPE "ClientActivityAction" ADD VALUE 'REPLY_RUN_STARTED';
ALTER TYPE "ClientActivityAction" ADD VALUE 'REPLY_RUN_STOPPED';
ALTER TABLE "client_activities" ADD COLUMN "details" JSONB;
```

The release currently running never reads these rows, and the column is nullable, so the
migration is backward compatible (constitution VI).

`ReplyRunActivityDetailsSchema` (`@common/zod/json-columns.schema.ts`):

```ts
z.strictObject({
  runId: z.uuid(),
  platform: z.enum(['facebook', 'instagram']),
  accountId: metaId,
  postId: metaPostId,
  toAnswer: z.int().min(0),
  handled: z.int().min(0).optional(), // REPLY_RUN_STOPPED only
})
```

Each entry also carries the existing columns: `clientId`, `clientName`, `actorId`,
`actorName`, `actorEmail`, `action`, `changedFields = []` and `createdAt`.

## 6. Validation rules (Zod, constitution II)

| Input | Schema | Rule |
|---|---|---|
| `:id` (client) | `IdParamSchema` | UUID |
| `:postId` | `metaPostId` (moved from `comment-backfill.schema.ts` to `@common/zod/primitives`) | `^\d{5,30}(_\d{5,30})?$` |
| `?platform` | `z.enum(['facebook','instagram'])` | required |
| `?after` | `graphCursor` | `^[A-Za-z0-9_\-=]+$`, 1–512 chars, optional |
| `?limit` | `z.coerce.number().int().min(1).max(25)` | default 25 |
| `:id` (run) | `IdParamSchema` | UUID |
| backfill body | `CommentBackfillSchema` (unchanged) | `{ accountId: metaId, postId: metaPostId }`, strict |

Each schema has a `strictObject` wrapper, a `createZodDto` DTO and `z.infer` types.
