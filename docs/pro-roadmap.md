# Pro roadmap and acceptance contract

Status: implemented and verified with unit/static checks. This document defines the authorized ten-feature scope and tracks each phase. Completed unit coverage is not live provider or deployment qualification.

## Constraints

- Repository source, authored text and documentation use English.
- Tests are adjacent unit tests in `__tests__`, with 100% executable source line, branch and function coverage.
- Tests never contact services, open a real database, spawn a process, run FFmpeg or Docker, render a browser, or incur API charges. Replace those dependencies with controlled doubles.
- Static type checking, linting, formatting and compilation remain available. Production dependencies are exercised through unit contracts only.
- Keep private-chat allowlisting, per-owner isolation, bounded attachment retention, sanitized errors and complete-turn persistence.
- Local cost estimates are configurable estimates, not provider billing guarantees. Failed/aborted paid work must not silently restore spending allowance.

## Phases

| Phase                       | Deliverables                                                                                                                                                                | Completion evidence                                                                    | Status   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| 1. Unit foundation          | Replace native/process/database tests with injected doubles; remove costly CI verification; preserve 100% thresholds                                                        | Unit-only execution and static checks                                                  | Complete |
| 2. Request control          | Usage ledger, daily budgets and feature limits; stop/retry/shorter/more-detail/read-aloud buttons; incremental text delivery                                                | Owner isolation, stale-action rejection, cancellation and quota unit tests             | Complete |
| 3. Workspaces and documents | Projects with files/instructions/notes; per-conversation modes; history search; Markdown/PDF export; two-document comparison; image settings and retained version selection | File/project isolation, limits, selection, export and comparison unit tests            | Complete |
| 4. Durable work             | Bounded background queue, status/cancel/result delivery; one-off and recurring reminders/summaries with timezone handling                                                   | Fake-clock scheduling, restart recovery, cancellation, budgets and delivery unit tests | Complete |
| 5. Data and release         | Data export/erase controls, per-conversation retention; configuration, user guide, operations, migrations and changelog                                                     | Unit-only 100% gate, static validation and documentation reconciliation                | Complete |

## Feature acceptance

1. `/usage` shows local daily request/tool/voice usage and estimated spend. Users can lower daily spending/count limits; authorization is checked before paid work. Reservations prevent concurrent overspending of local estimates.
2. A request can be stopped while running. Cancelled partial output is not committed as a complete turn. Response buttons belong to their owner and conversation and cannot operate on stale answers.
3. Projects scope reference files and instructions to the selected conversation's project. User notes and project notes have explicit, documented boundaries.
4. Search and export see only the requesting owner's retained histories. Exports are bounded and include provenance without exposing provider credentials.
5. Document comparison requires two references and requests a structured evidence-based change table. Missing evidence remains explicit.
6. Schedules accept explicit dates/times and intervals, validate IANA timezones, survive restart and have inspect/cancel commands. Missed occurrences do not trigger an uncontrolled burst of paid calls.
7. Modes and custom instructions are scoped per conversation, bounded and editable. They do not override access-control or tool safety instructions.
8. Image workflows expose size/quality, variation and source-version selection. Reverting selects a retained source; it never promises to reconstruct discarded image data.
9. Data export and deletion cover history, attachments, projects, saved notes, settings, jobs and schedules. Retention changes are explicit. Minimal current-day quota aggregates remain to prevent bypass. Existing Telegram messages, provider copies and operator backups remain outside local deletion.
10. Jobs persist state and bounded inputs, expose progress/status and cancel controls, obey budgets and are recovered conservatively after an interrupted paid attempt. Delivery failures remain inspectable without automatically rerunning paid work.

## Release evidence and limits

Release version: 4.0.0. The completed five-phase scope covers all ten items above. The unit suite contains 140 tests with 100% executable source line, branch and function coverage; thresholds and production measurement scope are unchanged. Static type checking, ESLint, Prettier and production compilation are required alongside it.

All service/native boundaries use doubles. No live provider request, real SQLite migration/durability test, application subprocess test, native FFmpeg invocation, real PDF render, browser or Docker build/run was performed. CI preserves this unit-only policy. `npm audit` is a separate dependency-metadata query, not a native/live acceptance test. Deployment and external-provider/native behavior remain unqualified by this evidence.
