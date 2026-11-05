# Telegram AI Bot Pro

A private TypeScript Telegram assistant with text and voice conversations, photo analysis and editing, image generation, web search with sources, document questions, projects, named conversations, explicit saved memory, usage controls, streaming replies and durable background jobs. MIT licensed.

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
- `ALLOWED_TELEGRAM_USER_IDS`: comma-separated numeric IDs. Only these users in private chats are processed.

Default chat model: `gpt-6.1-sol`. Override it with `OPENAI_CHAT_MODEL` using a Responses model supporting vision, document inputs, `web_search` and `image_generation`. Missing or blank values use the default.

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

Foreground updates are serialized per user. A background job locks its conversation; foreground work in another conversation can proceed within the global concurrency cap. `/stop` remains available during foreground work. Overlapping foreground updates receive a busy response. Provider failures do not commit partial turns. Successful complete-turn writes and capacity evictions are transactional in SQLite. Text and media have bounded request/history budgets. Daily quotas and configurable estimated-spend reservations apply separately; see the Pro workspace commands below. Estimates are not provider invoices or a hard billing cap.

Text, audio, attached files, saved notes and relevant history are sent to OpenAI for requested processing. Search may send generated queries to search providers. Responses use `store: false`; this does not establish zero retention by OpenAI or Telegram. Requests and raw provider exceptions are not logged. The SQLite file is access-restricted but is **not encrypted at rest** by this application.

## Pro workspaces and controls

| Workflow                        | Commands or controls                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Usage and local spending limits | `/usage`, `/budget 5`, `/limits image 3`                                                                 |
| Incremental answers             | Streaming text; Stop, Retry, Shorter, More detail and Read aloud buttons                                 |
| Projects and references         | `/projects`, `/project new Work`, `/project use id`, `/project attach` when replying to a document       |
| Conversation preferences        | `/mode developer`, `/instructions text`, `/retention 3600`                                               |
| History and exports             | `/find words`, `/export markdown`, `/export pdf`, `/export json`                                         |
| Document comparison             | `/compare focus` with two retained/project documents                                                     |
| Image controls                  | `/quality medium`, `/size 1536x1024`, `/versions`, `/revert id`; variation and previous-version buttons  |
| Background work                 | `/job research question`, `/jobs`, `/cancel id`, `/result id`, `/job delete id`                          |
| Reminders and summaries         | `/timezone Asia/Tbilisi`, `/remind every 2h \| Take a break`, `/summary every 1d \| Summarize decisions` |
| Schedule management             | `/schedules`, `/unschedule id`                                                                           |
| Local data controls             | `/data`, `/erase`, `/erase confirm`                                                                      |

Daily accounting uses UTC regardless of schedule timezone. Defaults allow 100 paid operations and $10 of **configured cost estimates** per owner/day. Tool calls and speech have separate limits. Failures and cancelled attempts retain their reservations because provider charges may already have occurred. Configure provider-side spending controls too. `/erase` retains minimal current-day quota counters to prevent limit bypass.

Projects and jobs retain files independently of conversation TTL. PDF export embeds a bundled font for Latin, Greek and Cyrillic text with limited punctuation; unsupported characters produce a clear error directing you to Markdown/JSON. No cloud PDF conversion is used. See the [user guide](docs/USER_GUIDE.md) for full syntax and lifecycle rules.

## Development and tests

```sh
npm run check          # types, lint, formatting, unit tests and production compilation
npm run test:unit      # unit tests only; npm test is equivalent
npm run test:coverage  # require 100% executable src lines, branches and functions
```

Tests live beside their implementation in `__tests__`; shared in-memory doubles live in `src/__tests__/helpers.ts`. Production compilation excludes every `__tests__` directory. Only test files are excluded from coverage; production code has no coverage-ignore annotations.

**Only unit tests are authorized and maintained.** HTTP/WebSocket transports, SQLite/filesystem access, process lifecycle, FFmpeg spawning and PDF rendering use controlled doubles. Tests do not call live services, open databases, run application subprocesses, invoke FFmpeg, build Docker or render browsers. They require no API keys and incur no API charges. Node's experimental module-mocking flag is included in test scripts.

CI runs static checks, unit tests, the 100% coverage gate and a dependency advisory query (`npm audit`, network metadata only). It does not install FFmpeg or build Docker. Unit coverage establishes exercised local control flow; live model access, native SQLite durability, PDF layout, audio fidelity and deployment behavior remain unqualified. npm is the sole package manager; commit lockfile changes with dependencies.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Configuration reference](docs/configuration.md)
- [Operations, Docker, backups and live verification](docs/operations.md)
- [Architecture and test conventions](docs/architecture.md)
- [Pro roadmap and acceptance](docs/pro-roadmap.md)
- [Changelog](CHANGELOG.md), [contributing](CONTRIBUTING.md), [security](SECURITY.md), [license](LICENSE)

Official API references: [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [image generation](https://developers.openai.com/api/docs/guides/tools-image-generation), [file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [Realtime audio](https://developers.openai.com/api/docs/guides/realtime-conversations), [Telegram Bot API](https://core.telegram.org/bots/api).
