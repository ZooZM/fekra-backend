# Specification Quality Checklist: Admin Clients Dashboard

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validation iteration 1: two open markers were waiting on the user (FR-010 settings scope,
  FR-023 interface language). Every other item passed.
- Validation iteration 2: both markers were resolved with the user's answers (2026-11-07):
  - FR-010: full edit of every client setting. This added User Story 6, FR-025, FR-026 and SC-009.
  - FR-023: English and Arabic with a switch, right-to-left in Arabic. This added SC-008 and
    edge cases for switching language.
  - All items pass. No terms such as API, JWT, endpoint, React or database products appear,
    there are no vague adjectives, and no template placeholders are left.
- Clarify session (2026-11-07): 5 questions were answered, adding FR-027 to FR-030 and SC-010 to
  SC-013. The edge cases, Key Entities and Assumptions were updated, and stale statements
  (last-save-wins, session length "per platform setting") were removed. All items still pass.
- Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`.

## Validation (T126, 2026-11-08)

Automated pipelines (quickstart section 4), run on one machine against real PostgreSQL 16 and Redis 7:

| Check | Result |
|---|---|
| Backend `lint:check` | 0 errors, 47 warnings (legacy code, listed in the constitution follow-ups) |
| Backend `build` | OK (`dist/main.js`) |
| Backend unit tests | 33 suites, 393 tests passed |
| Backend e2e (real database) | 3 suites, 82 tests passed (401, 403, 409, 422, version conflict, race, throttle, delete cascade, settings) |
| Dashboard `lint`, `typecheck`, `i18n:check`, `build` | OK (1 lint warning: fast-refresh export in `session-context.tsx`) |
| Dashboard unit tests (vitest, axe in en and ar) | 11 files, 88 tests passed |
| Dashboard Playwright (en and ar, axe wcag22aa) | 40 passed, 2 skipped (performance runs only with `SEED_CLIENTS=500`) |
| Performance spec (500 clients, 20 loads, vite dev server) | passed: p95 under 2000 ms for list and detail |
| Dashboard Docker image | builds, serves on 8080 as a non-root user, SPA fallback, cache and security headers verified |

Manual table (quickstart section 3), by row:

| Rows | How they were checked |
|---|---|
| US1 to US6, Lang, Session (reload), Activity | Covered by Playwright and backend e2e tests (same steps, both languages) |
| Session idle | Unit test with fake timers (30 minutes); not run by waiting |
| Throttle | Backend e2e (5 failures, same 401, correct password refused while blocked) |
| Logs / token never logged | Unit test spies on the Nest Logger during create and token replace; the API container logs were **not** searched |
| Usability (SC-001) | **Not run**: needs someone who has not seen the dashboard |

Not verified here: the GitHub Actions workflows (YAML parses, but they have not run), the GCP
setup, `remote-deploy.sh` on a real VM, and the backend Docker image build (written by another
session).
