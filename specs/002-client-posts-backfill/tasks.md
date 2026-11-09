---

description: "Task list for 002-client-posts-backfill"
---

# Tasks: Client Posts and Unreplied Comment Replies

**Input**: Design documents from `specs/002-client-posts-backfill/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED by Constitution Principle V (non-negotiable). In every story phase, test
tasks come first and MUST fail before the implementation tasks start.

- **Backend unit specs** mock dependencies (`jest.fn()`, `src/test-mocks/`) and never touch a
  real database, Redis or the Meta Graph API.
- **Backend e2e specs** use supertest against real PostgreSQL and Redis, with the Graph API
  stubbed by `test/utils/graph-stub.ts`.
- **Dashboard tests** use Vitest + MSW. Its Playwright specs mock the API with `page.route`,
  because the posts endpoints call Meta.

**Organization**: Tasks are grouped by user story (US1–US3 from spec.md) so each story can be
built, tested and demonstrated on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1–US3)

## Path Conventions

- **This repository (`fekra-backend`)**: paths are relative to its root (`src/…`, `prisma/…`,
  `test/…`).
- **Dashboard**: the existing sibling repository `E:\zeyad\fekra-dashboard`. Its paths are
  written `fekra-dashboard/…`.
- **Decisions**: "R4" means research.md R4. Shapes and error codes come from
  [contracts/client-posts-api.openapi.yaml](./contracts/client-posts-api.openapi.yaml) and
  [contracts/dashboard-ui.md](./contracts/dashboard-ui.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration and the test helper every backend e2e suite in this feature uses.

- [X] T001 [P] In .env.example, after the `RATE_LIMIT_*` lines, add `COMMENT_BACKFILL_DELAY_MS=5000`, `COMMENT_BACKFILL_MAX=500` and `COMMENT_BACKFILL_RESULT_TTL_SEC=86400`, each with a one-line comment (research R11). The first two are already read by src/inbox/comment-backfill.service.ts but are missing from the file
- [X] T002 [P] Create test/utils/graph-stub.ts, a test helper for stubbing Meta. It exports:
  - `stubGraph(handler: (url: URL, init?: RequestInit) => GraphReply | undefined)`: replaces `global.fetch` with `jest.spyOn`. Requests whose host is `graph.facebook.com` go to `handler`, which returns `{ status?: number; body: unknown }`. If the handler returns `undefined`, the stub answers 404 with `{ error: { code: 803, message: 'unstubbed' } }`. Every other URL goes to the original fetch.
  - `graphError(code, subcode?, status = 400)`: builds a Graph error body.
  - `graphCalls()`: returns the recorded `URL`s.
  - `restoreGraph()`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared Zod primitives, one shared comment rule for counts and runs (R4), and the
removal of the broken posts code (R1, R2). It must be removed before the new
`GET /clients/:id/posts` can be registered.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Add tests to src/common/zod/primitives.spec.ts, which MUST fail before T004:
  - `metaPostId` accepts `12345` and `12345_67890`, trims whitespace, and rejects `abc`, `1234`, `12345_` and 31 digits.
  - `graphCursor` accepts `QVFIUjRtc2Y0d0Rk=` and `a-b_c`, and rejects an empty string, spaces, `/`, and 513 characters.
- [X] T004 Add the primitives to src/common/zod/primitives.ts:
  - `metaPostId`: `z.string().trim().regex(/^\d{5,30}(_\d{5,30})?$/, 'Must be a Meta post or media ID')`;
  - `graphCursor`: `z.string().min(1).max(512).regex(/^[A-Za-z0-9_\-=]+$/, 'Invalid cursor')`.

  Then replace the inline `postId` schema in src/inbox/schemas/comment-backfill.schema.ts with `metaPostId` (no behavior change).
- [X] T005 [P] Create src/inbox/post-comments.service.spec.ts (it MUST fail before T006). Port the fetch and filter cases from src/inbox/comment-backfill.service.spec.ts:
  - Facebook and Instagram URLs and fields;
  - pagination through `paging.next`, stopping at `COMMENT_BACKFILL_MAX`;
  - normalization of both shapes;
  - `listUnreplied` excludes the account's own comments, hidden comments, Instagram comments without text, and comments with a reply from the account;
  - a comment replied to only by another customer still counts;
  - results are sorted newest first;
  - `truncated` is true only when the max was reached **and** `paging.next` exists.
- [X] T006 Create src/inbox/post-comments.service.ts (`@Injectable PostCommentsService`, injecting `GraphApiService` and `ConfigService`):
  - Move `PostComment`, `Page`, `FacebookComment`, `InstagramComment`, `fetchComments`, `needsReply`, `fromFacebook`, `fromInstagram`, `replierIds` and `toMs` there from src/inbox/comment-backfill.service.ts, without changing the rules.
  - `fetchComments` returns `{ comments, truncated }`.
  - Add `listUnreplied(platform, accountId, postId, token): Promise<{ checked: number; unreplied: PostComment[]; truncated: boolean }>`, with `unreplied` sorted newest first.
  - Register it in src/inbox/inbox.module.ts `providers` and `exports`.
- [X] T007 Make src/inbox/comment-backfill.service.ts call `PostCommentsService.listUnreplied` instead of its own fetch and filter. Behavior stays the same. Update src/inbox/comment-backfill.service.spec.ts to mock `PostCommentsService`, and delete the cases moved in T005. Run `npm test -- src/inbox`: it is green
- [X] T008 Remove the posts code added in commit 4f65fc3 (research R2):
  - In src/clients/clients.controller.ts, delete the `// posts` block (`getAllPosts`, `replyToPost`).
  - In src/clients/clients.service.ts, delete `getAllPosts` and `replyToPost`, the `GraphApiService` and `CommentBackfillService` constructor parameters, and their imports.
  - In src/clients/clients.service.spec.ts, delete `describe('replyToPost')` and the matching constructor mocks.
  - In src/clients/clients.module.ts, remove `GraphApiModule` and `forwardRef(() => InboxModule)` from `imports`.
  - Delete src/clients/types/facebook-comment.types.ts.

  Check that `npm run build` and `npm test` pass, and that the app boots without circular-dependency errors (`npm run start:dev`).

**Checkpoint**: Counts and runs share one rule. `ClientsModule` no longer depends on `InboxModule`.

---

## Phase 3: User Story 1 - See a client's posts and their unreplied comments (Priority: P1) 🎯 MVP

**Goal**: From a client's page, an admin sees the account's recent posts, 25 at a time. Each
post's unreplied count fills in as it is ready. There is a filter for posts with unreplied
comments.

**Independent Test**: For a client whose Facebook page has posts with a known number of answered
and unanswered comments, open the posts page. Check that the posts, the counts (for example, 3
unreplied out of 12), Load more, the filter, Refresh and the error states all work
(quickstart.md §3 rows 1–5).

### Tests for User Story 1 (REQUIRED - Constitution Principle V) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T009 [P] [US1] Create src/client-posts/schemas/client-posts-query.schema.spec.ts:
  - `ClientPostsQuerySchema`: `platform` is required and only `facebook`/`instagram`; `after` is optional and must be a `graphCursor`; `limit` is coerced from a string, 1–25, default 25; unknown keys are rejected.
  - `UnrepliedCountQuerySchema`: `platform` only.
  - `ClientPostParamsSchema`: `{ id: uuid, postId: metaPostId }`, strict.
- [X] T010 [P] [US1] Create src/client-posts/client-posts.service.spec.ts. It mocks `ClientsService` (`findById`, `getAccessToken`), `GraphApiService` (`host`, `get`) and `PostCommentsService` (`listUnreplied`).
  - **`list`**:
    - Facebook: the URL is `{host}/{fbPageId}/posts` with `fields=id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0)`, `limit=25` and `after` when given. Map the result to `ClientPost` (data-model §1).
    - Instagram: the URL is `{host}/{instaAccountId}/media` with the R3 fields. `thumbnailUrl` is `thumbnail_url` for `VIDEO` and `media_url` otherwise.
    - The host is always `graph.facebook.com` (`host('facebook')`).
    - Text longer than 500 characters is cut, with `textTruncated: true`. A missing text gives `null`.
    - `nextCursor` is `paging.cursors.after` only when `paging.next` exists. `fetchedAt` is set.
    - `findById` throwing `NotFoundException` is passed through.
    - A missing account for the platform gives 404 `ACCOUNT_NOT_CONNECTED`.
    - A null token gives 400.
    - `GraphError(code 190)` gives 400 `META_TOKEN_INVALID`, and a temporary `GraphError` gives 503 `META_UNAVAILABLE` (through `toHttpError`).
  - **`unrepliedCount`**:
    - On Facebook, a `postId` that does not start with `${fbPageId}_` gives 404 `META_POST_NOT_FOUND` with **no** Graph call.
    - It returns `{ postId, platform, checked, unrepliedCount: unreplied.length, truncated, checkedAt }`.
    - `GraphError(code 100)` gives 404 `META_POST_NOT_FOUND`.
- [X] T011 [P] [US1] Create src/client-posts/client-posts.controller.spec.ts:
  - `list` and `unrepliedCount` pass the parsed params and query to the service;
  - the class has the `JwtAuthGuard` and `RolesGuard` guards, with `ROLES` metadata `['ADMIN']` (read with `Reflector`, as in src/clients/clients.controller.spec.ts).
- [X] T012 [P] [US1] Create test/client-posts.e2e-spec.ts using `createE2eApp`, `resetDb`, `createUser` and `login` from test/utils/e2e-app.ts and `stubGraph` from test/utils/graph-stub.ts. Create an ADMIN, a CLIENT user, and a client with `fbPageId` only and an encrypted token (create it through `POST /clients`). Cases:
  - **Access**: both endpoints return 401 without a token and 403 `FORBIDDEN` for the CLIENT user.
  - **Not found**: 404 `NOT_FOUND` for an unknown client UUID; 404 `ACCOUNT_NOT_CONNECTED` for `platform=instagram`.
  - **Validation**: 422 `INPUT_VALIDATION_ERROR` for `platform=x`, `after=a/b`, `limit=26` and `postId=abc`.
  - **Paging**: with a stubbed 2-page Facebook feed, a 200 list returns the mapped first page and `nextCursor`, and `after=<cursor>` returns the second page with `nextCursor: null`.
  - **Count**: a post with 12 customer comments, 9 of them replied to by the page, returns `unrepliedCount: 3, truncated: false`.
  - **Ownership**: a count for `99999_12345` returns 404 `META_POST_NOT_FOUND`, and `graphCalls()` is empty.
  - **Meta errors**: Graph code 190 gives 400 `META_TOKEN_INVALID`; Graph code 2 on every attempt gives 503 `META_UNAVAILABLE`.

  Call `restoreGraph()` in `afterEach`.

### Implementation for User Story 1

- [X] T013 [P] [US1] Create src/client-posts/types/client-post.types.ts with:
  - the Graph shapes: `FacebookPost` (`id`, `message?`, `created_time`, `permalink_url`, `full_picture?`, `comments?.summary.total_count`), `InstagramMedia` (`id`, `caption?`, `timestamp`, `permalink`, `media_type`, `media_url?`, `thumbnail_url?`, `comments_count?`) and `GraphPage<T>` (`data`, `paging?.cursors.after`, `paging?.next`);
  - the `Platform` re-export from src/inbox/inbox.types.ts.
- [X] T014 [P] [US1] Create src/client-posts/schemas/client-posts-query.schema.ts with `ClientPostsQuerySchema` (`platform`, `after: graphCursor.optional()`, `limit: z.coerce.number().int().min(1).max(25).default(25)`), `UnrepliedCountQuerySchema` and `ClientPostParamsSchema`, all `z.strictObject`. Add the `createZodDto` classes `ClientPostsQueryDto`, `UnrepliedCountQueryDto` and `ClientPostParamsDto`, and the `z.infer` input types
- [X] T015 [P] [US1] Create src/client-posts/schemas/client-post-record.schema.ts with the response schemas `ClientPostSchema` (without `replyRun`, which US2 adds in T048), `ClientPostPageSchema` (`{ data, meta: { limit, nextCursor: string|null, fetchedAt } }`) and `UnrepliedCountSchema`. Shapes come from data-model §1–2 and the contract. Add the DTOs `ClientPostPageDto` and `UnrepliedCountDto` for `@ApiOkResponse`, and the exported types `ClientPost`, `ClientPostPage` and `UnrepliedCount`
- [X] T016 [US1] Create src/client-posts/client-posts.service.ts (`ClientPostsService`, with a `Logger`). It injects `ClientsService`, `GraphApiService` and `PostCommentsService`.
  - A private `resolve(clientId, platform)` does the following:
    - call `ClientsService.findById`;
    - read `accountId = platform === 'facebook' ? fbPageId : instaAccountId`;
    - if there is none, throw `NotFoundException({ message: 'This account is not connected to the client', errorCode: 'ACCOUNT_NOT_CONNECTED' })`;
    - get the token with `getAccessToken`; if it is null, throw `BadRequestException('No access token stored for this client')`.
  - `list(clientId, query)` calls Graph through `graph.get` on `graph.host('facebook')` with the R3 fields, maps the result (cap the text at 500 characters and accept only `https` thumbnails), and builds `meta`.
  - `unrepliedCount(clientId, postId, platform)` checks Facebook ownership, then calls `postComments.listUnreplied(platform, accountId, postId, token)`.
  - Wrap Graph failures with `toHttpError(err, platform, postId)` from src/inbox/comment-backfill.service.ts. Never log the token.
- [X] T017 [US1] Create src/client-posts/client-posts.controller.ts with `@Controller('clients/:id/posts')`, class-level `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('ADMIN')`. It has two routes:
  - `@Get()`: `list(@Param() { id }: IdParamDto, @Query() query: ClientPostsQueryDto)`, with `@ApiOkResponse({ type: ClientPostPageDto })`;
  - `@Get(':postId/unreplied-count')`: `unrepliedCount(@Param() { id, postId }: ClientPostParamsDto, @Query() { platform }: UnrepliedCountQueryDto)`, with `@ApiOkResponse({ type: UnrepliedCountDto })`.

  Each route makes a single service call.
- [X] T018 [US1] Create src/client-posts/client-posts.module.ts (imports `ClientsModule`, `InboxModule` and `GraphApiModule`; controller `ClientPostsController`; provider `ClientPostsService`) and add it to `imports` in src/app.module.ts. Check that src/inbox/inbox.module.ts exports `PostCommentsService`
- [X] T019 [US1] Run `npm run openapi:export`. Check that `/clients/{id}/posts` and `/clients/{id}/posts/{postId}/unreplied-count` in openapi/openapi.json match contracts/client-posts-api.openapi.yaml (params, 200 schemas), and that the old `/clients/{accountId}/posts/{postId}/reply` is gone. Commit openapi/openapi.json
- [X] T020 [P] [US1] Add `postman/collections/Social Inbox Automation API/Clients/List Client Posts (ADMIN).request.yaml` and `Count Unreplied Comments (ADMIN).request.yaml`, in the format of `Inbox/Backfill Unanswered Comments (ADMIN).request.yaml`:
  - a description with the params, responses and errorCodes from the contract;
  - URLs `{{baseUrl}}/clients/{{clientId}}/posts?platform=facebook` and `{{baseUrl}}/clients/{{clientId}}/posts/{{postId}}/unreplied-count?platform=facebook`;
  - `afterResponse` scripts that test for 200, save `postId` from `data[0].id` and save `nextCursor`.

  Then run `npm run postman:export`.

### Dashboard for User Story 1 (`fekra-dashboard`)

- [X] T021 [US1] In fekra-dashboard, run `npm run api:types` to regenerate fekra-dashboard/src/api/schema.d.ts from the openapi.json updated in T019
- [X] T022 [P] [US1] Create fekra-dashboard/src/test/fixtures/client-posts.ts with:
  - `makePost(overrides)` and `makePostsPage(n, nextCursor)`;
  - a 25-post Facebook page with mixed `commentsCount` values (including 0), Arabic and English texts, one post without text and one video.

  Add MSW handlers to fekra-dashboard/src/test/handlers.ts for `GET /api/clients/:id/posts` (two pages through `after`) and `GET /api/clients/:id/posts/:postId/unreplied-count`. The count handler can be set up per test, by postId, to return a number, a truncated result, a 503 or a 404 `META_POST_NOT_FOUND`.
- [X] T023 [P] [US1] Create fekra-dashboard/src/features/client-posts/posts-page.test.tsx (it MUST fail before T025–T028). It checks that:
  - **Progressive counts**:
    - the rows render before any count resolves;
    - each count cell shows a busy skeleton, then the number;
    - `truncated` shows "at least N" with the tooltip;
    - a failed count shows "Couldn't count", and Retry refetches only that post;
    - rows with `commentsCount = 0` show 0 without a request;
    - rows with 1 or more unreplied comments are highlighted.
  - **Filter**:
    - the filter switch (URL `unreplied=1`) hides rows that are 0, still loading or failed, including rows added by Load more;
    - when every row is hidden, the "none of the loaded posts" message shows and Load more stays visible.
  - **Page controls**:
    - Refresh reloads the first page and updates "Loaded at";
    - the platform tabs appear only when both accounts are connected, and the default is Facebook;
    - the empty state "This account has no posts yet" works.
  - **Errors**: the `ACCOUNT_NOT_CONNECTED` and `META_TOKEN_INVALID` banners appear (the latter with a **Replace token** button).
  - **Accessibility**: axe reports 0 violations in `en` and `ar`.
- [X] T024 [P] [US1] Extend fekra-dashboard/src/features/clients/detail-page.test.tsx: the **Posts** action links to `/clients/:id/posts` when `fbPageId` or `instaAccountId` is set. When neither is set, it is disabled and shows "Connect a Facebook page or Instagram account first"
- [X] T025 [US1] Create fekra-dashboard/src/features/client-posts/queries.ts with:
  - `postKeys` (`all`, `list(clientId, platform)`, `count(clientId, platform, postId)`, `run(runId)`);
  - `useClientPosts(clientId, platform)`, a `useInfiniteQuery` that calls `api.GET('/clients/{id}/posts', …)` with `after = lastPage.meta.nextCursor`;
  - `useUnrepliedCount(clientId, platform, postId, enabled)`, with `retry: false`, that runs its fetch through a module-level queue allowing at most 6 requests at a time, in call order. Write the queue in the same file; do not add a dependency.
- [X] T026 [US1] Create the row components, following contracts/dashboard-ui.md "Posts list":
  - fekra-dashboard/src/features/client-posts/unreplied-cell.tsx: the loading, `0`, count, "at least N" (with tooltip) and "Couldn't count" + Retry states, with `aria-busy` while loading;
  - fekra-dashboard/src/features/client-posts/post-row.tsx: the date, the text cut to one line with `dir="auto"`, "No text", a thumbnail with a placeholder on error, the permalink (`target="_blank" rel="noopener noreferrer"`), the comments count, the unreplied cell, highlighting when the count is 1 or more, and an empty action area slot for US2.
- [X] T027 [US1] Create fekra-dashboard/src/features/client-posts/posts-page.tsx:
  - URL state `platform` (default `facebook` if connected, else `instagram`) and `unreplied=1`;
  - platform tabs shown only when both accounts are connected;
  - "Loaded at {time}" with a **Refresh** button that resets the infinite query and the counts;
  - the filter switch, Load more, and loading, empty and error states through `components/page-state.tsx`;
  - the errorCode banners.

  Register the route `{ path: 'clients/:id/posts', element: <ClientPostsPage /> }` in fekra-dashboard/src/app/router.tsx inside the admin-guarded routes.
- [X] T028 [US1] Add the **Posts** action to fekra-dashboard/src/features/clients/detail-page.tsx (FR-002), disabled with the explanation when no account is connected
- [X] T029 [P] [US1] Add the `posts.*` strings (page title, tabs, loaded at, refresh, filter, load more, empty, no text, at least, tooltip, couldn't count, retry, connect first) to fekra-dashboard/src/i18n/en.json and ar.json. Add the `errors.ACCOUNT_NOT_CONNECTED`, `META_POST_NOT_FOUND`, `META_TOKEN_INVALID`, `META_PERMISSION_DENIED`, `META_UNAVAILABLE` and `META_ERROR` strings, and add those codes to the `KNOWN` set in fekra-dashboard/src/api/errors.ts
- [X] T030 [US1] Create fekra-dashboard/e2e/client-posts-us1.spec.ts. Sign in as the seeded admin and open a seeded client. Mock `**/api/clients/*/posts**` with `page.route` fixtures, and check:
  - the posts appear before the counts;
  - one count fails and its Retry works;
  - the filter and Load more work;
  - `expectNoA11yViolations` passes in the `en` and `ar` projects;
  - a keyboard-only pass works: tab to the filter, Retry and Load more.

**Checkpoint**: US1 works on its own. It can be demonstrated and deployed (backend first) as the MVP.

---

## Phase 4: User Story 2 - Reply to a post's unreplied comments (Priority: P2)

**Goal**: An admin starts a reply run on a post, after a confirmation. They see "handled X of N"
progress that updates on its own, and any admin can stop the run. The run re-checks each comment
before handling it. It refuses to start when comment replies are off. Starts and stops are
recorded in the activity record.

**Independent Test**: On a test post with 5 unanswered comments, start the run, follow its
progress, stop it, and check the activity rows (quickstart.md §3 rows 6–12 and 15, plus the SQL
check).

### Tests for User Story 2 (REQUIRED - Constitution Principle V) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T031 [P] [US2] Create src/common/zod/json-columns.schema.spec.ts:
  - `ReplyRunActivityDetailsSchema` accepts a started shape (`{ runId, platform, accountId, postId, toAnswer }`) and a stopped shape (the same plus `handled`);
  - it rejects unknown keys, negative numbers and a bad `platform`;
  - `readReplyRunDetails` returns `null` for invalid stored JSON.
- [X] T032 [P] [US2] Add `describe('recordReplyRun')` to src/clients/clients.service.spec.ts: it calls `repo.recordActivity({ id, name }, 'REPLY_RUN_STARTED', actor, details)` with the given values. A repository failure is passed through
- [X] T033 [P] [US2] Add `describe('recheck')` to src/inbox/post-comments.service.spec.ts:
  - **URLs**: Facebook calls `/{commentId}?fields=id,is_hidden,comments.limit(100){from{id}}`; Instagram calls `/{commentId}?fields=id,hidden,replies.limit(50){from{id}}`.
  - **Outcomes**:
    - `needs_reply`;
    - `answered` when a reply's `from.id` is the account;
    - `hidden`;
    - `deleted` on `GraphError` code 100;
    - `check_failed` on a temporary `GraphError`.
  - **Access errors**: code 190, 10 and 2xx throw. `isAccessError(err)` is true for them and false otherwise.
- [X] T034 [P] [US2] Create src/inbox/backfill-run.store.spec.ts with a mocked ioredis (`set`, `get`, `hgetall`, `hset`, `hincrby`, `expire`, `eval`, `pipeline().get/hgetall/exec`). It checks that:
  - **Create and lock**:
    - `create` writes all hash fields (including the internal `clientName`), with a 48 h TTL on `backfill:run:{id}` and on the pointer `backfill:post:{platform}:{postId}`;
    - `acquireLock` sends `SET backfill:lock:{platform}:{postId} {runId} PX {ttl} NX` and returns false when the result is null.
  - **Scripts**: `renewLock`, `releaseLock`, `stop`, `end` and `markStaleIfLockLost` call `eval` with the expected KEYS and ARGV.
  - **Reads**:
    - `get` maps the hash to a `BackfillRun`, with `handled = queued + dropped + skipped`, `stoppedBy: null` when empty, and numbers parsed; it returns `null` for an empty hash;
    - `latestForPosts` makes one pipeline round trip.
- [X] T035 [US2] Rewrite src/inbox/comment-backfill.service.spec.ts. Mock `PostCommentsService`, `BackfillRunStore`, `ClientsService` (`getClientDataForWorkFlow`, `getAccessToken`, `recordReplyRun`), `PriorityInboxService.push` and `ConfigService` (delay 0). Cover:
  - **`start`, refusals**:
    - 404 when there is no client;
    - 409 `COMMENT_REPLIES_DISABLED` when `commentReplyConfig.enabled` is false (checked before the token);
    - 400 when there is no token;
    - 409 `CONFLICT` with `details.runId` when `acquireLock` is false (the current holder is read from the store).
  - **`start`, failures**:
    - Meta errors are mapped through `toHttpError` and the lock is released;
    - `pending 0` returns `run: null`, releases the lock, and records no activity;
    - when `recordReplyRun` throws, the lock is released, no run is created, and the error is thrown.
  - **`start`, success**: records `REPLY_RUN_STARTED` with `{ runId, platform, accountId, postId, toAnswer }`, calls `store.create`, and returns `202` with `{ platform, postId, total, pending, delaySeconds, run }`.
  - **Worker**:
    - it pushes newest first with `{ skipRateLimit: true }`, and increments `queued` or `dropped` from the push result;
    - an `answered`, `hidden`, `deleted` or `check_failed` re-check increments `skipped` and does not push;
    - a stopped state before the next comment makes it exit with no more pushes;
    - `commentReplyConfig.enabled` turning false ends the run as `interrupted`/`COMMENT_REPLIES_DISABLED`; a client returning `null` ends it as `ACCOUNT_DISCONNECTED`; an access error from `recheck` ends it as `META_ACCESS_LOST`;
    - reaching the end gives `finished`;
    - `renewLock` returning false makes it exit without ending the run;
    - an unexpected error on one comment is logged, counted as `skipped`, and the loop continues;
    - the worker never rejects.
  - **`getRun`**: an unknown id gives 404 `BACKFILL_RUN_NOT_FOUND`; a `running` run whose lock is lost is returned as `interrupted`/`SERVER_RESTART`.
  - **`stopRun`**:
    - success records `REPLY_RUN_STOPPED` with `handled`;
    - an ended run gives 409 `BACKFILL_RUN_ENDED` with `details.state`;
    - an unknown id gives 404.
  - **`onModuleDestroy`**: marks this instance's runs `interrupted`/`SERVER_RESTART`, and swallows errors.
- [X] T036 [P] [US2] Create src/inbox/comment-backfill.controller.spec.ts:
  - `start` passes the body and the actor `{ id, name, email }` built from `@CurrentUser()`;
  - `getRun` passes the id, and `stopRun` passes the id and the actor;
  - the class has `ROLES` metadata `['ADMIN']`.
- [X] T037 [P] [US2] Create test/backfill-runs.e2e-spec.ts. At the top of the file, before `createE2eApp`, set `process.env.COMMENT_BACKFILL_DELAY_MS = '200'` and `process.env.DISPATCH_INTERVAL_MS = '600000'`. The second keeps the inbox dispatcher from consuming the queue, so no LLM or reply calls happen. Use `stubGraph` for the comment list and re-check endpoints. Cases:
  - **Access**: 401 and 403 for start, `GET runs/:id` and `POST runs/:id/stop`.
  - **Replies off**: 409 `COMMENT_REPLIES_DISABLED` after a PATCH that sets `commentReplyConfig.enabled=false`.
  - **Lock race**: two parallel starts give exactly one 202 and one 409 `CONFLICT`, whose `details.runId` equals the 202's `run.id`.
  - **Progress**: polling `GET runs/:id` shows `handled` increasing up to `toAnswer` and then `state: finished`; the `inbox:comments` sorted set contains the queued comment IDs.
  - **Re-check**: a re-check stub returning a page reply for one comment gives `skipped: 1`, and that comment is not in `inbox:comments`.
  - **Stop**: stop gives 200 `stopped` with `stoppedBy`. Stopping again gives 409 `BACKFILL_RUN_ENDED`. A new start on the same post right after the stop gives 202.
  - **Restart**: delete `backfill:lock:*` while a run is running, then `GET runs/:id` gives `interrupted` with `SERVER_RESTART`.
  - **Activity**: `client_activities` holds `REPLY_RUN_STARTED` and `REPLY_RUN_STOPPED` rows with the admin's name and the `details` from data-model §5.

  Clean `backfill:*` and `inbox:*` keys in `beforeEach`.

### Implementation for User Story 2

- [X] T038 [US2] In prisma/schema.prisma, add `REPLY_RUN_STARTED` and `REPLY_RUN_STOPPED` to `enum ClientActivityAction`, and add `details Json? @map("details")` to `model ClientActivity`, with a comment. Run `npx prisma migrate dev --name reply_run_activity`. Check that prisma/migrations/*_reply_run_activity/migration.sql contains only `ALTER TYPE … ADD VALUE` ×2 and `ADD COLUMN "details" JSONB` (data-model §5)
- [X] T039 [P] [US2] Add `ReplyRunActivityDetailsSchema` (data-model §5, using `metaId` and `metaPostId`) and its type `ReplyRunActivityDetails` to src/common/zod/json-columns.schema.ts. Add `readReplyRunDetails = reader('details', S.ReplyRunActivityDetailsSchema, null)` to src/common/zod/json-readers.ts; widen `reader`'s fallback type if needed
- [X] T040 [US2] Add `recordActivity(client: { id: string; name: string }, action: 'REPLY_RUN_STARTED' | 'REPLY_RUN_STOPPED', actor: ClientActor, details: ReplyRunActivityDetails): Promise<void>` to src/clients/repositories/IClientsRepository.repository.ts. Implement it in src/clients/repositories/clients.repository.impl.ts as one `prisma.clientActivity.create`, after `ReplyRunActivityDetailsSchema.parse(details)`, with `changedFields: []`. Add `recordReplyRun(client, action, actor, details)` to src/clients/clients.service.ts, delegating to it. It does no client lookup: the run keeps the client's name, so a stop still records after the client is deleted
- [X] T041 [P] [US2] Add `BACKFILL_RUN = 'backfill:run:'`, `BACKFILL_LOCK = 'backfill:lock:'` and `BACKFILL_POST = 'backfill:post:'` to src/inbox/inbox.constants.ts, each with a comment giving the key suffix (data-model §4)
- [X] T042 [US2] Add to src/inbox/post-comments.service.ts:
  - `recheck(platform, accountId, commentId, token): Promise<'needs_reply' | 'answered' | 'hidden' | 'deleted' | 'check_failed'>` (research R7). It throws on access errors.
  - An exported `isAccessError(err)`: true for a `GraphError` with code 190, code 10, or a code from 200 to 299.
- [X] T043 [US2] Add to src/inbox/schemas/comment-backfill.schema.ts:
  - `BackfillRunStateSchema` (`running|finished|stopped|interrupted`);
  - `InterruptReasonSchema` (`SERVER_RESTART|COMMENT_REPLIES_DISABLED|ACCOUNT_DISCONNECTED|META_ACCESS_LOST`);
  - `ActorRefSchema` (`{ id, name }`);
  - `BackfillRunSchema` and `BackfillStartResultSchema`, shaped as in the contract;
  - the DTO classes `BackfillRunDto` and `BackfillStartResultDto`, and the exported types.
- [X] T044 [US2] Create src/inbox/backfill-run.store.ts (`@Injectable BackfillRunStore`, injecting `@Inject(REDIS)`) with these methods:
  - **Lock**:
    - `acquireLock(platform, postId, runId, ttlMs)`: `SET NX PX`;
    - `lockHolder(platform, postId)`;
    - `renewLock(...)`: Lua, `PEXPIRE` only if `GET == runId`;
    - `releaseLock(...)`: Lua, `DEL` only if `GET == runId`.
  - **Run state**:
    - `create(run & { clientName })`: `HSET` flat fields, `EXPIRE` 48 h, and the pointer `SET … EX` 48 h;
    - `get(runId)`;
    - `incr(runId, 'queued'|'dropped'|'skipped')`.
  - **End states**:
    - `stop(runId, actor, ttlSec)`: Lua. If the state is `running`, it sets `stopped`, `stoppedById`, `stoppedByName` and `endedAt`, sets both TTLs, and deletes the lock if the lock holds this run. It returns the previous state, or `nil` when the run is missing.
    - `end(runId, state, reason, ttlSec)`: the same compare-and-set for `finished` and `interrupted`.
    - `markStaleIfLockLost(runId, ttlSec)`: Lua. If the state is `running` and the lock is not this run, it sets `interrupted`/`SERVER_RESTART`.
  - **Posts list**: `latestForPosts(platform, postIds)` reads the pointers, then the hashes, in pipelines.

  Write the Lua scripts as constants with a comment each.
- [X] T045 [US2] Rewrite src/inbox/comment-backfill.service.ts following research R5–R9:
  - **Constructor**: inject `PostCommentsService`, `BackfillRunStore`, `ClientsService` (forwardRef), `PriorityInboxService` and `ConfigService`. Remove the in-memory `running` set.
  - **`start(input, actor)`**: follow R9 steps 1–7.
    - The lock TTL is `delay + 60_000`. `estimatedEndAt` is `startedAt + (toAnswer − 1) × delay`.
    - Record the activity before starting the worker (R10).
    - Start the worker with `void this.feed(...)`.
  - **`feed(run, comments, token)`**: the R6 loop. For each comment:
    1. sleep;
    2. if `get(runId).state !== 'running'`, exit;
    3. if `renewLock` returns false, exit;
    4. read `getClientDataForWorkFlow(accountId)`: if it is `null`, `end(interrupted, ACCOUNT_DISCONNECTED)`; if `!commentReplyConfig.enabled`, `end(interrupted, COMMENT_REPLIES_DISABLED)`;
    5. `recheck`: on an access error, `end(interrupted, META_ACCESS_LOST)`; if the outcome is not `needs_reply`, `incr('skipped')`;
    6. otherwise call `inbox.push(item, { skipRateLimit: true })` with the same `InboxItem` as today, and `incr('queued' | 'dropped')`.

    At the end of the list, call `end(finished)`. Catch per comment (log at `error`, `incr('skipped')`) and around the whole loop. Keep the token in memory only.
  - **`getRun(id)`**: if the run is missing, throw `NotFoundException({ errorCode: 'BACKFILL_RUN_NOT_FOUND' })`. If it is `running`, call `markStaleIfLockLost`, then read it again.
  - **`stopRun(id, actor)`**: an unknown run gives 404. If the previous state was not `running`, throw `ConflictException({ errorCode: 'BACKFILL_RUN_ENDED', details: { state } })`. Otherwise call `recordReplyRun(STOPPED, { …, handled })` and return the run. If the activity insert fails, log at `error` and rethrow.
  - **`latestRuns(platform, postIds)`**: `latestForPosts`, plus a stale check on running runs.
  - **`onModuleDestroy`**: set `stopped`, then mark the runs this instance started as `interrupted`/`SERVER_RESTART`, best effort.
  - Keep `toHttpError` exported, unchanged. Log start, end, stop and interruption at `log`, and skips at `debug`.
- [X] T046 [US2] Update src/inbox/comment-backfill.controller.ts:
  - `start(@Body() dto, @CurrentUser() user)` builds the actor `{ id, name, email }`, with `@ApiAcceptedResponse({ type: BackfillStartResultDto })`;
  - add `@Get('runs/:id') getRun(@Param() { id }: IdParamDto)` with `@ApiOkResponse({ type: BackfillRunDto })`;
  - add `@Post('runs/:id/stop') @HttpCode(200) stopRun(@Param() { id }: IdParamDto, @CurrentUser() user)` with `@ApiOkResponse({ type: BackfillRunDto })`.

  The class-level guards and `@Roles('ADMIN')` stay unchanged.
- [X] T047 [US2] Register `BackfillRunStore` in the `providers` of src/inbox/inbox.module.ts, and export `CommentBackfillService`, `PostCommentsService` and `BackfillRunStore`. Run `npm test -- src/inbox src/clients`: it is green
- [X] T048 [US2] Attach runs to the posts list:
  - add `replyRun: BackfillRunSchema.nullable()` to `ClientPostSchema` in src/client-posts/schemas/client-post-record.schema.ts;
  - in src/client-posts/client-posts.service.ts `list`, inject `CommentBackfillService` and set each post's `replyRun` from `latestRuns(platform, postIds)` (one Redis round trip);
  - extend src/client-posts/client-posts.service.spec.ts: a run is attached by postId, and `null` is set when there is none.
- [X] T049 [US2] Run `npm run openapi:export`. Check `POST /inbox/comments/backfill` (202 `BackfillStartResult`), `GET /inbox/comments/backfill/runs/{id}`, `POST …/runs/{id}/stop` and `ClientPost.replyRun` against contracts/client-posts-api.openapi.yaml, and commit openapi/openapi.json
- [X] T050 [P] [US2] Update the Postman collection:
  - in `postman/collections/Social Inbox Automation API/Inbox/Backfill Unanswered Comments (ADMIN).request.yaml`, describe the `run` field, the 409 `CONFLICT` `details.runId` and the new 409 `COMMENT_REPLIES_DISABLED`, and make the `afterResponse` script save `runId` from `run.id`;
  - add `Inbox/Get Backfill Run (ADMIN).request.yaml` and `Inbox/Stop Backfill Run (ADMIN).request.yaml`, using `{{runId}}` and describing the 404 and 409 codes.

  Then run `npm run postman:export`.

### Dashboard for User Story 2 (`fekra-dashboard`)

- [X] T051 [US2] Run `npm run api:types` in fekra-dashboard to pick up the run schemas from T049
- [X] T052 [P] [US2] Add MSW handlers to fekra-dashboard/src/test/handlers.ts and fixtures `makeRun(overrides)` to fekra-dashboard/src/test/fixtures/client-posts.ts for:
  - `POST /api/inbox/comments/backfill`: 202 with a run, 202 with `run: null`, 409 `CONFLICT` with `details.runId`, and 409 `COMMENT_REPLIES_DISABLED`;
  - `GET /api/inbox/comments/backfill/runs/:id`: a scripted progress sequence;
  - `POST …/runs/:id/stop`: 200, or 409 `BACKFILL_RUN_ENDED`.
- [X] T053 [P] [US2] Create fekra-dashboard/src/features/client-posts/start-run-dialog.test.tsx, stop-run-dialog.test.tsx and run-status.test.tsx, and extend posts-page.test.tsx. They MUST fail before T054–T057. Cover:
  - **Confirmation**: the text includes the count, the client name, the delay and the duration. Cancel sends no request. Start POSTs `{ accountId: fbPageId | instaAccountId, postId }` for the current platform.
  - **Start results**: a `run: null` result shows "Nothing to answer anymore" and refetches the count.
  - **Progress**: a `role="progressbar"` with `aria-valuenow` and `aria-valuemax`, the text "Handled X of N", and "Started by". It polls every 5 s under fake timers, pauses when `document.visibilityState` is hidden, and stops polling once the run has ended.
  - **Stop**: the Stop confirmation sends the stop request.
  - **Action area**: disabled with a settings link when `commentReplyConfig.enabled` is false; no reply action while a run is in progress; a 409 `CONFLICT` starts following `details.runId`.
  - **Accessibility**: axe in `en` and `ar`.
- [X] T054 [US2] Add hooks to fekra-dashboard/src/features/client-posts/queries.ts:
  - `useStartRun(clientId, platform)`: a mutation. On 202 it seeds `postKeys.run(id)`, and on `run: null` it invalidates the count.
  - `useRun(runId)`: `refetchInterval: (q) => q.state.data?.state === 'running' ? 5000 : false`, with `refetchIntervalInBackground: false`. When a run goes from `running` to ended, it invalidates that post's count.
  - `useStopRun()`.
- [X] T055 [US2] Create fekra-dashboard/src/features/client-posts/start-run-dialog.tsx and stop-run-dialog.tsx on top of components/confirm-dialog.tsx, with the texts from contracts/dashboard-ui.md ("Start flow", "Stop flow"). Focus returns to the row's action button when a dialog closes
- [X] T056 [US2] Build the run display:
  - fekra-dashboard/src/features/client-posts/run-status.tsx, the running state: the progress bar, "Handled X of N", "Started by {name}" and a **Stop** button;
  - the action area in post-row.tsx, following the contract's "Reply runs" table (disabled when replies are off, running, count ≥ 1 with no running run, count 0 or unknown);
  - posts-page.tsx starts `useRun` for every visible row whose `replyRun.state` is `running`.
- [X] T057 [P] [US2] Add the `runs.*` strings (the action, both dialogs, progress, started by, stop, replies off note, nothing to answer, already running) to fekra-dashboard/src/i18n/en.json and ar.json. Add `errors.COMMENT_REPLIES_DISABLED`, `BACKFILL_RUN_ENDED` and `BACKFILL_RUN_NOT_FOUND` and the start-specific `CONFLICT` text, and the new codes to `KNOWN` in fekra-dashboard/src/api/errors.ts
- [X] T058 [US2] Create fekra-dashboard/e2e/client-posts-us2.spec.ts, with `page.route` mocks for the posts, count, start, run and stop endpoints. It checks: start → confirm → progress advances → Stop → confirm → stopped; the replies-off disabled state; axe in `en` and `ar`; and a keyboard-only pass through both dialogs

**Checkpoint**: US1 and US2 both work. Runs start, show progress, stop, re-check, refuse when
replies are off, and are recorded.

---

## Phase 5: User Story 3 - Check the result of a reply run (Priority: P3)

**Goal**: After a run ends, the post shows its outcome (finished, stopped, or interrupted with the
reason) for 24 hours, and the refreshed count reflects the replies.

**Independent Test**: Let a run on a 5-comment post finish, refresh the list, and see "Finished:
handled 5 of 5" and 0 unreplied. Repeat with a blocked sender and see the "left unanswered on
purpose" note (quickstart.md §3 rows 13–14).

### Tests for User Story 3 (REQUIRED - Constitution Principle V) ⚠️

- [X] T059 [P] [US3] Extend test/backfill-runs.e2e-spec.ts with `process.env.COMMENT_BACKFILL_RESULT_TTL_SEC = '3'` for a dedicated `describe`. It checks:
  - **Finished run**: it has `endedAt`, and `GET /clients/:id/posts` returns it as the post's `replyRun`.
  - **Blocked sender**: one comment's sender is in `blocked:{accountId}` (SADD before the start). That comment is counted in `dropped`.
  - **Expiry**: after 3 seconds, `GET runs/:id` gives 404 `BACKFILL_RUN_NOT_FOUND`, and the post's `replyRun` is `null`.
  - **Interrupted run**: an `interrupted` run with `META_ACCESS_LOST` (the re-check stub returns code 190) is visible with its reason.
- [X] T060 [P] [US3] Extend fekra-dashboard/src/features/client-posts/run-status.test.tsx with the outcome lines for `finished` (with and without the "left unanswered on purpose" note when `dropped + skipped > 0`), `stopped` (with `stoppedBy.name`), and each `interruptReason`. Check that:
  - the `META_ACCESS_LOST` line links to the replace-token dialog;
  - each outcome change is announced in an `aria-live="polite"` region;
  - a post with an ended run and count ≥ 1 shows both the outcome and the reply action;
  - axe passes in `en` and `ar`.

### Implementation for User Story 3

- [X] T061 [US3] Add the outcome lines from contracts/dashboard-ui.md "Outcome lines" to fekra-dashboard/src/features/client-posts/run-status.tsx, with an `aria-live="polite"` region. In post-row.tsx, show an ended run's outcome together with the reply action when the count is ≥ 1. Make sure the count is refetched when a polled run ends (US3-1)
- [X] T062 [P] [US3] Add the `runs.outcome.*` strings (finished, unanswered on purpose, stopped by, each interrupt reason, start again) to fekra-dashboard/src/i18n/en.json and ar.json
- [X] T063 [US3] Create fekra-dashboard/e2e/client-posts-us3.spec.ts, with `page.route` mocks where the run moves `running → finished`, then `stopped`, then each `interrupted` reason. It checks the outcome text in `en` and `ar`, that the count is refetched to 0 after `finished`, and that axe reports 0 violations

**Checkpoint**: All three user stories work on their own.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Contract, configuration, security and release checks across the stories.

- [X] T064 [P] Review the logging in src/inbox/comment-backfill.service.ts, src/inbox/post-comments.service.ts, src/inbox/backfill-run.store.ts and src/client-posts/client-posts.service.ts against Principle VIII:
  - one `Logger` per class, and no `console.*`;
  - no token, and no comment or post text above `debug`;
  - `error` for unexpected failures, `warn` for dropped events, `log` for run lifecycle.
- [X] T065 [P] Security pass (Principle IV):
  - every new route has class-level `JwtAuthGuard`, `RolesGuard` and `@Roles('ADMIN')`;
  - the token never appears in Redis (`HGETALL backfill:run:*` in the e2e Redis DB shows no token or email), in responses, or in logs;
  - the Facebook ownership check is in place;
  - the `thumbnailUrl` and `permalink` values sent to the dashboard are `https` only.
- [ ] T066 Check that prisma/migrations/*_reply_run_activity is committed, additive, and applies cleanly on a copy of the current schema with `npx prisma migrate deploy` (Principle VI)
- [X] T067 Run `npm run openapi:export && git diff --exit-code openapi/openapi.json` and `npm run postman:export`. Confirm that contracts/client-posts-api.openapi.yaml and the generated document agree on every path, status code and errorCode (Principle III)
- [ ] T068 Run the backend CI steps: `npm run lint:check`, `npm run build`, `npm test` and `npm run test:e2e`. Run the dashboard checks: `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e`. Fix any failure
- [ ] T069 Run the manual checks in specs/002-client-posts-backfill/quickstart.md §3–§4 against a test Facebook page, and record any deviation as a bug with a reproducing test first (Principle V)
- [ ] T070 Prepare the release notes in the PR description:
  - the new env variables for the production secret store (`COMMENT_BACKFILL_DELAY_MS`, `COMMENT_BACKFILL_MAX`, `COMMENT_BACKFILL_RESULT_TTL_SEC`);
  - the migration name;
  - the backend-first release order (Frontend Integration);
  - the removed `GET /clients/:accountId/posts/:postId/reply` and the changed `GET /clients/:id/posts` (plan.md Complexity Tracking).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies; can start immediately.
- **Foundational (Phase 2)**: depends on Setup. It blocks all user stories: T004 depends on T003, T006 on T005, T007 on T006, and T008 is independent of T003–T007.
- **US1 (Phase 3)**: depends on Phase 2.
- **US2 (Phase 4)**: depends on Phase 2.
  - Its backend tasks T031–T047 do not need US1.
  - T048 (attaching runs to the posts list) needs US1's T015–T016.
  - Its dashboard tasks extend US1's posts page and need T025–T027.
- **US3 (Phase 5)**: depends on US2. The outcomes come from US2's run states, and T059 extends US2's e2e file.
- **Polish (Phase 6)**: depends on every story being delivered.

### Within Each User Story

- Tests are written first and MUST fail.
- Schemas and types come before services, services before controllers, then module registration.
- OpenAPI is exported before the dashboard regenerates its types (T019 → T021, T049 → T051).
- Backend endpoints are deployed before the dashboard uses them.

### Parallel Opportunities

- T001 ‖ T002. In Phase 2, T003 ‖ T005 ‖ T008.
- **US1**:
  - the tests T009 ‖ T010 ‖ T011 ‖ T012;
  - then T013 ‖ T014 ‖ T015;
  - T020 ‖ T022–T024 once T019 is done;
  - T029 at any time.
- **US2**:
  - the tests T031 ‖ T032 ‖ T033 ‖ T034 ‖ T036 ‖ T037;
  - T038 ‖ T041 (then T039, which needs the migration's types only for the reader);
  - T050 ‖ T052 ‖ T053 ‖ T057 after T049.
- **US3**: T059 ‖ T060 ‖ T062.
- **Two repositories**: backend and dashboard work can run in parallel once each story's OpenAPI export is committed.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "T009 Schema spec in src/client-posts/schemas/client-posts-query.schema.spec.ts"
Task: "T010 Service spec in src/client-posts/client-posts.service.spec.ts"
Task: "T011 Controller spec in src/client-posts/client-posts.controller.spec.ts"
Task: "T012 e2e in test/client-posts.e2e-spec.ts"

# Then the independent files, together:
Task: "T013 Graph and record types in src/client-posts/types/client-post.types.ts"
Task: "T014 Query schemas in src/client-posts/schemas/client-posts-query.schema.ts"
Task: "T015 Response schemas in src/client-posts/schemas/client-post-record.schema.ts"
```

## Parallel Example: User Story 2

```bash
Task: "T031 Details schema spec in src/common/zod/json-columns.schema.spec.ts"
Task: "T033 Re-check spec in src/inbox/post-comments.service.spec.ts"
Task: "T034 Run store spec in src/inbox/backfill-run.store.spec.ts"
Task: "T036 Controller spec in src/inbox/comment-backfill.controller.spec.ts"
Task: "T037 e2e in test/backfill-runs.e2e-spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup), then Phase 2 (Foundational). This also removes the broken endpoints.
2. Phase 3 (US1): the backend, then the dashboard.
3. **Stop and validate**: run quickstart.md §3 rows 1–5 and §4 (posts and counts).
4. Deploy the backend, then the dashboard. Admins can now see where the unreplied comments are.

### Incremental Delivery

1. Setup and Foundational give a shared rule and a clean module graph.
2. US1 lets admins see posts and counts. Deploy (MVP).
3. US2 adds start, progress, stop and the activity record. Deploy the backend first (migration),
   then the dashboard.
4. US3 adds outcomes and result checks. Deploy the dashboard; the backend parts were already
   delivered with US2.

### Parallel Team Strategy

- Developer A: backend US1 → backend US2.
- Developer B: dashboard US1 (against MSW fixtures from the contract) → dashboard US2 → US3.
- They meet at each OpenAPI export (T019, T049).

---

## Notes

- [P] tasks touch different files and do not depend on an unfinished task.
- Commit after each task or logical group, with Conventional Commits (`feat(client-posts): …`,
  `feat(inbox): …`, `test: …`).
- A run posts real public replies: always test manually on a test page.
- Stop at any checkpoint to validate a story on its own.
