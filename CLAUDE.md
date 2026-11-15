<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/004-n8n-lead-endpoints/plan.md` (it ships with, and builds on,
`specs/003-chat-frontend-comment-analysis/plan.md`)
<!-- SPECKIT END -->

## Project constitution

Read `.specify/memory/constitution.md` before planning or changing code. It defines the
module layout, Zod validation, the HTTP/error contract the React frontend relies on,
security rules, test requirements, Prisma migration rules, and the GitHub Actions → GCP VM
deployment pipeline. When code and constitution disagree, follow the constitution.
