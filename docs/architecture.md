# Architecture and test conventions

## Boundaries

```text
src/
  index.ts                      composition, polling and shutdown
  config.ts                     validated environment settings
  domain/
    conversation.ts             messages, media, sources and model port
    state.ts                    profiles, sessions and persistence port
    speech.ts                   narration port
  application/
    conversations.ts            history/TTL/budgets and complete-turn commits
    profiles.ts                 conversation selection, explicit notes, voice preferences
    sources.ts                  safe source deduplication and citation rendering
  infrastructure/
    openai-model.ts             Responses, files, web/image tools and transcription
    realtime-speech.ts          bounded Realtime audio collection
    voice-encoder.ts            fixed-argument PCM -> OGG/Opus pipe
    state-store.ts              SQLite schema and transactional replacement/eviction
    telegram-file.ts            bounded HTTPS downloads from Telegram only
    telegram-audio.ts           voice-specific downloader adapter
    images.ts                   image signatures, types and size checks
    documents.ts                document format/signature/UTF-8 checks
  telegram/
    bot.ts                      access, concurrency, album collection, commands and delivery
```

Each source directory contains its own `__tests__` directory. `src/__tests__/helpers.ts` contains shared fake models/config; `src/__tests__/fixtures` contains process-only fake Telegram transport. Keep new tests adjacent to the source they exercise. Do not put application test files in a separate root `tests/` tree.

Domain and application code do not import Telegram/OpenAI SDK types. Provider and downloader behavior is injected at the bot boundary; speech transport and encoder can be injected independently. Importing application modules neither reads credentials nor starts polling. Only the entrypoint constructs the production database, provider clients and polling process.

## Request lifecycle

1. Reject non-private or unlisted users before provider/file access.
2. Hold one user/chat lock across conversation switches, commands and requests; apply a global handler cap. Album updates share a bounded collection window under the same lock.
3. Execute explicit conversation/memory/voice commands locally. Ordinary messages cannot silently create saved notes.
4. Validate and download attachments through HTTPS Telegram-origin checks, redirect rejection, streaming byte caps and a shared batch deadline.
5. Select the user's active conversation, prune expired/old history, attach explicitly selected files and supply saved notes as user-level preferences.
6. Call Responses with `store: false`. Search/image tool budgets and output tokens are bounded. Parse safe source annotations and validated images.
7. Commit complete turns and capacity evictions to SQLite before replacing in-memory state. Source lists stay in history for follow-up provenance. Generated images are reattached as labelled reference inputs for stateless subsequent edits.
8. Deliver plain-text Unicode-safe chunks, numbered sources and original PNG files. Optionally narrate a bounded answer. Narration failure preserves text and history.

Speech uses one short-lived Realtime connection per request, gathers 24 kHz mono PCM from audio delta events, rejects failed/incomplete/oversized responses, closes the connection, then pipes PCM to FFmpeg/libopus within the remaining deadline. Neither audio stage needs temporary files. FFmpeg receives fixed arguments and no shell command or user-controlled URLs.

## Test and coverage policy

`npm test` discovers `src/**/__tests__/*.test.ts`. `npm run test:coverage` enforces **100% line, branch and function coverage** across executable `src/**/*.ts`. Only `src/**/__tests__/**` is excluded from measurement. Do not add coverage-ignore annotations or lower thresholds to make a change pass. Interfaces have no runtime instructions to measure.

Use behavior assertions for isolation, state transitions, failure recovery, limits and provider contracts. The suite includes focused units plus offline integration tests for the actual SDK, Telegraf pipeline, SQLite, process lifecycle and FFmpeg. Network access and real credentials are unnecessary. Lifecycle tests run child processes with a test-only Telegram transport; shortened timers in that fixture exercise the real shutdown-deadline branch without waiting ten seconds.

Production compilation excludes every `__tests__` directory. CI runs the coverage gate separately from the standard checks and builds the same production output used by Docker. Coverage proves exercised control flow, not correctness of external model answers or availability of a user's account.
