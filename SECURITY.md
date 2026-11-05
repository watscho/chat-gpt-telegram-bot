# Security policy

Security fixes target the current main branch. Older releases are not maintained.

Report vulnerabilities privately using GitHub's **Report a vulnerability** option if enabled for this repository. If private reporting is unavailable, contact the repository owner through the profile linked on GitHub to arrange a private channel. Do not publish exploitable details or real credentials in public issues. No response-time SLA is promised.

Include the affected commit/version, prerequisites, reproduction steps using fake credentials, expected and actual behavior, and impact. Never attach `.env`, full Telegram download URLs (they contain bot tokens), user conversations, or unredacted provider logs.

Deployment operators must restrict the Telegram user allowlist, protect provider credentials, configure spending limits, and run a single polling instance per bot token. Rotate exposed credentials at their provider immediately.

The application stores conversation text, images, documents, explicit notes, project references, settings, usage aggregates, jobs and schedules in SQLite. Restrict database and backup access; the application does not encrypt them. TTL pruning occurs at startup and subsequent conversation access. Deleting local records does not delete provider copies or backups. Search queries and relevant user-provided context may reach external providers. Protect the configured FFmpeg executable and its path; it is executed without a shell with fixed arguments.

Daily local limits use configurable estimates rather than provider billing. Set provider-side budgets independently. Failed and cancelled paid attempts keep reservations. Local `/erase confirm` deletes owner content/settings/jobs/schedules but preserves minimal UTC-day usage aggregates to prevent quota bypass; these roll over lazily on next usage access. Conversation TTL does not expire project files or job snapshots/results. Users must remove those explicitly. Stop/delete races are guarded against local result resurrection, but cancellation cannot undo completed provider processing or Telegram delivery.

Automated verification consists only of isolated unit tests. Native SQLite durability, provider behavior, FFmpeg output and PDF font/layout are not certified by the coverage report. Do not add costly or external-service tests to CI.

Productivity state contains reusable prompt text, collected forwarded text/captions, feedback metadata, context snapshots and extracted library passages. Protect it like conversation history. Local indexing does not send complete library documents to providers; `/ask` sends retrieved passages alongside the selected conversation/project context. `/context` can inspect/exclude these inputs. Forward collection requires explicit opt-in and never automatically summarizes; its text and retrieved excerpts are untrusted content. Removal from a single request does not erase previous answers or text quotes. Context snapshots expire lazily on access and must be explicitly cancelled/erased for immediate local removal. Feedback is local and is not automatically submitted for model training.

Workflow records include task text/deadlines, project glossary preferences, delivered-answer excerpts and pending archive/work snapshots. Protect exports and backups accordingly. Glossary hints reach transcription providers; recaps and quotes are untrusted excerpts, not verified facts or system instructions. Imported owner prefixes, callbacks, credentials, quota counters, jobs/schedules and delivery IDs are never adopted. Canonical content is validated, IDs are remapped, merged limits are checked and writes use one transaction. Import does not activate task deadlines or collection mode. Cost confirmations are bounded estimates and cannot substitute for provider-side spending controls.

## Experience data and structured exports

Bookmarks explicitly copy retained passages independently of history TTL/reset. Evidence excerpts live with history and share its bounds; outbox notices store target IDs, thread IDs and clipped titles. All can contain private information. Local state is access-restricted, not encrypted; protect backups separately. Erasure clears content/preferences/outbox but retains minimal current-day owner/project quota aggregates without project titles or payloads.

Source-card links are restricted to safe HTTP(S) URLs; displaying a card does not fetch or verify the remote page. Treat excerpts, imported bookmarks, user quotations and model citations as untrusted content. UI localization preserves these passages without translation and does not change authorization or callback ownership.

Structured output is locally validated for exact nullable-string fields, bounded rows/cells and final bytes. CSV quotes/escapes cells and prefixes common spreadsheet formula starts, including those after leading whitespace/control characters. Importer behavior varies: validation/neutralization is not proof of safe execution in every spreadsheet application or factual accuracy. No automatic paid repair/retry is performed.

Format 2 archive import validates new evidence/bookmarks/project caps but never restores source notification settings, outbox, quota counters or paid jobs. Destination delivery preferences remain authoritative. SQLite schema 3 prevents older readers from processing new delivery states; use the documented backup rollback procedure.
