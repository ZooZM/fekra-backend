# Feature Specification: Make Branch 003 Deployable (n8n Lead Endpoints, Shared Chat Workflows, Deploy Safety, Voice Fix)

**Feature Branch**: `004-n8n-lead-endpoints` (merged into `003-chat-frontend-comment-analysis` before
its deploy)
**Created**: 2026-11-14
**Status**: Draft
**Input**: Branch 003 is not deployed yet. Four problems must be fixed before it ships: the n8n chat
workflows need a safe way to read and save the lead of a conversation; several clients must be able
to share one chat workflow; the first deploy must not break production; voice notes are sent with
the image instructions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A chat workflow reads a conversation's context (Priority: P1)

Before it answers a customer, a client's n8n chat workflow asks the platform for what it knows
about that customer on that client's account: the lead captured so far and the latest exchanges of
the conversation. The workflow never connects to the database.

**Why this priority**: Without the history and the lead, every reply starts from zero and the
workflow asks the customer the same questions again.

**Independent Test**: Seed a client, a conversation with answered and unanswered exchanges and a
lead, then call the context endpoint with the shared secret and check the lead and the exchanges,
oldest first.

**Acceptance Scenarios**:

1. **Given** a customer with no lead and no conversation, **When** the workflow asks for the
   context, **Then** it gets `lead: null` and an empty history, and nothing is created.
2. **Given** a conversation with 12 exchanges, some unanswered (paused assistant), **When** the
   workflow asks for 10, **Then** it gets the latest 10, oldest first, unanswered ones included with
   an empty reply.
3. **Given** an account that belongs to another client, **When** the workflow asks with its own
   client id, **Then** the request is refused as not found and nothing is returned.
4. **Given** a missing or wrong secret, **Then** the request is refused as unauthorized.

---

### User Story 2 - A chat workflow saves the lead after every reply (Priority: P1)

After each reply the workflow sends what it learned (stage, phone, country, last intent, summary
and business-specific fields). The platform merges it into the stored lead without losing what was
captured earlier, and tells exactly one request that it is the one that should notify the client
about a new qualified lead.

**Why this priority**: Leads are the business result of the chat. A lost phone number or a
duplicate notification is visible to the client.

**Independent Test**: Save a lead twice with partial data and check the merge; send several
concurrent saves that claim the notification and check that exactly one is told `notifiedNow: true`.

**Acceptance Scenarios**:

1. **Given** no lead, **When** the workflow saves one, **Then** it is created with the sent values.
2. **Given** a lead with a phone and `fields.industry = "clothes"`, **When** the workflow saves
   `phone: null` and `fields: { industry: "", page_link: "x" }`, **Then** the phone and the
   industry are kept and `page_link` is added.
3. **Given** a lead, **When** the workflow sends a stage, **Then** the stored stage is the sent one.
4. **Given** a lead never notified, **When** two saves with `claimNotification: true` arrive at the
   same time, **Then** exactly one response has `notifiedNow: true`, and every later one `false`.
5. **Given** invalid input (unknown key, too many fields, nested field value, bad country),
   **Then** the request is refused with field errors and nothing is saved.

---

### User Story 3 - Several clients share one chat workflow (Priority: P2)

An administrator can give the same chat workflow endpoint to several clients. The endpoint format
and the base address rule are unchanged; only the "one client per endpoint" rule is removed.

**Why this priority**: Business decision: clients of the same kind use the same workflow, which
tells them apart by the client data and client id in each request (and the lead endpoints scope
every read and write to that client).

**Independent Test**: Give two clients the same endpoint and subscribe both; both saves succeed.

**Acceptance Scenarios**:

1. **Given** a client using endpoint `chat-shop`, **When** the administrator saves `chat-shop` on
   another client, **Then** it is saved (no conflict).
2. **Given** an endpoint that is not a plain path segment, **Then** it is still refused (unchanged).

---

### User Story 4 - The first deploy of 003 cannot break production (Priority: P2)

The deploy stops before anything changes when the VM's env file lacks `N8N_BASE_URL` (the new API
refuses to boot without it). A runbook lists what operators do around the release so clients keep
getting chat replies.

**Independent Test**: Run the deploy script's preflight against an env file without the variable:
it exits non-zero with a clear message, prints no secret, and has started nothing.

**Acceptance Scenarios**:

1. **Given** an env file without `N8N_BASE_URL` (or with an empty or malformed value), **When** the
   API deploy starts, **Then** it fails before pulling images, migrating or replacing the API.
2. **Given** a valid env file, **Then** the preflight prints that the variable is set (not its
   value) and the deploy continues.

---

### User Story 5 - Voice notes are transcribed with the transcription instructions (Priority: P3)

A customer's voice note is sent to the model with the voice transcription instructions, not the
image description instructions.

**Independent Test**: A unit test checks the system instruction of the voice request.

## Edge Cases

- The lead of an account that changed owner: the stored lead belongs to the previous client. The
  context returns `lead: null` and only the current client's conversation; a save replaces the old
  lead with a new one for the current client (the old client's data is never returned).
- An empty string in `fields` is ignored: it never erases a stored value and is never stored.
- `null`, a missing key or an empty string for phone, country, last intent or summary keeps the
  stored value.
- `fields` hold the union of every key ever sent; one request sends at most 30.
- No conversation yet: empty history; the endpoint never creates a conversation.
- Leads hold personal data: they are deleted by the daily retention run when not updated for
  `RETENTION_MONTHS`.

## Requirements *(mandatory)*

### Functional Requirements

**n8n data endpoints**

- **FR-001**: `GET /n8n/leads/context` and `POST /n8n/leads` MUST authenticate the caller with the
  `x-webhook-secret` header compared in constant time with `N8N_WEBHOOK_SECRET`. Missing, wrong or
  unconfigured secret → `401 UNAUTHORIZED`. They take no JWT.
- **FR-002**: Both endpoints MUST refuse with `404 CLIENT_ACCOUNT_NOT_FOUND` when the client does
  not exist or the account is not that client's account on that platform (Facebook page id,
  Instagram account id). The same answer for both cases.
- **FR-003**: Invalid input MUST be refused with `422 INPUT_VALIDATION_ERROR` and field errors
  (limits in [contracts/n8n-data-api.openapi.yaml](./contracts/n8n-data-api.openapi.yaml)).
- **FR-004**: The context MUST return the client's lead for (platform, account, customer) or
  `null`, and the last `historyLimit` (1-50, default 10) exchanges of the matching conversation of
  that client, oldest first, unanswered ones included. It MUST NOT create anything.
- **FR-005**: The save MUST upsert on (platform, account, customer) in one transaction and merge:
  non-empty `fields` values overwrite, empty ones are ignored; empty or `null` phone, country, last
  intent and summary keep the stored value; the stage always takes the sent value.
- **FR-006**: With `claimNotification: true`, the save MUST set the notification time only when it
  is not set yet, with a conditional update, and answer `notifiedNow: true` only to the request that
  set it.
- **FR-007**: Leads MUST be deleted by the retention run when their last update is older than
  `RETENTION_MONTHS`.
- **FR-008**: The n8n callback MUST use the same secret check, with its behavior and contract
  unchanged.

**Shared chat workflows**

- **FR-009**: The same chat workflow endpoint MAY be set on several clients. Spec 003 FR-034 ("an
  endpoint belongs to at most one client") is removed. FR-032 (format), FR-035 (no host change) and
  "no shared fallback address" stay.

**Deploy safety**

- **FR-010**: The API deploy MUST fail before pulling, migrating or replacing anything when
  `N8N_BASE_URL` is missing, empty or not an http(s) address in `/opt/fekra/.env`, with a message
  that names the variable and never prints a value.
- **FR-011**: `specs/003-chat-frontend-comment-analysis/quickstart.md` MUST have a "Releasing 003"
  runbook.

**Voice notes**

- **FR-012**: A voice note's model request MUST carry the voice transcription instructions.

### Key Entities

- **Lead**: what a chat workflow has learned about one customer on one client account: stage (free
  text, stages differ per client), phone, country, last intent, summary, business-specific fields
  (flat text map) and when the client was notified. One per (platform, account, customer).

## Success Criteria *(mandatory)*

- **SC-001**: 100% of requests without the right secret are refused (e2e).
- **SC-002**: 0 reads or writes of another client's lead or conversation in the e2e matrix.
- **SC-003**: Out of 10 concurrent saves claiming the notification, exactly 1 gets `notifiedNow:
  true` (e2e).
- **SC-004**: A deploy with no `N8N_BASE_URL` stops in the preflight with the API still serving
  the previous release.
- **SC-005**: Lint, unit and e2e suites pass; migrations apply on an empty database.

## Assumptions

- The n8n workflow that calls these endpoints is already built: request and response field names
  are fixed.
- n8n reaches the API through the same public host as the dashboard (`/api/n8n/...` behind Caddy).
- `N8N_WEBHOOK_SECRET` is the same secret for the callback and the lead endpoints.
- Notifying the client (the message itself) is done by the workflow, not by the platform.
