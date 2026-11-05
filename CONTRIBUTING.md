# Contributing

Use the Node version in `.nvmrc`, install with `npm ci`, and copy `.env.example` for a local bot only if needed. Automated tests need no credentials or live services. Install FFmpeg with libopus for native encoder checks; CI installs it explicitly.

Keep domain/application logic independent of Telegram and OpenAI SDKs. Add behavior tests for changes involving state, error handling, limits, or provider contracts. Use injected transports to keep tests offline. Put tests beside their implementation in `__tests__`; shared support belongs in `src/__tests__`. Require 100% lines, branches and functions across executable `src`; exclude tests/fixtures only. Do not lower thresholds or add coverage-ignore comments. See `docs/architecture.md`.

Before opening a pull request:

```sh
npm run check
npm run test:coverage
npm audit
```

Describe the changed behavior, migration impact, and validation performed. Commit the updated npm lockfile with dependency changes. Do not include tokens, `.env`, private messages, or raw provider errors in code, fixtures, logs, or issues.

Contributions are provided under the existing MIT license. See `SECURITY.md` for private vulnerability reporting.
