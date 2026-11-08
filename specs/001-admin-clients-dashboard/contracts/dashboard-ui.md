# UI Contract: fekra-dashboard

The user-facing interface of the React dashboard (`fekra-dashboard` repository). Routes are
part of the contract: links are shareable, and the list state lives in the URL.

## Routes

| Route | Access | Screen | Spec |
|---|---|---|---|
| `/login` | public | Email and password form, language switch | FR-003, FR-023, FR-027 |
| `/clients` | ADMIN | Paged, sortable, searchable list; "New client" action | US1, FR-004 to FR-007 |
| `/clients/new` | ADMIN | Create form: profile, access token, settings (collapsed, with defaults) | US2, FR-009, FR-025 |
| `/clients/:id` | ADMIN | Detail: profile, "Access token: on file", settings, created and updated dates; actions Edit, Replace token, Delete | US1, US4, US5, FR-008 |
| `/clients/:id/edit` | ADMIN | Edit form: profile, AI, private-message and comment settings | US3, US6, FR-010, FR-011 |
| `/no-access` | signed in, not ADMIN | "You don't have access" message and sign-out button | FR-001 |
| `*` | any | Not found, with a link back to the list | FR-020 |

**List state in the URL**: `/clients?page=2&limit=20&orderBy=name&orderDir=asc&search=cafe`.
Invalid values fall back to the defaults (`page=1`, `limit=20`, `orderBy=createdAt`,
`orderDir=desc`).

**Route guard**: With no session, the guard redirects to `/login?next=<path>` and returns there
after sign-in. A user who is signed in but not an ADMIN is sent to `/no-access`. The guard is a
convenience; the API returns 403 regardless (constitution IV).

## Session behavior (research R2, R3)

| Event | Dashboard behavior |
|---|---|
| App start or reload | `POST /api/auth/refresh` → on 200, keep the token in memory and continue; on 401, go to `/login` |
| Activity, and last refresh more than 5 min ago | Refresh in the background |
| API returns 401 with an expired access token | Refresh once (one shared refresh per tab), then retry the request once |
| Refresh returns 401 `SESSION_EXPIRED` | Clear memory, go to `/login?next=…` with the notice "Your session expired". Form input is not saved (spec edge case) |
| 30 min with no pointer, keyboard, wheel or touch input | `POST /api/auth/logout`, go to `/login` with the notice "Signed out after 30 minutes of inactivity" |
| Sign out | `POST /api/auth/logout`, clear memory, and broadcast to other tabs (`BroadcastChannel('fekra-auth')`) so they go to `/login` too |

The access token is **never** written to `localStorage`, `sessionStorage` or a readable cookie.

## How API outcomes map to UI behavior

| API outcome | UI behavior |
|---|---|
| 2xx on a mutation | Success notification (announced by screen readers); go to the detail view or refresh the list |
| 401 `UNAUTHORIZED` on `/auth/login` | "Email or password is incorrect" (the same text for blocked attempts, FR-027) |
| 403 `FORBIDDEN` | Go to `/no-access` |
| 404 `NOT_FOUND` | "This client no longer exists" with a link back to the list |
| 409 `CLIENT_VERSION_CONFLICT` | Banner: "{updatedBy.name} changed this client at {updatedAt}". The form keeps the admin's input, and the "Load latest version" button reloads the client and drops the input after confirmation (FR-029) |
| 409 `DUPLICATE_KEY_ERROR` with `details.field` | Field error on `fbPageId` or `instaAccountId`: "Already connected to another client" |
| 422 `INPUT_VALIDATION_ERROR` | `details.fieldErrors` → messages on the matching fields; `formErrors` → message at the top of the form |
| 5xx, 503 or network failure | "Something went wrong. Try again." with a retry button; never shown as success |

All messages come from the `en` and `ar` translation files. The API's `message` text is never
shown to the admin.

## Confirmations

| Action | Confirmation |
|---|---|
| Leaving a form with unsaved changes | "Discard changes?" (FR-015) |
| Saving an edit that removes or changes `fbPageId` or `instaAccountId` | Warning that the platform stops handling the old account (FR-014) |
| Replacing the access token | Dialog with a hidden input (can be revealed), plus confirm (FR-017, FR-018) |
| Deleting a client | Dialog listing the consequences; the admin must type the client name to confirm (FR-019) |

## Accessibility and language (FR-023, FR-024, FR-030)

- **Language switch**: on every screen, including `/login`. It sets `<html lang dir>`, is saved
  as `localStorage['fekra.lang']`, and on the first visit follows the browser language (`ar` or
  `en`, otherwise `en`).
- **Direction of client data**: values entered by users are rendered with `dir="auto"`.
- **Keyboard and screen readers**: every control can be reached and used with the keyboard,
  with a visible focus indicator. Dialogs trap focus and return it to the control that opened
  them. Errors are linked to their fields with `aria-describedby`, and notifications use a live
  region.
- **Required check**: 0 axe `wcag22aa` violations on every route, in both languages.
