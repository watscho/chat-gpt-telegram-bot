# Architecture and unit-test conventions

Current release: **12.0.0**.

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

SQLite schema 3 stores profiles, sessions and scoped JSON records (`workspace`, `usage`, `queue`). Owner keys are private chat/user pairs; session keys append a conversation ID. Prefix deletion uses exact owner boundaries. Session replacement and evictions are transactional. Workspace/queue caches publish only after successful persistence. This is single-process coordination, not a distributed queue.

The worker runs one background job at a time and locks its target conversation. Foreground work elsewhere may proceed within the shared cap. Jobs snapshot reference files/instructions and origin project ID; explicit notes are resolved at execution. Schedules capture references when an occurrence becomes a job. No-context summaries fail before paid work.

Restart recovery marks interrupted paid attempts `uncertain`, without automatic paid retry. Interrupted reminders return to `queued`. Results and Telegram delivery state are separate: up to three delivery attempts, 60 seconds apart, never rerun the model. Delivery can duplicate after a crash between Telegram acceptance and local acknowledgement. Manual `/result` resends the retained result without generating it again.

Idle ticks do not rewrite unchanged queue records or repeatedly rescan persistent owners. Missed recurring occurrences coalesce into one pending occurrence; the next due time advances from the current clock. Completed/cancelled records consume queue slots until explicitly deleted. Conversation TTL does not erase projects or queued/results payloads.

## Unit-test and coverage policy

`npm test` and `npm run test:unit` discover `src/**/__tests__/*.test.ts`. Shared doubles live in `src/__tests__/helpers.ts`. Keep tests beside their source; do not create a root `tests/` tree. Production compilation excludes all `__tests__` directories.

Only unit tests are permitted. Use fake clocks, in-memory stores, fake Telegram/HTTP/WebSocket transports and controlled process/renderer doubles. SQLite constructors and filesystem calls are replaced; no real databases/files are opened by persistence tests. FFmpeg spawn events, lifecycle signals/exits and PDFKit output are mocked. Do not add real APIs, native encoding, application subprocesses, browser, Docker, integration, performance or soak tests.

`npm run test:coverage` requires **100% lines, branches and functions** across executable `src/**/*.ts`, excluding only `src/**/__tests__/**`. Do not lower thresholds, exclude production code or add coverage-ignore annotations. Assert behavior: ownership, failure/recovery, cancellation, limits, state transitions and transport contracts. Prefer constructor/property injection over mocking application modules, which can distort aggregated V8 source coverage.

The test scripts enable Node's experimental module mocks. CI runs static type/lint/format checks, unit tests, compilation, coverage and a dependency advisory query. It does not build Docker or install/run FFmpeg. Coverage does not establish native durability, real PDF typography, provider compatibility, model answer quality or deployment readiness.

## Productivity and retrieval

`src/application/productivity.ts` owns explicit templates, forward collections, answer ratings and single-use context drafts under the `productivity` record scope. `src/application/library.ts` owns project-scoped indexed passages under `library`; PDF/text extraction is an injected infrastructure port in `src/infrastructure/document-text.ts`. `src/telegram/productivity-commands.ts` implements commands, paginated menus and context controls. Data archives and deletion include both scopes and caches.

Branching copies a completed retained prefix into a new session/slot, preserves source history and copies thread settings. Revision starts a replacement turn in that branch using original references. Failed branch setup cleans up the new slot; a later provider failure preserves its prefix. Normal TTL/capacity rules still apply.

Local retrieval chunks text with bounded overlap, ranks distinct lexical query terms with inverse document-frequency weights, and returns at most eight passages. PDF.js extracts text page by page without rendering; UTF-8 inputs retain line labels. Scans/OCR and Office indexing are explicitly unsupported. The parser is dynamically loaded only when indexing a PDF, and fully mocked in tests. Original binaries are not stored by the index.

Context drafts snapshot selected content before paid work. History text is stripped of attachment fields and all current/historical payloads become independent deduplicated controls. Confirmation validates owner/thread/token/TTL/revision, consumes once, and uses `ReplyOptions.contextHistory` for provider input while retaining the original stored history. Removing context from one call does not delete earlier content. Reference excerpts are a distinct untrusted user-input item in Responses. Conversation model overrides remain configurable and do not change speech/image models.

Collections require explicit opt-in and forward metadata; only text/captions and Telegram message IDs are retained. Feedback uses answer-revision-bound buttons and stores a bounded local vote without copying answer text or contacting providers. Menus use short-lived per-owner tokens and conversation binding. All new service/parser/Telegram contracts use adjacent unit tests; no native parser or live-provider qualification is implied.

## Tasks, recaps, quoted answers and transfer

`workflow.ts` owns bounded tasks, project glossaries, delivered-answer mappings and guarded work/import approvals in the `workflow` scope. Its worker retries Telegram notification delivery only. Owner discovery is cached; idle ticks do not repeatedly scan/rewrite unchanged persistent records. `workflow-commands.ts` exposes paginated task lists, guided navigation, glossary/recap commands, batch work and import previews.

`recap.ts` deterministically categorizes bounded excerpts of trimmed complete turns. Conversations construct a provisional recap before a normal provider call and publish updated recap/history only after success. Reviewed requests use their explicitly selected summary string; they do not gain hidden context. The session recap is distinct from explicit profile/project memory.

Quoted-answer mappings are created from successfully delivered answer chunks (including edited streaming previews), scoped by owner/conversation/revision and checked against retained history. Exact Telegram quote fragments must match. Referenced text is supplied as untrusted source context, not a system instruction.

Batch admission validates all files/slots/payloads before one queue write. Each job retains batch/file metadata after input cleanup. Execution uses one document with an empty history/recap and normal current notes/glossary; paid retry/recovery and delivery contracts remain unchanged.

`archive.ts` validates an unknown JSON object into canonical portable records, remaps ownership/IDs, merges conflicts conservatively and rechecks destination/global budgets. `StateStore.commitImport` writes profile, new sessions and merged scopes in one transaction, without restoring queue/usage state or deleting existing content. Cache refresh occurs after commit. Unit tests mock SQLite and assert transaction boundaries; they do not exercise a real database.

## Experience, evidence and structured output

`Experience` owns per-owner UI/quiet/digest preferences, explicit bookmarks and a bounded durable notification outbox. Jobs/tasks publish target references and transition delivery to `queued`; `sent` and `suppressed` are terminal delivery receipts. Outbox claims persist before Telegram transport, with bounded delivery-only retries. Manual retrieval bypasses quiet/digest and acknowledges pending results. The worker and caches target one process; no distributed or exactly-once delivery is promised.

`evidenceCards` normalizes answer-bound excerpts and safe URLs. Cards share session lifecycle/character budgets; callbacks use bounded SHA-256 references resolved only within the owner/current conversation. Opening cards is local and never fetches remote pages. Explicit bookmarks are independent retained copies. `ExperienceCommands` handles delivery, bookmarks, budgets, queue controls, languages and structured requests.

`UsageLedger` reserves owner and origin-project aggregates in one usage-record write before paid execution. Successful unused-tool refunds settle both; failure reservations remain. Deferred jobs retain their origin project. Structured requests carry a validated specification through context review to the Responses adapter, disable tools/streaming and request strict JSON schema. Independent local validation produces bounded CSV/JSON artifacts retained as assistant documents.

`localization` applies static en-keyed ru/es catalogs to UI lines/button labels only, preserving raw model/user/source content and callback payloads. Unknown lines fall back to English. JSON resources ship in `dist`. Archive format 2 validates/merges new portable metadata/bookmarks in the existing atomic import transaction; destination notification preferences/outbox and usage records are excluded from import. See [release acceptance](pro-experience.md).

## Daily workflows and article transport

`Daily` owns setup preferences, notes mode, favorite/recent scenario IDs, expiring pending-input/task-review snapshots and optional morning-delivery claims in a bounded owner scope. `DailyCommands` composes existing projects, profiles, conversation snapshots, tasks, jobs, templates and experience controls. `/start` uses the short local entry flow; contextual action callbacks bind to the latest retained owner/thread answer. Project continuation opens the existing context-inclusion review before paid generation.

Voice notes reuse transcription accounting, strict structured extraction and context-review metadata (`reviewTasks`). Validated artifacts become a visible review; task creation is a separate local confirmation. `Workflow.addReviewedTasks` commits all fresh tasks in one record write using token-derived IDs, allowing idempotent recovery if review acknowledgement fails. Expiry/revision checks reject stale authorizations. Daily previews/settings are exported but excluded from portable import; created tasks/documents remain portable under existing rules.

Morning views use local state without model calls. The worker persists each delivery attempt first and acknowledges only compatible current settings, with quiet-hour checks, three attempts and one-minute backoff. Single-process coordination and ambiguous transport/state acknowledgement retain an at-least-once caveat.

`article-reader` separates bounded extraction and network policy from an injected DNS/HTTPS port. Every redirect validates a public HTTPS hostname and all DNS addresses; the chosen address is pinned through the request lookup callback, including the all-address form, with normal TLS/SNI and a fresh connection. The shared abort deadline covers lookup and request observation. Bounded UTF-8 text extraction scans sequentially, retaining a document/evidence excerpt without scripts, page execution or an independent cache. Article/model content remains untrusted; no citation or local shape check proves factual accuracy. See [daily acceptance](pro-daily.md).

## Provider workbench boundaries

`WorkbenchModel` routes only explicit prepared workbench requests to `Workbench`; ordinary chat keeps the existing model adapter. `OpenAIWorkbench` implements bounded provider IO. `ResourceJournal` persists minimal cleanup intent independently from owner erasure. `LiveSessions` owns reservations and shutdown deadlines; `MiniAppServer` authenticates Telegram callers, while the injected browser controller owns microphone/RTC lifecycle. See [provider lifecycle and qualification](pro-provider.md).

## Studio orchestration and workspace

The `studio` scoped JSON record contains Inbox items, captured inputs, missions, step claims/receipts and result versions. `Studio` owns pure lifecycle transitions and durable claim-before-effect orchestration; `StudioExecutor` uses existing model/workbench/quota adapters with no hidden chat history. `StudioWorkspace` exposes redacted owner snapshots and validated local actions; `StudioCommands` supplies reviewed Telegram entry points. The Mini App extends the signed shared HTTP boundary, and its browser controller preserves dirty edits and rejects stale revisions. Run one state-file writer. See [the workflow and recovery contract](pro-studio.md).

## Pro Suite boundaries

`Suite` owns explicit sources, brand templates, quality rules, versioned records/recipes and scoped expiring reviews/listeners. `suite-workflows` compiles a typed catalog; `SuiteExecutor` routes paid stages through `StudioExecutor` and handles separate claimed local/media stages through `SuiteAssetPorts`. Model shape validation, exact quote checks, deterministic offer arithmetic and human record acceptance are distinct operations.

`WorkSearch` recomputes owner-only lexical excerpts; `Watches` persists baselines/diffs and claims notification before transport. `SharedProjects` uses independent global records with fresh member-role/revision checks on every operation; private workspaces are never implicit shared resources. `SuiteWorkspace` exposes redacted authenticated snapshots/local controls; Telegram owns grants, publication and paid-plan reviews.

Artifact ports compose bounded native ZIP APIs, DOCX/PPTX/PDF adapters, preserved-pixel SVG annotations and fixed-argument private-temp video extraction. Unit tests replace external libraries/process/FS/transport ports; no native rendering/decompression/provider/browser acceptance is inferred. See [the acceptance matrix and lifecycle](pro-suite.md).

## Daily routine boundaries

`Routines` reads fresh owner `routines` state, validates record/byte limits and persists before publication. Calendar/finance/learning/waiting/reading services implement deterministic local state changes. `RoutinePlans` freezes only explicit selected sources/materials and the conversation model into inert Studio missions. `RoutineExecutor` wraps Suite execution, uses typed model stages and local validation, and prepares expiring owner/conversation/project-bound previews; `RoutineReviews` dispatches separate acceptance. The signed `RoutineHome` adapter shares the same services with Telegram commands and renders through text-only DOM controls.

Calendar evidence has a 15-minute maximum age. Financial arithmetic uses minor-unit strings/BigInt with currency-specific precision. Evening task effects and a recovery receipt are stored together in Workflow before the separate day-close commit. Reading shares pinned public HTTPS transport with articles and validates bounded XML in pure JavaScript. Revision/abort guards prevent late source commits; reminder claims precede transport and uncertain delivery has no automatic retry. Exports include routines, imports do not activate source routine state, and owner erase aborts reading before deletion. See [daily routine lifecycle and limits](pro-routines.md#state-limits-and-operations).

## Personal workspace boundaries

`Desk` owns bounded fresh-read owner state and scoped document/table/photo revisions; `DeskPlans` freezes explicit sources into Studio and `DeskExecutor` separates paid model stages from local proposals. `DeskActions` applies exact proposals and idempotent voice task/draft origins. `DeskWorkspace` and Telegram share these services. Browser recipes use the documented MCP UI-tool approach, require exact origins/tools and validate nested URL arguments both before initial approval and continuation. The operator's isolated browser service must enforce its own network and execution policy.

`ConnectionCenter` keeps separate sealed auth records, redacted status and owner-configured service resolution. One-use OAuth/PKCE flows consume state before token exchange and reject late commits after state changes. `LiveSessions` binds call/thread/project and frame claims; Realtime exposes only a review-staging function for local task/search/draft actions. Browser visual capture stops all tracks before preview. Production Mini App entry points are bundled, so runtime module delivery does not depend on unserved internal paths. See [workspace lifecycle](pro-desk.md#lifecycle-limits-and-release-operations).
