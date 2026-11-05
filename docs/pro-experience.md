# Pro experience release and acceptance

Version: 6.0.0. Start with `/guide`; delivery, saved evidence and structured outputs have dedicated navigation sections. Existing workflows remain documented in the [user guide](USER_GUIDE.md), [productivity guide](pro-productivity.md) and [workflow guide](pro-workflows.md).

| Capability                      | Entry point                             | Local acceptance                                                                                  |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Quiet hours and grouped digests | `/quiet`, `/digest`, `/notifications`   | Timezone boundaries, durable outbox, bounded retries, stale-target suppression and manual results |
| Tagged bookmarks                | Save buttons, `/bookmark`, `/bookmarks` | Ownership, deduplication, tag validation, pagination, persistence and erasure                     |
| Inspectable source cards        | Source buttons, `/sources`              | Answer/thread binding, bounded excerpts, safe URLs, stable callback sizes and expiry              |
| Project budgets/statistics      | `/project_budget`, `/project_usage`     | Atomic owner/project reservations, origin attribution, refunds/failures and UTC rollover          |
| Structured files                | `/output csv` or `/output json`         | Strict schema contract, exact fields, local validation, file bounds and CSV escaping              |
| Queue control                   | `/queue`, `/priority`, `/defer`         | Ready-first ordering, priority/ties, deferred eligibility and no paid retry                       |
| Independent languages           | `/language ui`, `/language answer`      | Catalog/placeholder parity, preserved raw content, separate owner/thread preferences              |

## Delivery semantics

Quiet hours default off. `/quiet 22:00-08:00` uses the owner's `/timezone` IANA zone; intervals include their start and exclude their end, including overnight windows. They delay job-result and task-deadline notifications, not computation, task visibility or direct command replies. Digest default is immediate; `/digest 5m` through `/digest 24h` groups eligible notices after each item's interval. `/digest off` disables interval grouping but keeps quiet hours. Worker ticks must run and the process must be alive; this is not an exact alarm service.

The owner outbox holds at most 100 notices, deduplicated by target. A digest processes at most 10 eligible items, with a 500-character preview per job and buttons for retained results/tasks. Notices contain target references and clipped titles, not full result copies. A task marked queued/reminded has been accepted into the outbox; it has not necessarily reached Telegram. Inspect `/notifications` for pending delivery.

Delivery claims persist before transport, with at most three attempts and 60-second backoff per item. `/notifications retry ID` explicitly rearms delivery, never paid work. `/notifications drop ID` suppresses delivery while keeping the result/task. `/digest now` bypasses quiet/interval waits, but respects retry backoff and exhausted attempts; its processed count includes stale targets discarded without a message. `/result ID` or Open result retrieves retained output immediately and acknowledges its pending notice. Deleted, done, sent or suppressed targets are skipped appropriately.

This is bounded at-least-once delivery: transport acceptance followed by a failed acknowledgement can produce a duplicate. Restarts do not automatically rerun uncertain paid work. A full outbox can exhaust ordinary delivery retries; free capacity and retrieve the retained result manually. Foreground responses are not delayed by quiet hours.

## Saved passages and evidence

Save answer keeps up to 4000 characters of retained answer text. Source buttons show the corresponding retained excerpt and optional safe HTTP(S) URL; Save source makes an explicit bookmark. `/sources` opens the latest retained assistant answer's cards in the current conversation. Buttons resolve only within the owner's current retained conversation, becoming unavailable after TTL, trimming, reset or deletion. Opening a card makes no network fetch or model request.

Cards retain at most 16 excerpts per answer, each up to 1200 characters, with 256-character titles. Local library/forward references retain captured excerpts; web cards retain a cited answer excerpt plus its URL, not fetched webpage text. Excerpts share history character/TTL limits and do not prove a source is accurate or supports every claim. Avoid treating model citations as independent verification.

Bookmarks are owner-wide explicit copies, independent of history TTL/reset: 100 entries, 80-character titles, 4000-character text and up to 10 case-normalized tags of 1..24 letters/digits/underscores/hyphens. Identical text reuses the existing bookmark without changing its tags. Lists show eight per page; queries are limited to 120 characters. Use `/bookmarks words`, `/bookmarks #work` or `/bookmarks #work | 2`, then `/bookmark show ID`, `/bookmark tags ID | work,reference` or `/bookmark delete ID`. `/bookmark add Title | passage | work` and replying to text with `/bookmark reply | work` save without a model request. `/erase confirm` removes bookmarks.

## Project estimates

Select a project, then `/project_budget 2.5` sets a daily USD estimate ceiling with up to six decimal places; zero blocks positive-cost reservations. `/project_budget` and `/project_usage` show UTC-day request/tool/speech/failure counts and estimates. A project with no explicit cap inherits the owner ceiling; all projects together remain constrained by the owner's budget, request and feature limits. Effective ceilings cannot exceed operator/owner controls. These are configured estimates, not measured tokens, provider prices, invoices or a provider billing cap.

One persisted owner usage record atomically reserves both totals before paid execution. Foreground chat, transcription/narration and jobs attribute to the selected/original project. Switching projects does not reattribute queued work; deleting its origin project causes execution to stop before a provider call. Successful unused tools refund both counters; failed/cancelled attempts retain reservations. Counters roll at UTC midnight, independently of the owner's timezone. Erasure retains minimal current-day aggregates, including project IDs/counters without project titles/content. Reusing an ID that day can conservatively inherit its counters.

## Validated files

Use `/output json name,amount | Extract rows from the retained document` or `/output csv name,amount | Build rows from this text`. The request uses current context/project references and the existing context-review setting. Format/field metadata survives review. Text beginning with a slash after `|` remains source prompt text. Structured requests disable image/search tools and incremental streaming; no partial unvalidated file is delivered.

Choose 1..10 unique lowercase field names matching `[a-z][a-z0-9_]{0,31}`. Output is `{ "rows": [{ "name": "Example", "amount": null }] }`: only the requested fields, all present, values string or null. At most 100 rows and 2000 characters per string cell; raw validation input is limited to two million characters. Strict provider JSON schema and independent local validation reject malformed/extra fields, wrong types and oversized content. Empty rows are permitted; shape validation cannot establish factual correctness. Invalid responses do not trigger automatic paid retries.

JSON preserves nulls. CSV uses the requested header order, quoted cells, doubled embedded quotes and CRLF row separators; null becomes an empty cell. Common formula prefixes `=`, `+`, `-`, `@` after leading whitespace/control characters receive a leading apostrophe. This intentionally changes those CSV strings, including negative-looking values; it is not a guarantee for every spreadsheet importer. Final bytes must fit both `MAX_EXPORT_BYTES` and `MAX_DOCUMENT_BYTES`. Successful files are retained as assistant documents under normal media/history limits and exported with history.

## Queue and languages

`/queue` lists owned queued jobs, placing ready work before deferred work and showing rank, priority and start time. `/priority ID 0..9` sets queued-job priority (default zero); ready jobs run by descending priority then creation time. `/defer ID | YYYY-MM-DD HH:MM` uses `/timezone`; `/defer ID | now` removes the delay. Running work is unchanged. Positions are an owner-local snapshot, not a global ETA or fairness guarantee; limits, conversation locks and other owners can delay actual execution. Cancellation and restart uncertainty retain existing behavior.

`/language ui en|ru|es` is owner-wide and changes catalogued navigation, buttons and common status/error messages. Commands stay in English. Uncatalogued technical text falls back to English; full translation of every help/error line is not claimed. Catalogs are packaged with the build. Generated answers, user passages, source excerpts, filenames, identifiers and callback payloads are not machine-translated by the UI layer.

`/language answer auto|code` is per conversation. Supported codes: en, ru, es, de, fr, it, pt, uk, tr, ja, zh, ar. `auto` leaves language selection to normal instructions/context. An explicit code adds a model instruction for prose and structured string values, preserving field names and quotations; model compliance is not guaranteed. Cloned/imported conversation preferences retain the answer language, while import preserves the destination's UI language.

## Storage, transfer and verification

SQLite metadata upgrades 0/1/2 to schema 3; version 5 rejects schema 3. See [upgrade and rollback](operations.md). `/data` emits archive format 2; import also accepts version 1 and legacy unversioned archives. Portable content now includes evidence, structured files, bookmarks, project caps and answer language. Import validates bounds/safe links, allocates fresh IDs and merges bookmarks by text within capacity. Destination UI/quiet/digest preferences, notices and quota counters are preserved. No notification or paid job is replayed by import.

The new owner `experience` record is capped at 1 MB and cleared by erasure. Conversation reset/delete clears its pending notices but preserves explicit bookmarks/preferences. This is single-process coordination, with no distributed queue guarantee.

Verification: 227 adjacent unit tests pass, with 100% executable source line, branch and function coverage and unchanged exclusions/thresholds. Providers, Telegram, persistence, clocks and native/process boundaries use controlled doubles. Types, lint, formatting, production compilation, packaged locale resources and documentation/version consistency are checked separately. No paid requests, real database, FFmpeg, PDF parser/renderer, browser, Docker, integration, performance or soak tests qualify this release. Production deployment and live provider acceptance remain unverified.
