# Telegram AI Bot Pro

Current release: **10.0.1**.

A private TypeScript Telegram assistant with text and voice conversations, photo analysis and editing, image generation, web search with sources, document questions, projects, named conversations, explicit saved memory, usage controls, streaming replies and durable background jobs. MIT licensed.

“Pro” names this repository's feature set. It does not grant a ChatGPT subscription or provider account access.

## Complete feature catalog

**116 documented capabilities across 14 areas.** Each row groups related commands and controls into one capability. Expand an area to see its full list, entry points and guide.

Start in Telegram with `/start`, use `/suite` for reviewed specialized workflows, and open `/workspace` for the project/mission dashboard.

| Area                                                        | Capabilities | Guide                                                     |
| ----------------------------------------------------------- | -----------: | --------------------------------------------------------- |
| [Conversations and answer controls](#catalog-conversations) |            9 | [Open guide](docs/USER_GUIDE.md#conversations-and-search) |
| [Memory, context and languages](#catalog-context)           |            7 | [Open guide](docs/USER_GUIDE.md#managed-memory)           |
| [Photos and image workflows](#catalog-photos)               |            8 | [Open guide](docs/USER_GUIDE.md#photos)                   |
| [Voice, meetings and recorded video](#catalog-audio)        |            8 | [Open guide](docs/pro-provider.md)                        |
| [Documents, data and artifacts](#catalog-documents)         |            8 | [Open guide](docs/USER_GUIDE.md#documents)                |
| [Search, sources and monitoring](#catalog-research)         |           10 | [Open guide](docs/pro-suite.md#start-in-telegram)         |
| [Private and shared projects](#catalog-projects)            |            8 | [Open guide](docs/pro-suite.md#explicit-shared-projects)  |
| [Daily productivity and navigation](#catalog-daily)         |            8 | [Open guide](docs/pro-daily.md)                           |
| [Tasks, schedules and notifications](#catalog-tasks)        |            8 | [Open guide](docs/pro-experience.md)                      |
| [Automation and connected tools](#catalog-automation)       |           10 | [Open guide](docs/pro-studio.md)                          |
| [Specialized reviewed workflows](#catalog-workflows)        |           11 | [Open guide](docs/pro-suite.md)                           |
| [Workspace, results and records](#catalog-results)          |            6 | [Open guide](docs/pro-studio.md#results-and-revisions)    |
| [Costs, privacy and data controls](#catalog-controls)       |            9 | [Open guide](docs/USER_GUIDE.md#data-and-limits)          |
| [Engineering and operations](#catalog-engineering)          |            6 | [Open guide](CONTRIBUTING.md)                             |

<a id="catalog-conversations"></a>
<details>
<summary><strong>Conversations and answer controls · 9 capabilities</strong></summary>

| Capability                    | What you can do                                                                                                     | Entry point                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Contextual text chat          | Ask questions and continue a conversation with retained context.                                                    | Send text                                                   |
| Streaming answers             | Read incremental replies and stop foreground generation.                                                            | Text previews; `/stop`                                      |
| Named conversations           | Create, list, switch, rename, reset and delete independent chats.                                                   | `/new`, `/chats`, `/switch`, `/rename`, `/reset`, `/delete` |
| Branches and revised requests | Branch at a retained turn or replace a request while preserving its original conversation.                          | `/turns`, `/branch`, `/revise`                              |
| Conversation model selection  | Set a chat-specific model override or restore the configured default.                                               | `/model`                                                    |
| Behavior modes                | Select default, developer, editor, translator or custom behavior.                                                   | `/mode`                                                     |
| Custom instructions           | Keep explicit conversation instructions alongside project preferences.                                              | `/instructions`                                             |
| Contextual answer actions     | Retry, shorten, expand, translate, extract checklists/risks, compare or propose tasks from a retained answer/photo. | Answer action buttons                                       |
| Local answer feedback         | Rate an answer and record an explicit improvement reason.                                                           | Helpful / Needs improvement; `/feedback`                    |

[Read the guide](docs/USER_GUIDE.md#conversations-and-search).

</details>

<a id="catalog-context"></a>
<details>
<summary><strong>Memory, context and languages · 7 capabilities</strong></summary>

| Capability               | What you can do                                                                                                | Entry point                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Explicit saved memory    | Save, inspect and remove owner-wide notes deliberately.                                                        | `/remember`, `/memory`, `/forget` |
| Long-conversation recaps | Inspect or clear bounded extractive excerpts from trimmed turns.                                               | `/recap`                          |
| Context review           | Inspect and include/exclude history, images, files, notes, instructions and retrieved excerpts before sending. | `/context`                        |
| Conversation retention   | Choose retention within operator bounds; expire retained history and attachments.                              | `/retention`                      |
| Interface languages      | Choose English, Russian or Spanish navigation with English fallback.                                           | `/language ui`                    |
| Answer language          | Set generated prose language independently from interface language.                                            | `/language answer`                |
| Project glossaries       | Preserve preferred terminology/spelling in answers and transcription hints.                                    | `/glossary`                       |

[Read the guide](docs/USER_GUIDE.md#managed-memory).

</details>

<a id="catalog-photos"></a>
<details>
<summary><strong>Photos and image workflows · 8 capabilities</strong></summary>

| Capability                    | What you can do                                                                                 | Entry point                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| Photo understanding           | Ask visual questions about photos, screenshots and visible text.                                | Send or reply to a photo              |
| Image generation              | Create images through an explicit generation workflow.                                          | `/image`                              |
| Reference-based image editing | Edit selected current, historical or replied image references.                                  | `/edit`                               |
| Multiple image references     | Collect bounded image/file albums into one reviewed request.                                    | Reference albums                      |
| Image quality and dimensions  | Choose supported quality and size settings.                                                     | `/quality`, `/size`                   |
| Original image delivery       | Receive generated images as downloadable original PNG documents.                                | Generated image files                 |
| Retained image versions       | Inspect/select/revert sources and request variations or a previous version.                     | `/versions`, `/revert`; image buttons |
| Annotated screenshot guidance | Export an SVG preserving original PNG/JPEG pixels with reviewable proposed regions and actions. | `/suite screen`                       |

[Read the guide](docs/USER_GUIDE.md#photos).

</details>

<a id="catalog-audio"></a>
<details>
<summary><strong>Voice, meetings and recorded video · 8 capabilities</strong></summary>

| Capability                        | What you can do                                                                                                    | Entry point             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Incoming voice transcription      | Transcribe incoming voice messages for the normal conversation workflow.                                           | Send voice              |
| AI voice answers                  | Choose off/on/automatic narration while keeping text answers available.                                            | `/voice`                |
| One-shot narration                | Read supplied text or a retained answer aloud with AI voice labeling.                                              | `/speak`                |
| Live voice Mini App               | Use conversation, language-practice or interview modes with explicit microphone, mute, interrupt and end controls. | `/live`                 |
| Recording transcripts             | Review transcription costs and download a bounded recording transcript.                                            | `/meeting`              |
| Optional speaker labels           | Request explicitly configured speaker labeling; labels require human review.                                       | `/meeting speakers`     |
| Meeting protocols                 | Generate structured meeting notes and separately reviewed task/deadline proposals.                                 | Meeting review controls |
| Timestamped recorded-video review | Sample a bounded clip, optionally transcribe audio, and download timestamped frame/transcript evidence.            | `/suite video`          |

[Read the guide](docs/pro-provider.md).

</details>

<a id="catalog-documents"></a>
<details>
<summary><strong>Documents, data and artifacts · 8 capabilities</strong></summary>

| Capability                         | What you can do                                                                                                      | Entry point                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Document questions and summaries   | Work with PDF, DOCX, XLSX, PPTX, TXT, MD, CSV and JSON references.                                                   | Send a file and a question                      |
| Document comparison                | Compare two selected retained/project documents with a supplied focus.                                               | `/compare`                                      |
| Reviewed document batches          | Summarize, extract fields or build tables per file with separate retained results.                                   | `/batch`                                        |
| Validated CSV/JSON exports         | Export bounded structured rows with exact fields and CSV formula-prefix neutralization.                              | `/output`                                       |
| Python data analysis               | Run provider-side analysis in a bounded container and retrieve supported output artifacts.                           | `/analyze`                                      |
| Branded DOCX/PPTX/PDF              | Create editable documents/slides or PDF with tables, reference images and source IDs; manage/import branding values. | `/suite brand`, `/suite brand-template`         |
| Reviewed form filling              | Extract fields, ask for missing values, accept explicit corrections and export a reconstructed review document.      | `/suite form`, `/suite answer`, `/suite export` |
| ZIP organization and deduplication | Preview groups/names/exact duplicates, rename safely and export a manifest-backed archive without disk extraction.   | `/suite zip`                                    |

[Read the guide](docs/USER_GUIDE.md#documents).

</details>

<a id="catalog-research"></a>
<details>
<summary><strong>Search, sources and monitoring · 10 capabilities</strong></summary>

| Capability                      | What you can do                                                                                                                  | Entry point                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Web search with citations       | Run explicit web research and retain clickable source links.                                                                     | `/search`                                                          |
| Public article reading          | Read a bounded public HTTPS page excerpt and use it for grounded follow-ups.                                                     | `/read`; standalone HTTPS URL                                      |
| Retained citation cards         | Inspect answer-bound source excerpts without fetching pages again.                                                               | `/sources`; source buttons                                         |
| Conversation history search     | Find retained text in the selected conversation.                                                                                 | `/find`                                                            |
| Local project libraries         | Index supported text/PDF passages and search them locally.                                                                       | `/library`                                                         |
| Passage-grounded questions      | Ask against matching indexed excerpts with filename/page/passage attribution.                                                    | `/ask`                                                             |
| Opt-in cloud semantic libraries | Explicitly upload project references, inspect readiness and ask through provider file search.                                    | `/knowledge`                                                       |
| Owner-wide work search          | Search retained chats, notes, projects, indexed files, tasks, bookmarks, Inbox, results and records; explicitly select excerpts. | `/suite search`, `/suite select`, `/suite sources`, `/suite clear` |
| Tagged bookmarks                | Save answers, sources and replied passages; organize/filter them with tags.                                                      | `/bookmarks`, `/bookmark`; save buttons                            |
| Change monitoring               | Watch public page excerpts or owned project-file digests with explicit intervals, thresholds and retained diffs.                 | `/suite watch`                                                     |

[Read the guide](docs/pro-suite.md#start-in-telegram).

</details>

<a id="catalog-projects"></a>
<details>
<summary><strong>Private and shared projects · 8 capabilities</strong></summary>

| Capability                          | What you can do                                                                                        | Entry point                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Private project workspaces          | Create/select/remove private projects across your own conversations.                                   | `/projects`, `/project`                                         |
| Project reference files             | Attach, replace, inspect and remove owned project files.                                               | `/project attach`, `/project info`, `/project remove`           |
| Project notes and instructions      | Keep explicit project-specific facts and behavior preferences.                                         | `/project remember`, `/project forget`, `/project instructions` |
| Targeted shared-project invitations | Create independent shared spaces and accept explicit expiring invitations.                             | `/suite team create`, `invite`, `invitations`, `accept`         |
| Shared roles and access lifecycle   | Use owner/editor/reader permissions with role changes, immediate revocation, leave and close controls. | `/suite team role`, `revoke`, `leave`, `close`                  |
| Reviewed shared publication         | Preview exact files/notes and recipients before publishing; recheck access on downloads.               | `/suite team publish`, `confirm`, `file`, `remove`              |
| Shared tasks                        | Create assigned/unassigned shared tasks and mark them complete within the current grant.               | `/suite team task`, `done`                                      |
| Shared audit history                | Inspect bounded actor/action history independently from private conversations.                         | `/suite team show`                                              |

[Read the guide](docs/pro-suite.md#explicit-shared-projects).

</details>

<a id="catalog-daily"></a>
<details>
<summary><strong>Daily productivity and navigation · 8 capabilities</strong></summary>

| Capability                      | What you can do                                                                      | Entry point                                     |
| ------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Guided onboarding               | Choose focus/language, explicitly try an example or skip setup.                      | `/start`, `/onboarding`                         |
| Guides and button settings      | Browse workflow guides and configure model/project/mode/voice/context/limit presets. | `/help`, `/guide`, `/settings`, `/menu`         |
| Today dashboard                 | See local tasks and ready work without a model request.                              | `/today`                                        |
| Morning overview                | Opt into a local morning dashboard using your configured time zone.                  | `/morning`                                      |
| Favorite and recent scenarios   | Discover built-in scenarios, save favorites and reuse recent workflows.              | `/scenarios`, `/favorites`, `/favorite`, `/run` |
| Forwarded-message collections   | Collect bounded forwarded text/captions and summarize only on request.               | `/collect`                                      |
| Voice notes to reviewed actions | Turn opted-in voice notes into summaries and explicit task/deadline proposals.       | `/notes`                                        |
| Deliberate project continuation | Review prior context and open actions before generating the next step.               | `/continue`                                     |

[Read the guide](docs/pro-daily.md).

</details>

<a id="catalog-tasks"></a>
<details>
<summary><strong>Tasks, schedules and notifications · 8 capabilities</strong></summary>

| Capability                                    | What you can do                                                                                               | Entry point                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Actionable task management                    | Create/list/edit deadlines, complete/reopen and delete local tasks.                                           | `/task`, `/tasks`                                |
| Reviewed task extraction                      | Propose tasks from retained answers, recordings or sourced records before accepting exact text/deadlines.     | Task buttons; `/task fromreply`; `/suite remind` |
| One-off and recurring reminders               | Schedule local reminders and manage their future occurrences.                                                 | `/remind`, `/schedules`, `/unschedule`           |
| Recurring summaries                           | Schedule explicitly configured background summary work.                                                       | `/summary`                                       |
| Time-zone-aware deadlines                     | Use IANA time zones and reject ambiguous/nonexistent local times.                                             | `/timezone`                                      |
| Quiet hours                                   | Suppress or queue supported background notifications during configured local hours.                           | `/quiet`                                         |
| Notification digests                          | Group supported pending task/job notifications and flush them explicitly.                                     | `/digest`                                        |
| Notification inspection and delivery controls | Inspect pending notifications and retain bounded delivery retry/suppression state separately from generation. | `/notifications`                                 |

[Read the guide](docs/pro-experience.md).

</details>

<a id="catalog-automation"></a>
<details>
<summary><strong>Automation and connected tools · 10 capabilities</strong></summary>

| Capability                         | What you can do                                                                                       | Entry point                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Reusable prompt templates          | Save prompt bodies with exact named variables and run them with fresh inputs.                         | `/templates`, `/template`, `/run`                           |
| Reviewed multi-step autopilot      | Plan work, review its estimate and execute retained steps.                                            | `/autopilot`                                                |
| Evidence/counter-evidence research | Run a public-question research workflow with retained sources and uncertainty.                        | `/investigate`                                              |
| Private Inbox capture              | Capture text, links, photos, files and untranscribed recording metadata without generation.           | `/inbox`                                                    |
| Inbox batch processing             | Review selected Inbox materials before processing them together.                                      | `/inbox process`                                            |
| Configured external MCP tools      | Use operator-scoped services with exact tool-name/argument approval, including reads.                 | `/connections`, `/connect`                                  |
| Reviewed service chains            | Prepare an editable draft, review external actions and retain reported receipts.                      | `/chain`                                                    |
| Durable mission checkpoints        | Inspect stages, pause/resume/cancel and review uncertain outcomes before an explicit paid retry.      | `/missions`, `/mission`                                     |
| Complete workflow recipes          | Save versioned step sequences with variables, fresh material selection and new approval for each run. | `/suite recipe`                                             |
| Durable background jobs and queues | Queue research/comparison/summaries, inspect/cancel results and control priority/deferred starts.     | `/job`, `/jobs`, `/queue`, `/priority`, `/defer`, `/cancel` |

[Read the guide](docs/pro-studio.md).

</details>

<a id="catalog-workflows"></a>
<details>
<summary><strong>Specialized reviewed workflows · 11 capabilities</strong></summary>

| Capability                 | What you can do                                                                                            | Entry point                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Travel assistance          | Review supplied booking/time/location evidence and accept a sourced itinerary record.                      | `/suite travel`                         |
| Continuing learning        | Retain accepted lessons, exercises, mistakes and adaptive feedback across explicit sessions.               | `/suite learn`, `/suite session`        |
| Conversation rehearsal     | Practice a chosen counterpart/scenario with accepted turn history and feedback.                            | `/suite rehearse`, `/suite session`     |
| Purchase-offer analysis    | Compare supplied costs/conditions and calculate known totals in integer minor units.                       | `/suite purchase`                       |
| Pre-send review            | Review tone, ambiguity, promises, sensitive details and attachment gaps before sending.                    | `/suite sendcheck`                      |
| Meeting preparation        | Build a sourced agenda, context, decision gaps and questions from selected owned material.                 | `/suite brief`                          |
| Multi-format repurposing   | Turn a reviewed source into separately named content formats and a downloadable pack.                      | `/suite repurpose`                      |
| Personal quality criteria  | Define owner/project rules and request criterion-by-criterion draft assessments.                           | `/suite quality-rule`, `/suite quality` |
| Sourced decision journal   | Retain reviewed decisions/reasons/alternatives with exact source-quote matching.                           | `/suite decision`                       |
| Quoted commitment tracking | Retain explicit actors/actions/deadlines with exact quoted evidence and optional separate reminder review. | `/suite commitment`                     |
| Independent model review   | Review a primary answer with an explicitly different allowlisted model and a separate configured estimate. | `/suite models`, `/suite referee`       |

[Read the guide](docs/pro-suite.md).

</details>

<a id="catalog-results"></a>
<details>
<summary><strong>Workspace, results and records · 6 capabilities</strong></summary>

| Capability                         | What you can do                                                                                                                | Entry point                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Authenticated workspace Mini App   | Browse projects/files/tasks/Inbox/jobs/missions/results/usage and Suite data in one signed Telegram workspace.                 | `/workspace`                                                                                                          |
| Result version history and restore | Retain stable versions/parentage and select a previous result.                                                                 | `/result`, `/result restore`                                                                                          |
| Local result editing               | Edit reviewed prose or replace one exact unique passage without another model request.                                         | `/result edit`, `/result replace`                                                                                     |
| Result comparisons                 | Download changed-line-block comparisons between retained versions.                                                             | `/result compare`                                                                                                     |
| Explicit paid revisions            | Request a new reviewed revision with a fresh plan/estimate.                                                                    | `/result revise`                                                                                                      |
| Private record lifecycle           | Inspect/export/delete accepted records and row history; reopen expired previews locally and reject stale/duplicate acceptance. | `/suite records`, `/suite record`, `/suite review`, `/suite confirm`, `/suite export`, `/suite delete`, `/suite stop` |

[Read the guide](docs/pro-studio.md#results-and-revisions).

</details>

<a id="catalog-controls"></a>
<details>
<summary><strong>Costs, privacy and data controls · 9 capabilities</strong></summary>

| Capability                             | What you can do                                                                                                         | Entry point                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Shared daily usage quotas              | Track owner/project requests and tool/transcription/voice consumption using UTC counters.                               | `/usage`, `/limits`, `/project_usage`                         |
| Owner and project spending estimates   | Set local estimated-spend limits under operator ceilings.                                                               | `/budget`, `/project_budget`                                  |
| Scoped cost/action confirmations       | Review applicable context, estimates and exact actions with expiring single-use revision guards.                        | Plan/context/action review controls                           |
| Private access and signed Mini Apps    | Restrict Telegram access to private allowlisted users and validate Mini App identity server-side.                       | Operator allowlist; Telegram init-data verification           |
| Durable bounded local state            | Persist conversations, files, preferences, queues and records with independent scope/capacity/retention controls.       | SQLite; `STATE_DB_PATH`                                       |
| Conversation exports                   | Export retained conversations as Markdown, PDF or JSON.                                                                 | `/export`                                                     |
| Private archives and reviewed transfer | Export owned data and merge supported canonical content with fresh IDs while preserving destination controls.           | `/data`, `/import`                                            |
| Scoped deletion and erasure            | Clear conversations, remove saved records and erase local owner/shared contributions while preserving quota safeguards. | `/reset`, `/delete`, `/erase confirm`; scoped remove commands |
| Provider resource cleanup              | Inspect/retry bounded cleanup of provider uploads, containers, stores and live calls.                                   | `/cloud_cleanup`                                              |

[Read the guide](docs/USER_GUIDE.md#data-and-limits).

</details>

<a id="catalog-engineering"></a>
<details>
<summary><strong>Engineering and operations · 6 capabilities</strong></summary>

| Capability                               | What you can do                                                                                                  | Entry point                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Typed modular implementation             | Use TypeScript domain/application/adapter boundaries and replaceable provider/store/clock/transport ports.       | [Architecture](docs/architecture.md)                           |
| Adjacent unit-only tests                 | Keep behavior-focused tests beside source with a strict 100% executable-source line/branch/function gate.        | `npm test`, `npm run test:coverage`                            |
| Static checks and production compilation | Run TypeScript, ESLint, formatting, release-documentation consistency checks and build output.                   | `npm run check`                                                |
| Locked dependencies and advisory gate    | Use the committed npm lockfile and fail verification on high/critical dependency advisories.                     | `npm run verify`; CI                                           |
| Pre-push verification                    | Check the exact outgoing commit with a clean worktree, locked reinstall and the same verification command as CI. | `npm run hooks:install`; tracked `pre-push` hook               |
| Deployment and recovery guidance         | Use Docker/FFmpeg, persistent volumes, configuration references, backups and bounded worker/shutdown cleanup.    | [Operations](docs/operations.md); [.env.example](.env.example) |

[Read the guide](CONTRIBUTING.md).

</details>

Provider features require the corresponding account/model access and configuration. Local estimates are not provider invoices. Unit coverage qualifies local source behavior; native media/document layout, browser interoperability and deployed-service acceptance remain separate. See the linked guides for exact bounds and setup.

## Get started

Requirements: Node.js **26.13+ within Node 26**, npm 11, a Telegram bot token, an OpenAI project API key with billing and model access. Outgoing voice messages require **FFmpeg with libopus**; the Docker image includes it. Incoming voice transcription needs no FFmpeg. Recorded-video sampling requires FFmpeg and ffprobe; document/ZIP features use Node 26.13 APIs and the locked document libraries.

```sh
nvm use
npm ci --ignore-scripts
npm run hooks:install
cp .env.example .env
# Fill in required settings before starting.
npm run dev
```

Required settings:

- `TELEGRAM_API_KEY`: token from [@BotFather](https://t.me/BotFather).
- `OPENAI_API_KEY`: private OpenAI project key.
- `ALLOWED_TELEGRAM_USER_IDS`: comma-separated numeric IDs. Only these users in private chats are processed.

Default chat model: `gpt-6.1-sol`. Override it with `OPENAI_CHAT_MODEL` using a Responses model supporting vision, document inputs, `web_search` and `image_generation`. Missing or blank values use the default.

Default image model: `gpt-image-2.5-sunburst`, quality `high`. Default outgoing speech model: `gpt-realtime-2.1-mini`, voice `marin`. Model availability must be checked against your own account. Configuration does not establish provider acceptance.

For FFmpeg on macOS, install with `brew install ffmpeg`; on Debian/Ubuntu, install the `ffmpeg` package. Check that your build supports the `libopus` encoder. `FFMPEG_PATH` can point to a trusted executable.

```sh
npm run build
npm start
```

## Pro Suite

Pro Suite provides twenty connected capabilities: local work search and change monitoring; branded DOCX/PPTX/PDF output; travel, learning and rehearsal records; purchase and pre-send reviews; timestamped recorded-video analysis; meeting briefs and content packs; personal quality criteria; annotated screenshots; sourced decisions and commitments; reviewed form filling; bounded ZIP organization; separate shared projects; explicitly priced independent model review; and complete reusable recipes.

Start with `/suite`. Model workflows create inert Studio plans with explicit estimates; record creation and shared publication require an additional content review. `/workspace` includes a Suite section. Follow [the command reference, limits, permissions and recovery guide](docs/pro-suite.md). Recorded video needs trusted FFmpeg and ffprobe executables; native/provider/hosted acceptance remains separate from unit qualification.

## Pro Studio

Pro Studio connects the tools into reviewed work: `/autopilot goal`, `/investigate question`, `/inbox`, `/chain`, durable `/missions`, versioned `/result` outputs and a `/workspace` Mini App. Plans stay inert until approval; chains pause on an editable draft and require exact tool approvals. Interrupted paid attempts stop for review.

Follow [the Studio user paths, recovery rules and setup](docs/pro-studio.md). Workspace hosting reuses the existing public HTTPS Mini App endpoint; account access and external-service acceptance remain separate.

## Provider workbench

The provider workbench includes `/analyze` (Python and downloadable files), `/knowledge` (private project semantic search), `/connections` and `/connect` (reviewed MCP tools), `/meeting` (recording protocols and reviewed tasks), and `/live` (a voice Mini App). Start with `/pro`. All paid provider workflows are explicit; external actions require an additional exact-arguments approval.

See [provider setup, user paths and limits](docs/pro-provider.md) before enabling cloud uploads, authenticated MCP endpoints or public HTTPS live voice. Account/model access and deployment remain operator setup; only unit/static qualification is included.

## Commands

| Command                                  | Behavior                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `/start`                                 | Guided setup for new users; Today after setup, preserving history               |
| `/help`                                  | Show the full command reference and guided workflow menu                        |
| `/new [name]`                            | Create and select an independent conversation                                   |
| `/chats`                                 | List your conversations and selected ID                                         |
| `/switch id`                             | Continue another conversation                                                   |
| `/rename name`                           | Rename the selected conversation                                                |
| `/delete id`                             | Delete that conversation and its retained history; keep at least one            |
| `/reset`                                 | Clear selected conversation's text, photos and documents                        |
| `/search query`                          | Explicit web search with numbered references and clickable sources              |
| `/image description`                     | Generate a new image                                                            |
| `/edit instructions`                     | Edit images in context, or a photo/file you reply to                            |
| `/remember note`                         | Explicitly save a note shared across your conversations                         |
| `/memory`                                | List saved notes with numbers                                                   |
| `/forget number`, `/forget all`          | Remove a note or all saved notes; exact note text also works                    |
| `/voice off`, `/voice on`, `/voice auto` | Disable voice, narrate all text answers, or narrate only answers to voice input |
| `/speak [text]`                          | Narrate supplied text, or the last retained assistant answer                    |

Voice replies start **off**. Every outgoing voice message is labelled **AI-generated voice**. Text answers remain available even if narration fails. Long answers are not silently truncated for speech: use `/speak` with a shorter passage.

Natural-language requests can invoke web search within quotas. Image generation/editing uses explicit `/image` or `/edit` and a cost/context confirmation by default; `CONFIRM_EXPENSIVE_REQUESTS=false` restores automatic image tools and immediate image/job requests. Batches always require confirmation. `remember: …` and `forget …` manage saved notes without a model call. The bot never creates explicit long-term notes automatically. A separate bounded extractive recap can retain excerpts from trimmed history within that session’s TTL.

## Photos and documents

Send a photo or original JPEG/PNG/static WebP file, with optional instructions in its caption. Continue asking questions about it. `/image`, `/edit` and `/search` also work in captions. Reply to an older photo or document to attach that exact source to the current request. Generated images arrive as original PNG documents.

Supported document extensions: **PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JSON**. Send a document with a question, or without a caption for a summary. Follow-up questions reuse retained files. PDFs and Office files are parsed by OpenAI; text documents must be UTF-8. Signatures catch obvious PDF/Office/image mismatches; complete file validity and provider parsing are checked downstream. Embedded pictures/layout in non-PDF documents are not guaranteed to be available to the model. Convert to PDF when visual layout matters.

Reference albums collect up to ten updates during a 750 ms window and share one download deadline. Items arriving later receive the usual busy response if processing has begun. Send files separately and wait for each reply when predictable batch membership matters.

Examples:

```text
[photo] Read this sign and translate it into English.
/image A realistic cat portrait in a spacesuit, square composition
[reply to that image] /edit Replace the background with a beach
[PDF] Summarize the obligations and point to the relevant pages.
[follow-up] What does section 4 say?
/search What changed in the latest Node.js release?
/new Work
/remember Answer concisely in English.
/voice auto
```

## Data and limits

Production state is saved to `STATE_DB_PATH` (default `./data/bot.sqlite`). **Text history, images, documents, conversation names, saved notes and voice preferences are private local data.** Keep this file out of source control and use a persistent Docker volume. `:memory:` selects disposable state. Tests inject isolated stores and do not open your production database.

Saved conversation names, notes and voice settings survive restarts. Retained message history and attachments also survive restarts **within TTL and capacity limits**. History defaults to one hour of inactivity and 20 complete turns per conversation. Expired histories are pruned at startup and on subsequent conversation access; names and explicit notes are retained separately. `/reset` preserves other conversations and saved notes. `/forget` removes saved notes but cannot erase earlier text containing the same information; clear affected conversations too when needed.

Foreground updates are serialized per user. A background job locks its conversation; foreground work in another conversation can proceed within the global concurrency cap. `/stop` remains available during foreground work. Overlapping foreground updates receive a busy response. Provider failures do not commit partial turns. Successful complete-turn writes and capacity evictions are transactional in SQLite. Text and media have bounded request/history budgets. Daily quotas and configurable estimated-spend reservations apply separately; see the Pro workspace commands below. Estimates are not provider invoices or a hard billing cap.

Text, audio, attached files, saved notes and relevant history are sent to OpenAI for requested processing. Search may send generated queries to search providers. Responses use `store: false`; this does not establish zero retention by OpenAI or Telegram. Requests and raw provider exceptions are not logged. The SQLite file is access-restricted but is **not encrypted at rest** by this application.

## Find your workflow

Open `/guide` (also shown by `/help`) for buttons grouped by tasks, context, documents, projects, costs and data transfer.

| Goal                               | Start here                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Track an action                    | `/task add Review draft`, `/tasks`, Done button                                 |
| Continue long conversations        | `/recap`; reply to a specific retained bot answer                               |
| Keep names/translations consistent | `/glossary set term \| preferred meaning` in a selected project                 |
| Process multiple documents         | `/batch summarize`, `/batch extract fields`, `/batch table instructions`        |
| Review expensive work              | Confirm the configured estimate before explicit images/jobs/batches             |
| Move to another installation       | `/data`, then reply to the archive with `/import` and inspect the merge preview |

See [Pro workflows and transfer limits](docs/pro-workflows.md). All tests remain unit-only; live/native behavior is not qualified by coverage.

## Daily workflows

Daily workflows make the main workflows accessible from a short guided start and contextual answer buttons. `/start` opens setup for a new user and Today after setup; `/help` and `/guide` retain the complete reference.

| Goal                              | Entry point                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Get a useful first result         | `/onboarding`: focus, language, explicit Try example; Skip setup is free       |
| Act on an answer or photo         | Checklist, risks, translation, tasks, comparison and studio-background buttons |
| Turn voice notes into actions     | `/notes on`, send voice, inspect summary/deadlines, Create reviewed tasks      |
| See what needs attention          | `/today`; optional `/morning 09:00` in `/timezone`                             |
| Read an article and ask questions | Send a standalone public HTTPS URL or `/read URL \| focus`                     |
| Reuse favorite workflows          | `/scenarios`, `/favorites`, `/favorite add polish`, `/run polish \| draft`     |
| Resume a project deliberately     | `/continue`, choose a conversation, review/exclude context before generation   |

No task is created from a generated proposal until you confirm. Today/morning are local overviews with no model call. Article reading downloads a bounded public page and sends its readable excerpt for requested processing; scripts, login and paywall bypass are unsupported. Favorites reuse existing templates; legacy `/run name {"variable":"value"}` syntax remains supported.

See the [daily workflow guide and acceptance](docs/pro-daily.md) for complete syntax, costs, limits and privacy. Source/docs remain English; multilingual UI values are isolated in the locale catalog. Schema 3 and archive format 2 remain unchanged.

## Pro experience

Delivery controls include saved evidence, project accounting and structured files. Start with `/guide delivery`, `/guide saved` or `/guide outputs`.

| Goal                              | Commands                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Reduce notification noise         | `/quiet 22:00-08:00`, `/digest 1h`, `/notifications`, `/digest now`          |
| Save useful passages              | Save answer/source buttons, `/bookmarks #work`, `/bookmark reply \| work`    |
| Inspect cited evidence            | Source-card buttons or `/sources` on a retained answer                       |
| Limit a project's estimated spend | `/project_budget 2`, `/project_usage` inside a selected project              |
| Export validated rows             | `/output csv name,amount \| Extract these fields from the retained document` |
| Manage queued work                | `/queue`, `/priority ID 9`, `/defer ID \| 2027-01-15 09:00`                  |
| Select languages independently    | `/language ui ru`, `/language answer en`                                     |

Quiet hours delay background notifications; work can still run. Manual result retrieval remains immediate. Project counters share owner caps and use UTC. Source cards retain excerpts; opening a card does not fetch a webpage. Structured output checks shape, not factual accuracy. UI catalogs cover navigation/common controls in English, Russian and Spanish with English fallback for uncatalogued technical text; generated and quoted content is preserved.

Current state uses SQLite schema 3 and archive format 2. Read the [experience guide and acceptance](docs/pro-experience.md) for historical upgrade details and keep a private pre-upgrade backup for rollback.

## Pro productivity

- Branch or revise retained turns while preserving the original conversation.
- Search a project library of text/PDF documents locally and ask grounded questions with passage references.
- Save reusable prompt templates with named variables.
- Collect forwarded text/captions and summarize only when requested.
- Configure model, project, mode, voice and local limits through `/settings` buttons.
- Rate retained answers with explicit feedback reasons.
- Review/exclude history, files, notes, instructions and retrieved excerpts before sending with `/context`.

See the [productivity workflows and limits](docs/pro-productivity.md) and [full user guide](docs/USER_GUIDE.md). PDF library extraction uses PDF.js; tests mock the parser and do not parse real files or run workers.

## Pro workspaces and controls

| Workflow                        | Commands or controls                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Usage and local spending limits | `/usage`, `/budget 5`, `/limits image 3`                                                                 |
| Incremental answers             | Streaming text; Stop, Retry, Shorter, More detail and Read aloud buttons                                 |
| Projects and references         | `/projects`, `/project new Work`, `/project use id`, `/project attach` when replying to a document       |
| Conversation preferences        | `/mode developer`, `/instructions text`, `/retention 3600`                                               |
| History and exports             | `/find words`, `/export markdown`, `/export pdf`, `/export json`                                         |
| Document comparison             | `/compare focus` with two retained/project documents                                                     |
| Image controls                  | `/quality medium`, `/size 1536x1024`, `/versions`, `/revert id`; variation and previous-version buttons  |
| Background work                 | `/job research question`, `/jobs`, `/cancel id`, `/result id`, `/job delete id`                          |
| Reminders and summaries         | `/timezone Asia/Tbilisi`, `/remind every 2h \| Take a break`, `/summary every 1d \| Summarize decisions` |
| Schedule management             | `/schedules`, `/unschedule id`                                                                           |
| Local data controls             | `/data`, `/erase`, `/erase confirm`                                                                      |

Daily accounting uses UTC regardless of schedule timezone. Defaults allow 100 paid operations and $10 of **configured cost estimates** per owner/day. Tool calls and speech have separate limits. Failures and cancelled attempts retain their reservations because provider charges may already have occurred. Configure provider-side spending controls too. `/erase` retains minimal current-day quota counters to prevent limit bypass.

Projects and jobs retain files independently of conversation TTL. PDF export embeds a bundled font for Latin, Greek and Cyrillic text with limited punctuation; unsupported characters produce a clear error directing you to Markdown/JSON. No cloud PDF conversion is used. See the [user guide](docs/USER_GUIDE.md) for full syntax and lifecycle rules.

## Development and tests

```sh
npm run verify         # the same static/unit/coverage/advisory gates as CI
npm run check          # types, lint, formatting, unit tests and production compilation
npm run test:unit      # unit tests only; npm test is equivalent
npm run test:coverage  # require 100% executable src lines, branches and functions
```

Tests live beside their implementation in `__tests__`; shared in-memory doubles live in `src/__tests__/helpers.ts`. Production compilation excludes every `__tests__` directory. Only test files are excluded from coverage; production code has no coverage-ignore annotations.

**Only unit tests are authorized and maintained.** HTTP/WebSocket transports, SQLite/filesystem access, process lifecycle, FFmpeg spawning and PDF rendering use controlled doubles. Tests do not call live services, open databases, run application subprocesses, invoke FFmpeg, build Docker or render browsers. They require no API keys and incur no API charges. Node's experimental module-mocking flag is included in test scripts.

The tracked `pre-push` hook installs the exact lockfile without lifecycle scripts, then runs `npm run verify`: static checks, unit tests, the 100% coverage gate and a dependency advisory query (`npm audit`, network metadata only). CI uses the same verification command. The hook requires a clean worktree and an outgoing commit matching checked-out HEAD, rechecks both after verification, and stops on any failure. Run `npm run hooks:install` after an install with `--ignore-scripts`; ordinary npm installation runs the installer through `prepare`. Existing custom hooks are preserved and require deliberate integration. It does not install FFmpeg or build Docker. Unit coverage establishes exercised local control flow; live model access, native SQLite durability, PDF layout, audio fidelity and deployment behavior remain unqualified. npm is the sole package manager; commit lockfile changes with dependencies.

## Documentation

- [Full feature catalog](#complete-feature-catalog)
- [User guide](docs/USER_GUIDE.md)
- [Pro Suite: twenty connected workflows](docs/pro-suite.md)
- [Pro Studio: missions, results and workspace](docs/pro-studio.md)
- [Provider workbench and setup](docs/pro-provider.md)
- [Daily workflows and acceptance](docs/pro-daily.md)
- [Pro experience, limits and acceptance](docs/pro-experience.md)
- [Configuration reference](docs/configuration.md)
- [Operations, Docker, backups and live verification](docs/operations.md)
- [Architecture and test conventions](docs/architecture.md)
- [Pro roadmap and acceptance](docs/pro-roadmap.md)
- [Changelog](CHANGELOG.md), [contributing](CONTRIBUTING.md), [security](SECURITY.md), [license](LICENSE)

Official API references: [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [image generation](https://developers.openai.com/api/docs/guides/tools-image-generation), [file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [Realtime audio](https://developers.openai.com/api/docs/guides/realtime-conversations), [Telegram Bot API](https://core.telegram.org/bots/api).
