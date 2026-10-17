# SCMTS – Smart Campus Mobility Transportation System
College project. Recommends the best bus/route to students using live bus positions,
destination and traffic. Roles: student, driver, admin.

## Stack
- frontend/  React (functional components, plain fetch)
- backend/   Go (standard library + chi router, database/sql, no ORM)
- db/        MySQL, schema in db/schema.sql
- REST over HTTPS; WebSocket for live bus positions

## Data stores
- D1 routes & stops: static, admin writes, student/driver read
- D2 live bus data: overwritten by driver GPS every few seconds
- D3 trip history: append-only (trip start = INSERT, trip end = UPDATE with rating)

## Rules
- Do ONLY the task I give. No refactors, no extra features, no new libraries without asking.
- Edit files in place. Never rewrite a whole file for a small change.
- For anything non-trivial: show a short plan, wait for my OK, then code.
- Go: handle every error, no panics in handlers, one handler per file section.
- SQL: parameterized queries only.
- Keep files small and single-purpose.
- After finishing: tell me how to test it, then tick the task in docs/TASKS.md.
- Never read node_modules/, dist/, build/, or lockfiles.
- Never commit secrets: .env files must stay out of git. If you see one tracked, tell me.
- If a doc and the code disagree (e.g. an endpoint in API.md that is not built), tell me instead of guessing. Mark unbuilt endpoints "not built yet" in API.md.

## Docs (read only when the task needs them)
- docs/SPEC.md   features and DFD summary
- docs/API.md    endpoints (update when you add one)
- docs/TASKS.md  task checklist by phase
