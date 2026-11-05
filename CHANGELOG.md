# Changelog

## 6.0.0 — Delivery, evidence and structured results

- Add timezone-aware quiet hours, grouped job/task notification digests, pending-delivery inspection, suppression and bounded delivery-only retries.
- Add private tagged bookmarks, local search/pagination, quoted-message saves and answer/source buttons.
- Retain bounded source cards with answer-bound excerpts and safe links; opening cards requires no page fetch or model call.
- Attribute foreground, speech and background reservations to their origin project in the shared owner ledger; expose project estimates and daily sub-budgets.
- Add strict CSV/JSON row requests, local shape/size validation, spreadsheet formula-prefix neutralization and retained file delivery.
- Add ready-queue positions, priorities and deferred starts without preemption, ETA promises or automatic paid retries.
- Add independent owner UI and conversation answer languages, static Russian/Spanish UI catalogs and English fallback.
- Extend guided navigation, archive validation/atomic merges, erasure, privacy documentation and adjacent unit coverage.

Breaking changes: SQLite metadata becomes schema 3; version 5 rejects it. Back up before upgrading and restore that backup to roll back. `/data` emits archive format 2; imports accept formats 1/2 and the legacy unversioned shape. Owner notification/language settings and quota counters are preserved at the destination, never imported. Queued work whose origin project was deleted now stops before provider execution. All 227 tests are unit-only with 100% executable source line, branch and function coverage; native/provider/deployment behavior is not qualified.

## 5.0.0 — Guided workflows and portable data

- Add local actionable tasks with status/deadline controls, paginated lists, Done buttons and bounded reminder delivery retries.
- Add automatic inspectable extractive recaps for trimmed conversation turns, independently selectable in context previews.
- Ground replies in a specific retained delivered bot answer or matching selected text fragment.
- Add project glossaries for answer/translation preferences and bounded incoming-transcription hints.
- Add confirmed per-file batch summaries, extraction and tables, atomic queue admission, progress and result exports.
- Add default estimated-cost/context confirmations for explicit images and ad-hoc jobs, with single-use expiry/revision guards and changed-estimate rejection.
- Add versioned data archives, validated merge previews, fresh conversation/project IDs, explicit template conflicts and atomic imports with cache refresh.
- Restore portable preferences, complete histories/recaps, files, notes, templates, library, collections, feedback, dictionaries and tasks without replaying paid jobs, schedules or notifications.
- Add `/guide` navigation and expand setup, user, configuration, architecture, security and operations documentation.
- Maintain adjacent unit-only tests and the unchanged 100% executable source line/branch/function gate; no live/native, browser, Docker or costly tests are added.

Breaking behavior: `CONFIRM_EXPENSIVE_REQUESTS=true` enables confirmation for `/image`, `/edit` and ad-hoc `/job`. Ordinary requests cannot invoke image tools implicitly under this default; use explicit commands. Operators can set the flag to `false` to restore prior immediate image/job behavior. Batches always require confirmation. Recaps can retain excerpts from trimmed turns within session TTL; inspect/clear them explicitly. SQLite remains schema 2.

## 4.1.0 — Pro productivity

- Add retained-turn inspection, preserved conversation branches and revised requests with original references and copied preferences.
- Add owner/project-scoped local text/PDF library indexing, ranked passage search and grounded questions with page/line labels; bounded PDF.js extraction is mocked in unit tests.
- Add durable named prompt templates with exact JSON variable contracts and bounded single-pass substitution.
- Add explicit forwarded text/caption collection and deliberate cited summaries with no automatic paid processing.
- Add paginated settings buttons for conversation models, projects, modes, voice, quota presets and context review; retain operator model defaults.
- Add answer-bound positive/negative feedback with explicit reasons, replacement votes and bounded local retention.
- Add expiring single-use context previews, text/metadata inspection and independent exclusion of history, deduplicated attachments, notes, instructions and reference excerpts.
- Include new records in owner data exports/erasure, conversation reset/deletion and project-library cleanup; document independent retention limits.
- Preserve adjacent unit-only tests and the unchanged 100% executable line/branch/function coverage gate. No live/native, browser, Docker or costly tests are added.

## 4.0.1 — Default chat model

- Default `OPENAI_CHAT_MODEL` to `gpt-6.1-sol` when unset, empty or whitespace-only, while preserving explicit overrides.
- Align environment examples and configuration/setup documentation with current official OpenAI guidance.
- Cover default and override behavior with unit tests; no live API requests are required.

## 4.0.0 — Pro workspaces and durable work

- Add UTC daily usage, operator/user limits and conservative estimated-spend reservations for chat, tools, transcription and narration.
- Stream text previews with Stop; add owner/thread/revision-bound retry, shorter, more-detail and read-aloud controls.
- Add projects with shared reference documents/instructions/explicit notes, plus per-conversation modes and custom instructions.
- Add retained-history search, Markdown/JSON/PDF exports with bundled licensed font, and structured document comparison.
- Add per-conversation image quality/size, variations and retained image-source selection with stable legacy identifiers.
- Add bounded durable research/comparison/summary jobs, inspect/cancel/result controls, conservative restart recovery and independent delivery retries.
- Add timezone-aware one-off reminders and recurring reminders/summaries with missed-occurrence coalescing.
- Add owner data export/erasure and per-conversation retention; preserve minimal UTC-day quota aggregates after erasure.
- Upgrade SQLite to schema 2 while preserving existing profiles/sessions; document backup-based rollback.
- Restrict all automated tests to adjacent unit tests. Replace actual SQLite/filesystem, process lifecycle, FFmpeg and PDF rendering with controlled doubles. Remove Docker/FFmpeg execution from CI; retain 100% executable source lines/branches/functions.
- Expand configuration, user workflows, architecture, operations, security and phased acceptance documentation.

Breaking changes: streaming and UTC daily estimated-spend/count quotas are enabled by default. Costs are configurable estimates, not provider billing caps. Schema 2 cannot be opened by version 3; restore a pre-upgrade backup to roll back. Jobs/projects retain content independently of history TTL. PDF export requires the bundled assets directory and rejects unsupported Unicode in favor of lossless Markdown/JSON. Only unit/static checks qualify this release; native/provider/deployment behavior is not certified.

## 3.0.1 — English documentation and examples

- Translate the user guide into English and rename it to `docs/USER_GUIDE.md`.
- Standardize help text, memory shortcuts, examples and test fixtures in English.
- Update documentation links while retaining Unicode input coverage and the 100% coverage gate.

## 3.0.0 — Pro features

- Photo analysis, stateless image generation/editing, original PNG delivery, reference selection and bounded albums.
- Automatic and explicit web search, numbered citations and safe clickable source lists.
- Inline PDF, DOCX, XLSX, PPTX and UTF-8 TXT/MD/CSV/JSON inputs with retained follow-up context.
- Independent named conversations, selection, rename and deletion.
- Explicit saved user notes with inspection and deletion; user-scoped voice preferences.
- SQLite persistence for completed history, media, profiles and preferences with transactional turn replacement and eviction.
- Optional Realtime narration and OGG/Opus voice replies, fixed-argument FFmpeg encoding and text fallback.
- Adjacent `__tests__` directories and required 100% line, branch and function coverage across executable source.
- User guide, complete configuration, architecture and operations references.

Breaking changes: `/new` creates a named conversation; `/start` shows help without resetting. Use `/reset` to clear the selected history. Production state now persists to `./data/bot.sqlite`; Docker needs a private persistent volume. Outgoing voice requires FFmpeg/libopus and Realtime model access. Chat model configuration must support vision, files, web search and the image tool. Existing 2.x in-memory history cannot be recovered after the old process exits.

## 2.0.0

Breaking modernization of the text and voice Telegram bot:

- Node 26, native ES modules, strict TypeScript, compiled production runtime.
- Current OpenAI SDK with Responses API and direct OGG transcription.
- Explicit configuration validation and required private-user allowlist.
- Independent, bounded conversation histories with expiry and reset.
- Complete-turn commits, concurrency limits, bounded audio downloads, safe errors.
- Offline application, SDK contract, and Telegram update tests.
- Flat ESLint configuration, Prettier, npm lockfile, CI and dependency updates.
- Non-root Docker image, architecture/operations/migration documentation.
- Preserved MIT license and original attribution; updated maintenance attribution.
