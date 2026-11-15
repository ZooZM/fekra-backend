---

description: "Task list for 004-n8n-lead-endpoints"
---

# Tasks: Make Branch 003 Deployable

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md),
[contracts/n8n-data-api.openapi.yaml](./contracts/n8n-data-api.openapi.yaml)

**Tests**: REQUIRED (Constitution V). Unit specs mock their dependencies; e2e specs run against
real PostgreSQL and Redis through `test/utils`. A bug fix starts with a failing test.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational

- [X] T001 Write the spec, plan, data-model, contract and tasks in `specs/004-n8n-lead-endpoints/`;
  point `.specify/feature.json` and `CLAUDE.md` at it.
- [X] T002 [P] `N8nSecretGuard` in `src/common/guards/n8n-secret.guard.ts` with
  `n8n-secret.guard.spec.ts` (wrong, longer, shorter, empty, missing, array header, unconfigured →
  401; right → pass). Same logic as the callback's `isAuthorized`.
- [X] T003 Refactor `src/inbox/n8n-callback.controller.ts` to `@UseGuards(N8nSecretGuard)`; move the
  secret cases of its spec to the guard spec and assert the guard is on the controller. Body checks
  and responses unchanged; `test/n8n-callback.e2e-spec.ts` pins the contract (401 body before the
  body is read, 400 without an id, `acknowledged: false` for an unknown id).

## Phase 2: US5 Voice prompt (P3, independent)

- [X] T004 [US5] `src/inbox/attachment-handler.service.spec.ts`: the voice request's system
  instruction is the voice prompt (fails on the old code), the image request's is the image prompt.
- [X] T005 [US5] `handleVoiceRecord` calls `buildVoicePrompt`.

## Phase 3: US3 Shared chat workflows (P2)

- [X] T006 [US3] Update the unit specs first: `clients.service.chat.spec.ts`,
  `clients.service.spec.ts`, `clients.repository.impl.spec.ts` (no conflict check, shared endpoint
  saved).
- [X] T007 [US3] `prisma/schema.prisma`: `chatWorkflowEndpoint` without `@unique`, plus
  `@@index([chatWorkflowEndpoint])`; `prisma migrate dev --name shared_chat_workflow_endpoint`.
- [X] T008 [US3] Remove `assertEndpointFree` (`clients.service.ts`) and `findChatEndpointConflict`
  (interface + impl).
- [X] T009 [US3] e2e `test/clients-chat-service.e2e-spec.ts`: two clients save the same endpoint.
- [X] T010 [US3] Docs 003: spec (US5-4, FR-033, FR-034, key entity, edge case, assumptions), plan,
  research R4, data-model §1 §9, contracts (yaml, dashboard-ui), quickstart check 3; Postman
  `Clients/Update Client` description.

## Phase 4: US1 + US2 Lead endpoints (P1)

- [X] T011 [P] [US1] `prisma/schema.prisma`: `Lead` model and `Client.leads`; `prisma migrate dev
  --name leads`.
- [X] T012 [P] [US1] `LeadFieldsSchema` and `readLeadFields` in `src/common/zod/` (+ specs).
- [X] T013 [P] [US1] `src/leads/schemas/lead.schema.ts` + spec: context query (`historyLimit` 1-50,
  default 10), strict upsert body with every limit, response DTOs.
- [X] T014 [P] [US2] `src/leads/helpers/merge-lead.ts` + spec: field merge, keep-on-empty, stage,
  other client's lead replaced.
- [X] T015 [US1] `ClientsService.ownsAccount` (+ spec) and `ConversationsService.recentExchanges`
  with `findRecentExchanges` in the conversations repository (+ specs), oldest first, scoped by
  client.
- [X] T016 [US2] `ILeadsRepository` + `leads.repository.impl.ts` (+ spec): find by key and client,
  locked upsert, conditional claim, batched `purgeBefore`.
- [X] T017 [US1] `LeadsService` (+ spec): `404 CLIENT_ACCOUNT_NOT_FOUND`, context, upsert,
  notification claim including two concurrent saves.
- [X] T018 [US1] `LeadsController` (`n8n/leads`, guard, `@ApiHeader`) + spec; `LeadsModule`;
  register in `AppModule`.
- [X] T019 [US2] Retention: `LeadsService.purgeBefore` called by `RetentionService` (spec: same
  cutoff, leads count in the log line); `retention.e2e-spec.ts` deletes an old lead, keeps a new one.
- [X] T020 [US1] e2e `test/n8n-leads.e2e-spec.ts`: 401 (missing, wrong, also on the callback), 404
  foreign account and unknown client, 422, context with no chat, history order with unanswered rows
  and `historyLimit`, upsert create, merge, `notifiedNow` once then false, 10 concurrent claims.
- [X] T021 [US1] Postman `n8n Data` folder (Get Lead Context, Upsert Lead, invalid secret); `npm run
  postman:export`; `npm run openapi:export`.

## Phase 5: US4 Deploy safety (P2)

- [X] T022 [US4] `deploy/remote-deploy.sh`: `preflight` command and the same check at the start of
  the `api` deploy; `.github/workflows/deploy.yml` step "Preflight: VM configuration";
  `deploy/compose.yml` comment uses `N8N_BASE_URL`.
- [X] T023 [US4] "Releasing 003" runbook in `specs/003-chat-frontend-comment-analysis/quickstart.md`;
  `.env.example` comments.

## Phase 6: Polish

- [X] T024 `npm run lint:check`, `npm test`, `npm run test:e2e`; migrations on a fresh database.
