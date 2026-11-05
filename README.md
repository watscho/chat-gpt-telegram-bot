# Telegram AI Bot Pro

A private TypeScript Telegram assistant with text and voice conversations, photo analysis and editing, image generation, web search with sources, document questions, named conversations and explicit saved memory. MIT licensed.

“Pro” names this repository's feature set. It does not grant a ChatGPT subscription or provider account access.

## Get started

Requirements: Node.js **26.13+ within Node 26**, npm 11, a Telegram bot token, an OpenAI project API key with billing and model access. Outgoing voice messages require **FFmpeg with libopus**; the Docker image includes it. Incoming voice transcription needs no FFmpeg.

```sh
nvm use
npm ci
cp .env.example .env
# Fill in required settings before starting.
npm run dev
```

Required settings:

- `TELEGRAM_API_KEY`: token from [@BotFather](https://t.me/BotFather).
- `OPENAI_API_KEY`: private OpenAI project key.
- `OPENAI_CHAT_MODEL`: a Responses model supporting vision, document inputs, `web_search` and `image_generation`.
- `ALLOWED_TELEGRAM_USER_IDS`: comma-separated numeric IDs. Only these users in private chats are processed.

Default image model: `gpt-image-2.5-sunburst`, quality `high`. Default outgoing speech model: `gpt-realtime-2.1-mini`, voice `marin`. Model availability must be checked against your own account. Configuration does not establish provider acceptance.

For FFmpeg on macOS, install with `brew install ffmpeg`; on Debian/Ubuntu, install the `ffmpeg` package. Check that your build supports the `libopus` encoder. `FFMPEG_PATH` can point to a trusted executable.

```sh
npm run build
npm start
```

## Commands

| Command                                  | Behavior                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `/start`, `/help`                        | Show help without clearing history                                              |
| `/new [name]`                            | Create and select an independent conversation                                   |
| `/chats`                                 | List your conversations and selected ID                                         |
| `/switch id`                             | Continue another conversation                                                   |
| `/rename name`                           | Rename the selected conversation                                                |
| `/delete id`                             | Delete that conversation and its retained history; keep at least one            |
| `/reset`                                 | Clear selected conversation's text, photos and documents                        |
| `/search query`                          | Explicit web search with numbered references and clickable sources              |
| `/image description`                     | Generate a new image                                                            |
| `/edit instructions`                     | Edit images in context, or a photo/file you reply to                            |
| `/remember note`                         | Explicitly save a note shared across your conversations                         |
| `/memory`                                | List saved notes with numbers                                                   |
| `/forget number`, `/forget all`          | Remove a note or all saved notes; exact note text also works                    |
| `/voice off`, `/voice on`, `/voice auto` | Disable voice, narrate all text answers, or narrate only answers to voice input |
| `/speak [text]`                          | Narrate supplied text, or the last retained assistant answer                    |

Voice replies start **off**. Every outgoing voice message is labelled **AI-generated voice**. Text answers remain available even if narration fails. Long answers are not silently truncated for speech: use `/speak` with a shorter passage.

Natural-language requests can invoke image generation or web search automatically. Explicit commands provide a predictable way to request them. `remember: …` and `forget …` manage saved notes without a model call. The bot never extracts long-term notes automatically from ordinary conversation.

## Photos and documents

Send a photo or original JPEG/PNG/static WebP file, with optional instructions in its caption. Continue asking questions about it. `/image`, `/edit` and `/search` also work in captions. Reply to an older photo or document to attach that exact source to the current request. Generated images arrive as original PNG documents.

Supported document extensions: **PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JSON**. Send a document with a question, or without a caption for a summary. Follow-up questions reuse retained files. PDFs and Office files are parsed by OpenAI; text documents must be UTF-8. Signatures catch obvious PDF/Office/image mismatches; complete file validity and provider parsing are checked downstream. Embedded pictures/layout in non-PDF documents are not guaranteed to be available to the model. Convert to PDF when visual layout matters.

Reference albums collect up to ten updates during a 750 ms window and share one download deadline. Items arriving later receive the usual busy response if processing has begun. Send files separately and wait for each reply when predictable batch membership matters.

Examples:

```text
[photo] Read this sign and translate it into English.
/image A realistic cat portrait in a spacesuit, square composition
[reply to that image] /edit Replace the background with a beach
[PDF] Summarize the obligations and point to the relevant pages.
[follow-up] What does section 4 say?
/search What changed in the latest Node.js release?
/new Work
/remember Answer concisely in English.
/voice auto
```

## Data and limits

Production state is saved to `STATE_DB_PATH` (default `./data/bot.sqlite`). **Text history, images, documents, conversation names, saved notes and voice preferences are private local data.** Keep this file out of source control and use a persistent Docker volume. `:memory:` selects disposable state. Tests inject isolated stores and do not open your production database.

Saved conversation names, notes and voice settings survive restarts. Retained message history and attachments also survive restarts **within TTL and capacity limits**. History defaults to one hour of inactivity and 20 complete turns per conversation. Expired histories are pruned at startup and on subsequent conversation access; names and explicit notes are retained separately. `/reset` preserves other conversations and saved notes. `/forget` removes saved notes but cannot erase earlier text containing the same information; clear affected conversations too when needed.

Per-user concurrency is serialized across all their conversations. Overlapping updates and commands receive a busy response rather than being queued. Provider failures do not commit partial turns. Successful complete-turn writes and capacity evictions are transactional in SQLite. Text and media have bounded request/history budgets. These are resource limits, not monetary quotas.

Text, audio, attached files, saved notes and relevant history are sent to OpenAI for requested processing. Search may send generated queries to search providers. Responses use `store: false`; this does not establish zero retention by OpenAI or Telegram. Requests and raw provider exceptions are not logged. The SQLite file is access-restricted but is **not encrypted at rest** by this application.

## Development and tests

```sh
npm run check          # types, lint, formatting, offline tests and production build
npm run test:coverage  # require 100% lines, branches and functions across executable src
npm audit              # dependency advisory check
```

Tests live beside their implementation in `__tests__`, for example `src/telegram/__tests__/bot.test.ts`. Shared helpers and process fixtures live in `src/__tests__`. Production compilation excludes every `__tests__` directory. Coverage excludes test files and fixtures only; production code has no coverage-ignore annotations.

The suite covers application behavior, the real Telegraf pipeline with fake transport, actual OpenAI SDK HTTP/WebSocket contracts with fake transport, SQLite durability/transactions, native FFmpeg encoding and process shutdown. Tests require no real API keys and spend no API credits. Full offline coverage does not prove live model/account compatibility, speech fidelity or deployment readiness.

CI installs FFmpeg, runs checks and the 100% coverage gate, audits dependencies and builds Docker. npm is the sole package manager; commit lockfile changes with dependency changes.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Configuration reference](docs/configuration.md)
- [Operations, Docker, backups and live verification](docs/operations.md)
- [Architecture and test conventions](docs/architecture.md)
- [Changelog](CHANGELOG.md), [contributing](CONTRIBUTING.md), [security](SECURITY.md), [license](LICENSE)

Official API references: [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [image generation](https://developers.openai.com/api/docs/guides/tools-image-generation), [file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [Realtime audio](https://developers.openai.com/api/docs/guides/realtime-conversations), [Telegram Bot API](https://core.telegram.org/bots/api).
