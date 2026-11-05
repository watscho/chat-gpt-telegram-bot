# Daily routines

Current release: **12.0.0**.

This guide covers six daily-use workflows and a personalized home panel. Only isolated adjacent unit tests and static/build checks qualify the implementation; no paid provider, native parser/media, browser, integration or deployment tests are authorized.

| Capability                          | Acceptance path                                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar-aware day planning         | Explicit configured calendar read with exact MCP approvals; reviewed bounded event snapshot; deterministic duration/priority/free-window suggestions; fresh task/calendar review before saving; no automatic calendar writes                       |
| Evening review                      | Inspect accepted day slots and actual task state; explicitly complete, keep or carry existing tasks; source revision checks and idempotent recovery; no duplicated tasks                                                                           |
| Expenses, subscriptions and refunds | Receipt extraction through a reviewed Studio plan; explicit integer-minor-unit ledger acceptance; currency-separated totals, correction/deletion, recurring charge dates and opt-in due reminders; confirmed refunds cannot exceed recorded charge |
| Spaced repetition                   | Explicitly create cards from accepted learning/selected sources or manual text; source-bound model proposals; reveal before one-use grading; deterministic documented intervals, progress and due reminders                                        |
| Waiting for replies                 | Explicit source/request/contact/check-date records; optional scoped MCP thread reads with approvals; reviewed response evidence/status; fresh follow-up draft with no sending; manual reply/close controls                                         |
| Selected-source reading digest      | Opt-in public HTTPS/RSS sources with pinned bounded fetch; canonical-link deduplication, topic preferences, read/save/hide controls; local daily selection with source links; separately approved model brief                                      |
| Personalized home                   | Three owner-chosen shortcuts, today/next-action overview, focus timer, Telegram controls and signed Mini App actions; optional supported home-screen shortcut; no automatic paid actions                                                           |

## Start with a useful day

Open `/home` for local counts, three shortcuts and a signed workspace button. `/home shortcuts plan review reading` changes the three actions. `/home workspace` opens the Home section of the existing Mini App; supported Telegram clients expose an explicit **Add to home screen** button. Configure the existing `/timezone` setting before entering local dates. Example dates below must be replaced with your own future dates.

A fresh installation does not subscribe to sources, enable notification schedules, read a service, invoke a model or send correspondence automatically. The local focus timer, expense arithmetic, recall grading, day scheduling and top-five selection do not call a model. Model and MCP operations first create an inert Studio mission: inspect its frozen inputs/model/estimate with `/mission ID`, approve execution there and separately approve exact MCP calls in Telegram. Provider estimates and quotas retain their existing meaning.

## Calendar and evening review

```text
/task add Prepare proposal
/day task TASK_ID 45 8
/day calendar use CALENDAR_CONNECTION_ID
/day calendar sync YYYY-MM-DD 09:00 18:00
/mission MISSION_ID
/day preview
/day confirm TOKEN REVISION
/day plan
/day confirm TOKEN REVISION
/day evening
/day evening set TOKEN REVISION TASK_ID done
/day evening set TOKEN REVISION TASK_ID carry | YYYY-MM-DD 10:00
/day evening note TOKEN REVISION | Finished the proposal; waiting on the client.
/day confirm TOKEN REVISION
```

`/day calendar` lists configured choices. The operator must supply an owner-scoped MCP connection exposing dedicated calendar **read-only tools and credentials**. The application requests reads and exact tool approval; a tool name alone cannot establish remote semantics. Never approve an unexpected write. This feature does not move/create calendar events; use an explicitly reviewed existing service chain if needed.

Manual alternative, after actually checking your availability:

```text
/day calendar manual YYYY-MM-DD 09:00 18:00 | []
/day calendar manual YYYY-MM-DD 09:00 18:00 | [{"title":"Meeting","start":"YYYY-MM-DD 10:00","end":"YYYY-MM-DD 11:00"}]
```

Review full attached JSON, including source coverage, busy intervals, timezone and timestamps. Empty/missing provider access is not proof of availability. Calendar evidence expires after 15 minutes; a window is at most 16 hours with 200 intervals. The deterministic planner merges busy intervals and uses open tasks, priority 0–9 (descending), earliest deadline and stable ID; duration defaults to 25 minutes and supports 1–480. Tasks are not split; each scheduled task reserves a five-minute buffer. Unscheduled tasks stay open. The accepted plan is a snapshot, not a live booking or calendar reservation.

Evening outcomes are `done`, `keep`, `carry` with a future local deadline, or `cancel` (removes the existing task). Task/day changes invalidate acceptance. A persisted Workflow receipt protects task changes if the process stops before the separate day-close commit: reopen the same still-valid preview and confirm again. This is application-level recovery, not a cross-record database transaction. The local review expires after 10 minutes; inspect actual tasks before making a fresh review after expiry. `/day remove PLAN_ID` removes a retained plan only. `/day review MISSION_ID` recreates its local validation/review without another model request, provided its source scope and records still match.

## Expenses and recorded obligations

```text
/expense scan | Read the visible total, merchant, currency and date.
/expense add | Coffee shop | YYYY-MM-DD | GEL | 12.50 | Food
/expense correct TOKEN REVISION 1 minor | 1250
/day confirm TOKEN REVISION
/expense total YYYY-MM
/expense subscription add month | Music | EUR | 9.99 | YYYY-MM-DD
/expense subscription paid SUBSCRIPTION_ID YYYY-MM-DD
/expense subscription paid SUBSCRIPTION_ID YYYY-MM-DD confirm
/expense refund EXPENSE_ID YYYY-MM-DD 2.50
/expense received REFUND_ID YYYY-MM-DD
/expense received REFUND_ID YYYY-MM-DD confirm
```

Attach or reply to an explicit receipt image/document for scanning; it does not retrieve previous attachments or project/history context. Inspect the Studio result and source before accepting the separate ledger preview. One total per receipt is proposed; ambiguous/missing extracted fields require a corrected manual charge. Correction fields are `merchant`, `date`, `currency`, `minor`, `category`; row numbers start at one. `minor` is an integer string, not a decimal amount. Same retained attachment-set hash is deduplicated; this does not detect a rephotographed receipt. Accepted mission origins prevent repeated acceptance within the retained acceptance window.

Supported currencies: USD/EUR/GBP/GEL (2 decimal places), JPY (0), BHD/KWD (3). Manual amounts reject signs, exponent notation and excess precision. Ledger arithmetic uses integer strings and BigInt; monthly totals remain separate per currency with no FX conversion. Refunds reduce totals and must be linked to an existing charge; outstanding/received refund cases together cannot exceed it. Closing an expected refund records no money. Dates/payments are user-recorded evidence, not bank verification. Payments and refund receipts require literal `confirm` after inspecting their preview. Nothing charges a provider, cancels a subscription or requests a refund.

Subscriptions support `month` or `year`, preserving the original billing day and clamping month ends. `/expense subscription on|off|remove ID` controls local reminders/settings. Active obligations within three days and due waiting refunds produce a local reminder, respecting quiet hours. `/expense subscriptions`, `/expense refunds`, `/expense close ID`, `/expense remove ID` and `/expense export` inspect/manage records. Refund evidence and linked original charges cannot be deleted individually; export and use `/expense clear confirm` to remove the entire ledger/refund history. Subscription settings remain until explicitly removed.

## Learning that continues tomorrow

```text
/review from COURSE_ID | Practice the core concepts.
/review from selected
/review add | When is a durable claim stored? | Before its external effect.
/day confirm TOKEN REVISION
/review next
/review reveal TOKEN
/review grade TOKEN good
/review notify 09:00
/review notify off
```

Accepted Suite courses or explicitly selected Suite excerpts supply the only source material. Proposed cards require exact source quotes; quote matching does not establish factual accuracy. Manual cards use their explicit answer as evidence. Inspect and accept the separate proposal before studying. The Home panel and Telegram hide the answer until reveal; rating consumes the scoped session once. Sessions expire after 10 minutes and bind the owner/conversation/project/card revision.

Scheduling is deterministic: initial level 0; `good` advances one level, `easy` two, capped at 6. Levels 1–6 correspond to 1, 3, 7, 14, 30, 60 days. `again` resets to 0, increments lapses and schedules in 10 minutes; `hard` preserves the level and schedules in one day. These are fixed intervals, not a calibrated learning model. `/review` shows counts/progress; `/review remove ID` deletes a card. Opt-in due-card reminders occur at most once per local day.

## Waiting without forgetting

Reply to the original text request, or select a Suite source excerpt first:

```text
/waiting add | Alice | Review the proposal | YYYY-MM-DD 10:00
/waiting bind ID MAIL_CONNECTION_ID | exact-provider-thread-reference
/waiting check ID
/day confirm TOKEN REVISION
/waiting draft ID | Keep it concise.
/waiting send ID | Use the reviewed draft only.
/waiting reply ID | Explicitly copied response.
/waiting snooze ID | YYYY-MM-DD 10:00
/waiting close ID
```

Optional fifth pipe field on `add` is the original sent local datetime; default is now. Checking is manual: it creates a separately approved read mission for that exact connection/reference. `replied` requires an exact evidence quote and a finite timestamp after the latest original request/recorded reply; partial evidence remains `unknown`. Inspect the source and reported timestamp before accepting. Unknown/waiting results update the check receipt without claiming a reply. A due notification does not query an inbox. Snoozing keeps earlier evidence and requires a newer reply timestamp for a later service proposal.

`draft` creates text only. `send` creates the existing chain with an editable draft, review pause and separate exact tool-call approval; it does not send immediately or automatically update the tracking record. `/waiting show ID` downloads the full record and `/waiting remove ID` deletes it. Tool permissions and provider reference/recipient correctness remain visible user/operator responsibilities.

## Reading worth opening

```text
/reading add rss 6 https://example.com/feed.xml
/reading add page 24 https://example.com/article
/reading topic 3 | TypeScript
/reading topic hide | celebrity
/reading check SOURCE_ID
/reading
/reading more ITEM_ID | TypeScript
/reading less ITEM_ID | TypeScript
/reading read ITEM_ID
/reading unread ITEM_ID
/reading save ITEM_ID
/reading hide ITEM_ID
/reading delivery 08:30
/reading delivery off
/reading brief ID,ID | Focus on practical implications.
```

Only subscribed public HTTPS sources are fetched; links are not crawled. RSS 2.0 and Atom support bounded UTF-8 XML with no DTD/entity declarations, at most 100 entries, 5,000 tags and 32 nested tags. A page contributes a single current article excerpt. Public DNS resolution, pinned addresses, redirects and response limits reuse the article reader (10-second transport deadline, 1 MB response limit); private/loopback destinations, credentials, custom ports, unsupported encodings and non-UTF-8 responses are rejected. No login cookies or private provider tokens are sent. XML parsing is a pure JavaScript dependency, covered with synthetic documents; actual network services remain unqualified.

Canonical links strip fragments and tracking parameters; retained link identities deduplicate sources and previously pruned entries. Read/saved flags survive refresh, sources remain attributed. Topics match normalized phrases in title/excerpt: weights −5…5 adjust ordering; hidden topics exclude an item. `/reading topic show | phrase` reverses a topic exclusion and weight 0 removes a weight. More/less accepts a phrase actually present in the selected item. Top five ranks by weighted relevance, date and stable ID; this is transparent local ranking, not model personalization. Sources may be wrong or stale. Saved bookmarks retain title/URL and a bounded excerpt; save does not download the linked page.

One due source is fetched per worker tick globally. A claim advances its next read before network work; interrupted attempts wait for that interval or an explicit manual check. Source revisions and abort signals prevent a disabled/removed source from committing a late result. `/reading sources`, `/reading topics`, `/reading on|off|remove SOURCE_ID` and `/reading export` expose lifecycle controls. Removing a source drops its attribution and disposable orphan items; saved orphan material remains in owner state/bookmarks. No model summary runs on a schedule. `brief` creates a separately approved mission with only the selected retained items and source links.

## State, limits and operations

All records live in owner-scoped `routines` state under the existing database schema; Workflow evening receipts are optional bounded metadata. No new SQL migration or archive format is introduced. `/data` exports the owner routines; `/day export` includes the whole routine scope, with dedicated expense/reading exports. Archive import intentionally does not activate imported routine subscriptions, timers, financial records or pending reviews; destination routines remain unchanged. `/erase confirm` aborts active reading and removes owner routines. Conversation deletion/reset invalidates its pending review/card session but keeps owner ledgers/cards/plans/subscriptions until explicit deletion/erase. Project deletion invalidates scoped previews through current-scope checks; owner records are independent of project TTL.

Limits per owner: 31 retained day plans, 500 expenses, 50 subscriptions, 100 refund cases, 200 cards, 100 reply records, 20 sources, 500 retained reading items, 100 task preferences, 20 weighted and 20 hidden topic phrases. Seen links retain 5,000 identities; acceptance origins retain 1,000; alerts retain 100; evening recovery receipts retain 100. Serialized routine state is bounded by the lower of 2 MB and `MAX_JOB_BYTES`. Export/remove old material before reaching capacity. Receipt/card proposals accept 1–20 rows; model briefs select 1–5 items. Origin/link deduplication is bounded retention, not an indefinite guarantee against manually re-entered duplicates.

Scheduled reading, reminders and focus timers require persistent state, a running bot worker and an allowlisted private owner. Delivery honors quiet hours and claims each reminder before transport. A failed/uncertain send is **not retried automatically**; `/day alerts` and Home show delivery failures for manual inspection. `/day alerts clear` clears the visible log while preserving current deduplication claims. Process downtime delays due reminders; local daily schedules use the configured timezone and are not precise alarm guarantees. `/focus 25 [TASK_ID_OR_none]` and `/focus stop` control the local timer.

Upgrade: stop the worker and back up private state before installing the new locked dependencies/application. Restore the pre-upgrade application and state together for rollback; do not expect older releases to operate new records. Existing `MINI_APP_URL`, `STATE_PATH`, user allowlist, MCP connection settings, task limits, quiet hours and cost estimates remain authoritative. No additional provider account is required for local features. Real service/calendar/mail, native database durability, Telegram home-screen behavior and hosted deployment have not been acceptance-tested; adjacent unit tests use mocked ports and DOM/transport doubles.
