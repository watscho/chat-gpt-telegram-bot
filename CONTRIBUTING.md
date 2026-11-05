# Contributing

Use Node from `.nvmrc` and npm from `package.json`; install with `npm ci --ignore-scripts`. Automated checks need no credentials, live services or FFmpeg. Copy `.env.example` only when intentionally running a local bot. Repository source, comments, documentation, examples and commit messages use English.

Keep domain/application logic independent of Telegram/OpenAI SDK types. Add adjacent behavior-focused unit tests in `__tests__` for state, failures, ownership, cancellation, limits and provider contracts. Shared controlled doubles belong in `src/__tests__/helpers.ts`. Only unit tests are permitted: mock network, filesystem/database constructors, clocks, process lifecycle, PDF rendering and FFmpeg spawning. Never add live API, application subprocess, native database/encoder, browser, Docker, integration, performance or soak tests.

Require 100% executable source lines, branches and functions. Exclude tests only; do not lower thresholds or add coverage-ignore annotations. See [architecture and conventions](docs/architecture.md).

Before opening a pull request:

```sh
npm run check
npm run test:coverage
```

These run static checks, unit tests and TypeScript compilation. `npm audit` is a separate network-backed dependency advisory query, not a unit test. CI includes it; do not substitute advisory results for runtime qualification.

Describe changed behavior, migration impact and the checks actually performed. Update user/configuration/operations documentation and `CHANGELOG.md`; keep package and lockfile versions aligned. Commit lockfile changes with dependencies. Never include credentials, private messages, real user files or raw provider errors in fixtures, logs or issues. Do not claim live/native/deployment acceptance from unit coverage.

Contributions use the existing MIT license. See [security policy](SECURITY.md) for private reporting.

## UI translation resources

English is the source language for code, comments, documentation and commits. Deliberately multilingual values belong only in `src/telegram/locales/messages.json`. Keep Russian/Spanish English-key catalogs and placeholder sets aligned; preserve commands, IDs and quoted/model content. Unknown UI messages fall back to English. Unit tests enforce catalog parity; production builds must include the JSON resources. Add language/control-flow coverage using controlled local doubles, never paid translation/provider calls.
