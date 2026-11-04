# Security policy

Security fixes target the current main branch. Older releases are not maintained.

Report vulnerabilities privately using GitHub's **Report a vulnerability** option if enabled for this repository. If private reporting is unavailable, contact the repository owner through the profile linked on GitHub to arrange a private channel. Do not publish exploitable details or real credentials in public issues. No response-time SLA is promised.

Include the affected commit/version, prerequisites, reproduction steps using fake credentials, expected and actual behavior, and impact. Never attach `.env`, full Telegram download URLs (they contain bot tokens), user conversations, or unredacted provider logs.

Deployment operators must restrict the Telegram user allowlist, protect provider credentials, configure spending limits, and run a single polling instance per bot token. Rotate exposed credentials at their provider immediately.
