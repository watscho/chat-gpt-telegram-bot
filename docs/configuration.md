# Configuration reference

Copy `.env.example` to `.env` for local development, or inject environment variables in production. Never commit credentials, state databases or user content. Invalid numeric and enum values fail at startup; error messages name settings without their values. Numeric values must be positive integers within the maxima below.

## Credentials and models

| Setting                      | Default                  | Purpose                                                                                 |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `TELEGRAM_API_KEY`           | Required                 | Bot token                                                                               |
| `OPENAI_API_KEY`             | Required                 | OpenAI project key                                                                      |
| `ALLOWED_TELEGRAM_USER_IDS`  | Required                 | Comma-separated positive safe-integer Telegram IDs; private chats only                  |
| `OPENAI_CHAT_MODEL`          | Required                 | Responses model supporting images, files, web search and image generation               |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Incoming OGG-compatible transcription model                                             |
| `OPENAI_IMAGE_MODEL`         | `gpt-image-2.5-sunburst` | Image tool model                                                                        |
| `OPENAI_IMAGE_QUALITY`       | `high`                   | `low`, `medium`, `high`, `auto`                                                         |
| `OPENAI_IMAGE_SIZE`          | `auto`                   | `auto`, `1024x1024`, `1536x1024`, `1024x1536`                                           |
| `OPENAI_SPEECH_MODEL`        | `gpt-realtime-2.1-mini`  | Realtime speech model, not a `/audio/speech` model                                      |
| `OPENAI_SPEECH_VOICE`        | `marin`                  | `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar` |
| `FFMPEG_PATH`                | `ffmpeg`                 | Trusted FFmpeg executable with libopus; no shell interpolation                          |
| `STATE_DB_PATH`              | `./data/bot.sqlite`      | SQLite file or `:memory:`; use a private writable directory                             |

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

`/image` and `/edit` force the image tool with one call. Automatic requests offer both image generation and web search, and share `MAX_WEB_SEARCH_CALLS`; the model is instructed to generate at most one image. `/search` offers only web search and requires a tool call. The budget is not a daily spending cap. Each generated image is checked before delivery; a large completed turn may be delivered and then discarded from history to satisfy retention limits.

Lowering history budgets removes oversized retained histories on startup and evicts older histories until global limits hold. Changing note/thread limits governs subsequent additions; existing saved notes and named slots remain until explicitly edited or deleted. Limits do not count tokens inside files before the provider parses them.
