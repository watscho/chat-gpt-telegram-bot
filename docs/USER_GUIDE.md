# Telegram AI Bot Pro: user guide

The bot works in private chats for allowlisted users only. Features use the OpenAI API and incur provider charges. Pro refers to this project's feature set.

## Conversations and search

Send a text or voice message. For voice messages, the bot first displays the transcript, then its answer. The response language follows your request.

To search explicitly, use `/search query`, for example:

```text
/search What changed in the latest Node.js release?
```

The bot can also choose search automatically when a question requires current information. Answers include references such as `[1]` and `[2]`, followed by a separate source list with clickable URLs. Verify important conclusions against the sources themselves. When no sources are available, the bot does not invent a source list.

## Photos

Send a photo with a caption such as "What is in this picture?" or "Read the text." Without a caption, the bot starts with a description. You can then ask follow-up questions.

- `/image description` creates an image.
- `/edit instructions` modifies an image in the conversation context.
- Reply to a specific photo or generated PNG with `/edit …` to select that source.

Commands also work in photo captions. Natural requests such as "Create an image" and "Replace the background" can invoke generation. Results arrive as original PNG files. High quality is the default. Editing is generative, so exact preservation of every pixel is not guaranteed.

JPEG, PNG and static WebP are supported. You can send multiple references as an album. The bot collects updates for 750 ms; late items may receive a busy response. For predictable sequential uploads, wait for a reply after each file.

## Documents

Supported formats are PDF, DOCX, XLSX, PPTX, TXT, MD, CSV and JSON. Text documents must use UTF-8 encoding.

Send a document with a caption:

```text
Give me a brief summary. Identify the pages containing the key obligations.
```

Without a caption, the bot prepares an initial summary. Follow up with questions such as "What does section 4 say?" or "Translate this passage." Reply to an older document to select it. Context is limited by retention time and size budgets; reattach a file when necessary. If images and layout in an Office document matter, save it as a PDF first.

## Separate conversations

```text
/new Work
/chats
/switch 1
/rename Personal
/delete 2
```

Each conversation has its own text and attachment history. `/chats` displays conversation IDs and the active selection. You cannot access another user's conversations. Keep at least one conversation; use `/reset` to clear the last one.

`/new` creates a conversation. `/reset` clears only the active conversation. `/start` and `/help` display help without clearing anything.

In a normal production setup, SQLite stores data across restarts. By default, history expires after one hour of inactivity, retains up to 20 complete exchanges and has additional size limits. Conversation names are stored separately. Older history is removed when capacity limits are reached. This is not an indefinite archive.

## Managed memory

```text
/remember Answer concisely in English.
/memory
/forget 1
/forget all
```

Explicit requests such as "remember: …" and "forget …" also work. After "forget," supply a note number or its exact text; "forget all" removes all saved notes.

Saved notes are available across your conversations. The bot does not automatically save facts from ordinary chat. Other users cannot access your notes. `/reset` preserves saved notes. `/forget` removes a saved note but does not change earlier answers that may mention it; clear the relevant conversations when necessary.

## Voice replies

```text
/voice on
/voice auto
/voice off
/speak Read this text aloud
/speak
```

- `on` narrates text answers.
- `auto` narrates answers only after incoming voice messages.
- `off` provides normal text answers and is the initial setting.
- `/speak` without text narrates the last retained answer in the active conversation.

Every outgoing audio message is labelled as AI-generated. Voice replies require Realtime model access and FFmpeg with libopus. If narration fails, the text remains available. Long answers are not silently truncated: select a shorter passage for `/speak`.

## Data and limits

The default per-file limit is 10 MB. History and attachments have additional shared budgets. While foreground work is running, other foreground requests receive a busy response. `/stop` and the Stop button remain available. A background job locks only its conversation, allowing foreground work in another conversation within the operator concurrency limit.

Text, audio, files, saved notes and relevant history are sent to OpenAI. Search queries may reach search providers. History and attachments are also stored locally; the application does not encrypt its database. The operator must protect the database and backups. Provider failures are displayed without private technical details.

For settings and retention rules, see [configuration.md](configuration.md) and [operations.md](operations.md).

## Answer controls and daily usage

Text previews stream by default. Use `/stop` or Stop to abort the active foreground request. Partial/cancelled answers are not saved as complete turns. Cancellation cannot undo a provider charge already incurred. The latest answer offers Retry, Shorter, More detail and Read aloud. These are new paid operations. Buttons belong to the owner and conversation and become stale after another answer, including a background result. Retry needs the original retained request; reattach expired references when necessary.

```text
/usage
/budget 5
/limits image 3
/limits search 10
/limits voice 0
```

The budget is USD of operator-configured estimates, not an invoice or guaranteed billing ceiling. Usage counts paid operations separately: a voice input plus answer plus narration can count as three operations. Image/search calls reserve additional estimates. Unused tool reservations are released on successful completion; failed/stopped attempts keep conservative reservations. Quotas use UTC, independent of your timezone. User budgets/counts cannot exceed operator maxima; zero disables the relevant work. `/usage` shows consumption; `/budget` without an amount shows your estimated-spend ceiling.

## Projects and conversation preferences

```text
/project new Contract review
/projects
/project info
/project instructions Use an evidence table and quote section numbers.
/project remember The current draft is version B.
[reply to an uploaded document] /project attach
/project remove draft.pdf
/project forget 1
/project forget all
/project instructions clear
/project use none
/project use 1
/project delete 1
/mode developer
/instructions Keep explanations concise.
/instructions clear
```

Creating a project selects it for the active conversation. Select the same project from other conversations to share files, project instructions and explicit project notes. Each conversation still has independent history and settings. `/project info` lists retained files/notes; attaching the same filename replaces that project file. A project can hold at most ten documents within the owner's aggregate project byte budget.

Global `/remember` notes apply across all your conversations. Project notes apply to that project's work. Ordinary chat never automatically becomes a saved note. Modes are `default`, `developer`, `editor`, `translator` and `custom`; combine a mode with your bounded custom instructions. Preferences do not override the bot's access/tool safety rules.

Deleting a project unlinks it from conversations but preserves their history and any already captured job references. Removing a note/file does not remove copies already present in histories or queued inputs. Explicit notes for queued jobs are resolved when execution starts, so forgetting a note before that point removes it from the notes supplied to that job. Files and instructions are captured snapshots instead.

## History search, exports and comparison

```text
/find renewal
/export markdown
/export pdf
/export json
/compare Identify changes to termination and payment terms.
```

`/find` searches your retained text across conversations, returning up to 20 snippets; it does not search binary file contents or other users. Query length is 1..120 characters. Exports cover the active retained conversation. Markdown/PDF include text, source lists and file metadata; they omit attachment binaries. JSON includes retained structured content and encoded attachments.

PDF uses a bundled Noto Sans font and automatic pagination. Supported export characters are limited to U+0000..U+052F and U+2000..U+206F, covering common Latin/Greek/Cyrillic text and punctuation. Emoji, CJK and other unsupported characters reject the PDF export; use Markdown/JSON for lossless Unicode. PDF typography/rendering has unit-contract coverage only.

Comparison requires at least two document references from retained history, selected project files or a replied document. Upload the files first or attach them to a project. The answer requests a summary and a table of location, before, after, impact and evidence, marking uncertain/missing evidence. It does not perform image generation or web search. Verify important interpretations against the originals.

## Image quality, variations and retained versions

```text
/quality medium
/size 1536x1024
/versions
/revert image-version-id
/edit Use the selected version and make the background lighter.
```

Quality choices: `low`, `medium`, `high`, `auto`. Sizes: `auto`, `1024x1024`, `1536x1024`, `1024x1536`. Image-bearing answers also offer variation, previous-version and quick quality/size controls. A variation requests another generative edit; it is paid. Previous version and `/revert` choose a retained source for the next edit, rather than deleting later history or regenerating lost pixels. An explicitly attached/replied image takes precedence. Once an image expires or is evicted, upload it again.

## Background jobs

```text
/job research Find primary sources on this question.
/job compare Compare the two attached drafts.
/job summary Summarize decisions and unresolved questions.
/jobs
/cancel job-id
/result job-id
/job delete job-id
```

Jobs run in the conversation where they were created, even if you switch elsewhere. Research enables search; comparison needs two documents; summary needs retained history or references before paid execution. Image generation is disabled in background jobs. One background execution runs at a time. Files, instructions and origin project ID are captured when queued; current explicit global/origin-project notes resolve at execution. Changing project selection does not redirect a queued job's project notes.

States are `queued`, `running`, `succeeded`, `failed`, `uncertain` and `cancelled`. Delivery is tracked separately. After a restart, interrupted paid work is `uncertain` and is not automatically charged again. Inspect and explicitly create new work if desired. Successful results retry Telegram delivery at most three times, 60 seconds apart, without another model call. `/result` manually resends a retained result; it does not rerun the job or rewrite its recorded automatic-delivery status. A crash can cause duplicate delivery.

Completed/cancelled records count toward the job limit until `/job delete`. Cancel a running job before deleting it. Cancelled paid attempts may still be billed. `/reset` and deleting a conversation cancel its pending/running jobs and remove its schedules; retained completed job records require separate deletion. Jobs/results do not expire with conversation TTL.

## Reminders, recurring summaries and timezones

```text
/timezone Asia/Tbilisi
/remind 2027-01-15 09:00 | Review the contract
/remind every 2h | Take a break
/summary every 1d | Summarize decisions and open questions
/schedules
/unschedule schedule-id
```

Default timezone is UTC. Set an IANA timezone before creating a schedule. One-off dates are interpreted in that timezone and must be in the future. Invalid dates, nonexistent DST times and ambiguous DST times are rejected. Listings show due times as ISO UTC (`Z`) with the captured timezone. Later timezone changes affect new schedules only.

Intervals use whole numbers of minutes (`m`), hours (`h`) or days (`d`), from one minute to 365 days. Recurrence is an elapsed UTC interval, so local wall-clock time may shift across DST. Missed occurrences coalesce; the bot does not replay every missed interval. Queue capacity can delay an occurrence. Reminders send the stored text without a paid model call; summaries use the current retained conversation/references at occurrence creation and obey normal quotas. Empty summaries fail before paid execution.

Schedules require the bot process to be running. `/unschedule` stops future occurrences; already queued jobs remain in `/jobs` and can be cancelled separately. Removing completed jobs frees capacity for future occurrences.

## Retention, archive and deletion

```text
/retention 1800
/retention default
/data
/erase
/erase confirm
```

Retention is inactivity TTL for the selected conversation, 60..86400 seconds. A shorter value also shortens its existing deadline; increasing it or choosing default does not resurrect discarded data. Expiry is pruned on startup/access, without an exact-time erasure guarantee. Projects, saved notes, names, settings, job snapshots/results and schedules have separate lifecycles.

`/data` exports your profile, workspace, retained histories, queue/schedules and current-day usage as bounded JSON, including encoded attachments. Large exports can exceed the operator cap; export a single conversation or remove unnecessary retained content first. Treat downloaded exports as private files.

`/erase` explains the action; `/erase confirm` deletes all your local conversation content, attachments, projects, notes, settings, jobs and schedules. Minimal current-day usage aggregates remain to prevent quota bypass; the accounting day rolls over in UTC. A later request starts with fresh settings. This cannot delete existing Telegram messages, provider copies or operator backups. Earlier text may still contain a forgotten note; clear affected histories/jobs too when needed.

## Branches and revised requests

```text
/turns
/branch 2 | Alternative approach
/revise 2 | Use the same inputs, but compare costs instead.
```

Turn numbers refer to retained user/assistant pairs shown by `/turns`, and can change as old history expires or is trimmed. `/branch N` creates/selects a new conversation through completed turn N. `/revise N` creates/selects a branch through N-1 and sends a replacement request with turn N's original attachments. The original conversation remains intact. Modes, project selection and conversation preferences are copied. This explicit workflow does not automatically rerun requests when you edit a Telegram message.

Branch creation is local; a revision's new answer uses normal quotas. Capacity failures leave the source selected and clean up the new branch. A later provider failure can leave a selected branch containing its retained prefix; retry deliberately. Branches consume normal conversation/history capacity and remain subject to TTL/eviction. They are not permanent backups.

## Project library and cited retrieval

```text
[reply to a PDF or text document] /library add
/library list
/library find renewal notice
/ask What notice is required for renewal?
/library remove document-id
```

Select a project first. Its library is separate from the ten-file inline reference set: it retains extracted text for up to 500 documents across your projects. Indexing and `/library find` are local and make no model call. Adding the same filename replaces that project's indexed version; unchanged content is reused. No original binary is retained by indexing itself, although the original upload may already exist in conversation/project history.

Supported indexing formats: text PDF, UTF-8 TXT, MD, CSV and JSON. Convert Office documents to PDF/text first. Encrypted, scanned or unextractable PDFs require an external text/OCR export. There is no built-in OCR, spreadsheet formula evaluation or layout interpretation. Text extraction quality has unit-contract verification only.

Retrieval ranks lexical matches, returning up to eight passages with `[L#]` labels, filename and PDF page/text line plus passage number. `/ask` supplies matching excerpts as untrusted evidence and requests citations; no match stops before paid work. This is a bounded local search, not semantic embeddings or an exhaustive legal/document comparison. Inspect `/library find` excerpts and original sources when accuracy matters. Normal conversation/project context can also be supplied; use `/context on` to inspect and exclude it.

Limits are 10 MB/input, 500 pages/PDF, one million extracted characters/document and 20 MB stored indexed text/owner. Exceeding a limit rejects the new index without silently truncating it. Removing a project removes its library index; captured context snapshots and previous answers can still contain excerpts until cleared/expired.

## Reusable prompt templates

```text
/template save review | Review {{code}} for {{focus}}.
/templates
/template show review
/run review {"code":"example()", "focus":"correctness"}
/template delete review
```

Names use lowercase letters, digits, underscore or hyphen, starting with a letter; maximum 32 characters. Variables use `{{lowercase_name}}`. Supply exactly the required keys as a JSON object of strings. Unknown/missing/blank values are rejected. Substitution happens once: variable contents cannot introduce another expansion. A template without variables needs only `/run name`.

Templates persist per owner, up to 50 entries and 8000 characters per body/expanded request. Saving/replacing/deleting a template is local; `/run` uses normal answer quotas, project settings and optional context review. Templates are explicit user instructions, not system-policy overrides.

## Forwarded message collections

```text
/collect on
[forward several text messages]
/collect show
/collect summarize Highlight decisions, owners and deadlines.
/collect off
/collect clear
```

Collection is explicit and scoped to the active conversation. Forwarded text/captions are stored locally without model calls; media contents and sender identities are not collected. Unsupported/empty forwarded media receives an explanatory error. Normal non-forwarded messages continue through the usual chat workflow. Rapid forwarded text/caption batches are collected independently of the foreground busy lock; forwarded commands remain quoted content.

Summarization is a deliberate paid operation that supplies `[F#]` excerpts and requests a summary, decisions/tasks and uncertainty about attribution. Forwarded text is evidence, not trusted instructions. Collection remains available after a summary until explicitly cleared. Limits: 50 entries, 60000 total characters, 8000 characters per entry. Reset/delete clears that conversation's collection and collection mode. History TTL alone does not clear it.

## Button settings and answer feedback

Open `/settings` or `/menu` for model, project, mode, voice, estimated budget/feature presets and context review. Project selection is paginated. Menus expire after ten minutes and cannot be used from another owner/conversation; reopening replaces the previous menu. These actions make no model call. Voice settings remain owner-wide; mode, model, project and review preference are conversation-specific. Budget/count settings remain owner-wide and cannot exceed operator ceilings.

`/model ID` sets a conversation override; `/model default` restores the configured operator model. Availability/compatibility is not tested by spending API credits. Queued jobs use the conversation's model at execution time. Image and speech model configuration remains separate.

Answer buttons include Helpful and Needs improvement. Negative reasons are incorrect, too long, lost context and other. `/feedback` lists ratings for the active conversation. A new vote replaces the previous vote on that answer. Controls require the latest retained answer and reject stale/cross-conversation actions. Feedback stores no separate answer copy, is not sent to OpenAI and is capped at the last 200 entries per owner. Reset/delete clears that conversation's feedback.

## Inspect and exclude context before generation

```text
/context on
[send a request]
/context show 0
[use Include/Exclude buttons, then Send selected context]
/context off
/context Explain the termination clause.
```

`/context on` stages foreground answers for review; `/context request` creates a one-off preview even when automatic review is off. Local management commands and background-job scheduling retain their normal explicit workflows. A preview is a snapshot of the request, history text, deduplicated current/historical/project attachments, saved notes, instructions and retrieved/forwarded excerpts when present.

The preview itself makes no model call. `/context show ID` displays text or file name/type/size; no binary payloads or credentials are printed. History text and attachments have separate toggles. Excluding a file/image also removes its historical attachment copies from this request. All mode/custom/project instructions are one toggle; retrieved/forwarded excerpts are another. Text that already quotes a file/note can remain in selected history; inspect/exclude history too when needed.

Send consumes the draft once and uses normal quotas; Cancel makes no provider call. Drafts expire after ten minutes, are owner/conversation-bound, and reject a changed history revision. A stopped/failed confirmed request needs a new preview. Another preview replaces the previous one. Snapshot data can remain after a source file/project is removed; cancel it or create a new preview to reflect those changes. Expired snapshots are removed on owner access, without an exact-time erasure guarantee.

Selections apply to this request only. Excluding context does not rewrite stored conversation history or globally delete a note/file. Use the existing clear/delete/erase commands for that purpose. `/data` includes templates, library text, collections, feedback and any current draft; `/erase confirm` removes them along with other owner content.
