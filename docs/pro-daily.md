# Daily workflows: guide and release acceptance

Current release: **11.0.0**.

These daily workflows were introduced in version 7.0.0. Open `/start` for the short entry flow or `/guide daily` for navigation. These workflows reuse private-chat allowlisting, owner/thread binding, existing budgets, cancellation, context review and history limits.

| Scenario                  | User path                                | Unit acceptance                                                                                                    |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Guided start              | `/onboarding` or first `/start`          | Focus/language choices are local; only Try example invokes the model; Skip setup is free                           |
| Contextual actions        | Buttons under a retained answer          | Latest-answer/owner/thread binding; image/document/text-specific inputs; existing edit cost review                 |
| Voice note to tasks       | `/notes on`, voice, review, confirm      | Strict structured extraction, checked deadlines, no pre-confirmation task writes, atomic duplicate-safe creation   |
| Today and morning         | `/today`, `/morning HH:MM`               | Local tasks/results, timezone/quiet boundaries, allowlists, persisted attempts, bounded delivery and no model call |
| Article reading           | Standalone HTTPS URL or `/read`          | Public DNS/IP policy, pinned transport, redirects, bytes/types, cancellation, malformed HTML and retained excerpts |
| Favorite/recent scenarios | `/scenarios`, `/favorites`, `/run`       | Exact template variables, legacy syntax, pagination, bounded IDs and expiring pending input                        |
| Project continuation      | `/continue`, select conversation, review | Scoped local excerpts/open tasks; no generation before reviewing selected context                                  |

## Start with one useful result

New users see a short focus choice: Work, Study or Personal. Then choose English, Russian or Spanish for the interface and example answer. The focus selects a small meeting-checklist, study or planning example; it does not silently overwrite project/model/custom instructions. Try example explicitly uses normal API quota. Skip setup completes the local setup flag and opens Today without generation. `/onboarding` can be reopened later. Commands stay English; common controls have catalog translations, with English fallback for uncatalogued technical text.

After setup, `/start` opens Today. `/help` retains the full command reference and `/guide` the grouped workflow menu. Setup does not clear history or enable voice, schedules or paid background jobs.

## Actions beside the result

Text answers offer Make checklist, Create tasks and Translate. Document answers offer Review risks, Create tasks, Translate and Compare files when multiple current documents were supplied. Image-bearing answers offer Explain image, Translate text and Studio background. These supplement existing response, feedback, source-card and bookmark controls.

Actions resolve the latest retained answer in the current owner's selected conversation. Old/cross-conversation controls fail locally. The request captures that answer and its preceding request/reference inputs; it does not pretend an expired image or file can be recovered. Translation targets the current UI language, preserving identifiers and source quotations; for photos it asks for visible text and for documents their readable content. Model compliance/recognition is not guaranteed.

Studio background is a concrete edit to a neutral studio background, preserving the subject. It reuses the selected image and normal image quotas/cost confirmation. To choose another background, use `/edit your instructions`. Comparison requires the available retained references and must flag uncertainty; a button is not evidence that two versions actually differ.

## Voice note to reviewed actions

```text
/notes on
[voice note describing agreed work and explicit deadlines]
[inspect summary, task titles and proposed deadlines]
[Create reviewed tasks or Cancel review]
/notes off
```

Notes mode is owner-wide and opt-in. Incoming voice uses the normal transcription reservation, then one structured model request for `summary`, `task` and `due` string/null fields. Existing context review still applies before generation. Tools and incremental structured streaming are disabled. Transcription and extraction both use owner/origin-project quotas; there is no automatic paid repair/retry. Normal input/file limits still apply, including extraction-instruction overhead.

At most 10 proposed rows are accepted, with duplicate title/deadline pairs merged. Titles are clipped to 1000 characters in the visible review; the summary is bounded to 4000 characters. Only explicitly stated deadlines should be proposed as `YYYY-MM-DD HH:MM` in `/timezone`. Invalid, past, ambiguous or nonexistent local times produce a warning and a task without a deadline. Review shows accepted deadlines as UTC ISO timestamps. Model extraction can still be wrong: inspect every proposal.

No tasks are created before confirmation. Create reviewed tasks accepts the visible set atomically within the existing 100-task owner capacity; Cancel review creates nothing. To change a proposal first, cancel and request a corrected extraction. After creation use `/task due ID | date` or status/delete controls. If a deadline passes while awaiting confirmation, create a new review. Reviews expire after ten minutes and are owner/thread/revision bound. Another response/reset/deletion can invalidate them.

Task IDs derive from the review token and row index. If the task-record write succeeds but clearing the review fails or the process stops, confirming that same review cannot create duplicate tasks. These are unit-verified persistence contracts, not native crash-durability or exactly-once Telegram qualification. The validated JSON artifact remains a retained assistant document under ordinary history/attachment limits; the review is displayed in place of automatically sending its raw file.

Create tasks under a text/document answer uses the same extraction and review workflow. It never treats a generated list as authorization to create tasks automatically.

## Today and the optional morning overview

`/today` shows up to eight open tasks, nearest dated tasks first, followed by undated tasks. It marks overdue deadlines, shows up to five retained ready-job IDs, project/bookmark counts and the selected conversation. Done and result buttons operate on existing local objects; Continue last work and Scenarios provide the next entry points. The dashboard is an owner-wide snapshot, not an AI-generated priority judgment or calendar integration. Task titles/content are preserved; catalogued labels and date formatting follow the UI language.

```text
/timezone Asia/Tbilisi
/morning 09:00
/morning
/morning off
```

Morning default is off. When enabled, the worker sends the same local dashboard at or after the selected local time, once per local calendar date after successful acknowledgement. Quiet hours postpone it; the bot must be running and ticking. It is separate from job/task digest grouping and makes no model call. Enabling a time already passed can send today's overview on the next eligible tick. There is no replay of every missed past day after downtime.

Each day's attempt is persisted before transport, with up to three attempts and 60-second backoff. Failed delivery retains that claim; retry occurs only on later eligible ticks. A successful send followed by a failed state acknowledgement can duplicate delivery. Changing the time or timezone can change eligibility/reset local-day accounting; this is not an exact alarm or exactly-once service. Turning the setting off during delivery is respected by the acknowledgement guard. Use `/today` for immediate manual access.

## Article to readable reference

```text
https://example.com/article
/read https://example.com/article | Summarize the claims and missing evidence
[follow-up] What supports the second claim?
```

A standalone public HTTPS URL or explicit `/read` authorizes an unauthenticated server fetch, followed by normal model processing of its readable excerpt. The remote host sees the request. No browser, JavaScript execution, cookies, credentials, login or paywall bypass is provided. Upload the text when a page is inaccessible or script-driven. Do not assume a hidden/private link can be fetched, or that the full original article was read.

The reader permits public domain hosts on HTTPS port 443, without URL credentials, IP literals, single-label/local/reserved hosts or trailing-dot variants. Every redirect is revalidated, up to three. All resolved addresses must pass the public-network policy; a validated address is pinned into the HTTPS lookup callback, including Node's all-address lookup form, while hostname/SNI and normal TLS certificate verification remain intact. Private, loopback, link-local, multicast, mapped/transition and documentation/reserved ranges are rejected. A fresh connection avoids global-agent reuse. This reduces server-side request-forgery exposure; operator network controls remain a separate layer.

The combined request/lookup deadline is ten seconds and supports Stop. Downloaded response data is capped at 1 MB; only uncompressed HTML/plain UTF-8 text is accepted. Sequential extraction discards markup, comments and script/style/noscript/SVG contents without running them. It is a bounded text extractor, not a full HTML5 reader or layout parser. Common/numeric entities are decoded; unreadable content is not reconstructed. A readable result needs at least 80 characters, retains at most 20,000 and marks truncation. Titles are bounded to 256 characters.

The excerpt is attached as `article.txt` with URL, title, size/truncation metadata and a retained [A1] card excerpt. It is sent as untrusted reference data with image/search tools disabled. Summaries must distinguish reported claims and unavailable content; citations do not prove truth or instruction resistance. Follow-up questions use retained text without refetching the page until TTL/capacity removes it. Failed/cancelled downloads make no model request; successful reads/extraction can still fail local model-input/file limits before generation. No article cache independent of history is added.

## Favorite and recent scenarios

`/scenarios [page]` shows built-in Polish text, Translate to English, Read an invoice and Plan my next steps, followed by saved templates. Favorites and recent IDs come first, deduplicated; 12 entries appear per page. `/favorites [page]` restricts the list to favorites. Up to 20 favorites and 10 recent attempted scenario IDs are retained; recent means successfully prepared input, not proof of successful model delivery. Deleted template shortcuts are pruned on menu access.

```text
/favorite add polish
/favorite add template:review
/favorites
/run polish | Make this draft clearer
/run template:review | {"text":"Draft to review"}
/run review {"text":"Draft to review"}
```

The last line is the unchanged legacy template syntax. New pipe-form scenarios use built-in IDs or `template:NAME`. If an existing template shares a built-in name, legacy non-pipe `/run NAME` continues to select that template; buttons/new pipe syntax select the built-in explicitly. Templates still require exactly their declared JSON string variables; `{}` runs one without variables. Explicit image/edit template bodies retain normal tool and cost-confirmation behavior. Built-ins are analysis-only requests.

Choosing a button or `/run ID` without input opens a ten-minute owner/thread/revision-bound prompt for the next text/file. Files can be sent with or without a caption. `/scenario_cancel` cancels it. Commands and standalone URLs remain explicit commands/reader requests, rather than silently becoming scenario input. A changed conversation/revision rejects stale pending input. Input is consumed once before preparing a request; invalid input should be supplied again through a new scenario prompt. No second saved copy of the input is kept in favorites/recent IDs.

## Resume without guessing context

`/continue` shows local excerpts from up to five retained conversations in the currently selected project, their recaps and up to eight open actions. Without a selected project it stays within the selected conversation. It labels excerpts as local records, not independently verified decisions; absent/expired history is shown explicitly. Up to ten conversation buttons are offered.

Choose Review context to select a conversation and open the existing inclusion/exclusion preview. No model call occurs until Send selected context. The next-step request uses only that selected reviewed snapshot, including its existing project instructions, files, notes and recap as included. It does not invisibly inject every other project's excerpt. Foreground model work then follows ordinary budget, cancellation and retention controls. Project changes/deletions/history expiry can change what is available; this is deliberate inspection rather than a promise of permanent model memory.

## State, transfer and release checks

The owner `daily` scope is capped at 100 KB. It stores setup focus/completion, notes/morning preferences, favorite/recent IDs, pending input metadata and task-review snapshots. Expired pending/review payloads are cleared lazily on access and persisted before further action. Conversation reset/delete clears its pending input/review; explicit preferences/favorites remain. `/erase confirm` deletes the scope and caches along with ordinary local content; existing minimal quota-counter retention is unchanged.

`/data` includes daily state as private export data. Format 2 import deliberately preserves destination daily settings/favorites/recent/pending reviews and does not restore source daily state, tokens or morning delivery. This avoids replaying schedules/authorizations from an archive. Portable templates, created tasks and retained article/structured documents continue through the established validated merge. Schema stays 3, archive format stays 2, and no new environment variables or dependencies are required.

Historical introduction evidence (7.0.0): 245 adjacent unit tests with 100% executable source lines, branches and functions, unchanged thresholds/exclusions, plus types, lint, formatting, production compilation and static documentation/resource/version checks. DNS, HTTPS, Telegram, model, persistence, clocks and native/process boundaries use controlled doubles. No live URLs/API calls, real databases, FFmpeg, PDF parsing/rendering, browser, Docker, integration, performance or soak tests qualify this release. Production deployment and live provider acceptance remain unverified.
