# Quickstart: Admin Clients Dashboard

Run the backend and the dashboard locally, then check each user story and success criterion.
Commands assume a POSIX shell (Git Bash on Windows).

## 1. Backend (`fekra-backend`)

Prerequisites: Node.js 22, PostgreSQL, and Redis reachable from your machine.

```bash
npm ci
npx prisma migrate dev          # applies the admin_clients_dashboard migration
npm run start:dev               # http://localhost:3000
```

New variables in `.env.development.local` (all listed in `.env.example`):

```env
JWT_EXPIRES_IN=10m              # access token lifetime (production uses 10m)
SESSION_IDLE_MINUTES=30         # FR-003 idle limit
SESSION_MAX_HOURS=12            # FR-003 absolute limit
SESSION_COOKIE_PATH=/api/auth   # browser sees /api via the Vite proxy
APP_ORIGIN=http://localhost:5173
CORS_ORIGINS=                   # empty: the dashboard is same-origin through the proxy
LOGIN_MAX_FAILURES=5            # FR-027
LOGIN_BLOCK_MINUTES=15          # FR-027
OPENAPI_ENABLED=true            # serves /docs-json outside production
```

Create a first administrator. Register a user, then promote it in the database:

```bash
curl -s -X POST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"change-me-please"}'
psql "$DATABASE_URL" -c "UPDATE users SET roles = ARRAY['ADMIN']::\"UserRole\"[] WHERE email = 'admin@example.com';"
```

Export the contract for the dashboard:

```bash
npm run openapi:export          # writes openapi/openapi.json
```

## 2. Dashboard (`fekra-dashboard`)

```bash
npm ci
npm run api:types               # openapi-typescript ../fekra-backend/openapi/openapi.json → src/api/schema.d.ts
npm run dev                     # http://localhost:5173
```

`vite.config.ts` proxies the API so the browser sees a single origin:

```ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api/, '') },
  },
},
```

## 3. Manual check by user story

| # | Steps | Expected | Covers |
|---|---|---|---|
| US1 | Sign in as the admin, open `/clients` with 45 seeded clients, page, sort, and search "caf" | 20 rows per page, total 45; sorting works; search filters and shows the match count | FR-004 to FR-008, SC-002 |
| US1 | Sign in as a CLIENT-role user | Sent to `/no-access`. `curl -H "Authorization: Bearer <client token>" localhost:3000/clients` → 403 | FR-001, FR-002, SC-003 |
| US2 | Create a client with an existing `fbPageId` | Field error "Already connected to another client"; nothing created | FR-012 |
| US2 | Create a valid client | The detail view opens and shows "Access token: on file" | FR-009, FR-016 |
| US3 | Open the same client in two tabs, save in tab A, then save in tab B | Tab B shows "{name} changed this client at {time}" and keeps its input | FR-029, SC-012 |
| US4 | Replace the token, then search the network panel and server logs for the value | The value appears only in the PUT request body you sent | FR-016, SC-004 |
| US5 | Delete a client, typing its name | Removed from the list; `/clients/<id>` shows "no longer exists" | FR-019, FR-020 |
| US6 | Turn private messages on with an empty list, then add one message and save | First save is blocked; second save shows exactly the saved values | FR-026, SC-009 |
| Lang | Switch to Arabic on `/login` and on `/clients/new` with input typed | RTL layout; input kept; still Arabic after reload | FR-023, SC-008 |
| Session | Reload the page | Still signed in | FR-003 |
| Session | Set `SESSION_IDLE_MINUTES=1` and stay idle for 1 minute | Signed out with an inactivity notice | FR-003 |
| Throttle | Enter a wrong password 5 times, then the correct one | Refused with the same message; correct password works after `LOGIN_BLOCK_MINUTES` | FR-027, SC-010 |
| Usability | Ask someone who hasn't seen the dashboard to create a valid client, timing them | Done in under 2 minutes without help | SC-001 |
| Logs | After replacing a token, search the API container logs for the token value | 0 matches | FR-016, SC-004 |
| Activity | After the steps above, run `SELECT action, actor_name, changed_fields FROM client_activities ORDER BY created_at` | One row per change; no token values | FR-028, SC-011 |

## 4. Automated checks

```bash
# backend
npm run lint && npm run build && npm test
npm run test:e2e                # needs Postgres and Redis; covers 401, 403, 409 and throttle paths

# dashboard
npm run lint && npm run typecheck && npm test
npm run e2e                     # Playwright: all user stories + axe wcag22aa in en and ar
```

Done when every row in section 3 matches and both pipelines are green.
