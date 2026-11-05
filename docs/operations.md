# Operations

## Run and store state

Run exactly **one polling process per bot token**. Replicas conflict on Telegram polling and do not share in-memory locks/quotas/caches. SQLite is local durable state, not distributed coordination. No inbound HTTP server is needed. Production requires outbound HTTPS/WebSocket access and a private writable state directory.

```sh
npm ci --ignore-scripts
npm run build
npm start
```

The build excludes tests, credentials and databases from `dist`. New Unix directories use `0700`, database files `0600`; existing parent permissions remain the operator's responsibility. SQLite is not encrypted by the application. The ignored `data/` directory should be on persistent private storage. `STATE_DB_PATH=:memory:` is disposable.

## Schema 2 migration and rollback

Version 4 accepts SQLite schema 0/1/2 and upgrades older databases to schema 2 on open, adding scoped JSON records for workspaces, usage and queues while retaining profiles/sessions. Unknown newer schemas and corrupt state fail with sanitized errors. This migration has unit-contract coverage only; no real database migration test was run.

Before upgrading, stop the bot and copy the complete database to a private backup. Upgrade the application and retain the original backup until the operator accepts the migration. Version 3 rejects schema 2: rollback requires stopping the bot, restoring the pre-upgrade backup and using the previous application/dependencies. Changes since the backup will be lost. Never downgrade by manually changing `user_version` or editing stored JSON.

Complete-turn replacement and capacity evictions are transactional. Failed provider work leaves prior history intact. Persistence failures do not publish replacement cached state. Generic workspace/queue/usage updates are separate writes, so multi-command operations are not a global cross-scope transaction.

## Docker definition

```sh
docker build -t telegram-ai-bot-pro .
docker volume create telegram-bot-data
docker run --rm --init --name telegram-ai-bot-pro \
  --env-file .env \
  --mount source=telegram-bot-data,target=/app/data \
  --stop-timeout 15 \
  telegram-ai-bot-pro
```

These are operator deployment instructions, **not automated test steps**. No Docker build/run is part of this release's verification. The definition includes FFmpeg/libopus and bundled PDF fonts and runs as the unprivileged `node` user. Bind mounts must be writable by that user. Keep `assets/fonts` alongside `dist` for PDF exports; the font license is included there.

## Jobs, schedules and shutdown

The worker ticks every `WORKER_INTERVAL_MS` and runs one background execution at a time. Foreground work in another conversation can proceed within the global cap. Scheduled jobs obey allowlisting, reference validation and UTC quotas. Reminders have no model call. Recurrences coalesce missed intervals rather than replaying all missed work. A full queue delays due occurrences; completed records must be explicitly removed.

`SIGINT`/`SIGTERM` stop polling/worker scheduling and abort active background work, with a bounded 10-second shutdown window. Interrupted paid attempts recover as `uncertain` and require a deliberate new job; they are not automatically rerun. Interrupted reminders can resume. Queued jobs persist. Pending Telegram updates are dropped at startup to avoid stale foreground charges.

Successful execution and delivery have separate state. Delivery retries at most three times with 60-second backoff. A crash after Telegram accepts a message but before the local acknowledgement can duplicate delivery. `/result id` manually resends a retained result without a paid rerun; its automatic-delivery status remains unchanged. This is not exactly-once delivery.

Jobs freeze files/instructions and origin project ID, with explicit notes resolved at execution. Schedules capture references when an occurrence materializes. No-context summaries fail before paid work. Deleting/resetting a conversation cancels its queued/running work and schedules; retained completed results require explicit job deletion. Queue payload admission and provider output bounds limit memory, but `MAX_JOB_BYTES` is not a hard database size ceiling.

## Backups, retention and local deletion

Stop the bot before copying/restoring SQLite. Protect backups and define retention separately; they contain messages, encoded attachments, projects, notes, usage and queue/schedule payloads. A fresh database is created if the configured file is absent.

History pruning occurs at startup and access, not at an exact background deadline. Per-thread `/retention` changes future inactivity TTL; shortening also shortens existing expiry. Project files, notes, names, preferences, jobs/results and schedules do not inherit history TTL. Removing project data cannot remove copies already captured in history/jobs.

`/reset` clears active history, invalidates controls and cancels that conversation's pending work/schedules. `/delete id` removes a conversation slot/history/settings, keeping at least one slot. `/forget all` removes explicit global notes; project notes have `/project forget all`. None rewrites old answer text.

`/data` produces a bounded owner archive. `/erase confirm` aborts owner work and removes profiles, histories, attachments, workspaces, queue and schedules. Minimal UTC-day usage aggregates are intentionally retained to prevent quota bypass; they roll over logically on access and are replaced on the next reservation. Existing Telegram messages, provider copies and backups are outside local erasure. SQLite secure deletion is enabled, but files can retain reusable free pages rather than shrink.

## Costs and diagnosis

Set provider-side budgets and monitor billing. Daily local spending uses configured fixed estimates, not actual provider token/image/audio charges. Reserve before paid work; successful responses refund unused tool estimates, while failed/cancelled/uncertain attempts retain reservations. One voice interaction may include separate transcription, answer and narration reservations. User timezone does not alter UTC quota accounting. See [configuration](configuration.md).

Raw exceptions, payloads and token-bearing Telegram URLs are deliberately omitted from logs/errors. Check account dashboards, model/tool access, egress, writable disk, allowlisting and trusted FFmpeg/libopus availability without logging private content. PDF unsupported-character errors should be handled using Markdown/JSON. Font packaging is statically checked; real rendering has not been qualified.

## Verification boundary

Only unit tests are maintained and run: controlled transports, in-memory persistence, mocked SQLite/filesystem constructors, fake clocks, lifecycle events, FFmpeg spawn events and PDF renderer output. Static type/lint/format checks and compilation run separately. CI also queries dependency advisories, which is not a live application test.

No paid provider requests, actual database migration/durability, FFmpeg encoding, PDF visual rendering, browsers or Docker were exercised for version 4. Do not treat 100% unit coverage as proof of those properties or deployment readiness. Live/native qualification remains outside the authorized test scope and is not a required release step in this task.

## Productivity data and PDF extraction

Version 4.1 adds `productivity` and `library` scoped records to schema 2; no schema-version migration is required. Include them in the same database backup/access controls. Templates, extracted library text, collected forwards and feedback do not inherit history TTL. Context drafts expire logically after ten minutes and are removed lazily on owner access. `/data` exports these records; `/erase confirm` removes their persisted content and caches. Reset/delete clears the selected conversation's collections, feedback and pending preview. Project deletion removes its library index, but previously captured previews/results/history can retain excerpts.

PDF indexing uses the installed PDF.js distribution and its bundled worker resources. Keep runtime npm dependencies intact; no external PDF conversion executable is required. Inputs are bounded and no page rendering/OCR is performed. Scanned/Office inputs should be converted to supported text/PDF before indexing. Native worker/font/extraction behavior has not been exercised as a test. Unit tests replace PDF.js and verify only input limits, page contracts, cleanup and sanitized failures.

Context review is foreground-only. Scheduling/background jobs remain explicit and use their existing frozen-reference/notes-at-execution semantics; they do not pause for a context-confirmation UI. Model overrides are resolved per conversation at execution time. Successful library/collection answers consume normal quotas; indexing, retrieval inspection, settings, feedback and previews do not call the model. Local costs remain configured estimates.

## Version 5 workflows and transfer

Version 5 retains schema 2 and adds the `workflow` scope plus optional session recap/preferences. Back up SQLite before upgrading. Older version 4 code may drop optional recap fields on subsequent history writes and will not manage new workflows; restoring a pre-upgrade backup is the conservative rollback path. No native migration test was performed.

Task reminders use the existing worker timer and require a running single instance. Delivery retries at most three times with 60-second backoff; no paid provider work is retried. A crash after acceptance but before acknowledgement can duplicate a reminder. Tasks do not inherit history TTL; reset/delete clears their conversation's tasks and quote/work mappings. Project deletion clears its glossary. `/erase confirm` includes workflow records; the quota-counter exception remains.

`CONFIRM_EXPENSIVE_REQUESTS=true` changes image/ad-hoc-job initiation to guarded previews and disables implicit image tools. Configure the flag deliberately and explain it to users through `/guide costs`. Existing recurring summary schedules retain their explicit scheduling/normal-quota semantics. Estimates remain operator figures, not billing limits.

Portable imports require a persisted store, a bounded `/data` JSON document and an explicit merge confirmation. Current IDs/content/settings/quotas remain destination-owned; new portable conversations/projects receive fresh IDs. Tasks have no imported deadlines, collection mode is off, and jobs/schedules/controls are not restored. Transaction failure leaves existing state untouched; caches refresh after commit. Capacity failure never evicts current histories to fit. Native atomicity/durability remains unqualified by the unit contracts. See [portable archive contract](pro-workflows.md).

## Version 6 upgrade, delivery and rollback

Version 6 accepts SQLite metadata 0/1/2/3 and upgrades it to schema 3 on open. Tables remain scoped JSON records; the schema marker prevents older version 5 readers from interpreting queued/suppressed notification states incorrectly. Stop the process and back up the complete private database before first opening it with version 6. Version 5 rejects schema 3. Rollback means stopping version 6, restoring the pre-upgrade database and previous application/dependencies; changes since that backup are lost. Never edit `user_version` to force a downgrade. Only constructor/transaction unit contracts were checked; native migration is unqualified.

Ship the complete compiled `dist` tree, including `telegram/locales/messages.json`. The new `experience` scope contains bookmarks, UI/delivery preferences and pending notice references. Include it in database backup/privacy controls. `/data` now uses format 2; older readers may reject it. Current import accepts legacy/unversioned, 1 and 2 archives and preserves destination UI/quiet/digest settings, notices and counters.

Monitor `/notifications`, `/tasks all`, `/jobs` and `/queue` for local state. Quiet/digest requires ordinary worker ticks and an alive process; it does not suspend paid execution. A queued task/job notification means accepted by the outbox, not confirmed Telegram delivery. Three transport attempts with 60-second backoff apply; explicit `/notifications retry ID` rearms delivery only. `/digest now` bypasses time windows but respects exhausted attempts/backoff. `/notifications drop ID` suppresses it; manual `/result ID` fetches retained output immediately. Deleted/done/sent/suppressed targets are discarded without new work. Full outboxes need manual cleanup/retrieval. Duplicate delivery remains possible after ambiguous transport/acknowledgement failures.

Project statistics are configured UTC estimates inside owner limits. Deleted origin projects cause queued paid work to stop before execution. Erasure retains minimal same-day owner/project counters to prevent quota bypass; reusing project IDs can conservatively retain the day's totals. No live/native/provider/deployment acceptance is claimed by the unit gate. See [version 6 acceptance](pro-experience.md).

## Version 7 daily release operations

Version 7 retains schema 3 and archive format 2. Back up the complete private database before upgrading; the new `daily` scope contains preferences, favorite/recent IDs and temporary review payloads. Earlier code does not operate these workflows. For a consistent rollback, stop the bot and restore the pre-upgrade state/application; do not assume newer preferences or daily claims are portable to an older release. No native migration/deployment qualification was run.

`/start` now shows setup or Today; `/help` retains the reference. Standalone HTTPS links now request article fetching/summarization. Notes/morning remain opt-in. Morning uses ordinary worker ticks and quiet hours, not a separate scheduler service. Enabling a local time already passed may send today's overview immediately on the next eligible tick. Delivery claims persist before transport with three attempts and 60-second backoff; settings/timezone changes can alter eligibility. `/today` remains available manually if a day's delivery is exhausted.

The article reader needs outbound DNS and direct public HTTPS access. It sends no credentials/cookies and does not bypass login/paywalls, execute scripts or use proxy/global-agent pooling. Validated DNS addresses are pinned per request. Response bytes, redirects and a shared abort deadline are bounded. Network-level egress controls remain operator-owned. Article extraction/transport is unit-verified with controlled doubles only; live reachability/content/provider acceptance is unverified.

Include `daily` in access controls/backups/erasure reviews. Expired pending payloads clear lazily on owner access; persisted snapshots can remain in private backups independently. `/data` exports the scope, while import ignores source daily state and preserves destination settings/tokens. Source schedules/review authorizations never replay from an import. See [daily guide and limits](pro-daily.md).

## Operating provider workflows

Before enabling the 8.0 workflows, follow [provider setup and qualification](pro-provider.md). Build browser assets, configure a public HTTPS proxy if live voice is enabled, and inspect `/cloud_cleanup` after failures. Complete remote cleanup before rollback; preserve unresolved cleanup records when backing up or restoring state.

## Operating Pro Studio

Rebuild before restarting the shared voice/workspace Mini App. Run one bot process per state file. Inspect `/missions` after restart: queued untouched steps may continue, while interrupted attempts require external-state inspection and a fresh `/mission retry ID confirm` review. `/mission cancel ID` bypasses saturated admission. Milestone delivery is claimed once and suppressed during quiet/digest windows; users can retrieve results explicitly. Cancel unfinished missions before rollback and protect Studio-containing exports/backups. See [Studio operations and limits](pro-studio.md).
