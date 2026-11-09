# Research: Client Posts and Unreplied Comment Replies

**Feature**: `002-client-posts-backfill` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

Each entry resolves an open technical question from the plan's Technical Context. Facts about
the current code were checked in the repository on 2026-11-09 (commit `4f65fc3`).

"Run" in the spec is "backfill run" in the code (`CommentBackfillService`). The API keeps the
existing `backfill` name; the dashboard says "reply run".

---

## R1. Where the posts code lives

- **Decision**: Add a new pipeline module, `src/client-posts/`, that owns no tables. It serves
  `GET /clients/:id/posts` and `GET /clients/:id/posts/:postId/unreplied-count`, and imports
  `ClientsModule` (client lookup and token), `InboxModule` (comment rules and runs) and
  `GraphApiModule`. Remove `getAllPosts` and `replyToPost` from `ClientsService`, and remove the
  `GraphApiService` and `CommentBackfillService` injections and the `InboxModule` import from
  `ClientsModule`.
- **Rationale**: The posts code added in `4f65fc3` created a cycle (`ClientsService` ↔
  `CommentBackfillService`, both through `forwardRef`). With the new module, dependencies point
  one way: `client-posts` → `clients`, and `client-posts` → `inbox` → `clients` (the existing
  `forwardRef` stays only between `inbox` and `clients`). Constitution I allows pipeline modules
  without a repository layer.
- **Alternatives considered**: Keep the code in `ClientsService` (keeps the cycle, and puts Graph
  calls in a CRUD service). Put the posts endpoints in `inbox` (wrong URL family: the dashboard
  reads posts per client).

## R2. The two endpoints from commit 4f65fc3

- **Decision**: Replace both.
  - `GET /clients/:id/posts` keeps its path with a new, working implementation (R3).
  - `GET /clients/:accountId/posts/:postId/reply` is removed. The dashboard starts runs with the
    existing `POST /inbox/comments/backfill`.
- **Rationale**: Neither endpoint can work today, so no consumer depends on them.
  - `/clients/:id/posts` validates `id` as a UUID (`IdParamDto`) but looks the client up with
    `findByAccountId`, which matches Meta account IDs, so every call returns 404. It also always
    reads `client.fbPageId`, even for Instagram, and returns raw Graph data without counts.
  - The `/reply` route starts sending public replies from a `GET`, has no Zod validation of its
    params (constitution II), and duplicates `POST /inbox/comments/backfill`.
- **Alternatives considered**: Fix both in place (a side effect on `GET` breaks HTTP semantics,
  and two start endpoints would drift apart).

## R3. Reading posts from Facebook and Instagram

- **Decision**: One Graph call per page of posts, through `GraphApiService.get` (10 s timeout,
  3 attempts on temporary errors), always on `graph.facebook.com` with the client's Page token.
  This is the same host and token the backfill and `CommentReplyService` already use for
  Instagram.
  - Facebook: `GET /{fbPageId}/posts?fields=id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0)&limit=25[&after=…]`
  - Instagram: `GET /{instaAccountId}/media?fields=id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,comments_count&limit=25[&after=…]`
  - Each post is mapped to `{ id, platform, publishedAt, text, textTruncated, thumbnailUrl,
    permalink, commentsCount, replyRun }`.
    - `text` is capped at 500 characters on the server; the UI shortens it to one line (FR-005).
    - `thumbnailUrl` is `full_picture` on Facebook. On Instagram it is `thumbnail_url` for
      videos and `media_url` otherwise.
    - `commentsCount` comes from Facebook's `summary.total_count` (top-level comments) or
      Instagram's `comments_count` (which includes replies). It is only a display number;
      the unreplied count is computed separately (R4).
  - Paging uses Graph cursors. The response is `{ data, meta: { limit, nextCursor, fetchedAt } }`.
    `nextCursor` is `paging.cursors.after` when `paging.next` exists, and `null` otherwise. The
    dashboard passes it back as `?after=`.
  - `fetchedAt` is the server time of the read (FR-009).
- **Rationale**: Graph exposes cursors, not page numbers or totals, so the constitution's
  `PaginatedResult` (`total`, `page`, `totalPages`) cannot be filled. Counting every post of
  an account would cost one call per 100 posts on every load. The `{ data, meta }` envelope is
  kept, so the frontend list code stays similar. This is justified in plan.md (Complexity
  Tracking).
- **Alternatives considered**: Offset pages built by walking cursors on the server (one Graph
  call per skipped page, and cursors expire). `/feed` instead of `/posts` (it includes visitor
  posts, which the page cannot answer through this flow). Store posts in PostgreSQL (the spec
  says counts are read live, and a store would go stale).

## R4. Counting unreplied comments with the same rule as the run (FR-006, FR-007, SC-002)

- **Decision**: Move the comment fetch and the "needs a reply" rule out of
  `CommentBackfillService` into a new `PostCommentsService` (`src/inbox/post-comments.service.ts`).
  The count endpoint and the run both call it, so they cannot drift apart.
  - `listUnreplied(platform, accountId, postId, token)` returns
    `{ checked, unreplied: PostComment[], truncated }`. `truncated` is true when the
    `COMMENT_BACKFILL_MAX` limit (500) was reached and Graph still had a `next` page.
  - The rule is the current `needsReply`: not written by the account, not hidden, no reply from
    the account, and on Instagram, not empty text.
- **Count endpoint**: `GET /clients/:id/posts/:postId/unreplied-count?platform=` returns
  `{ postId, platform, checked, unrepliedCount, truncated, checkedAt }`. The dashboard calls it
  once per post after the list renders (FR-024), and again for a single post on "retry". It skips
  the call when `commentsCount` is 0 and shows 0.
- **Facebook post ownership**: on Facebook, `postId` must start with `{fbPageId}_`; otherwise
  the endpoint returns `404 META_POST_NOT_FOUND`. This cheap check stops an admin URL from
  counting another page's post with this client's token. Instagram media IDs carry no owner
  prefix; Graph refuses media the token cannot read (code 100 → 404).
- **Rationale**: One request per post lets counts appear progressively and fail independently
  (clarification Q5). Using the same code path is the only reliable way to meet SC-002.
- **Alternatives considered**: One request for all 25 counts (slowest post blocks all, and one
  failure fails all). A server-sent events stream (a new transport for a small gain). Caching
  counts in Redis (FR-009 wants the state at load time, and refresh must reload).

## R5. Run state and the one-run-per-post lock

- **Decision**: Keep run state in Redis so every API instance sees the same runs. Keys are
  constants in `inbox.constants.ts`:

  | Key | Type | Content | TTL |
  |---|---|---|---|
  | `backfill:run:{runId}` | hash | the run (data-model.md) | 48 h while running; `COMMENT_BACKFILL_RESULT_TTL_SEC` (24 h) after it ends |
  | `backfill:lock:{platform}:{postId}` | string | `runId` of the run in progress | `delay + 60 s`, renewed before each comment |
  | `backfill:post:{platform}:{postId}` | string | `runId` of the latest run on the post | same as the run hash |

  - **Start** takes the lock with `SET … NX PX`. If the lock is taken, the start is refused
    with `409 CONFLICT` and `details.runId` (FR-016). Two admins starting at the same moment
    get one run (spec edge case).
  - **Renew and release** use small Lua scripts that act only if the lock still holds this run's
    ID (compare-and-set), so a late worker never renews or deletes a newer run's lock.
  - The in-memory `running` set is removed.
- **Rationale**: The constitution puts asynchronous work on Redis (VII). The current in-memory
  set protects only one instance (its own comment says so). A lock TTL tied to the pace, plus
  renewal, frees the post on its own if the process dies.
- **Alternatives considered**: A PostgreSQL `reply_runs` table (durable, but the run is
  temporary state that the spec keeps for 24 hours, and it would add a migration and a
  repository for data nobody queries later; the lasting trace is the activity record, R10).
  BullMQ (a new dependency for one loop).

## R6. Progress (FR-017) and what "handled" means

- **Decision**: The worker loop stays in `CommentBackfillService.feed`. For each comment it:
  1. waits `COMMENT_BACKFILL_DELAY_MS` (except before the first comment);
  2. reads the run state, and exits if it is no longer `running` (stopped by any instance);
  3. renews the lock;
  4. re-checks the client's settings and the comment (R7, R8);
  5. pushes the comment to the inbox;
  6. increments one counter with `HINCRBY`:
     - `queued`: accepted by the inbox, so the normal comment flow will answer, like or hide it;
     - `dropped`: refused by the inbox as a duplicate or because the sender is blocked;
     - `skipped`: the re-check found it no longer needs a reply, or the check failed.

  `handled = queued + dropped + skipped`. This is the "handled X of N" of FR-017, where N is
  `toAnswer`.
  - `GET /inbox/comments/backfill/runs/:id` returns the run.
  - The posts list adds each post's latest run as `replyRun`: one Redis pipeline reads
    `backfill:post:*` and the run hashes for the 25 posts.
  - The dashboard polls the runs that are `running` every 5 seconds (FR-017 asks for at most
    10).
- **Rationale**: The inbox handles a queued comment within seconds (1 s dispatch tick, a reserved
  comment slot). The run cannot know whether the final action was a reply, a like or a hide, so
  "handled" means "processed by the run", as the spec defines it.
- **Alternatives considered**: Count only comments that got a reply (would need a callback from
  `CommentReplyService` keyed by run, plus extra state for LLM retries that can be parked for
  minutes). Push progress over WebSockets (a new transport; polling a Redis hash every 5 s is
  cheap for up to 10 admins).

## R7. Re-checking each comment before it is handled (FR-023)

- **Decision**: `PostCommentsService.recheck(platform, accountId, commentId, token)` makes one
  Graph call:
  - Facebook: `GET /{commentId}?fields=id,is_hidden,comments.limit(100){from{id}}`
  - Instagram: `GET /{commentId}?fields=id,hidden,replies.limit(50){from{id}}`

  It returns one of:
  - `needs_reply`: the comment is pushed to the inbox;
  - `answered` (a reply from the account), `hidden`, or `deleted` (Graph code 100): skipped;
  - `check_failed` (a temporary error after `GraphApiService` retries): skipped, so the comment
    stays unreplied and the next run picks it up;
  - a token or permission error (code 190, 10, 200–299): the run ends as `interrupted` with
    reason `META_ACCESS_LOST` (R8), because every following check would fail the same way.
- **Rationale**: This is what clarification Q3 decided. When the check fails, skipping is safer
  than replying: a missed reply can be retried, but a duplicate public reply cannot be taken
  back.
- **Cost**: One extra Graph call per comment, every 5 seconds or more per run. That is well below
  Meta's page rate limits.
- **Alternatives considered**: Re-check the whole post every N comments (cheaper, but leaves a
  window for duplicate replies). Re-check inside `CommentReplyService` for every comment,
  including live ones (changes live behavior, which is out of scope).

## R8. Ending a run: finished, stopped, interrupted (FR-021, FR-022)

- **Decision**: A run is in one of four states: `running`, `finished`, `stopped` or
  `interrupted`. The last three are final, and their hash TTL becomes 24 hours.
  - **Stop** (`POST /inbox/comments/backfill/runs/:id/stop`): a Lua script changes
    `running → stopped` and records `stoppedBy` and `endedAt`, then releases the lock. A newer
    run on the post can start right away, and the inbox dedupe key (`inbox:seen:*`, 1 h) stops a
    comment from being queued twice. If the run has already ended, the response is
    `409 BACKFILL_RUN_ENDED` with `details.state` (spec edge case). The worker notices the
    state at step 2 of R6, so at most the comment in flight is still completed (SC-009).
  - **Interrupted**, with `interruptReason`:
    - `SERVER_RESTART`: on shutdown, `onModuleDestroy` marks this instance's runs. This is best
      effort, because Redis may already be closing. The reliable path: whenever a run is read
      (status, posts list, start), a run still marked `running` whose lock is missing or held
      by another run is changed to `interrupted` by a Lua compare-and-set. A crashed process is
      detected within `delay + 60 s`.
    - `COMMENT_REPLIES_DISABLED`: before each comment the worker reads the client
      (`getClientDataForWorkFlow`, the same read the inbox makes per comment). If
      `commentReplyConfig.enabled` is false, the run ends.
    - `ACCOUNT_DISCONNECTED`: the client was deleted, or this account was removed from it.
    - `META_ACCESS_LOST`: the token was rejected during a re-check (R7).
  - **Finished**: the worker reached the end of its list.
- **Spec impact**: the spec's FR-022 named two interruption reasons. The last two reasons above
  are needed for correctness, so FR-022 was updated to list all four.
- **Alternatives considered**: Resume interrupted runs automatically on boot (the spec rules out
  resuming; starting a new run picks up whatever is still unreplied).

## R9. Starting a run: `POST /inbox/comments/backfill` (FR-011 to FR-013)

- **Decision**: Keep the path and body (`{ accountId, postId }`, already used by Postman and named
  by the product owner). Checks, in order:
  1. client exists for `accountId` → else `404 NOT_FOUND` (unchanged);
  2. comment replies on → else **new** `409 COMMENT_REPLIES_DISABLED` (FR-011);
  3. token on file → else `400` (unchanged);
  4. lock free → else `409 CONFLICT` with **new** `details.runId`. The `errorCode` is unchanged,
     so this stays backward compatible;
  5. fetch and filter comments (R4) → Meta errors through the existing `toHttpError`
     (unchanged codes);
  6. if `toAnswer` is 0: release the lock and return `202` with `run: null`. No run and no
     activity entry are created;
  7. otherwise write the activity entry (R10), create the run hash and pointer, start the worker,
     and return `202`.

  The `202` body keeps `{ platform, postId, total, pending, delaySeconds }` and adds
  `run: BackfillRun | null`. The controller now passes `@CurrentUser()` as the actor.
- **Rationale**: The response changes are additive. The only tightening is the new refusal in
  step 2, which the spec requires. Its sole consumer today is the Postman collection, which is
  updated in the same PR (plan.md, Complexity Tracking).
- **Alternatives considered**: A new `POST /clients/:id/posts/:postId/reply-runs` (a second start
  path for the same action). A new errorCode for "already running" (changing `CONFLICT` breaks
  the contract for no gain, because `details.runId` already tells the cases apart).

## R10. Activity record (FR-019)

- **Decision**:
  - Add `REPLY_RUN_STARTED` and `REPLY_RUN_STOPPED` to `ClientActivityAction`.
  - Add a nullable `details Json?` column to `client_activities`, validated by
    `ReplyRunActivityDetailsSchema` in `@common/zod/json-columns.schema.ts` and read through
    `readReplyRunDetails` in `json-readers.ts` (constitution II).
    - Started: `{ runId, platform, accountId, postId, toAnswer }`.
    - Stopped: the same fields plus `handled`.
  - Writes go through a new `ClientsService.recordReplyRun(...)` → `IClientsRepository.recordActivity(...)`:
    a single insert, because no client row changes.
  - The start writes its entry **before** the worker starts. If the insert fails, the lock is
    released and the start fails with `500`, so no run goes unrecorded.
  - The stop writes its entry after the state change. If that insert fails, the run stays
    stopped (stopping is the safe direction), the error is logged at `error`, and the response
    is `500` so the admin sees it.
- **Rationale**: This reuses the activity record from feature 001 (append-only, it outlives the
  client, there is no viewing screen). A JSON column keeps the table generic for future action
  types. `changedFields` is kept for `UPDATED` only.
- **Alternatives considered**: Dedicated columns (`postId`, `platform`, ...), which add nullable
  columns meaningful for one action type only. Logging only, which does not meet FR-019's
  retention requirement.

## R11. Configuration (constitution VIII)

| Variable | Default | Use |
|---|---|---|
| `COMMENT_BACKFILL_DELAY_MS` | 5000 | Pause between two comments (existing, missing from `.env.example`) |
| `COMMENT_BACKFILL_MAX` | 500 | Comments checked per post, for counts and runs (existing, missing from `.env.example`) |
| `COMMENT_BACKFILL_RESULT_TTL_SEC` | 86400 | How long an ended run stays visible (FR-022) |

The lock TTL is derived (`delay + 60 s`), not configured. It must exceed one loop iteration's
worst case: the delay, a re-check (3 attempts × 10 s + 6 s backoff), and the push.

## R12. Meta rate-limit budget

- Posts page: 1 call.
- Counts: up to `ceil(500/100) = 5` calls per Facebook post and 10 per Instagram post (pages of
  50). In practice it is 1 call for posts with fewer than 100 comments.
- Run: up to 5 calls (10 on Instagram) at the start, then 1 re-check per comment, so at most 12
  calls per minute per run at the default pace.

At about 10 admins this stays far below the page-level Business Use Case limits. Temporary
rate-limit errors (codes 4, 17, 32, 613) are already retried with backoff by
`GraphApiService`. After that they surface as `503 META_UNAVAILABLE` on lists and counts, or as
skipped comments in a run.

## R13. Testing strategy (constitution V)

- **Unit** (mocked Graph, Redis and repository):
  - `post-comments.service.spec.ts`: count rule, `truncated`, the re-check outcomes and the
    error mapping.
  - `comment-backfill.service.spec.ts`: rewritten for start checks, worker steps,
    stop/interrupt paths and counters.
  - `backfill-run.store.spec.ts`: key names, TTLs and script arguments.
  - `client-posts.service.spec.ts`: Graph mapping for both platforms, cursors, run attachment
    and ownership check.
  - Controller specs, `clients.service.spec.ts` (`recordReplyRun`), and schema specs (cursor,
    `metaPostId`, details schema).
- **e2e** (`test/client-posts.e2e-spec.ts`, `test/backfill-runs.e2e-spec.ts`) against real
  PostgreSQL and Redis, with `global.fetch` stubbed for `graph.facebook.com`:
  - 401 and 403 on all five operations;
  - 404 for an unknown client and `ACCOUNT_NOT_CONNECTED`;
  - 422 for a bad platform, cursor or post id;
  - `409 COMMENT_REPLIES_DISABLED`;
  - the lock: two parallel starts give one `202` and one `409`;
  - stop, then `409 BACKFILL_RUN_ENDED`;
  - interruption detected after the lock expires;
  - the activity rows.

  The Lua scripts are only meaningful against real Redis, so they are covered here.
- **Dashboard** (`fekra-dashboard`): Vitest + MSW for the posts page, progressive counts, filter,
  run dialog, progress polling and stop; Playwright + axe in English and Arabic, as in feature
  001.
