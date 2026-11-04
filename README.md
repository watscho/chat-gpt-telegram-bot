# ChatGPT Telegram Bot

A private Telegram bot for text conversations and voice transcription, written in strict TypeScript. Uses the OpenAI Responses and audio transcription APIs. MIT licensed.

## Requirements and setup

- Node.js 26.13 or newer within the Node 26 release line (`nvm use`).
- npm 11; npm is the sole package manager. The old Yarn 1 lockfile has been replaced by `package-lock.json`.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- An OpenAI project API key, API billing, and access to the configured models.

```sh
npm ci
cp .env.example .env
```

Fill in `TELEGRAM_API_KEY`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, and `ALLOWED_TELEGRAM_USER_IDS`. Model IDs are configurable; select a Responses-compatible text model available to your project. The default transcription model is `gpt-4o-mini-transcribe`. Never commit `.env`.

Only private chats from the listed numeric user IDs are processed. All other updates are ignored before accessing OpenAI. There is intentionally no public-access switch.

```sh
npm run dev       # watch TypeScript sources, read .env
npm run build     # clean dist and compile production JavaScript
npm start         # run compiled JavaScript, read .env if present
```

`npm run watch` is an alias for `dev`. Production environment variables can be injected directly; no `.env` file is required. A build never copies credentials.

## Bot behavior

- Send text or a Telegram voice message.
- `/start`, `/new`, `/reset`: discard your conversation.
- `/help`: display usage and data-processing information.
- Requests for the same user/chat run one at a time. Overlapping requests, including resets, receive a busy response; they are not queued.
- Global concurrency, input length, output tokens, audio size and duration are bounded.
- Long replies are sent as plain-text chunks within Telegram limits, preserving Unicode surrogate pairs.
- Failed or incomplete OpenAI responses do not add partial turns to history.
- OGG audio goes directly to transcription: no FFmpeg, subprocesses, disk downloads, or temporary files.

## Configuration

See [.env.example](.env.example) for all settings. Missing credentials, an empty user allowlist, invalid IDs, and invalid numeric limits fail at startup. Values are never included in configuration errors.

| Setting                      | Default                  | Purpose                                      |
| ---------------------------- | ------------------------ | -------------------------------------------- |
| `OPENAI_CHAT_MODEL`          | Required                 | Responses-compatible model ID                |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | OGG-compatible transcription model           |
| `ALLOWED_TELEGRAM_USER_IDS`  | Required                 | Comma-separated user allowlist               |
| `MAX_INPUT_CHARACTERS`       | 8000                     | Text/transcript limit in UTF-16 code units   |
| `MAX_HISTORY_TURNS`          | 20                       | Complete user/assistant pairs per session    |
| `MAX_HISTORY_CHARACTERS`     | 60000                    | Retained history budget in UTF-16 code units |
| `SESSION_TTL_SECONDS`        | 3600                     | History inactivity lifetime                  |
| `MAX_SESSIONS`               | 1000                     | Maximum retained sessions                    |
| `MAX_CONCURRENT_REQUESTS`    | 10                       | Global in-flight update limit                |
| `MAX_VOICE_BYTES`            | 10000000                 | Both declared and actual audio bytes checked |
| `MAX_VOICE_SECONDS`          | 300                      | Maximum Telegram-declared duration           |
| `OPENAI_MAX_OUTPUT_TOKENS`   | 2000                     | Output-token budget per response             |
| `REQUEST_TIMEOUT_MS`         | 60000                    | Per OpenAI request/audio download timeout    |

History is process-local, bounded, and lost on restart. Expired entries are pruned when the next conversation request arrives. At capacity, the least recently completed session is evicted. Complete turns are trimmed from the beginning to stay within history limits; an oversized answer can cause its whole turn to be discarded. Input limits still apply to the current message. Limits are not an exact tokenizer-based context calculation.

## Architecture

```text
src/
  index.ts                       # composition and process lifecycle
  config.ts                      # validated environment boundary
  domain/conversation.ts         # messages and model port
  application/conversations.ts   # history, retention, complete-turn commits
  infrastructure/openai-model.ts       # OpenAI SDK adapter
  infrastructure/telegram-audio.ts # bounded HTTPS audio download
  telegram/bot.ts                 # access control, concurrency, update handlers
```

The application depends on a small model interface. SDK and Telegram types stay at infrastructure boundaries. Factories and constructors receive dependencies explicitly; importing application modules does not start polling or read credentials.

## Quality checks

```sh
npm run check          # typecheck, lint, formatting, tests, build
npm run test:coverage  # native Node.js coverage report
npm audit              # inspect known dependency advisories
```

Tests use Node's test runner, fake language models, the real Telegraf update pipeline with intercepted transport, and the real OpenAI SDK with a fake HTTP transport. They cover access control, concurrent updates, history isolation/expiry/eviction, reset, provider failures, response chunking, audio bounds, SDK request contracts, startup failures, and SIGINT/SIGTERM during startup and polling. Coverage measures exercised code paths and does not establish live provider compatibility. They do not spend API credits or contact Telegram.

TypeScript remains on 6.0.3 because the current typescript-eslint release supports TypeScript below 6.1. Node types match the supported Node 26 runtime. The `minimatch` override pins 11.0.4 to address [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in the lint dependency tree; remove it once upstream ranges accept a patched version.

CI runs a clean installation and all checks. Dependabot opens weekly dependency updates. Review model/API changes and lockfile diffs before merging updates.

## Operations and privacy

Run exactly **one polling instance per bot token**. Deploying multiple replicas creates Telegram polling conflicts and separate histories. Use `SIGINT` or `SIGTERM` for shutdown; in-flight requests have a bounded shutdown window. Pending Telegram updates are dropped at startup to avoid processing stale messages and unexpected API charges.

```sh
docker build -t chat-gpt-telegram-bot .
docker run --rm --init --env-file .env chat-gpt-telegram-bot
```

The container runs as an unprivileged user. No inbound port, database, persistent volume, or web server is required. Stop with a grace period of at least 15 seconds.

User text, retained conversation context, and audio are transmitted to OpenAI. Transcripts are returned to the Telegram chat. `store: false` disables Responses storage for retrieval; it is not a promise of zero retention by either provider. The application does not log message content, credentials, transcripts, or raw provider errors. Generic failure logs intentionally omit details that can contain bot tokens.

Set provider spending limits and monitor billing. Concurrency and per-request limits are not monetary quotas or per-user rate limits. The allowlist is intended for a trusted private bot. Durable history, multi-replica coordination, daily spending quotas, and webhook hosting require separate storage and deployment design.

For a manual live check, use a dedicated bot and account: start the bot, send text and voice, verify `/reset`, and verify an unlisted account gets no response. Automated checks cannot establish live account access, billing, model availability, or Telegram connectivity.

## Migration from 1.x

- Node 19/CommonJS → Node 26/ES modules.
- OpenAI SDK 3 → current SDK and Responses API; `OPENAI_CHAT_MODEL` is now required.
- Add the required `ALLOWED_TELEGRAM_USER_IDS` allowlist.
- Replace Yarn commands with npm and run `npm ci`.
- Production entrypoint is `dist/index.js`; run `npm run build` before `npm start`.
- `APP_PORT` and `APP_URL` are removed (this bot has no HTTP server).
- FFmpeg dependencies and the 30-second voice truncation are removed. Limits reject oversized voice messages explicitly.
- Previous unbounded/shared session behavior is replaced by isolated, bounded histories.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [LICENSE](LICENSE). Existing MIT terms and the original copyright notice are preserved.

API references: [Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), [audio transcription and supported formats](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), [Telegram Bot API](https://core.telegram.org/bots/api).
