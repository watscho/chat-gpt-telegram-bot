# Pro workflows release and acceptance

Version: 5.0.0. This release adds seven workflows while retaining private-chat allowlisting, local ownership, complete-turn persistence and unit-only verification.

| Feature                 | Entry point                            | Behavior                                                                                                               |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Actionable tasks        | `/task`, `/tasks`                      | Local open/done tasks, optional timezone-aware deadlines, delivery retries and Done buttons                            |
| Long-history recap      | `/recap`                               | Automatic bounded extractive excerpts from trimmed turns, categorized as decisions, constraints, questions and context |
| Specific quoted replies | Reply to a bot answer                  | Resolve the delivered answer ID and optional exact text fragment in its original retained conversation                 |
| Project dictionary      | `/glossary`                            | Explicit preferred spellings/translations in answers and bounded incoming-transcription hints                          |
| Batch files             | `/batch`                               | Confirm once, enqueue 1..10 independent per-file jobs atomically, inspect/export retained results                      |
| Cost confirmation       | Image/context and work preview buttons | Show configured estimates before explicit image/edit, ad-hoc jobs and batches; consume a guarded preview once          |
| Archive transfer        | `/data`, reply with `/import`          | Validate and preview portable content, allocate new IDs, skip conflicting templates and commit a merge atomically      |

Start with `/guide`. `/help` also opens the navigation menu. Existing projects, templates, search, context controls, image versions and schedules remain available.

## Release constraints

- Authored code, examples and documentation use English. Conversation output follows the requested language.
- Only adjacent unit tests are permitted. Providers, Telegram, persistence, clocks, process/native boundaries and PDF extraction/rendering use controlled doubles.
- Keep 100% executable source lines, branches and functions, with no production exclusions or coverage-ignore annotations.
- Type checking, lint, formatting, compilation and static documentation checks are separate from tests. No live API, database, FFmpeg, browser, Docker, performance or soak tests qualify this release.

## Persistence and limits

Tasks, glossaries, delivered-answer mappings and pending work/import previews use the owner-scoped `workflow` record. It is capped at 20 MB. Tasks are capped at 100 per owner, with 1000-character titles; lists show eight per page. Completed tasks remain until deleted. Task status/reminder delivery is local state, with up to three delivery attempts and 60-second backoff. It is not exactly-once messaging.

Glossaries are per project, with up to 100 entries and 4000 combined term/meaning characters. Terms/meanings are single-line and bounded to 80/200 characters. Transcription receives up to 800 characters of relevant glossary context; recognition is not guaranteed.

Quoted-answer mappings retain the last 100 delivered answer chunks per owner, each up to 4000 characters. A mapping is usable only while its source answer remains in the same retained conversation. Exact fragments must match the delivered text. These records are deleted on conversation reset/delete or owner erasure.

Recaps contain at most three 300-character excerpts per category, with role labels. They quote content rather than verify it or infer permanent user facts. They share the session lifecycle and are cleared by reset/deletion/TTL or `/recap clear`. Recap updates publish only with successful complete-turn commits. Context review treats recap as an independent inclusion item; a reviewed snapshot is authoritative, so newly computed excerpts become visible on the following reviewed request rather than being inserted invisibly.

Batch jobs consume ordinary job slots and payload limits, with one base Responses estimate per file. They use one file each, explicit global/project notes and captured instructions; unrelated conversation history and recap are excluded. No automatic paid retry is added. Result delivery retains the existing at-least-once caveat and manual `/result` path.

## Breaking behavior

`CONFIRM_EXPENSIVE_REQUESTS=true` is the default. Explicit `/image` and `/edit` stage a combined context/cost preview; ad-hoc `/job` requests stage work previews. Batches always require confirmation. Natural text requests cannot invoke the image tool under the default guard: use `/image` or `/edit`. Web search remains available within normal quotas. Setting the flag to `false` restores immediate explicit image/job execution and automatic image tools; batch confirmation remains.

These are operator-configured fixed estimates, not provider prices, measured token charges or a billing cap. Quotas are checked at actual execution. Ordinary chat, transcription, narration and explicitly created recurring summary schedules retain their normal quota/authorization behavior; this is not a confirmation for every paid operation. Preview tokens expire after ten minutes and are owner/thread/revision bound. Changed image estimates require a fresh preview.

## Portable archive contract

`/data` emits `archiveVersion: 1`. The importer also accepts the previous unversioned `/data` shape, after the same validation. It requires durable storage and a supported JSON document downloaded through existing Telegram file limits. `MAX_EXPORT_BYTES` bounds decoded archive size; the smaller per-document download bound can also apply. Source IDs/owner prefixes never become target ownership.

Restored content: conversation names and complete retained turns, bounded recaps, per-conversation preferences/project links, projects with documents/instructions/notes, global notes, templates, library text, forward collections with collection mode off, local feedback, glossaries and tasks. New conversation/project IDs are allocated; titles receive an import suffix. Template-name conflicts are shown and skipped. Current selection, global voice/timezone/budget settings and quotas are preserved. Tasks import open without deadlines to prevent unsolicited reminder delivery.

Not restored: provider credentials, quota counters, active/completed job records, schedules, task delivery state, Telegram message mappings, response buttons, context/work previews and selected image versions. Backups remain separate. Imported content may contain private data and untrusted prompt text; inspect the source and preview before confirming.

Validation covers archive shape/version, roles and complete turns, IDs/duplicates, supported attachment signatures/types and base64, lengths/counts, preferences, project references and merged storage/global history budgets. A merge never evicts existing histories or overwrites current templates/projects/conversations. Insufficient capacity rejects the merge. Profile, new sessions and merged scoped records commit in one SQLite transaction; caches refresh only after success. Transaction behavior is unit-contract verified, not native SQLite-qualified.

## Verification evidence

The release unit suite contains 194 passing tests and enforces 100% executable source line, branch and function coverage. Production files remain included, with tests excluded only by the existing adjacent `__tests__` rule. TypeScript, ESLint, Prettier, production compilation, documentation links, environment documentation and release-version alignment are checked separately. No real provider, database, encoder, PDF parser/renderer, browser or Docker execution was used for qualification.
