# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
*Source: `.specify/memory/constitution.md`. Mark each gate ✅ pass, ❌ violation (justify in
Complexity Tracking) or N/A.*

- [ ] **I. Feature modules**: work sits in `src/<feature>/` with controller → service →
  repository interface (`<FEATURE>_REPOSITORY` token) → `PrismaService`; no Prisma in
  controllers; cross-module access only through exported services
- [ ] **II. Zod input contract**: every body/query/param has a `createZodDto` schema built
  with `z.strictObject`, shared primitives and `IdParamDto`; JSON columns have schemas and
  readers
- [ ] **III. HTTP contract**: lists return `{ data, meta }` via `paginate()`; errors use
  `{ statusCode, message, errorCode, details? }`; changes are additive or expand → contract;
  the Postman collection is updated
- [ ] **IV. Security**: `JwtAuthGuard` by default; ADMIN routes use `RolesGuard` +
  `@Roles('ADMIN')`; CLIENT users are scoped to their `clientId`; secrets encrypted and
  omitted; webhooks verified with constant-time comparison
- [ ] **V. Tests**: co-located `*.spec.ts` for each new or changed unit with mocked
  dependencies; e2e coverage for auth, role, tenant and signature rejections
- [ ] **VI. Migrations**: schema changes come with a committed Prisma migration that is
  backward compatible with the running release (expand → backfill → contract)
- [ ] **VII. Async reliability**: webhooks acknowledge fast; Redis keys are namespaced
  constants; outbound calls have a timeout, bounded retries and a terminal state; rules run
  before the LLM
- [ ] **VIII. Observability & config**: per-class `Logger`, no secrets in logs; config via
  `ConfigService` (`getOrThrow` for required); new variables in `.env.example`
- [ ] **Frontend integration**: contract impact on the React app identified; release order
  (backend first, compatible) respected; CORS/auth assumptions unchanged or documented
- [ ] **Delivery**: change builds in the Docker image, needs no manual VM step, and keeps
  `GET /health` meaningful

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT) - NestJS feature module (this repo)
src/
├── common/                      # shared zod primitives, filters, pipes, helpers
└── [feature]/                   # plural kebab-case, e.g. clients, business-info
    ├── [feature].module.ts
    ├── [feature].controller.ts (+ .spec.ts)
    ├── [feature].service.ts    (+ .spec.ts)
    ├── repositories/
    │   ├── I[Feature]Repository.repository.ts   # interface + [FEATURE]_REPOSITORY token
    │   └── [feature].repository.impl.ts
    ├── schemas/                 # Zod schemas + createZodDto DTOs + z.infer types
    ├── interfaces/              # repository input data
    ├── types/                   # records returned to callers
    └── mappers/                 # Prisma row → record

prisma/
├── schema.prisma
└── migrations/

test/                            # e2e (supertest) *.e2e-spec.ts
postman/collections/Social Inbox Automation API/   # living API contract

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
