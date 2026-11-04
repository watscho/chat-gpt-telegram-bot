# Changelog

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
