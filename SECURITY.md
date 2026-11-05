# Security policy

Security fixes target the current main branch. Older releases are not maintained.

Report vulnerabilities privately using GitHub's **Report a vulnerability** option if enabled for this repository. If private reporting is unavailable, contact the repository owner through the profile linked on GitHub to arrange a private channel. Do not publish exploitable details or real credentials in public issues. No response-time SLA is promised.

Include the affected commit/version, prerequisites, reproduction steps using fake credentials, expected and actual behavior, and impact. Never attach `.env`, full Telegram download URLs (they contain bot tokens), user conversations, or unredacted provider logs.

Deployment operators must restrict the Telegram user allowlist, protect provider credentials, configure spending limits, and run a single polling instance per bot token. Rotate exposed credentials at their provider immediately.

The application stores conversation text, images, documents, explicit notes, project references, settings, usage aggregates, jobs and schedules in SQLite. Restrict database and backup access; the application does not encrypt them. TTL pruning occurs at startup and subsequent conversation access. Deleting local records does not delete provider copies or backups. Search queries and relevant user-provided context may reach external providers. Protect the configured FFmpeg executable and its path; it is executed without a shell with fixed arguments.

Daily local limits use configurable estimates rather than provider billing. Set provider-side budgets independently. Failed and cancelled paid attempts keep reservations. Local `/erase confirm` deletes owner content/settings/jobs/schedules but preserves minimal UTC-day usage aggregates to prevent quota bypass; these roll over lazily on next usage access. Conversation TTL does not expire project files or job snapshots/results. Users must remove those explicitly. Stop/delete races are guarded against local result resurrection, but cancellation cannot undo completed provider processing or Telegram delivery.

Automated verification consists only of isolated unit tests. Native SQLite durability, provider behavior, FFmpeg output and PDF font/layout are not certified by the coverage report. Do not add costly or external-service tests to CI.

Productivity state contains reusable prompt text, collected forwarded text/captions, feedback metadata, context snapshots and extracted library passages. Protect it like conversation history. Local indexing does not send complete library documents to providers; `/ask` sends retrieved passages alongside the selected conversation/project context. `/context` can inspect/exclude these inputs. Forward collection requires explicit opt-in and never automatically summarizes; its text and retrieved excerpts are untrusted content. Removal from a single request does not erase previous answers or text quotes. Context snapshots expire lazily on access and must be explicitly cancelled/erased for immediate local removal. Feedback is local and is not automatically submitted for model training.
