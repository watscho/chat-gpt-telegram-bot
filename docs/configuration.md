# Configuration reference

Current release: **10.0.1**.

Copy `.env.example` to `.env` for local development, or inject environment variables in production. Never commit credentials, state databases or user content. Invalid numeric and enum values fail at startup; error messages name settings without their values. Numeric values must be positive integers within the maxima below.

## Credentials and models

| Setting                      | Default                  | Purpose                                                                                 |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `TELEGRAM_API_KEY`           | Required                 | Bot token                                                                               |
| `OPENAI_API_KEY`             | Required                 | OpenAI project key                                                                      |
| `ALLOWED_TELEGRAM_USER_IDS`  | Required                 | Comma-separated positive safe-integer Telegram IDs; private chats only                  |
| `OPENAI_CHAT_MODEL`          | `gpt-6.1-sol`            | Responses model supporting images, files, web search and image generation               |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Incoming OGG-compatible transcription model                                             |
| `OPENAI_IMAGE_MODEL`         | `gpt-image-2.5-sunburst` | Image tool model                                                                        |
| `OPENAI_IMAGE_QUALITY`       | `high`                   | `low`, `medium`, `high`, `auto`                                                         |
| `OPENAI_IMAGE_SIZE`          | `auto`                   | `auto`, `1024x1024`, `1536x1024`, `1024x1536`                                           |
| `OPENAI_SPEECH_MODEL`        | `gpt-realtime-2.1-mini`  | Realtime speech model, not a `/audio/speech` model                                      |
| `OPENAI_SPEECH_VOICE`        | `marin`                  | `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar` |
| `FFMPEG_PATH`                | `ffmpeg`                 | Trusted FFmpeg executable with libopus; no shell interpolation                          |
| `STATE_DB_PATH`              | `./data/bot.sqlite`      | SQLite file or `:memory:`; use a private writable directory                             |

The default chat model is `gpt-6.1-sol`, selected from [official OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model) on 2026-11-05 for its balance of intelligence, speed and cost. Its [model reference](https://developers.openai.com/api/docs/models/gpt-6.1-sol) documents Responses, vision, streaming, web search and image-generation tool support. Missing, empty or whitespace-only `OPENAI_CHAT_MODEL` values use this default; an explicit nonempty value takes precedence. This is a configured model ID, not an automatic latest-model resolver.

Model identifiers are configurable strings. Startup validation checks configuration syntax, not account access or model/tool compatibility. Creative requirements such as transparent backgrounds and composition go in image prompts. Generative edits do not guarantee pixel-exact preservation and there is no mask editor.

## Resource budgets

| Setting                    |  Default |   Maximum | Scope                                                                        |
| -------------------------- | -------: | --------: | ---------------------------------------------------------------------------- |
| `MAX_THREADS`              |       20 |       100 | Named conversation slots per user/chat                                       |
| `MAX_MEMORIES`             |       20 |       100 | Explicit saved notes per user/chat                                           |
| `MAX_MEMORY_CHARACTERS`    |     4000 |     16000 | Total saved-note UTF-16 characters                                           |
| `MAX_INPUT_CHARACTERS`     |     8000 |     32000 | Current text, caption or transcript                                          |
| `MAX_HISTORY_TURNS`        |       20 |       100 | Complete user/assistant pairs per conversation                               |
| `MAX_HISTORY_CHARACTERS`   |    60000 |    200000 | Retained text, including source lists                                        |
| `SESSION_TTL_SECONDS`      |     3600 |     86400 | History inactivity expiry                                                    |
| `MAX_SESSIONS`             |     1000 |     10000 | Retained conversation histories across users                                 |
| `MAX_CONCURRENT_REQUESTS`  |       10 |       100 | Concurrent user/chat handlers                                                |
| `MAX_VOICE_BYTES`          | 10000000 |  20000000 | Incoming audio bytes, declared and streamed                                  |
| `MAX_VOICE_SECONDS`        |      300 |      1200 | Telegram-declared incoming voice duration                                    |
| `MAX_IMAGE_BYTES`          | 10000000 |  20000000 | Each binary input/generated image                                            |
| `MAX_DOCUMENT_BYTES`       | 10000000 |  20000000 | Each binary document                                                         |
| `MAX_HISTORY_IMAGE_BYTES`  | 20000000 | 100000000 | Encoded attachment characters per conversation, including documents          |
| `MAX_TOTAL_IMAGE_BYTES`    | 64000000 | 500000000 | Encoded attachment characters across retained histories, including documents |
| `OPENAI_MAX_OUTPUT_TOKENS` |     2000 |     16000 | Responses output-token budget                                                |
| `MAX_WEB_SEARCH_CALLS`     |        3 |        10 | Shared built-in-tool budget in automatic/search requests                     |
| `MAX_SPEECH_CHARACTERS`    |     3000 |      4000 | One narration request; long answers stay available as text                   |
| `MAX_SPEECH_BYTES`         | 10000000 |  20000000 | Both decoded PCM and encoded OGG bounds                                      |
| `REQUEST_TIMEOUT_MS`       |    60000 |    180000 | File batch downloads, transcription, or whole speech-plus-encoding operation |
| `IMAGE_TIMEOUT_MS`         |   300000 |    900000 | All Responses requests, including text and search                            |

The historical `*_IMAGE_BYTES` history variable names are retained for compatibility and now cover **all attachments**. Base64 expands binary payloads by about one third. Budgets bound encoded payloads, not total RSS, network buffers or SQLite file size. Providers can impose additional request limits; raising local budgets does not raise provider limits.

`/image` and `/edit` force the image tool with one call. With `CONFIRM_EXPENSIVE_REQUESTS=false`, automatic requests offer both image generation and web search, and share `MAX_WEB_SEARCH_CALLS`; the model is instructed to generate at most one image. `/search` offers only web search and requires a tool call. This per-request tool budget is separate from the UTC daily usage quotas below. Each generated image is checked before delivery; a large completed turn may be delivered and then discarded from history to satisfy retention limits.

Lowering history budgets removes oversized retained histories on startup and evicts older histories until global limits hold. Changing note/thread limits governs subsequent additions; existing saved notes and named slots remain until explicitly edited or deleted. Limits do not count tokens inside files before the provider parses them.

## Pro usage, streaming and durable work

`STREAM_RESPONSES` defaults to `true`; accepted values are exactly `true` or `false`. Streaming edits a Telegram preview at most once per second. Setting it to `false` keeps final-answer delivery and cancellation controls.

| Setting                            |  Default |    Maximum | Scope                                                                         |
| ---------------------------------- | -------: | ---------: | ----------------------------------------------------------------------------- |
| `DAILY_BUDGET_MICRO_USD`           | 10000000 | 1000000000 | Estimated daily spend per owner; 1000000 micro-USD = $1                       |
| `DAILY_REQUESTS`                   |      100 |      10000 | Paid operations: Responses, transcription and narration each count separately |
| `DAILY_IMAGES`                     |       20 |       1000 | Image tool calls per owner/UTC day                                            |
| `DAILY_SEARCHES`                   |      100 |      10000 | Web tool calls per owner/UTC day                                              |
| `DAILY_VOICE`                      |       50 |       1000 | Outgoing narration operations per owner/UTC day                               |
| `ESTIMATE_CHAT_MICRO_USD`          |   100000 |   10000000 | Base reservation per Responses operation                                      |
| `ESTIMATE_IMAGE_MICRO_USD`         |   500000 |   10000000 | Additional reservation per image tool call                                    |
| `ESTIMATE_SEARCH_MICRO_USD`        |    10000 |   10000000 | Additional reservation per search tool call                                   |
| `ESTIMATE_VOICE_MICRO_USD`         |   100000 |   10000000 | Reservation per narration operation                                           |
| `ESTIMATE_TRANSCRIPTION_MICRO_USD` |   100000 |   10000000 | Reservation per incoming transcription                                        |
| `MAX_PROJECTS`                     |       10 |        100 | Projects per owner                                                            |
| `MAX_PROJECT_BYTES`                | 20000000 |   64000000 | Aggregate encoded document data across all projects per owner                 |
| `MAX_JOBS`                         |       20 |        100 | Retained job records per owner, including completed/cancelled records         |
| `MAX_JOB_BYTES`                    | 20000000 |   64000000 | Serialized queue payload budget checked before adding work                    |
| `MAX_SCHEDULES`                    |       20 |        100 | Schedules per owner                                                           |
| `MAX_EXPORT_BYTES`                 | 20000000 |   64000000 | Each generated Markdown/JSON/PDF export                                       |
| `WORKER_INTERVAL_MS`               |     1000 |      60000 | Background worker polling interval                                            |

All numeric environment settings must be positive integers. Users can set `/budget 0` or `/limits image|search|voice 0` to disable paid work or a feature locally; these user settings can rise only as far as the operator maximum. `/budget` accepts USD with up to six fractional digits. Usage resets logically at the UTC day boundary; schedule timezone changes cannot reset it. Old persisted usage aggregates are overwritten on the next reservation rather than erased by a midnight task.

Estimates are fixed configurable amounts, **not measured token costs or current provider prices**. A Responses call reserves its base plus possible tools; successful completion releases unused image/search reservations. Automatic tools shrink or disable when remaining allowance is insufficient; explicit unavailable image/search work rejects before the provider call. Failures/cancellation keep reservations because a charge may already have occurred. Outgoing speech and incoming transcription reserve separately. Background paid jobs obey the same ledger; reminder delivery uses no model call. Set independent provider-side budgets and monitor actual billing.

Per-conversation overrides: mode (`default`, `developer`, `editor`, `translator`, `custom`), custom instructions (up to 4000 characters), image quality/size from the model table, history retention (60..86400 seconds or operator default), and selected project/image version. Explicit project instructions use the same 4000-character bound. Each project retains at most ten documents; same-name attachment replaces the existing file. Project notes obey configured note count/character limits. Projects and jobs do not inherit conversation TTL.

`MAX_JOB_BYTES` is an admission bound, not a hard database/RSS limit: later generated results and schedule metadata can increase the stored queue size. Results remain bounded by provider output/media limits; adding further work fails when the resulting queue is too large. Remove old jobs explicitly. Export size checks may reject a full `/data` archive containing large attachments; remove unnecessary retained content or export a conversation separately.

Changing limits does not rewrite all existing workspace/job data. Use explicit deletion commands to reclaim it. Run a single polling process: counters, caches and locks are not distributed. See [operations](operations.md) for schema migration and recovery.

## Productivity limits and model overrides

`/model ID` overrides only the active conversation; `/model default` restores `OPENAI_CHAT_MODEL`. Overrides must contain 1..100 model-ID characters (letters, digits, dot, underscore, colon or hyphen, starting with a letter/digit). Model account access and tool compatibility remain the operator's responsibility. Background jobs resolve this override at execution time. Existing stored thread settings need no migration; absent model/review fields preserve operator-default and immediate-answer behavior.

Productivity bounds are fixed in this release: 50 templates/owner; 8000 template/expanded characters; 50 forwarded entries and 60000 characters/conversation; 200 feedback records/owner; one context draft/owner valid for ten minutes; 20 MB serialized productivity state. The operator's `MAX_INPUT_CHARACTERS` still applies to generated requests. A library has up to 500 indexed documents/owner, 10 MB/input, 500 PDF pages, one million extracted characters/document and 20 MB serialized text/owner; up to eight passages are retrieved. These independent stores do not share the inline project-file byte budget or history TTL. See [productivity acceptance](pro-productivity.md).

## Workflow confirmations and portable state

`CONFIRM_EXPENSIVE_REQUESTS` defaults to `true`; accepted values are `true` and `false`. With the default, `/image` and `/edit` require an expiring cost/context confirmation and implicit image tools are disabled for ordinary requests. Ad-hoc `/job` requests require a work confirmation. Batches always require confirmation. Setting it to `false` restores immediate explicit images/jobs and automatic image tools. Web search and ordinary chat/transcription/narration retain normal quotas. Existing paid recurring summary schedules do not pause for per-occurrence UI confirmation.

Estimates use the existing `ESTIMATE_*_MICRO_USD` rates: image/edit reserves base chat plus one image; research preview includes the configured maximum search calls; batch preview includes one base chat estimate per file. Estimates do not measure token usage or guarantee provider costs. Changed image estimates invalidate old confirmations. Actual quotas and current capacity are rechecked at execution.

Fixed workflow bounds: 100 tasks/owner, 1000 title characters, eight tasks/list page; 100 glossary entries/project with 4000 combined characters and single-line 80/200-character term/meaning limits; 100 delivered-answer mappings/owner; 20 MB workflow record; ten-minute work/import previews. A transcription receives at most 800 glossary characters. Recaps keep at most three excerpts per category (decisions, constraints, questions, context), up to 300 content characters plus role labels per excerpt.

Current archives use `archiveVersion: 2` and schema 3 storage; version 1 and legacy unversioned archives remain importable. Import is additive, requires durable storage, obeys the current conversation/project/note/file/history/library/productivity/workflow limits and never evicts existing histories to fit. `MAX_EXPORT_BYTES` bounds the archive; Telegram's per-document download cap also applies. Imported global voice/timezone/budget settings, credentials, jobs/schedules, quotas and active controls are not restored. See [workflow acceptance](pro-workflows.md) for the complete portable contract.

## Owner preferences and fixed bounds

No new environment variables are required. `/quiet`, `/digest`, `/language ui`, bookmarks and notification references persist in the owner `experience` record (1 MB maximum). Defaults: quiet off, digest immediate, UI English. Quiet windows use `/timezone`; digests allow 5..1440 minutes, 100 pending notices and batches of 10, with three delivery attempts and 60-second backoff. Bookmarks allow 100 entries, 10 tags and 4000-character passages.

`/language answer` persists per conversation; UI catalogs support en/ru/es with English fallback. Locale JSON files are production resources copied by TypeScript compilation; deploy the complete `dist` directory. Structured output accepts 1..10 lowercase fields, at most 100 rows and 2000-character nullable string cells. Output bytes obey the smaller of `MAX_EXPORT_BYTES` and `MAX_DOCUMENT_BYTES`; no image/search tools or partial streaming are used.

Project daily estimate caps persist with project settings and cannot exceed owner/operator ceilings. Shared atomic owner usage records include project aggregates; UTC rollover and conservative failed-attempt accounting remain authoritative. Queue priority is 0..9, default zero; deferred eligibility uses an absolute timestamp parsed from `/timezone`. See [all behavior and limits](pro-experience.md).

## Daily workflows

No new environment variables or dependencies are added. Owner commands persist guided setup, `/notes`, `/morning`, favorite/recent scenario IDs and pending review metadata in a 100 KB `daily` record. Notes and morning default off. Favorites are capped at 20, recent IDs at 10 and scenario pages at 12. Pending scenario input and task reviews expire after ten minutes. Reviewed task batches accept at most 10 rows within the existing 100-task owner capacity. All paid generation/transcription/edit work retains existing owner/project quotas and cost/context controls.

Morning overviews use `/timezone`, quiet hours and worker ticks, with three attempts per local day and 60-second backoff; no model request is needed. Article requests use a fixed ten-second combined lookup/request deadline, three redirects, a 1 MB response cap, 80-character minimum readable text and 20,000-character excerpt cap. HTTPS/public DNS/TLS validation and uncompressed UTF-8 HTML/plain text are required. Normal configured document/input/history limits can impose smaller effective limits. The reader never executes JavaScript or restores inaccessible content. See [daily workflow limits](pro-daily.md).

Schema 3/archive format 2 remain unchanged. `/data` includes private daily state for inspection/backup; archive import preserves destination daily state and ignores source daily settings/tokens, preventing unsolicited morning delivery. Deploy the full compiled `dist` tree and locale resources as before.

## Provider workbench settings

See [provider setup](pro-provider.md) for MCP credentials, Mini App HTTPS hosting, model access and cleanup. All new settings and their defaults appear in `.env.example`. Analysis/meeting/live model IDs are independent from the ordinary chat/transcription models.

| Setting                             | Default                 | Bound or meaning                                                     |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `OPENAI_ANALYSIS_MODEL`             | `gpt-6-astra`           | Code Interpreter model; account access required                      |
| `OPENAI_MEETING_MODEL`              | `gpt-transcribe`        | JSON recorded-audio transcription                                    |
| `OPENAI_DIARIZATION_MODEL`          | empty                   | Explicit optional legacy speaker-label model; see deprecation note   |
| `OPENAI_LIVE_MODEL`                 | `gpt-realtime-2.1-mini` | Realtime WebRTC call model                                           |
| `MINI_APP_URL`                      | empty                   | Public HTTPS origin/path, no credentials/query/fragment              |
| `MINI_APP_PORT`                     | `8787`                  | 1..65535, binds `127.0.0.1`                                          |
| `LIVE_MAX_SECONDS`                  | `180`                   | 1..600, cleanup deadline rather than guaranteed billing cap          |
| `MAX_MEETING_BYTES`                 | `20000000`              | 1..20000000                                                          |
| `MAX_MEETING_SECONDS`               | `1800`                  | 1..7200 metadata bound and unknown-duration estimate                 |
| `OPENAI_MCP_CONNECTIONS`            | `[]`                    | Up to 20 owner-scoped authenticated endpoint configurations          |
| `ESTIMATE_ANALYSIS_MICRO_USD`       | `1000000`               | 1..100000000, in addition to ordinary chat reservation               |
| `ESTIMATE_INDEX_MICRO_USD`          | `100000`                | 1..10000000, in addition to ordinary chat reservation                |
| `ESTIMATE_CONNECTION_MICRO_USD`     | `100000`                | 1..10000000 per approved provider continuation plus chat             |
| `ESTIMATE_LIVE_MINUTE_MICRO_USD`    | `500000`                | 1..10000000; full duration rounded up to minutes plus ordinary voice |
| `ESTIMATE_MEETING_MINUTE_MICRO_USD` | `100000`                | 1..10000000 per rounded minute plus transcription and protocol/chat  |

Knowledge questions reserve the ordinary chat cost plus the configured search estimate. Estimates are conservative operator inputs, not dynamically fetched prices, measured token/tool usage or a provider billing limit.

## Studio configuration

Studio reuses existing models, owner/project budgets, `MAX_JOB_BYTES`, file limits and `MINI_APP_URL`; it adds no credential or model default. Build the workspace browser asset before starting the optional shared Mini App server. [The Studio guide](pro-studio.md) documents fixed item/mission/version bounds, estimate checks and public research isolation.

## Pro Suite

| Variable                          | Default                   | Bounds/meaning                                                                  |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `OPENAI_REVIEW_MODELS`            | `gpt-6.1-sol,gpt-6-astra` | 1..10 unique configured model IDs; reviewer must differ from frozen primary     |
| `ESTIMATE_REVIEW_EXTRA_MICRO_USD` | `100000`                  | Additional reviewer estimate, up to 100,000,000 micro-USD; not provider billing |
| `FFPROBE_PATH`                    | `ffprobe`                 | Trusted executable path, at most 512 characters, no NUL/newlines                |
| `MAX_VIDEO_BYTES`                 | `20000000`                | Positive integer, at most 20 MB                                                 |
| `MAX_VIDEO_CLIP_SECONDS`          | `120`                     | Positive integer, at most 300 seconds per selected clip                         |
| `MAX_VIDEO_FRAMES`                | `8`                       | Positive integer, at most ten sampled frames                                    |

Video audio uses `OPENAI_MEETING_MODEL` through the meeting WAV port, without speaker labeling. Video audio estimates add the normal transcription estimate and configured meeting-minute estimate; the plan conservatively quotes the full configured clip duration. Actual transcription reserves the extracted clip duration. Zero model requests are made by local search, watch checks, ZIP organization, template editing or artifact rendering. Native processing is bounded by existing request/image deadlines, document/export limits and the independent owner Studio/Suite byte budgets. Configure a private persistent `STATE_DB_PATH` for watches/shared projects. See [Suite setup and user paths](pro-suite.md).
