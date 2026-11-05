# Contributing

Current release: **12.0.0**.

Use Node from `.nvmrc` and npm from `package.json`; install with `npm ci --ignore-scripts`, then run `npm run hooks:install`. Automated checks need no credentials, live services or FFmpeg. Copy `.env.example` only when intentionally running a local bot. Repository source, comments, documentation, examples and commit messages use English.

Keep domain/application logic independent of Telegram/OpenAI SDK types. Add adjacent behavior-focused unit tests in `__tests__` for state, failures, ownership, cancellation, limits and provider contracts. Shared controlled doubles belong in `src/__tests__/helpers.ts`. Only unit tests are permitted: mock network, filesystem/database constructors, clocks, process lifecycle, PDF rendering and FFmpeg spawning. Never add live API, application subprocess, native database/encoder, browser, Docker, integration, performance or soak tests.

Require 100% executable source lines, branches and functions. Exclude tests only; do not lower thresholds or add coverage-ignore annotations. See [architecture and conventions](docs/architecture.md).

Before opening a pull request:

```sh
npm run verify
```

`npm run verify` is shared by CI and the tracked pre-push hook. It runs type/lint/format and release-documentation consistency checks, adjacent unit tests, production compilation, the 100% executable-source coverage gate and `npm audit --audit-level=high`. Audit is a network-backed dependency advisory query, not a unit test; it does not call a paid model or establish runtime qualification.

The hook requires the outgoing commit to match checked-out HEAD and a clean tracked/untracked worktree. It installs the committed lockfile with `npm ci --ignore-scripts --no-audit --no-fund`, runs verification, then rechecks HEAD/worktree before allowing the push. Commit or stash changes before pushing; switch to the branch you intend to push. Deletion-only pushes contain no outgoing code and skip the validation pipeline. Failed installation, unavailable audit metadata, failed checks or changed state block the push. Do not bypass the hook to publish a failing release.

Ordinary npm installation runs `prepare` to install `.githooks` through repository-local `core.hooksPath`. Installs using `--ignore-scripts` require the explicit `npm run hooks:install` step. The installer preserves an existing different hooks path or existing default hooks and asks you to integrate this pre-push command deliberately. Git archive/non-worktree installs skip hook setup. The hook uses the repository's Node 26 requirement and native TypeScript loading; no additional hook dependency is installed. Hook behavior has adjacent unit tests with mocked Git/npm/filesystem ports; no application subprocess, network or paid-provider test is added.

Describe changed behavior, migration impact and the checks actually performed. Update user/configuration/operations documentation and `CHANGELOG.md`; keep package and lockfile versions aligned. Commit lockfile changes with dependencies. Never include credentials, private messages, real user files or raw provider errors in fixtures, logs or issues. Do not claim live/native/deployment acceptance from unit coverage.

Contributions use the existing MIT license. See [security policy](SECURITY.md) for private reporting.

## UI translation resources

English is the source language for code, comments, documentation and commits. Deliberately multilingual values belong only in `src/telegram/locales/messages.json`. Keep Russian/Spanish English-key catalogs and placeholder sets aligned; preserve commands, IDs and quoted/model content. Unknown UI messages fall back to English. Unit tests enforce catalog parity; production builds must include the JSON resources. Add language/control-flow coverage using controlled local doubles, never paid translation/provider calls.

## Daily workflow contracts

New workflow tests remain adjacent unit tests. Mock DNS/HTTPS transport and assert public-address policy, pinned lookup behavior (single/all address forms), redirect/byte/type/cancellation limits and malformed text extraction without live URL requests. Task proposals must remain inert until a bound confirmation; use atomic task-record writes and stable token-derived IDs. Test context-review intent propagation, legacy template syntax, stale callbacks, allowlists and morning attempt-before-effect behavior. Do not add network, browser, native DB, performance or integration qualification to this workflow.

## Provider workflow qualification

Provider changes require adjacent unit tests with fake provider/HTTP/media ports and the existing 100% executable-source gate. Do not introduce paid API, native microphone/browser, SQLite/decoder or deployment tests into the unit suite. Operator acceptance and credentials are separate; document unqualified external behavior in [the provider guide](docs/pro-provider.md).

## Studio regression contract

Keep Studio lifecycle, provider execution, HTTP and browser-port tests adjacent and unit-only. Preserve the 100% executable source gate; cover claim-write/result-write failures, restart/cancel races, exact approvals, sparse sources/files, edited-draft continuation, stale model estimates, owner/revision checks and dirty-editor refresh races. UI contract tests use controlled DOM/fetch objects and do not qualify native rendering. [Studio qualification](docs/pro-studio.md) records the external acceptance boundary.

## Release consistency

`package.json` is the release-version source. Keep the root lockfile entries, latest changelog entry and exactly one `Current release: **VERSION**.` declaration in README, contributing/security guidance and every Markdown guide under `docs/` synchronized. Guide titles stay unversioned; explicitly historical introduction counts, changelog records, database/archive schemas, dependency versions and migration instructions keep their own original numbers. `npm run docs:check` enforces release declarations and README capability/area totals before unit checks and before push.

Daily routine changes must preserve explicit material selection, inert paid plans, separate exact local acceptance, integer currency arithmetic, source attribution, scoped expiring card/review tokens and claim-before-delivery behavior. Add adjacent unit tests with synthetic XML and mocked service/state/DOM/transport ports; do not add network, browser, native database, integration or paid provider tests. Keep the [complete feature catalog](README.md#complete-feature-catalog), [daily routines guide](docs/pro-routines.md), current-release declarations and changelog synchronized.

Personal workspace changes must preserve exact range/revision acceptance, independent table snapshots, plain-text rendering, source/tool grants, sealed connection credentials, one-use OAuth/PKCE state and reviewed live actions. Browser policy checks do not replace remote driver isolation. Keep tests adjacent and isolated with state/model/network/RTC/DOM doubles and synthetic CSV/PNG bytes; do not add real provider/browser/native image/database/integration acceptance runs. Build both browser bundles and keep [workspace documentation](docs/pro-desk.md), catalog and release declarations synchronized.
