# UI Contract: chat flow, chat workflows, client data and comments (fekra-dashboard)

This extends the UI contracts of features 001 and 002
(`specs/001-admin-clients-dashboard/contracts/dashboard-ui.md`,
`specs/002-client-posts-backfill/contracts/dashboard-ui.md`). Sign-in, the route guard, the two
languages, the errors table and the accessibility rules all apply unchanged. API calls go
through the generated client (`openapi-fetch`) built from `openapi/openapi.json`. Every screen
here is ADMIN-only; CLIENT-role users never see the navigation entries (FR-026).

## Routes

| Route | Screen | Spec |
|---|---|---|
| `/clients` | Adds a **Chat service** column and an **Only not subscribed** switch (`?chatSubscribed=false`) | US5-11, FR-046 |
| `/clients/new`, `/clients/:id/edit` (client form) | Adds a **Chat service** section: endpoint field and subscription switch | US5, FR-032 to FR-036, FR-043 to FR-046 |
| `/clients/:id/business-info` | Business information form | US6, FR-037, FR-038 |
| `/clients/:id/services` | Services list and form | US6, FR-039, FR-042 |
| `/clients/:id/offers` | Offers list and form | US6, FR-040 to FR-042 |
| `/conversations` | Conversations list | US1, US2, FR-001 to FR-007 |
| `/conversations/:chatId` | One conversation: thread and pause control | US1, US2, FR-003, FR-009 to FR-015 |
| `/comments` | Classified comments, filters, download | US3, US4, FR-016 to FR-024 |

Main navigation (admin): Clients, Conversations, Comments. The client page shows tabs
**Details · Business info · Services · Offers · Posts** (Posts is feature 002).

**URL state** (survives reload and can be shared): every list filter, the search value and
`page`. Not in the URL: expanded rows and open dialogs.

## Clients list and form (US5)

- **Column** "Chat service": a badge, **Subscribed** (green) or **Not subscribed** (grey).
- **Switch** "Only not subscribed" (off by default) sends `chatSubscribed=false`. It is the
  administrator's checklist after the release (SC-019).
- **Form section** "Chat service", below the private-message settings:
  - **Chat workflow endpoint**: text field, `dir="ltr"`, helper text "Letters, digits, - and _
    only. It is added to the chat workflow address." The base address is never shown (FR-031).
    The client-side check mirrors the server regex `^[A-Za-z0-9_-]{1,100}$` (the server is the
    authority).
  - **Subscribed to the chat service**: switch. When the endpoint is empty, the switch is disabled
    with the hint "Enter an endpoint first" (FR-045).
  - While subscribed, the endpoint field cannot be emptied: clearing it shows "Unsubscribe first"
    and the save button stays enabled for other fields, so the server's 422 is never the only
    signal.
- Both fields are saved with the rest of the form through `PATCH /clients/{id}` with `version`,
  so the 001 rules apply as they are: unsaved-changes guard, `CLIENT_VERSION_CONFLICT` dialog,
  and field errors.

## Business information, services and offers (US6)

- **Business info** (`GET /business-info/client/{id}`): `404 NOT_FOUND` → empty form and a
  **Create** button (`POST`). Otherwise the form, and **Save** sends `PUT` with every field, so
  what is on screen is what is stored. **Delete** asks for confirmation.
  - Fields: phone, WhatsApp (≤ 50), email, website (`http`/`https`), social links (rows of
    platform + URL, add/remove), location (city, district, full address, map links: URL +
    description), work hours (one row per weekday, `sunday` to `saturday`, with a start and an end time as `HH:MM`;
    a weekday that is left out means closed, matching the API's per-day object), payment methods and installment options (tag inputs, no duplicates).
- **Services** (`GET /services?clientId=…`): table with name, price, variants count and the
  offer's title; sort by name, price or date created; **Load more** by 20. The form has name
  (required), description, price (free text), variants (rows of name + price, names unique) and
  an **Offer** select that lists only this client's offers (`GET /offers?clientId=…`) with an
  empty option.
- **Offers** (`GET /offers?clientId=…`): table with title, discount (`10%` or `50.00`), start and
  end date, and the number of linked services (counted from the client's services list); sort by
  title, start, end or date created. The form has title, description, discount type (radio:
  percentage or fixed amount), value (> 0; ≤ 100 for a percentage), start date and end date (end
  ≥ start, checked before sending).
- **Delete offer** dialog: "This offer covers N services. They will stay, without an offer."
- All text inputs use `dir="auto"`, so Arabic reads right to left (US6-8).
- Errors: `422` `details.fieldErrors` onto the fields (for example `offerId`: "Choose an offer of
  this client"); `404` → "This item was deleted" and the list reloads.

## Conversations list (US1, US2)

1. `GET /chats?page=…&limit=20` (+ filters). Rows are ordered by last activity.
2. Each row shows:
   - the platform icon;
   - the client name (admins see every client);
   - the customer identifier;
   - the time of the last activity (relative, with the exact time in a tooltip);
   - `lastExchange.message` and `lastExchange.reply`, one line each, `dir="auto"`; "Not answered"
     in place of the reply when `answered` is false; "No exchange recorded yet" when
     `lastExchange` is null (US1-6);
   - a **Paused** badge when `paused`, with "until 18:30" or "until resumed".
3. Filters: platform (All / Facebook / Instagram), client (searchable select), **Only paused**
   switch (`paused=true`).
4. **Search** box "Customer identifier": exact match (`senderId`); spaces are trimmed; empty =
   no filter. No result: "No conversation found for this identifier" (US1-9).
5. Pagination: **Load more** while `meta.page < meta.totalPages`. **Refresh** reloads the first
   page (FR-007). There are no live updates.
6. Empty state: "No conversations yet". Loading: a skeleton list (FR-006).

## Conversation thread (US1, US2)

- Header (`GET /chats/{chatId}`): client name, platform, customer identifier, and the pause
  control.
- Thread (`GET /chats/{chatId}/messages?orderDir=desc&limit=20`): the newest 20 exchanges,
  shown oldest at the top. **Load earlier** requests the next page (FR-003). Each exchange shows:
  - the customer's message in a bubble on the customer's side, `white-space: pre-wrap`,
    `dir="auto"`, so batched messages keep one per line and Arabic, emoji and line breaks show as
    written (FR-004, FR-005);
  - the reply on the other side, or a muted "Not answered by the assistant" when `answered` is
    false;
  - the time.
- **Pause control**:
  - **Active**: a **Pause assistant** button opens a dialog with the duration as a radio group:
    Until I resume · 1 hour · 24 hours · 7 days. Confirm sends `POST /chats/{id}/pause`.
  - **Paused**: a banner "Assistant paused by {pausedBy.name} at {pausedAt}, until
    {pausedUntil | 'you resume it'}", with **Resume** (`POST …/resume`) and **Change duration**
    (the same dialog).
  - After any action the header and the list query are invalidated. A `pausedUntil` in the past
    is shown as active even before a refresh (compare with the clock), because the server
    computes the state the same way.
- `404` → "This conversation no longer exists", with a link back to the list.

## Comments (US3, US4)

1. `GET /comment-replies?page=…&limit=20` (+ filters), newest first.
2. Columns:
   - date;
   - client;
   - platform;
   - comment: one line, `dir="auto"`, "No text" when empty, a **Show all** toggle for long text
     (FR-019);
   - label (a colored tag per classification);
   - **Decided by**: Rules · AI model ({decisionModel}) · Safe fallback · Unknown;
   - reason (muted).
3. Filters: label, decided by, platform, client, from, to. The total is shown as "{meta.total}
   comments" (FR-017). `to` < `from` is blocked in the form, and the server's `422` on `to` is
   shown on the field (FR-018).
4. A note under the filters: "Comments from clients with comment automation turned off are not
   classified, so they are not included." (FR-020)
5. **Download CSV**:
   - Sends `fetch('/api/comment-replies/export?' + same filters)` with the bearer token, and saves
     the blob as the server's filename.
   - While it runs, the button shows a spinner and "Preparing {meta.total} rows…".
   - The download counts as failed when the response is not `ok`, when the body stream throws, or
     when the network fails. A failure shows the toast "The download did not finish. Try again."
     and saves nothing (FR-024).
   - For very large exports (> 100,000 rows), use `showSaveFilePicker` and stream to disk when the
     browser supports it, otherwise a blob.
6. Empty state: "No comment has been classified yet" (US3-7).

## Errors (additions to the 001 table)

| Status / `errorCode` | Where | UI |
|---|---|---|
| ~~`409 DUPLICATE_KEY_ERROR`, `details.field = chatWorkflowEndpoint`~~ | client form | No longer returned since feature 004 (several clients may share an endpoint). The mapping is harmless; remove it when convenient |
| `422 INPUT_VALIDATION_ERROR` on `chatWorkflowEndpoint` | client form | the server message on the field |
| `422 INPUT_VALIDATION_ERROR` on `offerId` / `clientId` | service form | on the field |
| `404 NOT_FOUND` | business info `GET` | empty form + Create (not an error) |
| `404 NOT_FOUND` | thread, pause, resume | "This conversation no longer exists" |
| `403 FORBIDDEN` | any screen here | the standard "No access" page (should not happen for admins) |

## Accessibility

- The pause dialog and the delete dialogs trap focus and return it to the button.
- The **Paused** banner uses `role="status"`. Download progress uses `aria-live="polite"`.
- Each label and **Decided by** value has text, not color only.
- Every new screen gets an axe check in Playwright, in English and Arabic.
