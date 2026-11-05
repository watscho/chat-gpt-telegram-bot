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
