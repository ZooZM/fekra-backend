# Implementation Plan: Client Posts and Unreplied Comment Replies

**Branch**: `002-client-posts-backfill` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/002-client-posts-backfill/spec.md`

## Summary

From a client's page in the admin dashboard, an administrator lists the posts of the client's
Facebook page or Instagram account. Each post shows its number of unreplied comments, and the
admin starts a "reply run" that answers them one by one through the existing comment pipeline.
The admin can follow the run's progress and stop it.

This repository supplies:

- **Posts list**: a new `client-posts` module with `GET /clients/:id/posts`, which reads Meta
  live with cursor paging (R1–R3). It replaces the broken endpoints from commit `4f65fc3` and
  removes the `ClientsService` ↔ `CommentBackfillService` cycle.
- **Per-post count**: `GET /clients/:id/posts/:postId/unreplied-count`. It uses the same rule
  as the run, because both go through the new `PostCommentsService` (R4).
- **Run state in Redis**: shared by all instances. It holds the one-run-per-post lock,
  progress counters, stop, and the end states (finished, stopped, interrupted with a reason),
  kept for 24 hours (R5–R8).
- **Re-check**: each comment is checked again just before it is handled, so nothing is answered
  twice (R7).
- **Start, progress, stop**:
  - `POST /inbox/comments/backfill` is kept, with an additive response;
  - it refuses to start when comment replies are off (R9);
  - new `GET /inbox/comments/backfill/runs/:id` and `POST …/runs/:id/stop`.
- **Activity record**: two new actions and a `details` JSON column (R10), in one additive
  migration.

The dashboard screens are built in `fekra-dashboard` against
[contracts/dashboard-ui.md](./contracts/dashboard-ui.md).

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 22 LTS (backend). React 19 + Vite (dashboard,
separate repository).
**Primary Dependencies**:
- **Backend**: NestJS 11, Prisma 7 (pg adapter), Zod 4 + nestjs-zod, ioredis, `@nestjs/swagger`,
  Meta Graph API v24.0 through the existing `GraphApiService`. No new dependencies.
- **Dashboard**: TanStack Query 5, Mantine 8, i18next and `openapi-fetch`, as in feature 001.

**Storage**:
- **PostgreSQL**: one additive migration. It adds two `ClientActivityAction` values and a
  nullable `client_activities.details` JSONB column.
- **Redis**: run hashes, per-post locks and latest-run pointers (`backfill:*`).
- Posts and counts are not stored.

**Testing**:
- **Unit**: Jest + ts-jest with mocked Graph, Redis and repository.
- **e2e**: supertest against real PostgreSQL and Redis, with `global.fetch` stubbed for
  `graph.facebook.com`.
- **Dashboard**: Vitest + MSW, Playwright + axe.

**Target Platform**: the existing GCP VM (Docker Compose: api, dashboard, caddy, redis,
postgres). Desktop browsers.
**Project Type**: Web service plus a single-page app, in two repositories.
**Performance Goals**:
- The posts page shows in ≤ 2 s at p95: 1 Graph call and 1 Redis pipeline (SC-001).
- Each unreplied count arrives in ≤ 10 s at p95: at most 5 sequential Graph pages.
- A run status read takes < 50 ms (Redis only).
- The dashboard polls running runs every 5 s.

**Constraints**:
- Meta rate limits: a fixed pace of 5 s per comment, about 12 Graph calls per minute per run,
  and at most 1 + 25 × 5 calls per posts page (R12).
- At most one run per post across instances.
- 0 double replies (SC-007).
- `POST /inbox/comments/backfill` changes stay backward compatible, except the one refusal
  required by FR-011.
- Migrations stay backward compatible.

**Scale/Scope**:
- About 500 clients, up to 10 admins, a handful of runs at the same time.
- At most 500 comments checked per post, so a run takes about 42 min at the default pace.
- 5 API operations: 2 new, 1 replaced, 1 changed, 1 removed. 1 dashboard route.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*Source: `.specify/memory/constitution.md` v1.0.0.*

| Gate | Pre-research | Post-design | Notes |
|---|---|---|---|
| **I. Feature modules** | ✅ | ✅ | New pipeline module `src/client-posts/` (owns no tables, so no repository layer, as allowed for pipeline modules). It uses `ClientsService`, `CommentBackfillService`, `PostCommentsService` and `GraphApiService`, all exported services. The `ClientsService` → inbox dependency and its `forwardRef` are removed (R1). Activity rows are written through `ClientsService` → `IClientsRepository.recordActivity`. Redis access for runs sits in `BackfillRunStore` (inbox), keeping the service unit-testable. |
| **II. Zod input contract** | ✅ | ✅ | `strictObject` schemas for the posts query (`platform`, `after`, `limit`), the post params (`id` UUID + `metaPostId`) and the run param (`IdParamSchema`). `metaPostId` moves to `@common/zod/primitives` because two features use it. The new `details` JSON column gets `ReplyRunActivityDetailsSchema` and a reader. Response DTOs (`createZodDto`) feed the OpenAPI export. |
| **III. HTTP contract** | ⚠️ | ⚠️ justified | Errors keep the standard shape. New codes: `ACCOUNT_NOT_CONNECTED`, `COMMENT_REPLIES_DISABLED`, `BACKFILL_RUN_NOT_FOUND` and `BACKFILL_RUN_ENDED`; the Meta codes are reused. Deviations, all justified in Complexity Tracking: (a) the posts list uses a cursor `meta` (`nextCursor`) instead of `PaginatedResult`; (b) two non-working endpoints are replaced or removed; (c) the backfill start can now refuse with `409 COMMENT_REPLIES_DISABLED`. Everything else is additive (`run` in the 202, `details.runId` in the 409). Postman and `openapi/openapi.json` are updated in the same PR. |
| **IV. Security** | ✅ | ✅ | All routes use class-level `JwtAuthGuard` + `RolesGuard` + `@Roles('ADMIN')`. The token is decrypted only inside services and never logged or returned. Redis stores no email or token. On Facebook, posts are checked against the client's page ID (R4). Each run records the admin who started or stopped it. |
| **V. Tests** | ✅ | ✅ | Unit specs for `PostCommentsService`, `CommentBackfillService` (rewritten), `BackfillRunStore`, `ClientPostsService`, both controllers, `ClientsService.recordReplyRun` and the new schemas. e2e covers 401/403 on all 5 operations, 404/409/422 paths, the lock race, stop, stale-run interruption, and activity rows. The Lua scripts are tested against real Redis (R13). |
| **VI. Migrations** | ✅ | ✅ | One additive migration: `ALTER TYPE … ADD VALUE` ×2 and a nullable column. The running release never reads them. |
| **VII. Async reliability** | ✅ | ✅ | Redis keys are constants (`backfill:run:`, `backfill:lock:`, `backfill:post:`). Graph calls go through `GraphApiService` (10 s timeout, 3 attempts). The worker is fire-and-forget, catches and logs its own errors, and always reaches a final state (R8). The lock expires on its own after a crash. Stop is checked across instances before each comment. Inbox dedupe and the re-check make handoffs idempotent. `onModuleDestroy` stops the loop. Rules-before-LLM in the comment flow is unchanged. |
| **VIII. Observability & config** | ✅ | ✅ | One `Logger` per class. Run start, end, stop and interruption are logged at `log`; skips at `debug`; failures at `error`. No comment text is logged above `debug`. `COMMENT_BACKFILL_DELAY_MS` and `COMMENT_BACKFILL_MAX` (read today but missing) and the new `COMMENT_BACKFILL_RESULT_TTL_SEC` are added to `.env.example` and the production secret store. |
| **Frontend integration** | ✅ | ✅ | Additive for the dashboard: a new route and new operations. The UI branches on `errorCode` ([contracts/dashboard-ui.md](./contracts/dashboard-ui.md)). Release order: backend first, and the deployed dashboard does not call any changed endpoint. CORS and auth are unchanged. |
| **Delivery** | ✅ | ✅ | The migration runs through `prisma migrate deploy` in the pipeline. No manual VM step. `GET /health` is unchanged. Graceful shutdown marks runs interrupted (best effort), with lock expiry as the reliable fallback. |

**Result**: PASS. The ⚠️ is justified below. The design adds no unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-client-posts-backfill/
├── spec.md
├── plan.md                              # this file
├── research.md                          # R1–R13 decisions
├── data-model.md                        # ClientPost, UnrepliedCount, BackfillRun (Redis), ClientActivity changes
├── quickstart.md                        # local run + Postman, SQL and dashboard checks
├── contracts/
│   ├── client-posts-api.openapi.yaml    # API contract the generated OpenAPI must match
│   └── dashboard-ui.md                  # route, list/count/run behavior, errorCode → UI
├── checklists/requirements.md
└── tasks.md                             # created by /speckit-tasks
```

### Source Code: this repository (`fekra-backend`)

```text
src/
├── app.module.ts                              # + ClientPostsModule
├── client-posts/                              # NEW pipeline module (no tables)
│   ├── client-posts.module.ts                 # imports ClientsModule, InboxModule, GraphApiModule
│   ├── client-posts.controller.ts (+ .spec.ts)# @Controller('clients/:id/posts'), ADMIN; GET /, GET /:postId/unreplied-count
│   ├── client-posts.service.ts (+ .spec.ts)   # resolve account per platform, Graph page → ClientPost, attach runs, counts, FB ownership check
│   ├── schemas/
│   │   ├── client-posts-query.schema.ts (+ .spec.ts)  # platform, after (graphCursor), limit; post params
│   │   └── client-post-record.schema.ts       # response schemas → DTOs for OpenAPI
│   └── types/client-post.types.ts             # Graph post shapes (FB/IG), ClientPost, UnrepliedCount
├── inbox/
│   ├── post-comments.service.ts (+ .spec.ts)  # NEW fetchComments + needsReply (moved), listUnreplied, recheck
│   ├── backfill-run.store.ts (+ .spec.ts)     # NEW Redis run hash, lock (SET NX PX), Lua CAS renew/release/stop/end/stale
│   ├── comment-backfill.service.ts (+ .spec.ts)  # start checks, Redis runs, worker loop (stop, re-check, settings, counters), get/stop, onModuleDestroy
│   ├── comment-backfill.controller.ts (+ .spec.ts)  # + @CurrentUser actor; GET runs/:id; POST runs/:id/stop
│   ├── schemas/comment-backfill.schema.ts     # body unchanged; postId → metaPostId; BackfillRun/StartResult response schemas
│   ├── inbox.constants.ts                     # + BACKFILL_RUN, BACKFILL_LOCK, BACKFILL_POST
│   └── inbox.module.ts                        # + PostCommentsService, BackfillRunStore (exported with CommentBackfillService)
├── clients/
│   ├── clients.controller.ts (+ .spec.ts)     # − GET :id/posts, − GET :accountId/posts/:postId/reply
│   ├── clients.service.ts (+ .spec.ts)        # − getAllPosts/replyToPost/Graph/backfill deps; + recordReplyRun
│   ├── clients.module.ts                      # − GraphApiModule, − InboxModule imports
│   ├── repositories/IClientsRepository.repository.ts  # + recordActivity(client, action, actor, details)
│   ├── repositories/clients.repository.impl.ts        # + recordActivity (single insert)
│   └── types/facebook-comment.types.ts        # deleted (unused)
└── common/zod/
    ├── primitives.ts (+ .spec.ts)             # + metaPostId, graphCursor
    ├── json-columns.schema.ts                 # + ReplyRunActivityDetailsSchema
    └── json-readers.ts                        # + readReplyRunDetails

prisma/
├── schema.prisma                              # ClientActivityAction + 2 values; ClientActivity.details Json?
└── migrations/<ts>_reply_run_activity/        # additive

test/
├── client-posts.e2e-spec.ts                   # NEW auth/role, 404/422, list mapping + counts with stubbed Graph
├── backfill-runs.e2e-spec.ts                  # NEW 409 disabled, lock race, progress, stop/ended, stale interrupt, activity rows
└── utils/graph-stub.ts                        # NEW fetch stub for graph.facebook.com

openapi/openapi.json                           # regenerated (npm run openapi:export)
.env.example                                   # + COMMENT_BACKFILL_DELAY_MS, COMMENT_BACKFILL_MAX, COMMENT_BACKFILL_RESULT_TTL_SEC
postman/collections/Social Inbox Automation API/
├── Clients/List Client Posts (ADMIN).request.yaml            # NEW
├── Clients/Count Unreplied Comments (ADMIN).request.yaml     # NEW
├── Inbox/Backfill Unanswered Comments (ADMIN).request.yaml   # updated docs, run field, new 409
├── Inbox/Get Backfill Run (ADMIN).request.yaml               # NEW
└── Inbox/Stop Backfill Run (ADMIN).request.yaml              # NEW
```

### Source Code: `fekra-dashboard` (separate repository)

```text
src/
├── api/schema.d.ts                         # regenerated from openapi/openapi.json
├── api/errors.ts                           # + new errorCodes (contracts/dashboard-ui.md)
├── features/clients/detail-page.tsx        # + Posts action (disabled without accounts)
├── features/client-posts/
│   ├── posts-page.tsx                      # route /clients/:id/posts, platform tabs, filter switch (URL), refresh, load more
│   ├── post-row.tsx                        # thumbnail, text (dir=auto), link, counts, highlight, action area
│   ├── unreplied-cell.tsx                  # loading / count / at-least / couldn't count + retry
│   ├── start-run-dialog.tsx                # FR-012 confirmation
│   ├── stop-run-dialog.tsx
│   ├── run-status.tsx                      # progress bar + outcome lines (aria-live)
│   └── queries.ts                          # posts (cursor), counts (queue of 6), run polling (5 s, pauses when hidden)
├── i18n/ en.json, ar.json                  # new strings
└── test/ msw handlers                      # posts, counts, runs
e2e/client-posts.spec.ts                    # Playwright US1–US3 + axe (en, ar) + keyboard pass
```

**Structure Decision**: Backend changes follow the existing feature-module layout. Posts get
their own pipeline module so that `clients` stays a CRUD module and the dependency cycle goes
away. Run logic stays in `inbox` next to the pipeline it feeds. The dashboard work goes in
`fekra-dashboard` as a new feature folder, sharing the contract through `openapi/openapi.json`.

## Delivery Order

1. **Foundation**:
   - migration, Prisma schema, details schema and reader;
   - `metaPostId` and `graphCursor` primitives;
   - `.env.example`.
2. **Inbox**: `PostCommentsService` (move the rule out, add `recheck`) → `BackfillRunStore` →
   the `CommentBackfillService` rewrite → controller endpoints. Unit tests at each step.
3. **Posts**:
   - the `client-posts` module (list, count, run attachment);
   - remove the old posts code from `clients`;
   - add `recordReplyRun`.
4. **Contract**: response DTOs, `openapi:export`, Postman requests, e2e suites.
5. **Deploy the backend**. It stays compatible: the deployed dashboard does not use these
   endpoints yet.
6. **Dashboard**, by story: US1 (posts, counts, filter) → US2 (start, progress, stop) → US3
   (outcomes, refresh), each with tests and axe checks. Then deploy.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `GET /clients/:id/posts` returns `{ data, meta: { limit, nextCursor, fetchedAt } }` instead of `PaginatedResult` | Meta's Graph API pages with cursors and gives no total for page posts or Instagram media (R3) | Offset pages would need one Graph call per skipped page on every request, and cursors expire. Counting all posts for `total` would cost one call per 100 posts each time |
| Breaking: `GET /clients/:id/posts` changes behavior; `GET /clients/:accountId/posts/:postId/reply` is removed | Both were added in `4f65fc3` and cannot succeed (UUID param looked up as a Meta account ID). The second sends replies from a `GET` with unvalidated params (constitution II, III) (R2) | Expand → contract would keep a broken, side-effecting `GET` alive with no consumer to migrate. No deployed frontend or Postman request uses either |
| Tightened: `POST /inbox/comments/backfill` can refuse with `409 COMMENT_REPLIES_DISABLED` | FR-011 (clarification Q4). With replies off, a run would go through every comment and post nothing | A warning-only start was rejected in clarification. The only consumer is the Postman request, updated in the same PR. The other changes are additive (`run`, `details.runId`) |
| `ClientsRepository` writes `client_activities` rows that change no client (`recordActivity`) | FR-019 puts reply runs in the 001 activity record, which `ClientsRepository` already owns | A separate activity repository duplicates the table ownership for a single insert. The activity record is defined as part of the clients feature |
