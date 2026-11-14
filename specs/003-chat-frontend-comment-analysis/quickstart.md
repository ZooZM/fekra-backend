# Quickstart: Chat Flow in the Dashboard

Run the backend locally, check each user story and success criterion, then follow the release
steps. Commands assume a POSIX shell (Git Bash on Windows). Setup for the dashboard and the first
administrator is in `specs/001-admin-clients-dashboard/quickstart.md`.

## 1. Backend

```bash
npm ci
npx prisma migrate dev          # applies <ts>_chat_workflow_pause_export
npm run start:dev               # http://localhost:3000
```

Variables (all listed in `.env.example`):

```env
N8N_BASE_URL=https://n8n.example.com/webhook/   # replaces N8N_WEBHOOK_URL (research R3)
N8N_WEBHOOK_SECRET=change-me                    # unchanged
PAUSE_SWEEP_INTERVAL_MS=30000                   # how often expired pauses are recorded (FR-014)
COMMENT_EXPORT_BATCH=1000                       # rows per database read while exporting
RETENTION_MONTHS=12                             # customer texts older than this are deleted daily (FR-049)
```

For a client to get automatic DM replies it needs an endpoint and the subscription
(`PATCH /clients/{id}` with `chatWorkflowEndpoint`, `chatSubscribed: true` and `version`), and
an n8n workflow listening at `{N8N_BASE_URL}{endpoint}`. Use a test page, never a customer's.

## 2. Automated checks

```bash
npm run lint:check
npm test                    # unit: url builder, delivery, inbox gates, sender, pause, sweeper, retention, CSV, schemas
npm run test:e2e            # needs PostgreSQL + Redis; n8n and Graph are stubbed
npm run openapi:export && git diff --exit-code openapi/openapi.json
npm run postman:export
```

## 3. Manual checks with Postman

Sign in as an ADMIN first (`Auth / Login` saves `{{accessToken}}`). New and changed requests are
in the `Clients`, `Conversations`, `Comments`, `Services`, `Offers` and `Business Info` folders.

| # | Request | Expect | Spec |
|---|---|---|---|
| 1 | `PATCH /clients/{{clientId}}` `{ "chatSubscribed": true, "version": n }` on a client with no endpoint | 422, `fieldErrors.chatWorkflowEndpoint` | US5-8, FR-045 |
| 2 | same with `"chatWorkflowEndpoint": "chat-acme"` | 200, both fields set, `version` + 1 | US5-1, FR-032 |
| 3 | another client, same endpoint | 200: both clients keep it (shared workflow, feature 004) | US5-4, FR-034 |
| 4 | endpoint `https://evil.test/x`, `a/b`, `..`, `a b` | 422 each | US5-3, FR-035, SC-016 |
| 5 | send a DM to the test page (or the dev simulator) | the stub/n8n receives `POST {base}chat-acme` with the client's data | US5-1, SC-015 |
| 6 | unsubscribe, send a DM | nothing reaches n8n, no conversation row, a `warn` "dropped" log without text | US5-7, FR-044, SC-018 |
| 7 | `GET /chats?senderId={{customerId}}` | the customer's conversation, `lastExchange` filled | US1-8, FR-002 |
| 8 | `POST /chats/{{chatId}}/pause` `{ "duration": "1h" }` | 200, `paused: true`, `pausedUntil` ≈ now + 1 h | US2-1, FR-009 |
| 9 | send 3 DMs | no reply; 3 exchanges with `answered: false` | US2-2, FR-010, FR-011 |
| 10 | `POST /chats/{{chatId}}/resume`, send a DM | the next DM is answered; the 3 stay unanswered | US2-3, FR-012, SC-004 |
| 11 | pause / resume / export with a CLIENT-role token | 403 | US2-7, US4-8, FR-026 |
| 12 | `GET /comment-replies?decisionBasis=ai_model` | only `AI_MODEL` rows, `decisionModel` set | US4-9, FR-017 |
| 13 | `GET /comment-replies/export?classification=complaint` | a CSV download, BOM, header row, rows = the list's `meta.total` | US4-6, FR-024, SC-008 |
| 14 | `GET /services?clientId={{clientId}}` | only that client's services | US6-2, FR-037 |
| 15 | `PUT /services/{{serviceId}}` with another client's `offerId` | 422 on `offerId` | US6-6, FR-039 |
| 16 | `GET /business-info/client/{{newClientId}}` | 404 `NOT_FOUND` | US6-1 |
| 17 | change a service price, then send a DM | the n8n payload shows the new price | US6-10, FR-048, SC-020 |

## 4. Database checks

```sql
-- pause history, newest first (FR-014): actor_id IS NULL = automatic resume
SELECT action, duration, "until", actor_name, created_at
FROM chat_pause_events WHERE chat_id = '<chatId>' ORDER BY created_at DESC;

-- decision basis spread for the model analysis (SC-007)
SELECT decision_basis, decision_model, classification, count(*)
FROM comment_replies GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- download records (FR-030, SC-014): never contain comment text
SELECT actor_email, filters, row_count, completed, created_at
FROM comment_export_records ORDER BY created_at DESC LIMIT 20;

-- release checklist (SC-019)
SELECT id, name FROM clients WHERE NOT chat_subscribed ORDER BY name;
```

To test retention (SC-021), back-date rows, restart the app (the first run starts 1 minute after
boot), then check that they are gone and that the log line shows only counts:

```sql
UPDATE comment_replies SET created_at = now() - interval '13 months' WHERE id = '<commentId>';
UPDATE chats SET updated_at = now() - interval '13 months' WHERE id = '<inactiveChatId>';
```

To test a timed pause without waiting, move `paused_until` into the past, then wait one sweep
interval:

```sql
UPDATE chats SET paused_until = now() - interval '1 minute' WHERE id = '<chatId>';
```

## 5. Success criteria: how each is checked

| SC | Check |
|---|---|
| SC-001 | Playwright: search an identifier, open the thread, latest exchange visible; timed once on staging |
| SC-002 | e2e: 50 seeded exchanges come back in order (`orderDir=asc`) with identical text |
| SC-003 | e2e `chat-pause`: pause, then 20 DMs → 0 n8n calls and 0 Graph sends |
| SC-004 | e2e `chat-pause`: manual resume and sweeper expiry; only post-resume DMs answered |
| SC-005 | e2e: live comments + a backfill run → one `comment_replies` row each, correct label |
| SC-006 | seed 10,000 rows; first page of each list < 2 s (e2e smoke with a timer) |
| SC-007 | unit: every save path sets `decisionBasis`; SQL spread check (§4) |
| SC-008 | Playwright: filter + download < 1 min; file rows = `meta.total` |
| SC-009 | e2e rejection tests (401, CLIENT 403, wrong-tenant 404) |
| SC-010 | unit: a recording failure is logged and the reply still goes out (R16) |
| SC-011 | the 001 and 002 Playwright suites pass unchanged against the new backend |
| SC-012 | unit: logger spies never receive message, comment or reply text; one-day log review after release |
| SC-013 | e2e `comments-export`: 100,000 rows, flat memory, DM handling timed in parallel |
| SC-014 | e2e: each download leaves a record with counts and no text |
| SC-015 | e2e `chat-workflow`: 3 clients, 50 DMs, stub sees each on its own endpoint |
| SC-016 | unit: 20 invalid endpoint values rejected; URL builder origin check |
| SC-017 | manual: a new client's business info, 5 services and 2 offers in < 10 min |
| SC-018 | e2e `chat-workflow`: unsubscribed client, 50 DMs → 0 calls, 0 rows |
| SC-019 | e2e: after migration, existing clients list under `chatSubscribed=false`; manual after release |
| SC-020 | e2e `chat-workflow`: change a price, next DM payload has the new price |
| SC-021 | e2e `retention`: back-dated rows, one run |

## 6. Release (hard cut, research R12)

From the moment the backend is deployed, **no client gets automatic DM replies until it is
subscribed** (FR-047). Do these in one window:

1. **Before**:
   - Create one n8n workflow per client at `{N8N_BASE_URL}{endpoint}` and write down each
     client's endpoint.
   - Have the dashboard build for this feature ready to deploy.
2. **Env file on the VM**: add `N8N_BASE_URL` (and optionally `PAUSE_SWEEP_INTERVAL_MS`,
   `COMMENT_EXPORT_BATCH`, `RETENTION_MONTHS`). The first retention run, 1 minute after boot,
   deletes anything already older than the period. With the default 12 months this is nothing
   today: these tables only exist since 2026-11-09. **Keep `N8N_WEBHOOK_URL`** for rollback. Update the production secret
   store in the same change.
3. **Deploy the backend** (pipeline: migrate → start → `GET /health`).
4. **Deploy the dashboard** right after. Until it is live, use the Postman request
   `Clients / Update Client` to subscribe a client.
5. **Subscribe every client**: on `/clients`, turn on **Only not subscribed**, then set the
   endpoint and subscribe each client. Stop when the list is empty.
6. **Verify**: one DM per client reaches its own workflow (Postman check 5, or n8n's execution
   log).
7. **Later**: remove `N8N_WEBHOOK_URL` from the env file once rollback is no longer needed.

**Rollback**: redeploy the previous SHA. It ignores the new columns and tables and sends every DM
to `N8N_WEBHOOK_URL` again. The migration stays applied and needs no undo.
