# Pro Suite: twenty-workflow acceptance contract

Current release: **10.0.1**.

Status: implemented; introduced in version 10.0.0; unit/static qualification is recorded below. This matrix consolidates the twenty approved follow-up capabilities. Existing Studio/provider workflows are reused; a recipe name alone is not completion evidence. Final qualification remains adjacent unit/static checks only, with no paid, native-media, browser, integration or deployment acceptance runs.

| #   | Capability                    | Required usable behavior                                                                                                  | Phase |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Owner-wide work search        | Search owned messages, notes, projects, library excerpts, Inbox and results; open a scoped, attributed source             | B     |
| 2   | Change monitoring             | Explicit public-URL/project-file subscriptions, bounded intervals, baseline/diff inspection and claim-before-notification | B     |
| 3   | Branded documents             | Reviewed reusable branding/templates, real DOCX/PPTX/PDF artifacts with sources and editable content                      | A/C   |
| 4   | Travel assistance             | Reviewed booking/ticket extraction, saved itinerary, source references and explicit reminders                             | C     |
| 5   | Continuing learning           | Saved topic/progress/errors, exercises, reviewed answer feedback and next practice                                        | C     |
| 6   | Shared projects               | Explicit invitations/acceptance, reader/editor roles, scoped files/tasks/notes, revocation and audit history              | D     |
| 7   | Conversation rehearsal        | Owned scenarios and turn history, text/voice input, reviewed counterparty replies and feedback                            | C     |
| 8   | Purchase analysis             | Comparable offer/currency/conditions/missing-cost evidence, uncertainty and reusable result artifacts                     | C     |
| 9   | Pre-send review               | Check selected content/attachments against contradictions, promises and quality criteria; review exact changes            | C     |
| 10  | Video/screencasts             | Reviewed bounded clips, sampled timestamped frames and optional audio transcription; no claim to unsampled coverage       | A/C   |
| 11  | Meeting preparation           | Selected owned correspondence/materials into a sourced agenda, prior commitments and open questions                       | C     |
| 12  | Repurposing                   | One reviewed source into several separately named output formats with preserved attribution                               | C     |
| 13  | Personal quality criteria     | Explicit owner/project rules, frozen into plans and inspectable criterion assessments                                     | B/C   |
| 14  | Annotated screenshot guidance | Reviewed region/action extraction and a real annotated artifact preserving original image content                         | A/C   |
| 15  | Decision journal              | Owned decisions, reasons, alternatives and source quotes, with inspection/search/history                                  | B/C   |
| 16  | Form assistance               | Extract fields, ask for missing values, accept explicit answers and export a filled review document                       | C     |
| 17  | ZIP organization              | Bounded archive validation, preview names/groups/duplicates and export an organized archive                               | A/C   |
| 18  | Commitment tracking           | Exact quoted evidence, reviewed actors/promises/deadlines and opt-in local reminders                                      | B/C   |
| 19  | Independent model review      | Explicitly different configured model, separate estimate/approval and visible disagreement report                         | C     |
| 20  | Complete workflow recipes     | Versioned multi-step recipes with variables, current-material selection and fresh cost/context approval                   | B/C   |

## Stages

A. Build bounded archive/document/media artifact ports and unit contracts.
B. Build private knowledge/preferences/recipe state, search and change subscriptions.
C. Connect typed workflow recipes and durable reviewed application paths to Studio; preserve quotas, cancellation and uncertain-outcome handling.
D. Add shared-project authority independently from private owner state, with explicit grants and immediate revocation.
E. Extend Telegram/Mini App navigation, lifecycle documentation and release qualification; update the version/changelog and publish only after checks pass.

## Non-negotiable boundaries

- English source, comments, documentation and commit text; multilingual user content remains unchanged.
- Only adjacent unit tests in `__tests__`; 100% executable source lines, branches and functions, without lowered thresholds or coverage-ignore annotations.
- Model access, artifact rendering/native media and public HTTPS acceptance are separate from unit/static source qualification.
- No automatic external writes or uncertain paid retries; proposed actions retain explicit cost/context and exact tool approvals.
- Private search excludes other owners' private records; collaboration reads/writes require a current grant and do not imply access to private conversations.
- Input files, drafts, extracted claims, model assessments and tool output are untrusted. Geometry, transcription, factual support and template fidelity require human review.
- Reset/delete/erase/import/export and source/approval expiry must be documented and tested for the new state scopes.

## Start in Telegram

Run `/suite` for the directory. A workflow creates a Studio draft; it does not start a model request. Inspect its steps, model, parameters, frozen materials and configured remaining estimate. `/mission context ID` downloads the frozen input and step specifications without provider continuation credentials. Approve the plan in Telegram or the authenticated workspace. Retrieve the final text/files with `/result ID`, and an intermediate artifact with `/mission step ID NUMBER`.

For source-based work, run `/suite search distinctive keywords`, then `/suite select SOURCE_ID`. `/suite sources` downloads the exact selected excerpts; `/suite clear` removes the selection. Search is local keyword/prefix ranking, not embeddings or a semantic completeness guarantee. It includes retained messages/recaps, saved notes, project notes and UTF-8 text/JSON files, indexed library passages, tasks, bookmarks, Inbox text, result revisions and Suite records. Non-indexed binary documents are not searched automatically. Opening a search result rechecks the current owner's retained corpus. Selection retains an explicit excerpt copy until cleared or erased.

Replying to a text supplies that passage as an explicit source. Replying to a photo/document supplies that attachment. Current project and retained conversation attachments also appear in the plan; download its context before approval to inspect the exact snapshot. Source passages, files and generated text remain untrusted evidence.

| Workflow            | Command                                                   | Result/review                                                                                                                 |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Branded document    | `/suite brand TEMPLATE docx                               | pptx                                                                                                                          | pdf \| goal`                                                                                                                    | Editable document/slides or PDF, actual tables, preserved reference images and a selected-source ID list; `default`/`docx` may be omitted |
| Travel              | `/suite travel \| organize these bookings`                | Booking/date/location/action rows; accept an itinerary record after checking time zones and source facts                      |
| Learning            | `/suite learn \| teach me a topic`                        | One lesson/exercise and retained feedback/mistakes after acceptance                                                           |
| Rehearsal           | `/suite rehearse \| scenario and counterpart role`        | Fictional counterpart turn and feedback, with retained accepted turns                                                         |
| Purchase            | `/suite purchase \| compare these supplied offers`        | Price components, conditions and risks; deterministic integer minor-unit total only when all components/currency are supplied |
| Pre-send review     | `/suite sendcheck \| intended audience and message`       | Findings, evidence and suggested changes; no message is sent                                                                  |
| Recorded video      | `/suite video START_SECONDS yes                           | no \| goal` while replying to MP4/MOV/WebM                                                                                    | Timestamped sampled frames, optional clip transcription and `video-evidence.zip`; `yes` explicitly requests audio transcription |
| Meeting preparation | `/suite brief \| meeting purpose`                         | Agenda, context, questions and decision gaps from selected owned sources                                                      |
| Repurposing         | `/suite repurpose \| adapt this source`                   | Separate email/status/post/brief/checklist Markdown files and a ZIP, with source IDs; no publishing                           |
| Quality             | `/suite quality \| check this draft`                      | Criterion-by-criterion model assessments; first add explicit criteria                                                         |
| Screenshot          | `/suite screen \| explain the next steps` with PNG/JPEG   | SVG embedding unchanged original pixels, reviewed regions/actions; geometry is an estimate                                    |
| Decisions           | `/suite decision \| extract decisions`                    | Exact-quote/source-validated proposed journal rows                                                                            |
| Forms               | `/suite form \| identify fields and propose known values` | Reviewed field record, missing-field questions and explicit corrections                                                       |
| Commitments         | `/suite commitment \| extract explicit promises`          | Exact-quote/source-validated actors/actions/deadlines; no automatic reminders                                                 |
| Model review        | `/suite models`, then `/suite referee MODEL \| question`  | First answer plus a separately estimated different configured model's critique/disagreements                                  |

Travel and purchase workflows use supplied evidence. They do not establish current prices, availability, legal requirements or schedules. Use the existing explicit `/investigate` public research workflow for a current public question, then select the resulting evidence deliberately. Structured model output establishes shape, not factual accuracy. Decision/commitment quotes must be literal substrings of selected source excerpts; that does not authenticate the source author's real-world identity.

## Records and continuing sessions

Record-producing workflows end in a ten-minute local preview. `/suite confirm TOKEN REVISION` accepts its exact rows in the source conversation/project; acceptance creates no reminder or external write. A stale record revision rejects rather than overwriting newer progress. `/suite review MISSION_ID` reopens a completed record workflow's expired/replaced preview locally from its retained model result. It makes no new model call. An already accepted initial workflow cannot create a duplicate record; accepted session updates invalidate old revisions.

- `/suite records` lists records; `/suite record ID` downloads the record, sources and up to ten prior row revisions.
- `/suite session ID` explicitly selects a course/rehearsal/form for the next text or voice-transcribed answer. The listener expires after ten minutes and consumes one answer. Learning/rehearsal feedback becomes a fresh paid plan requiring approval and subsequent record acceptance. Accepted rows retain previous mistakes/turns, capped at 100 rows. `/suite stop` stops listening.
- Forms ask for one missing field at a time. `/suite answer ID FIELD | value` stores an explicit reviewed correction. `/suite session ID` asks for the next missing value. `/suite export ID docx|pptx|pdf` exports a reconstructed review document, not an original PDF's coordinates/AcroForm layout and not a submitted form.
- `/suite remind ID ROW_NUMBER` enters the existing separate task/deadline review. Check exact date, time zone and task text before confirming. `/suite delete ID` removes the record and retained row history.

Voice input follows the existing incoming transcription quotas/approval policy. It is not a continuous live rehearsal call. For narration, copy a reviewed counterpart passage into `/speak text`; existing live modes remain separate. Model scores and feedback are coaching assessments, not verified qualifications.

## Brand templates and quality rules

`/suite brand-template set NAME | brand | HEX_COLOR | font | footer | heading...` saves editable values. `/suite brand-template import NAME` while replying to DOCX/PPTX extracts a bounded palette, font and heading sample. It does not copy pixel-perfect layout, macros or embedded objects. Inspect with `/suite brand-template show NAME`; list/remove with `/suite brand-template` and `/suite brand-template remove NAME`. Plans bind the template revision; edits require a fresh document plan.

Documents allow 1..20 sections, at most 16,000 heading/body characters and bounded images/output bytes. Presentations stop above 32 slides. Invalid Markdown tables remain text; valid tables have 2..30 rows, up to eight columns and 300 characters/cell. PDF supports the bundled Latin/Greek/Cyrillic/punctuation font range; choose DOCX/PPTX for other scripts. Screenshot and preserved-image artifacts accept PNG/JPEG dimensions up to 8192 per side and 16 megapixels; WebP conversion is not performed silently.

`/suite quality-rule add global|project | label | check` saves a rule; project rules apply alongside global rules. `/suite quality-rule` lists current rules; `/suite quality-rule remove ID` deletes one. Plans freeze applicable rules in their input. `/suite quality` returns model assessments against them, not certification.

## Change monitoring

- `/suite watch url PUBLIC_HTTPS_URL HOURS THRESHOLD_PERCENT` subscribes to an unauthenticated public page.
- `/suite watch file PROJECT_ID HOURS THRESHOLD_PERCENT | filename` watches an owned project attachment's content digest/metadata. It does not re-download an upstream original or send a binary file to a model.
- `/suite watch` lists subscriptions; `show|check|on|off|remove ID` inspects or controls one. `show` downloads baseline/diff/error state; `check` forces a bounded read.

Persistent state is required. Limits: ten watches/owner, one hour to seven days between scheduled checks, threshold 0..100%. The first successful read establishes a baseline. Changes below the threshold accumulate against the last accepted baseline. A material change retains a bounded diff and claims notification before transport. Delivery failures are not retried automatically. Quiet periods suppress proactive watch messages; inspect retained changes manually afterward. Reads compare the readable page excerpt (up to 20,000 characters), using the existing DNS-pinned public HTTPS reader and its SSRF/redirect/byte/time bounds, with no model call. Changes outside that excerpt are unobserved. An enabled subscription authorizes repeat public page requests; disable/remove it to stop. Deleted project files produce a retained error rather than silently changing targets.

## Explicit shared projects

Shared projects require persistent state and private allowlisted identities. A member gets access only to deliberately published shared content, never another member's personal conversations/projects/search corpus.

1. `/suite team create | title` creates a separate space. `/suite team` lists accessible spaces and syntax.
2. Owner: `/suite team invite TEAM USER_ID reader|editor`. Recipient: `/suite team invitations`, then `/suite team accept TEAM TOKEN`. Invitations are targeted, single-use and expire in ten minutes. The bot sends no invitation message on your behalf.
3. `/suite team publish TEAM | note` optionally while replying to a file previews exact content, recipients and current shared revision. `/suite team confirm TOKEN REVISION` consumes the ten-minute preview, rechecks editor authority/revision and publishes only those files/notes.
4. `/suite team show TEAM`, `file TEAM FILE_ID`, `remove TEAM CONTENT_ID`; `task TEAM ASSIGNEE_ID_OR_none | title`; `done TEAM TASK_ID` inspect/manage shared work. Readers cannot write. Assignments do not automatically notify anyone.
5. Owner: `role TEAM USER_ID reader|editor`, `revoke TEAM USER_ID`; member: `leave TEAM`; owner: `close TEAM confirm`. Revocation applies on every subsequent read/download/write, including Mini App file requests. Already downloaded copies cannot be recalled.

Each space has a bounded audit of actor/action/target, with no credential or invitation-token exposure in snapshots. Limits: ten owned spaces, 20 members/invitations/files, 100 notes/tasks and 100 audit events per space; shared file data across owned spaces has its own aggregate bound using the configured project byte ceiling. Publishing never imports personal conversation history automatically.

## ZIP organization and recipes

Send a ZIP, then reply with `/suite zip` (or use that caption). Preview proposed groups/names, byte counts and exact SHA-256 duplicates. `/suite zip rename TOKEN REVISION ENTRY | safe-basename.ext` creates a new review revision. `/suite zip confirm TOKEN REVISION` exports nonduplicate entries plus a manifest accounting for omitted duplicates. Previews expire in ten minutes. Nothing is extracted to disk or executed. Invalid/traversal/ambiguous paths, symlinks, encryption, unsupported compression, duplicate normalized names, excess entries and expanded-byte overflow reject before allocation/decompression. Classic ZIP methods store/deflate are accepted, with checksum verification. An unambiguous end record and declared entry cap are checked before native metadata construction; collapsed duplicate names reject by count mismatch. ZIP64/multi-disk and unsupported directory layouts are rejected. The writer uses store mode and bounded output streaming. Maximum 100 input entries and 101 output entries including the generated manifest.

`/suite recipe save NAME MISSION_ID` saves the complete portable step sequence and goal. Use `{{variable}}` in the goal, step titles or prompts before saving. `/suite recipe run NAME | {"variable":"value"}` requires exactly the declared variables, selects fresh current materials and creates a new plan/estimate review. `show|export|remove NAME` inspect/export/delete a recipe; updates retain the previous five definitions. Source bytes, live session bindings, video Telegram IDs, provider continuations, credentials and approvals are never copied into recipes. Connection steps require currently configured owner-scoped connections and still use exact tool approvals. Recipe files are inspectable exports; automatic recipe import is not implemented.

## Workspace, lifecycle and release boundaries

`/workspace` uses existing signed Telegram init-data authentication and server-side private-user allowlisting. Suite navigation exposes source search/selection, record inspection/deletion, watch enable/disable, templates, criteria, recipe summaries and current shared content/downloads. Paid plans, record acceptance, invitations and publication reviews stay in Telegram. The existing Missions section starts/pauses/cancels approved drafts and downloads retained artifacts. No browser microphone is opened by Suite navigation.

Private Suite and watches use separate owner records; shared spaces use an independent global `teams` scope with fresh grant checks. `/reset` and conversation deletion clear matching Suite previews/listeners; explicitly saved records, source selections, watches and memberships survive and are independently removable. Mission input/output snapshots retain copied material until that mission is removed. Project deletion cancels its active missions through existing controls; file watches retain an unavailable-source error. Conversation TTL does not expire these independent records.

`/data` includes private Suite/watch state and currently authorized shared content/files; protect it like the database. `/erase confirm` deletes private Suite/watch data, owned shared spaces and the user's memberships/invitations/contributions/assignments in other spaces. Audit references to that user are removed; quota reductions do not block this shared erasure. Other people's downloaded copies, exports, backups and provider-side processing are outside local erasure. Canonical archive import preserves destination Suite/watch/shared state and does not restore source Suite records, pending reviews, listeners, subscriptions, memberships or automation. SQLite remains schema 3 and archive format 2; generic scoped records need no schema migration. Older application versions do not expose/erase the new scopes, so use a pre-upgrade backup for rollback.

The worker persists stage claims before effects and shares Studio capacity, quotas, cancellations and uncertain-outcome recovery. Failed or interrupted paid attempts are not automatically retried. A failed document/record local stage can be retried from its retained paid result through the existing explicit mission retry/fresh-review path; record preview reopening is free. Native video sampling and optional transcription are one claimed media stage; if it becomes uncertain, an explicit retry can repeat transcription and is estimated again. A local confirmation cannot undo earlier provider processing or file delivery.

Only isolated adjacent units/static checks qualify this release. Document libraries, ZIP codec, child processes, filesystem, transport, browser DOM and provider calls are mocked at their boundaries. Actual Office/PDF layout, native ZIP/FFmpeg behavior, browser/Telegram acceptance, model access and hosted deployment are not established by 100% source coverage.

## Qualification

The current release uses adjacent isolated unit tests and the unchanged 100% executable-source line/branch/function gate, plus TypeScript, ESLint, formatting and build checks. External/native/browser/deployment acceptance remains outside this evidence. See the current changelog entry for the release test count.
