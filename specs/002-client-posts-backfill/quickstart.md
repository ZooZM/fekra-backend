# Quickstart: Client Posts and Unreplied Comment Replies

Run the backend locally, then check each user story and success criterion. Commands assume a
POSIX shell (Git Bash on Windows). Setup for the dashboard and the first administrator is in
`specs/001-admin-clients-dashboard/quickstart.md`.

## 1. Backend

```bash
npm ci
npx prisma migrate dev          # applies <ts>_reply_run_activity
npm run start:dev               # http://localhost:3000
```

Variables (all listed in `.env.example`):

```env
COMMENT_BACKFILL_DELAY_MS=5000          # pause between two comments (FR-014)
COMMENT_BACKFILL_MAX=500                # comments checked per post (FR-007)
COMMENT_BACKFILL_RESULT_TTL_SEC=86400   # how long an ended run stays visible (FR-022)
```

For fast manual tests, set `COMMENT_BACKFILL_DELAY_MS=2000`.

You need a test client whose Facebook page (and optionally Instagram account) is connected with
a valid Page token. The token needs the `pages_read_engagement`, `pages_read_user_content` and
`pages_manage_engagement` permissions, plus `instagram_basic` and `instagram_manage_comments`
for Instagram. Use a test page, never a customer's page: runs post real public replies.

## 2. Automated checks

```bash
npm run lint:check
npm test                                  # unit: post-comments, backfill, run store, client-posts, schemas
npm run test:e2e                          # needs PostgreSQL + Redis; Graph is stubbed
npm run openapi:export && git diff --exit-code openapi/openapi.json   # contract is committed
npm run postman:export
```

## 3. Manual checks with Postman

Use the `Social Inbox Automation API` collection. The `Clients` and `Inbox` folders have the new
requests. Sign in as an ADMIN first (the `Auth / Login` request saves `{{accessToken}}`).

| # | Request | Expect | Spec |
|---|---|---|---|
| 1 | `GET /clients/{{clientId}}/posts?platform=facebook` | 200; up to 25 posts, newest first; `meta.nextCursor` set when there are more | US1-1, FR-004, FR-005 |
| 2 | same with `after={{nextCursor}}` | the next posts, no overlap | US1-1 |
| 3 | `GET /clients/{{clientId}}/posts/{{postId}}/unreplied-count?platform=facebook` | 200; on a post with 12 customer comments, 9 answered by the page → `unrepliedCount: 3` | US1-2, FR-006 |
| 4 | same, `platform=instagram` for a client without Instagram | 404 `ACCOUNT_NOT_CONNECTED` | US1-4, FR-002 |
| 5 | count for `{{otherPageId}}_123456` | 404 `META_POST_NOT_FOUND` | R4 ownership check |
| 6 | turn comment replies off (PATCH client), then `POST /inbox/comments/backfill` | 409 `COMMENT_REPLIES_DISABLED`; turn them back on | US2-9, FR-011 |
| 7 | `POST /inbox/comments/backfill` `{ accountId: {{pageId}}, postId }` | 202; `pending` equals the count from #3 (SC-002); `run.state: running` | US2-2, FR-013 |
| 8 | repeat #7 at once | 409 `CONFLICT`, `details.runId` = the run from #7 | US2-4, FR-016 |
| 9 | `GET /inbox/comments/backfill/runs/{{runId}}` every few seconds | `handled` goes up by 1 per delay; the posts list shows the same `replyRun` | US2-7, FR-017 |
| 10 | answer one of the remaining comments on Facebook by hand, then wait | when the run reaches it, `skipped` +1 and no second reply on Facebook | FR-023, SC-007 |
| 11 | `POST /inbox/comments/backfill/runs/{{runId}}/stop` | 200 `state: stopped`, `stoppedBy` = you; at most 1 more reply appears on Facebook | US2-8, FR-021, SC-009 |
| 12 | stop again | 409 `BACKFILL_RUN_ENDED` | spec edge case |
| 13 | start a new run, let it finish, recount | `state: finished`; the count is 0 when no sender is blocked | US3-1, SC-003 |
| 14 | start a run, kill the server (Ctrl+C), restart, then read the run after `delay + 60 s` | `state: interrupted`, `interruptReason: SERVER_RESTART` | spec edge case, FR-022 |
| 15 | sign in as a CLIENT user and call #1, #3, #7, #9, #11 | 403 each (401 without a token) | FR-001, SC-006 |

Check the activity record:

```sql
SELECT action, actor_name, details, created_at
FROM client_activities
WHERE client_id = '<clientId>' AND action IN ('REPLY_RUN_STARTED', 'REPLY_RUN_STOPPED')
ORDER BY created_at DESC;
```

You should see one `REPLY_RUN_STARTED` row per run from #7 and #13, and one `REPLY_RUN_STOPPED`
row from #11 with `details.handled` (FR-019).

## 4. Dashboard checks (fekra-dashboard)

Follow `contracts/dashboard-ui.md`. Check each item in English and in Arabic:

- the posts appear before the counts, and one failed count can be retried on its own (FR-024,
  SC-001: the posts appear in under 2 s, the counts within 10 s);
- the filter switch, including after **Load more** (US1-6);
- the confirmation text; the progress updates every ≤ 10 s; stop; each outcome line (US2, US3);
- the axe scan has 0 violations, and the whole flow works with the keyboard alone (SC-008).
