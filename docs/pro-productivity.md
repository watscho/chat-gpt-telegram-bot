# Pro productivity release: scope and acceptance

Version: 4.1.0. This release implements seven additional workflows. All automated verification is unit-only; coverage does not establish live provider behavior, native PDF extraction quality or deployment readiness.

| Feature                    | User workflow                                                                           | Acceptance                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Edit requests and branch   | `/turns`, `/branch N \| title`, `/revise N \| replacement`                              | Copy a retained prefix into a new conversation; original history remains intact; revisions reuse original references                  |
| Project document retrieval | Reply with `/library add`, inspect with `/library find query`, ask with `/ask question` | Local project/owner-scoped ranked passages with document/page/line labels; only selected excerpts are supplied for grounding          |
| Prompt templates           | `/template save name \| body`, `/run name {"variable":"value"}`                         | Exact variable contracts, bounded expansion, explicit save/show/delete and private persistence                                        |
| Forwarded collections      | `/collect on`, forward messages, `/collect summarize`                                   | Text/captions collected without automatic paid work; bounded collection and explicit clear/off                                        |
| Settings buttons           | `/settings` or `/menu`                                                                  | Model, project, mode, voice, local budget/feature presets and context-review controls with owner/thread/expiry guards                 |
| Answer feedback            | Helpful / Needs improvement buttons, `/feedback`                                        | One replaceable vote per retained answer; explicit reasons; bounded local retention; no model call                                    |
| Inspectable context        | `/context request` or `/context on`                                                     | Snapshot preview, full text/metadata inspection, independent inclusion controls, single-use confirmation and stale-revision rejection |

## Boundaries

- Source, documentation, examples and commit messages use English. User-facing responses follow the user's requested language.
- Tests remain adjacent in `__tests__`, with 100% executable source line/branch/function thresholds and no production exclusions.
- Unit tests replace providers, Telegram transport, persistence, clocks, process/FFmpeg boundaries, PDF export and PDF extraction. No real APIs, database, worker parsing, native rendering, browser, Docker, performance or soak tests are included.
- Local retrieval uses lexical relevance rather than embeddings. It supports text PDFs and UTF-8 TXT/MD/CSV/JSON. Office documents must be exported to PDF/text for indexing; existing direct Office analysis still uses the normal document-input workflow. Scans require external OCR.
- Library limits: 500 documents/owner, 10 MB/input, 500 pages/PDF, one million extracted characters/document and 20 MB serialized indexed text/owner. Individual passages contain up to 1200 characters with 200-character overlap; up to eight matching passages are returned.
- Templates: 50/owner, lowercase names of 1..32 characters, body/expanded text up to 8000 characters. Operator input limits can be lower.
- Forward collection: 50 messages and 60000 characters/conversation; each entry at most 8000 characters. Sender identities and media bodies are not stored by collection. Existing Telegram/private-chat allowlisting remains mandatory.
- Context drafts: one per owner, ten-minute validity, total productivity-record budget 20 MB. Expired drafts are removed lazily on owner access; no exact-time deletion scheduler is promised. History text and deduplicated attachment payloads are separate controls, preventing excluded files from leaking back through historical attachments. Removing a note cannot remove mentions already present in selected history text.
- Feedback: last 200 votes/owner, stored locally with thread/answer ID, rating, reason and timestamp. No automatic training or provider submission occurs.
- Projects/library data, templates, collections and feedback have explicit lifecycles; they do not inherit conversation TTL. `/data` includes them and `/erase confirm` removes them, preserving the pre-existing minimal quota-counter exception.

## Qualification

Phases: application/storage contracts, Telegram wiring, unit failure/isolation coverage, and documentation/release validation. Completed unit evidence: 165 passing unit tests with 100% executable source lines, branches and functions. Completion also requires static checks and production compilation. No real PDF parsing, provider requests or deployment actions are authorized as tests. See the architecture and operations references for persistence and recovery limits.
