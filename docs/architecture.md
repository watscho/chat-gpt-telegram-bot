# Architecture and unit-test conventions

## Boundaries

| Layer                                                | Responsibilities                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain`                                         | Conversation/media/provider ports, profiles/persistence, workspace/usage and job/schedule types                                             |
| `src/application/conversations.ts`                   | Complete-turn commits, bounded history, TTL, search, retained image versions and owner-scoped deletion                                      |
| `src/application/profiles.ts`                        | Named conversations, selection, explicit global notes and voice preferences                                                                 |
| `src/application/workspaces.ts`                      | Projects, per-thread modes/instructions/image settings/retention and lower user limits                                                      |
| `src/application/usage.ts`                           | UTC ledger, atomic local reservations, tool reconciliation and conservative failed-attempt accounting                                       |
| `src/application/response-controls.ts`               | Abort controllers, answer tokens, owner/thread/revision-bound buttons                                                                       |
| `src/application/jobs.ts`                            | Durable queue, schedule materialization, worker locks, cancellation, restart recovery and delivery retries                                  |
| `src/application/scheduling.ts`                      | Intervals and IANA timezone conversion with DST ambiguity/gap rejection                                                                     |
| `src/application/sources.ts`                         | Safe source deduplication and citation rendering                                                                                            |
| `src/infrastructure`                                 | Responses/transcription, Realtime speech, FFmpeg encoding, bounded Telegram downloads, file validation, SQLite and Markdown/JSON/PDF export |
| `src/telegram/bot.ts`                                | Access control, foreground/background locking, albums, streaming, callbacks and delivery                                                    |
| `src/telegram/pro-commands.ts`                       | Local workspace/data/usage/job commands and comparison prompt construction                                                                  |
| `src/index.ts`, `src/infrastructure/dependencies.ts` | Production composition, polling, worker timer and bounded shutdown; replaceable constructor references for unit tests                       |

Domain/application code does not import Telegram/OpenAI SDK types. Provider, store, clock and transport boundaries are replaceable. Importing application modules starts no network or database activity. The entrypoint constructs the actual SQLite connection and provider clients.

## Request lifecycle

1. Reject non-private or unlisted users before provider/file access. Serialize foreground work per owner and apply a global active-handler cap. Allow cancellation through the busy gate.
2. Execute local commands without a model call. Albums share a bounded 750 ms collection window and download deadline. Validate formats, HTTPS Telegram origin, no redirects, stream byte caps and cancellation.
3. Resolve the selected conversation/project, prune expired history, compose mode/custom/project instructions, and supply explicit global/project notes as user-level preferences. Selected retained image versions supply edit references.
4. Validate the complete input before invoking `onStart`. Reserve UTC usage and estimated spend immediately before each paid operation. Automatic tools are disabled when no allowance remains; explicit unavailable tools reject locally.
5. Call Responses with `store: false`, AbortSignal and bounded output/tools. Stream throttled preview edits when enabled. Only a completed, non-cancelled response is eligible for history commit.
6. Commit a complete turn with capacity evictions before replacing cached history. Assign message UUIDs; legacy images use stable content-derived IDs. Reconcile unused tool reservations on successful completion; retain reservations on failure/cancellation.
7. Deliver Unicode-safe text chunks, citations and original PNG files. Bind answer controls to owner, thread, token and last assistant revision so background updates invalidate old actions. Optional narration has its own quota reservation; failure preserves text.

Speech gathers bounded 24 kHz mono PCM over a short-lived Realtime connection, then pipes it to FFmpeg/libopus within the remaining deadline. Cancellation closes the connection and aborts encoding. FFmpeg uses fixed arguments without a shell or temporary audio files.

## Durable work and persistence

SQLite schema 2 stores profiles, sessions and scoped JSON records (`workspace`, `usage`, `queue`). Owner keys are private chat/user pairs; session keys append a conversation ID. Prefix deletion uses exact owner boundaries. Session replacement and evictions are transactional. Workspace/queue caches publish only after successful persistence. This is single-process coordination, not a distributed queue.

The worker runs one background job at a time and locks its target conversation. Foreground work elsewhere may proceed within the shared cap. Jobs snapshot reference files/instructions and origin project ID; explicit notes are resolved at execution. Schedules capture references when an occurrence becomes a job. No-context summaries fail before paid work.

Restart recovery marks interrupted paid attempts `uncertain`, without automatic paid retry. Interrupted reminders return to `queued`. Results and Telegram delivery state are separate: up to three delivery attempts, 60 seconds apart, never rerun the model. Delivery can duplicate after a crash between Telegram acceptance and local acknowledgement. Manual `/result` resends the retained result without generating it again.

Idle ticks do not rewrite unchanged queue records or repeatedly rescan persistent owners. Missed recurring occurrences coalesce into one pending occurrence; the next due time advances from the current clock. Completed/cancelled records consume queue slots until explicitly deleted. Conversation TTL does not erase projects or queued/results payloads.

## Unit-test and coverage policy

`npm test` and `npm run test:unit` discover `src/**/__tests__/*.test.ts`. Shared doubles live in `src/__tests__/helpers.ts`. Keep tests beside their source; do not create a root `tests/` tree. Production compilation excludes all `__tests__` directories.

Only unit tests are permitted. Use fake clocks, in-memory stores, fake Telegram/HTTP/WebSocket transports and controlled process/renderer doubles. SQLite constructors and filesystem calls are replaced; no real databases/files are opened by persistence tests. FFmpeg spawn events, lifecycle signals/exits and PDFKit output are mocked. Do not add real APIs, native encoding, application subprocesses, browser, Docker, integration, performance or soak tests.

`npm run test:coverage` requires **100% lines, branches and functions** across executable `src/**/*.ts`, excluding only `src/**/__tests__/**`. Do not lower thresholds, exclude production code or add coverage-ignore annotations. Assert behavior: ownership, failure/recovery, cancellation, limits, state transitions and transport contracts. Prefer constructor/property injection over mocking application modules, which can distort aggregated V8 source coverage.

The test scripts enable Node's experimental module mocks. CI runs static type/lint/format checks, unit tests, compilation, coverage and a dependency advisory query. It does not build Docker or install/run FFmpeg. Coverage does not establish native durability, real PDF typography, provider compatibility, model answer quality or deployment readiness.
