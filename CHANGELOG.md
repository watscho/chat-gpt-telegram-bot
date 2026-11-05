# Changelog

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
