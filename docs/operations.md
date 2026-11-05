# Operations

## Run and store state

Run exactly **one polling process per bot token**. Multiple replicas conflict on Telegram polling and do not share in-memory locks. The SQLite file is local durable state, not a distributed coordination mechanism. No inbound HTTP server or port is required. Outbound HTTPS and secure WebSocket access to providers is required.

```sh
npm ci
npm run build
npm start
```

A build never copies `.env`, databases or tests into `dist`. Place the database in a private writable directory. On Unix, new directories use mode `0700` and the database uses `0600`; existing parent-directory permissions remain the operator's responsibility. The default `data/` directory and SQLite files are ignored by Git and Docker build context.

The database uses schema version 1. A newer unsupported schema or corrupt state fails with sanitized errors. Do not edit stored JSON while the bot is running. Successful turns and capacity evictions commit together. Failed provider responses leave prior completed history intact; failed database commits do not publish replacement history in memory.

## Docker

```sh
docker build -t telegram-ai-bot-pro .
docker volume create telegram-bot-data
docker run --rm --init --name telegram-ai-bot-pro \
  --env-file .env \
  --mount source=telegram-bot-data,target=/app/data \
  --stop-timeout 15 \
  telegram-ai-bot-pro
```

The runtime image includes FFmpeg/libopus and runs as the unprivileged `node` user. The persistent volume holds private history and attachments. Bind mounts must be writable by that user. For intentionally disposable state set `STATE_DB_PATH=:memory:`.

`SIGINT` and `SIGTERM` stop polling. In-flight work has a bounded 10-second process shutdown window, so stopping during a long generation can interrupt delivery. Completed durable writes survive restart. Pending Telegram updates are dropped on startup to avoid stale requests and unexpected API charges. Requests are not retried automatically.

## Backups and deletion

Stop the bot, copy the SQLite database to a private backup destination, then restart. Restore only while stopped, retaining private permissions and using a compatible application version. A fresh SQLite file is created automatically if the configured database is absent. Backups contain text, images, documents and explicit user notes; manage their retention separately.

History expires after inactivity and is pruned at startup and subsequent history access. There is no background scheduler guaranteeing erasure at the exact TTL instant. Conversation names, explicit notes and voice preferences are stored separately and do not expire with history. `/reset` clears the active history; `/delete id` deletes the selected slot and its history, subject to keeping one slot; `/forget all` removes explicit notes. Clear other affected conversations if old answers contain a forgotten fact. SQLite secure deletion is enabled, but external backups and provider copies require separate handling. Database files may retain reusable free pages rather than shrinking after deletion.

## Costs and diagnosis

Set provider budgets and monitor billing. Local concurrency, token, file and tool-call limits are not monetary quotas. Disabling voice with `/voice off` stops automatic narration; `/speak` still explicitly requests it. A voice failure preserves the delivered text. Check FFmpeg availability and Realtime model access if narration fails.

Configuration errors identify missing/invalid keys. Other failures deliberately omit raw provider errors and URLs because those may include bot tokens or user content. Check account dashboards, model access, network egress, writable disk space and the configured executable without logging private payloads.

## Live verification

Use a dedicated bot, allowlisted account and non-sensitive test files. Live requests incur provider charges.

1. Send text and voice. Confirm transcription, a text answer and `/reset` behavior.
2. Upload a photo with a question, follow up, generate with `/image`, edit with `/edit`, then reply to an older image to select it.
3. Upload a PDF with a known answer and page reference. Ask a follow-up. Repeat with DOCX and UTF-8 text; reject an unsupported file and an oversized input.
4. Run `/search` for a current fact. Open returned sources and verify the claim and reference numbers. Try a fresh-fact question without the command.
5. Create a named conversation, switch back and confirm history isolation. Verify another allowlisted user cannot access it.
6. Save a harmless note, list it, use another conversation, then delete the note and verify it is no longer supplied on future requests.
7. Enable `/voice auto`: text messages get text; voice input gets text plus an AI-labelled OGG/Opus reply. Test `/speak` and `/voice off`.
8. Restart with the same database before TTL expiry. Verify selection, notes, voice preferences and retained file/text context. Test deletion and reset again after restart.
9. Verify an unlisted user and a group chat receive no responses or provider calls. Exercise a busy response without duplicating the paid request.

The offline suite validates contracts and state behavior. It cannot certify live model/tool availability, provider PDF extraction, image quality, narration accuracy or deployment connectivity. Record live outcomes separately from automated coverage.
