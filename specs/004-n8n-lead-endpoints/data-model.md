# Data Model: Make Branch 003 Deployable

**Feature**: `004-n8n-lead-endpoints` | **Plan**: [plan.md](./plan.md)

Two additive migrations. No new Redis key.

## 1. Lead (new, `leads`)

One per customer per client account. Serves every client: business-specific data goes in `fields`.

| Field | Column | Type | Rules |
|---|---|---|---|
| `id` | `id` | `UUID` PK | generated |
| `clientId` | `client_id` | `UUID NOT NULL` FK → `clients.id` `ON DELETE CASCADE` | the account's owner, checked on every request |
| `platform` | `platform` | `"Platform"` | input `facebook` / `instagram` (any case) |
| `accountId` | `account_id` | `VARCHAR(255)` | Page ID / Instagram account ID; must be the client's (`fbPageId` / `instaAccountId`) |
| `senderId` | `sender_id` | `VARCHAR(255)` | PSID / IGSID |
| `stage` | `stage` | `VARCHAR(50) NOT NULL DEFAULT 'new'` | free text, 1-50; always the last sent value |
| `phone` | `phone` | `VARCHAR(30) NULL` | max 30; empty/`null` keeps the stored value |
| `country` | `country` | `VARCHAR(2) NULL` | 2 letters, upper-cased; empty/`null` keeps |
| `lastIntent` | `last_intent` | `VARCHAR(50) NULL` | max 50; empty/`null` keeps |
| `summary` | `summary` | `TEXT NULL` | max 1000; empty/`null` keeps |
| `fields` | `fields` | `JSONB NOT NULL DEFAULT '{}'` | flat `{ string: string }`; per request ≤ 30 keys, keys ≤ 50, values ≤ 500; shallow merge, empty values skipped. `LeadFieldsSchema`, read through `readLeadFields` |
| `notifiedAt` | `notified_at` | `TIMESTAMP NULL` | set once, by a conditional update |
| `createdAt`, `updatedAt` | `created_at`, `updated_at` | `TIMESTAMP` | `updatedAt` drives retention |

Indexes: unique `(platform, account_id, sender_id)` (the upsert key), `(client_id, stage,
updated_at)` (per-client lists, and the FK index), `(updated_at)` (retention).

**LeadRecord** (response): every column above, `fields` parsed, dates as ISO strings.

**Retention**: deleted by the daily run when `updated_at < cutoff` (`RETENTION_MONTHS`), in
batches of 5,000. Deleting a client deletes its leads (cascade).

## 2. Client (changed)

| Field | Before (003) | Now |
|---|---|---|
| `chatWorkflowEndpoint` | `VARCHAR(100) NULL UNIQUE` | `VARCHAR(100) NULL`, plain index `clients_chat_workflow_endpoint_idx` |

The format rule (`^[A-Za-z0-9_-]{1,100}$`), the subscribe-needs-endpoint rule and its `CHECK`
constraint are unchanged.

## 3. Migrations

1. `<ts>_shared_chat_workflow_endpoint`: `DROP INDEX "clients_chat_workflow_endpoint_key"`,
   `CREATE INDEX "clients_chat_workflow_endpoint_idx"`. Loosens a constraint only.
2. `<ts>_leads`: `CREATE TABLE "leads"` with its indexes and FK. The previous release never reads it.

Both apply in the same deploy as 003's migration; a rollback to the previous image ignores them.
