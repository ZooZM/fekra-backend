# UI Contract: client posts and reply runs (fekra-dashboard)

This extends the feature 001 UI contract
(`specs/001-admin-clients-dashboard/contracts/dashboard-ui.md`). Sign-in, the route guard,
languages, the errors table and accessibility rules from 001 all apply unchanged. API calls go
through the generated client (`openapi-fetch`) built from `openapi/openapi.json`.

## Routes

| Route | Access | Screen | Spec |
|---|---|---|---|
| `/clients/:id` | ADMIN | Adds a **Posts** action. It is disabled, with "Connect a Facebook page or Instagram account first", when neither is connected | FR-002 |
| `/clients/:id/posts?platform=facebook` | ADMIN | Posts list for one account. The platform tabs are shown only when both accounts are connected; Facebook first | US1, US2, FR-003 |

**URL state**:
- `platform` (default `facebook` if connected, else `instagram`);
- `unreplied=1` for the filter switch (FR-008).

Loaded pages and counts are not in the URL. A reload starts again from the first page.

## Posts list (US1)

1. Request `GET /clients/{id}/posts?platform=…` and render the 25 rows right away (FR-024).
   Show `meta.fetchedAt` as "Loaded at 14:32" next to a **Refresh** button (FR-009).
2. For each row with `commentsCount > 0`, request
   `GET /clients/{id}/posts/{postId}/unreplied-count?platform=…`. Use at most 6 requests at a
   time (a TanStack Query queue), in list order. Rows with `commentsCount = 0` show 0 without
   a request.
3. Each row shows:
   - the date;
   - the text, cut to one line, with `dir="auto"` so Arabic reads right to left;
   - "No text" when there is none;
   - a thumbnail (with a placeholder if it fails to load);
   - a link that opens on Facebook or Instagram (`target="_blank" rel="noopener noreferrer"`);
   - the comments count;
   - the unreplied cell.
4. Unreplied cell states:

   | State | Shows |
   |---|---|
   | loading | skeleton, `aria-busy="true"` |
   | loaded, 0 | "0" |
   | loaded, ≥ 1 | the count, highlighted row (FR-008). If `truncated`: "at least 37" with a tooltip "Only the latest 500 comments are checked" (FR-007) |
   | failed | "Couldn't count" + **Retry** (refetches this post only) |

5. The **Only posts with unreplied comments** switch (off by default) hides loaded rows whose
   count is 0, still loading or failed (FR-024). When every loaded row is hidden, show "None of
   the loaded posts have unreplied comments" and keep **Load more** visible.
6. **Load more** appears while `meta.nextCursor` is not null and calls the list with
   `after=nextCursor`. New rows go through steps 2–5.
7. **Refresh** reloads the first page and all counts. Posts loaded with **Load more** are
   dropped.
8. Empty state: "This account has no posts yet". Loading state: a skeleton list.

## Reply runs (US2, US3)

Each row's action area depends on the latest run and the count.

| Condition | Action area |
|---|---|
| `client.commentReplyConfig.enabled` is false | **Reply to unreplied comments** is disabled, with the note "Comment replies are off for this client" and a link to `/clients/:id/edit#comment-settings` (FR-011) |
| `replyRun.state = running` | Progress "Handled X of N" (X = `handled`, N = `toAnswer`) with a progress bar, "Started by {startedBy.name}", and a **Stop** button. No reply action (FR-017) |
| `replyRun` ended (< 24 h) | Outcome line (FR-022) and, if the count is ≥ 1, the reply action |
| count ≥ 1, no running run | **Reply to unreplied comments** |
| count 0, unknown or failed | No reply action |

Outcome lines:

| `state` / `interruptReason` | Text |
|---|---|
| `finished` | "Finished: handled N of N" + "Some comments may be left unanswered on purpose (for example, blocked senders)" when `dropped + skipped > 0` (US3) |
| `stopped` | "Stopped by {stoppedBy.name}: handled X of N" |
| `interrupted` / `SERVER_RESTART` | "Interrupted by a server restart: handled X of N. Start again to continue." |
| `interrupted` / `COMMENT_REPLIES_DISABLED` | "Interrupted: comment replies were turned off" |
| `interrupted` / `ACCOUNT_DISCONNECTED` | "Interrupted: this account is no longer connected to the client" |
| `interrupted` / `META_ACCESS_LOST` | "Interrupted: Facebook or Instagram rejected the client's access token" + link to replace the token |

**Start flow**:
1. Open the confirmation dialog (FR-012). It says: "{count} comments will be answered publicly on
   behalf of {client name}, following its comment settings, one every {delay} seconds (about
   {duration})." The buttons are **Start replying** and **Cancel**. The default delay of 5 s
   is shown until the first run reports `delaySeconds`.
2. On **Start replying**: `POST /inbox/comments/backfill` with
   `{ accountId: client.fbPageId | client.instaAccountId, postId }`.
3. On 202 with `run`: success notification "Replying started: {pending} comments, about
   {duration}". The row switches to progress. On 202 with `run: null`: notification "Nothing to
   answer anymore", then refetch the count.

**Progress**: while any visible row has a `running` run, poll
`GET /inbox/comments/backfill/runs/{id}` every 5 s for each of those runs (FR-017 requires at
most 10 s). Stop polling a run once it has ended. When polling ends, refetch that post's count
(US3). Polling pauses while the tab is hidden and resumes, with an immediate fetch, when the
tab is visible again.

**Stop flow**: a confirmation dialog: "Stop replying? Comments not handled yet stay unreplied.
You can start again later." Then `POST /inbox/comments/backfill/runs/{id}/stop`, and on 200,
show the outcome line.

## errorCode → UI

The table below adds to the one in feature 001.

| API outcome | UI behavior |
|---|---|
| 404 `ACCOUNT_NOT_CONNECTED` | Page message "This account is no longer connected to the client" with a link back to the client |
| 404 `META_POST_NOT_FOUND` (count or start) | Row message "This post no longer exists"; the row's actions are disabled until **Refresh** |
| 400 `META_TOKEN_INVALID` | Page banner "Facebook or Instagram rejected this client's access token" + **Replace token** (opens the 001 replace-token dialog) |
| 400 `META_PERMISSION_DENIED` | Page banner "The client's page is missing a permission", with the missing permission from the translation for this code |
| 400 `BAD_REQUEST` on start | "No access token on file for this client" + **Replace token** |
| 409 `CONFLICT` on start | "A reply run is already in progress for this post". Start polling `details.runId` and show its progress |
| 409 `COMMENT_REPLIES_DISABLED` | Same note as the disabled state; refetch the client |
| 409 `BACKFILL_RUN_ENDED` on stop | "This run has already ended"; refetch the run and show its outcome |
| 404 `BACKFILL_RUN_NOT_FOUND` | Remove the progress from the row; refetch the count |
| 503 `META_UNAVAILABLE`, 502 `META_ERROR` | List: page error with **Retry**. Count: the row's "Couldn't count" state. Start: dialog error with **Retry**. Never shown as success |

All texts are in `en.json` and `ar.json`. The dialogs, progress bar and switch follow WCAG 2.2
AA (FR-020):

- progress uses `role="progressbar"` with `aria-valuenow` and `aria-valuemax`;
- outcome changes are announced through an `aria-live="polite"` region;
- dialogs trap focus and return it to the row's action button when closed.
