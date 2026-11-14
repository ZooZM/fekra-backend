# Implementation Plan: Make Branch 003 Deployable

**Branch**: `004-n8n-lead-endpoints` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-n8n-lead-endpoints/spec.md`

## Summary

Four fixes that ship with feature 003, in its release:

1. **n8n data endpoints**: a new `leads` module with a `Lead` table, `GET /n8n/leads/context` and
   `POST /n8n/leads`, behind a reusable `N8nSecretGuard` (also used by the n8n callback). Leads are
   added to the retention run.
2. **Shared chat workflows**: `clients.chat_workflow_endpoint` loses its unique index (a plain index
   stays) and the service drops its uniqueness pre-check.
3. **Deploy safety**: a preflight in `deploy/remote-deploy.sh` (and its own workflow step) refuses
   an API deploy when `/opt/fekra/.env` has no valid `N8N_BASE_URL`; a "Releasing 003" runbook.
4. **Voice fix**: `handleVoiceRecord` uses `buildVoicePrompt`.

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22, NestJS 11.
**Primary Dependencies**: Prisma 7 (pg adapter), Zod 4 + nestjs-zod, `@nestjs/swagger`. No new
dependency.
**Storage**: PostgreSQL. Two additive migrations: `shared_chat_workflow_endpoint` (drop the
unique index, add a plain one) and `leads` (new table). No new Redis key.
**Testing**: Jest unit specs with mocks; supertest e2e against real PostgreSQL and Redis.
**Target Platform**: the GCP VM (Docker Compose behind Caddy). n8n calls `https://<host>/api/n8n/...`.
**Performance Goals**: the context is 3 indexed reads (client by id, lead by unique key, last N
exchanges through the chat unique key and `(chat_id, created_at)`); the save is one short
transaction (insert-if-missing, row lock, read, update, optional claim).
**Constraints**: request and response field names are fixed by the existing n8n workflow; no
customer text or phone in logs; the callback contract must not change.
**Scale/Scope**: 2 new endpoints, 1 new table, 1 new `errorCode` (`CLIENT_ACCOUNT_NOT_FOUND`).

## Decisions

- **D1. Module layout.** `src/leads/` owns the table (controller → service → `ILeadsRepository`).
  It reads the conversation history through a new exported `ConversationsService.recentExchanges`
  and checks ownership through a new `ClientsService.ownsAccount`, never through another module's
  repository (constitution I). The guard lives in `src/common/guards/` because `inbox` and `leads`
  both use it.
- **D2. Ownership.** `ownsAccount(clientId, platform, accountId)` reads the client by id, uncached.
  Unknown client and foreign account give the same `404 CLIENT_ACCOUNT_NOT_FOUND`, so the answer
  does not reveal which ids exist.
- **D3. Tenant scope on reads.** The lead and the conversation are also filtered by `clientId`: if
  an account moved to another client, the previous client's lead and conversation are not returned.
  A save over such a lead replaces it (fresh lead, notification reset) instead of merging into the
  previous client's data.
- **D4. Merge in one transaction.** `INSERT … ON CONFLICT DO NOTHING` (Prisma `createMany` with
  `skipDuplicates`) makes sure the row exists, `SELECT … FOR UPDATE` locks it, the pure helper
  `mergeLead(current, input)` builds the update, then the update. Concurrent saves for the same
  customer merge one after the other, so no field is lost. The merge rules live in the helper
  (unit-tested), the Prisma calls in the repository.
- **D5. Notification claim.** `updateMany({ where: { id, notifiedAt: null }, data: { notifiedAt:
  now } })`; `notifiedNow = count === 1`. The row lock already serializes saves; the conditional
  update keeps the claim correct on its own.
- **D6. Empty values.** Empty `fields` values are skipped (never stored, never erase). Phone,
  country, last intent and summary accept `null`, a missing key or `""`, all meaning "keep". Text
  is trimmed and NUL characters stripped (`storableText`), so Postgres never rejects a save.
  `country` is upper-cased.
- **D7. Output enums.** `lead.platform` is the database value (`FACEBOOK` / `INSTAGRAM`), like
  every other record of the API. Input accepts either case (`platformField`).
- **D8. Deploy preflight.** `remote-deploy.sh preflight` reads `N8N_BASE_URL` from
  `/opt/fekra/.env` with `sed` (the file is never sourced, the value never printed), checks it is a
  non-empty http(s) address without query or fragment, and exits 1 with a message otherwise. The
  `api` deploy runs it first, before `pull`, `migrate` and `up`; the deploy workflow also runs it as
  its own step so the failure is visible by name.

## Constitution Check

*Source: `.specify/memory/constitution.md` v1.0.0.*

| Gate | Result | Notes |
|---|---|---|
| **I. Feature modules** | ✅ | `src/leads/` with the standard layout; cross-module calls through exported `ClientsService` and `ConversationsService`; `RetentionModule` deletes leads through `LeadsService`. |
| **II. Zod input contract** | ✅ | `LeadContextQuerySchema` and `UpsertLeadSchema` are `z.strictObject` DTOs, reuse `platformField`, `externalId`, `storableText`. The new JSON column `leads.fields` gets `LeadFieldsSchema` and `readLeadFields`. The callback body still bypasses Zod (existing follow-up, untouched: its contract must not change). |
| **III. HTTP contract** | ✅ | Records returned as-is, standard error shape, one new `errorCode`. Shared endpoints only remove a `409` (looser validation, backward compatible). Postman `n8n Data` folder and `openapi.json` updated. |
| **IV. Security** | ✅ | New public routes, justified: called only by n8n, a machine caller that authenticates with the shared secret like the existing callback; constant-time comparison in `N8nSecretGuard`. Tenant scope enforced in the service from the verified ownership (D2, D3). |
| **V. Tests** | ✅ | Unit: guard, schemas, merge helper, service (ownership, claim, concurrency), repository, retention, attachment handler (fails on the old code). e2e: 401, 404 other client, 422, context and upsert cases, concurrent claim, retention, shared endpoints. |
| **VI. Migrations** | ✅ | Two Prisma-generated, additive migrations. `leads.client_id` FK `ON DELETE CASCADE`, indexed by `(client_id, stage, updated_at)`. Dropping a unique index loosens a constraint: safe for the running release. |
| **VII. Async reliability** | ✅ | Synchronous endpoints with short transactions; no outbound call. |
| **VIII. Observability & config** | ✅ | No new variable. Ids only in logs, never phone, summary or fields. |
| **Frontend integration** | ✅ | The dashboard does not use the new routes. It no longer gets `409` for a shared endpoint; its mapping for it becomes unused (harmless). |
| **Delivery** | ✅ | The preflight is a deploy-time guard; no new manual VM step beyond 003's `N8N_BASE_URL`. |

**Result**: PASS.

## Project Structure

```text
src/
├── common/guards/n8n-secret.guard.ts (+ .spec.ts)         # NEW constant-time x-webhook-secret check
├── common/zod/json-columns.schema.ts, json-readers.ts      # + LeadFieldsSchema, readLeadFields
├── inbox/n8n-callback.controller.ts (+ .spec.ts)           # uses the guard; same contract
├── inbox/attachment-handler.service.ts (+ NEW .spec.ts)    # voice prompt fix
├── clients/clients.service.ts (+ specs)                    # − endpoint uniqueness; + ownsAccount
├── clients/repositories/*                                  # − findChatEndpointConflict
├── conversations/conversations.service.ts (+ spec)         # + recentExchanges
├── conversations/repositories/*                            # + findRecentExchanges
├── leads/                                                  # NEW module
│   ├── leads.module.ts, leads.controller.ts (+ spec), leads.service.ts (+ spec)
│   ├── helpers/merge-lead.ts (+ spec)
│   ├── repositories/ILeadsRepository.repository.ts, leads.repository.impl.ts (+ spec)
│   ├── schemas/lead.schema.ts (+ spec), mappers/lead.mapper.ts, types/lead.types.ts
└── retention/retention.service.ts (+ spec), retention.module.ts   # + leads

prisma/schema.prisma, prisma/migrations/<ts>_shared_chat_workflow_endpoint/, <ts>_leads/
test/n8n-leads.e2e-spec.ts (NEW), retention.e2e-spec.ts, clients-chat-service.e2e-spec.ts
deploy/remote-deploy.sh, deploy/compose.yml, .github/workflows/deploy.yml
postman/collections/Social Inbox Automation API/n8n Data/ (NEW), openapi/openapi.json
specs/003-chat-frontend-comment-analysis/{spec,research,data-model,plan,quickstart}.md, contracts/
```

**Structure Decision**: one new feature module (`leads`) that owns the new table; everything else
changes in the module that owns it.

## Complexity Tracking

No violation. Public routes are justified under Constitution IV above.
