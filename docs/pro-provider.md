# Provider workbench

Current release: **11.0.0**.

The provider workbench supports five opt-in workflows to the existing private bot. `/pro` is the entry point. Pro names repository features; API billing, model access, MCP accounts and public HTTPS hosting are separate operator responsibilities. Startup does not verify provider acceptance.

## User paths

| Goal                             | Start                                                                   | Review and result                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Analyze data with Python         | Attach/reply to CSV, XLSX, JSON, TXT, MD or PDF with `/analyze [focus]` | Inspect context and configured estimate, then Send. Receive an answer and up to five downloadable supported artifacts.                     |
| Search a project semantically    | `/project new Research`, reply to a file with `/knowledge add`          | Confirm upload; use `/knowledge status` until ready, then `/knowledge ask question` and review context.                                    |
| Use an external service          | `/connections`, then `/connect mail \| Find the draft`                  | Review context/cost, then separately inspect each exact tool name and JSON arguments. Approve or reject the proposed actions.              |
| Talk live                        | `/live`, open the Mini App                                              | Check estimate/project and mode, press Start, allow microphone. End session, mute or interrupt explicitly.                                 |
| Turn a recording into a protocol | Reply to audio with `/meeting` (or use an audio caption)                | Confirm transcription/protocol estimate. Receive a transcript file and structured protocol/task proposals. Confirm local tasks separately. |

Do not confuse `/knowledge` with `/library`: `/library` is local extracted-text retrieval; `/knowledge` explicitly uploads documents to OpenAI. One cloud library belongs to one owner and project. Completed, unexpired file IDs are checked locally before any search result enters model context. Indexing is not polled automatically: `/knowledge status` retrieves readiness. Expired or failed items need explicit removal/re-upload. Use `/knowledge remove FILE_ID confirm` or `/knowledge clear confirm` to detach references and queue provider deletion. Answers already retained locally remain until their own deletion/expiry.

Analysis accepts one to ten distinct files and uses an explicit 1 GB Code Interpreter container with networking disabled, up to three tool calls, and the configured output-token limit. Downloads are bounded per file and in aggregate; allowed artifacts are CSV, JSON, XLSX, PNG, PDF, TXT and MD. Generated files are retained as conversation attachments under existing history limits. Code execution is at the provider; the bot does not execute model-generated code locally.

External-service requests do not automatically attach documents or chat history. Reviewed saved notes/instructions/references can still reach the model and selected service; inspect the preview. Every MCP tool uses `require_approval: always`, including reads. Approval is bound to owner, conversation and answer revision for ten minutes, consumed before continuation, and invalidated if the configured endpoint, tools or authorization changes. A provider may propose another action requiring another confirmation. Uncertain failures are never retried automatically; check the external service before trying again.

## Operator setup

Use a persistent `STATE_DB_PATH` (not `:memory:`). The normal composition supplies the OpenAI workbench automatically with your existing `OPENAI_API_KEY`. Configure the models and conservative cost estimates in `.env.example`; these are reservations, not measured invoices or hard provider spending caps. Owner and selected-project daily budgets apply to paid calls. Each live session reserves its full configured duration before the provider call; a shorter session does not refund that estimate. Limit account spending separately at the provider.

### Authenticated MCP services

`OPENAI_MCP_CONNECTIONS` is a JSON array of operator-trusted remote MCP endpoints. It is empty by default. Each item grants one Telegram user only an explicit tool allowlist:

```dotenv
OPENAI_MCP_CONNECTIONS='[{"id":"mail","owner":123456789,"title":"Work mail","server":"https://mcp.example.com/mcp","tools":["search_messages"],"authorization":"REPLACE_WITH_SERVER_AUTHORIZATION_VALUE"}]'
```

The endpoint must be public HTTPS, without credentials, query strings, fragments, custom ports or IP-literal/local-looking hostnames. OpenAI connects to that operator-selected endpoint; this is not the public article reader's DNS-pinned fetch path. Supply the authorization value expected by that MCP server through protected environment/secret management. Never send tokens in Telegram or commit them. Restart after changes. Gmail, Calendar and Drive require an appropriate authenticated MCP server and its account setup; this release does not provide a built-in Google OAuth/login flow or automatic service discovery. Tool names must match that server's schema. Legacy `connector_id` is deliberately unused.

### Live voice Mini App

1. Build with `npm run build`; the server loads the compiled browser modules from `dist/web`. Rebuild after changes even when using `npm run dev` with the Mini App enabled.
2. Set `MINI_APP_URL=https://voice.example.com/voice/` and optionally `MINI_APP_PORT=8787`.
3. Publish that exact path and its static/API children through an HTTPS reverse proxy to `127.0.0.1:8787`. Preserve paths, JSON bodies and `X-Telegram-Init-Data`. Do not log request headers/bodies. The Node server intentionally binds to loopback.
4. Restart the bot, use `/live` in its private chat, then open the Telegram Web App button. Ordinary browser visits cannot authorize paid access.

The Mini App validates signed Telegram `initData`, age and allowlist server-side; it never receives the OpenAI key. Microphone access starts only on Start. The server creates the WebRTC call with fixed model/voice, no tools and no supplied Telegram history, files or notes. Modes are conversation, language practice and interview rehearsal. The visible interface is English; conversation answer language follows the selected chat preference. Transcript events, when supplied, remain on the current screen and are capped at 40 elements. Audio/transcripts are still processed by OpenAI; browser-only display does not imply provider non-retention.

Ending stops browser tracks and requests provider hangup. A server-owned deadline and durable call journal request cleanup after timeout/restart; only one active or uncertain call per owner is allowed. Provider/network failures can delay hangup, so `LIVE_MAX_SECONDS` and estimates are not guaranteed provider billing caps. Clients with control over their data channel are not a trusted model-configuration boundary. No automatic paid reconnect occurs. `/cloud_cleanup` shows outstanding IDs; `/cloud_cleanup retry` rearms failed/due cleanup without ending an unexpired live call.

### Meeting audio

Accept MP3, M4A, WAV, OGG or WebM recordings within `MAX_MEETING_BYTES` and `MAX_MEETING_SECONDS`. Metadata is reviewed before download; the downloaded signature is checked before transcription. Unknown duration reserves the configured maximum. No decoder verifies the actual duration locally: the byte bound is enforced, while a missing or inaccurate Telegram duration cannot establish a hard duration/billing cap. Original audio is not written to the local state store by this workflow. The transcript and generated protocol can be retained in history/exports.

Normal `/meeting` uses `OPENAI_MEETING_MODEL=gpt-transcribe` and never invents speakers. `/meeting speakers` requires an explicit `OPENAI_DIARIZATION_MODEL`. The documented `gpt-4o-transcribe-diarize` is deprecated with shutdown scheduled for **2027-02-26**; it is intentionally disabled by default. Enable only with verified account access and a migration plan. Provider speaker labels are not verified identities. Transcript errors, inferred tasks and deadlines need human review; no task is created before the separate task confirmation.

## Retention, cleanup and portability

- Analysis uploads request a one-hour file expiry; explicit containers request a 20-minute last-active expiry. Success/failure cleanup is attempted immediately.
- Knowledge file uploads request seven-day expiry and vector stores seven days since last activity. Local retrieval rejects file references older than seven days regardless of provider search output. Each project allows 20 cloud files within the owner's configured project-byte budget.
- Provider operations are not atomic with local persistence. Unknown IDs after lost acknowledgements or failed journal writes may rely on requested provider expiry; live call creation has best-effort hangup on malformed SDP. These controls do not prove immediate remote erasure.
- The cleanup journal persists only resource IDs, type, attempt/deadline metadata and a hashed owner key. It claims attempts before deletion, retries at most three times with a 60-second interval, and retains unresolved records for operator inspection/retry. Hashing is pseudonymization, not encryption.
- `/erase confirm` stops known live calls, retires remote references and deletes local content. Minimal cleanup IDs deliberately survive until deletion acknowledgement; remote retention/backups and operator backups are separate. `/reset`/conversation deletion invalidates pending provider approvals and recording previews but does not delete a project's cloud library.
- Private exports include provider workspace metadata and the owner's cleanup records, but never environment credentials. These exports may contain sensitive approval arguments/continuation state. Archive import does not adopt source provider IDs, tool approvals, recording previews or live sessions; destination provider state remains authoritative. Schema stays 3, archive format stays 2. Keep a pre-upgrade backup; complete remote cleanup before rollback because older code will not process these records.

## Qualification

Adjacent unit tests cover adapters with fake fetch/SDK responses, scoped retrieval, approval replay and destination changes, failure cleanup, quota reservations, Telegram handlers, signed Mini App requests, HTTP routing with a fake server, browser controller races with injected ports, and recording protocol review. Tests do not open real sockets, microphones or browser sessions, run native decoders/SQLite/PDF parsers, or call paid providers. Static type/lint/format/build checks qualify the bundled source, not a deployment or provider/account acceptance. Public HTTPS, microphone/WebRTC interoperability, MCP service behavior and live model access remain operator setup/acceptance work.

References: [Code Interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter), [File Search](https://developers.openai.com/api/docs/guides/tools-file-search), [MCP](https://developers.openai.com/api/docs/guides/tools-connectors-mcp), [transcription](https://developers.openai.com/api/docs/guides/transcription), [Telegram Web App validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

## Studio integration

[Pro Studio](pro-studio.md) composes these adapters into durable reviewed missions and adds a workspace under the same HTTPS Mini App base. Existing cleanup, account-access, cost and remote-effect limitations still apply. The workspace does not require live voice activation or microphone permission.
