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
