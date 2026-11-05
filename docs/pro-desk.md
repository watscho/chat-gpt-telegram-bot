# Personal workspace

Current release: **12.0.0**.

The personal workspace brings eight connected workflows into Telegram and the signed Mini App: selected-passage editing, personal assistants, visual live voice, interactive tables, reviewed browser tasks, photo projects, reviewed voice actions and a connection center. `/hub` provides Ask, Create, My materials, My day and Assistants; the workspace keeps Connections and the existing mission/project sections available alongside them.

## Interaction and verification contract

The interface keeps the existing calm dark surfaces, readable typography, one accent and flat working lists. Ask/Create orient the user, My materials holds editable work, My day retains the daily overview and Assistants exposes explicit instructions/knowledge/tools. Selection, revision and review status explain each action. Existing short reveal/hover transitions respect reduced motion; documents and grids remain the dominant working surfaces, with source photos providing their own visual context.

All model/service work starts as an inert Studio plan with an inspectable source scope, selected model, instructions, materials and estimate. Local model proposals require separate acceptance; external MCP operations always require exact Telegram approvals. Unknown/interrupted paid effects remain uncertain, without automatic paid retry. Only adjacent isolated unit tests and static/build checks qualify this release. Model/service/network/state/RTC/DOM ports use doubles; no paid provider, native image decoding, actual database, browser, integration or deployment acceptance tests are included.

## Edit a document

```text
/canvas add Proposal | text | Original document text
/canvas show DOCUMENT_ID
/canvas save DOCUMENT_ID REVISION | Full edited text
/canvas edit DOCUMENT_ID REVISION START END | Make this passage clearer.
/desk preview
/desk confirm TOKEN REVISION
/canvas restore DOCUMENT_ID REVISION VERSION_ID
/canvas export DOCUMENT_ID VERSION_ID
/canvas remove DOCUMENT_ID confirm
```

In My materials, save a document, select a nonempty passage in its textarea and enter the edit instruction. The model receives the selected text and a bounded surrounding excerpt; other owner files/history are not automatically attached. The returned replacement is a proposal with exact before/after text, source revision and range. Acceptance preserves all text outside the selection. Manual full-document saves, accepted selected edits and restoration create a new revision; the latest 20 text versions are retained. An empty model replacement is rejected so deletion must be an explicit manual edit. Maximum text length is 60,000 UTF-16 code units; Telegram range offsets use the same zero-based textarea convention, with the end offset excluded.

Mini App drafts stay in page memory through navigation/refresh. A draft based on an older revision remains visible and cannot overwrite the latest server revision silently. Save success clears that local draft; Discard removes it explicitly. Closing the Mini App discards unsaved page-memory drafts. Stored documents are plain text/code; the workspace does not execute their content. Before/after comparison applies to the selected passage rather than a claim of semantic equivalence.

## Personal assistants

```text
/assistant add Editor | Be concise and preserve facts. | default | search,analysis
/assistant sources ASSISTANT_ID
/assistant use ASSISTANT_ID
/assistant use none
/assistant ask ASSISTANT_ID chat | Rewrite this paragraph.
/assistant ask ASSISTANT_ID search | Research this question with sources.
/assistant ask ASSISTANT_ID connection:mail | Prepare a reviewed service request.
/assistant show ASSISTANT_ID
/assistant remove ASSISTANT_ID confirm
```

Create a named assistant with instructions, an optional model and explicit tool permissions. `sources` copies the current explicit Suite selection; changes to that selection later do not silently alter the assistant. Sources can be replaced by selecting new excerpts and running `sources` again. A changed source/permission revision invalidates previously planned assistant execution. Selecting an assistant affects ordinary text in that conversation; it supplies its instructions and chosen knowledge, retains the current conversation context, and disables automatic model tools. Owner-wide saved notes/project references are not automatically added. Conversations are still shared context when switching assistants within one chat; create named conversations when separate histories are desired.

Requested search, analysis or configured `connection:ID` calls use `/assistant ask` and an inert plan. Permission grants do not themselves authorize an external action. A connection still requires current owner access and exact approvals. Use photo projects for separately reviewed region editing. An assistant is this bot's local configuration and does not import ChatGPT account assistants, private chats or subscription access.

## Tables, Excel and charts

```text
/sheet import Sales
/sheet analyze Workbook
/sheet from ANALYSIS_MISSION_ID table.csv | Sales
/desk confirm TOKEN REVISION
/sheet show TABLE_ID
/sheet cell TABLE_ID REVISION ROW COLUMN | New value
/sheet restore TABLE_ID REVISION VERSION_ID
/sheet export TABLE_ID VERSION_ID
/sheet remove TABLE_ID confirm
```

Reply to an explicit UTF-8 CSV/JSON file for `import`, or an Excel/document file for `analyze`. Excel extraction uses the existing reviewed provider-side Python analysis and must return an explicit CSV/JSON artifact before a local table can be accepted. Inspect the source, truncation notes, units and missing values. Local import itself does not call a model. JSON shape: `{"columns":["Item","Value"],"rows":[["A","10"],["B",null]]}`. CSV parsing supports quoted commas/newlines, escaped quotes, CRLF and UTF-8 BOM; malformed rectangular data is rejected.

My materials displays 25 rows per page, local text filtering, lexical/numeric sorting, explicit cell editing, version restoration and bar-chart controls. Sort/chart column indices start at zero (`-1` means no sort); Telegram cell row/column numbers start at one. Charts use at most 50 filtered rows, explicit finite numeric strings and a magnitude limit of 10^15; no currency-symbol or locale-separator guessing occurs. Chart controls are visualization, not financial accounting. Tables support 1–20 unique columns, 500 rows and 2,000 characters per text/null cell. The latest 10 row snapshots are retained independently. CSV exports neutralize formula-leading cells and preserve missing values as empty fields. Filtering/chart state is local to the view; downloads export the selected retained table version, not an implied recalculation of filtered totals.

## Photo projects and region edits

```text
/photos add Product photos
/photos show PROJECT_ID
/photos edit PROJECT_ID IMAGE_ID X Y WIDTH HEIGHT | Replace the selected object.
/desk confirm TOKEN REVISION
/photos export PROJECT_ID IMAGE_ID
/photos remove PROJECT_ID confirm
```

Attach or reply to explicit images when creating a project. Send an original PNG as a document to avoid Telegram photo compression when region editing is needed. Project creation accepts supported image references, but exact region masks require original PNG dimensions and at most four million pixels. In My materials, choose a retained version, drag a rectangle on the image and describe the change; Telegram coordinates are original-image pixels. The server builds a PNG alpha mask with transparent selected pixels using bounded byte operations; it does not run an image decoder or execute model code locally.

The paid image plan freezes the source image version and project revision. Generated candidates remain a separate proposal until accepted; originals remain retained. Projects start with 1–8 images and retain at most 20 originals/accepted candidates. Source versions can be selected and downloaded. Image models may change pixels outside the mask; inspect the result before acceptance. No claim of exact pixel preservation or native image/render qualification is made.

## Visual live voice and reviewed actions

Open `/live`. Capture camera frame or Capture screen frame starts a one-frame browser capture only after a user click. All capture tracks are stopped before preview. Inspect the frame and explicitly Send or Discard it. Sending requires an active source-scoped live call and an additional quota reservation; each call permits at most three visual frames. Frames are bounded JPEG previews, at most 1,280 pixels on the longest side. Screen capture depends on Telegram/browser support; no continuous camera/screen stream is started. Captured frames are not stored in Desk, though OpenAI processes them and provider retention rules still apply. The configured image estimate is a conservative local reservation, not a measured Realtime image invoice or hard provider spending cap.

The Realtime function `propose_action` can propose only a local task, a search of retained owner materials, or a draft-only mission. Its exact text is shown before confirmation. Confirm creates the local task, returns bounded selected search excerpts to the live model, or creates an inert text-draft mission with its own later cost approval. Cancel returns a cancellation result. It cannot send mail, change a calendar or run arbitrary tools. Task IDs bind the proposal origin so a repeated confirmation after an interrupted Desk commit does not duplicate a task. Draft recovery finds an already-created mission by its voice origin. Closing/changing the source call/conversation/project invalidates further action review. Voice requests are untrusted proposals, not authorization on their own.

## Browser tasks

```text
/browser add Research browser | browser_connection | https://example.com,https://docs.example.com | observe,navigate,click,type
/browser run RECIPE_ID https://example.com/path | Inspect the form and prepare its fields.
/browser remove RECIPE_ID confirm
```

The operator must provide an **isolated browser MCP driver** as an owner-configured connection. This implements OpenAI's documented custom UI-tool/MCP approach; it does not bundle Chromium or claim to use a hosted browser without configuration. The service must enforce the recipe's network/origin policy, prevent private-network access, keep browser accounts isolated, restrict downloads and disable generic shell/eval/script execution tools. Use only dedicated observe/navigation/click/type tools whose semantics the operator has reviewed.

Every browser tool's JSON arguments must contain an exact approved `origin`. Tool names must be explicitly permitted; nested `url`, `href` and `origin` arguments are checked against the recipe origins before proposals/continuations are processed. These application checks do not prove a remote driver's internal behavior: server-side isolation and origin enforcement remain required. Recipe policy is included in continuation signatures, so changing/removing policy cannot reuse an earlier approval. Every read, navigation, click, typing and submission proposal uses the existing exact Telegram approval flow; page text is untrusted. Stop for login or unclear access and review the selected recipient/form/URL yourself. The mission records stage/approval progress and reported results, without claiming independent verification of a remote action.

## Connections and authorization

`/services` or Connections shows owner-configured endpoints, tools, authentication mode, local enablement and authorization state. Existing operator-managed bearer credentials continue to work. `/services disconnect ID confirm` immediately blocks future local use and removes the saved OAuth access token; `/services enable ID` restores local enablement but does not recreate missing authorization. To revoke a provider-side grant, also remove it in that service's account settings. This is not universal remote token revocation.

For supported providers, add optional OAuth metadata to the existing `OPENAI_MCP_CONNECTIONS` entry:

```json
{
  "id": "mail",
  "owner": 123456789,
  "title": "My mail",
  "server": "https://mcp.example.com/mcp",
  "authorization": "",
  "tools": ["mail_read"],
  "oauth": {
    "authorizationURL": "https://accounts.example.com/authorize",
    "tokenURL": "https://accounts.example.com/token",
    "clientID": "registered-application-id",
    "scopes": ["mail.read"]
  }
}
```

Register the exact redirect URI `${MINI_APP_URL}/oauth/callback` (remove a trailing slash before appending), and optionally supply `clientSecret` for a confidential client. Each provider needs its own correctly registered OAuth application/scopes and a compatible MCP endpoint. Generic metadata does not imply built-in Gmail/Calendar/Drive adapters or universal service availability. Endpoints must be fixed public HTTPS URLs without credentials/query/fragment/custom ports; redirects on token exchange are refused. OAuth supports authorization code + S256 PKCE, a one-use 10-minute state and access tokens with explicit `expires_in` up to one year. Expired tokens require explicit reauthorization; refresh tokens are not retained or refreshed automatically.

`/services authorize ID` creates the provider link. Tokens are AES-256-GCM sealed with owner/connection associated data and a domain-separated key derived from the bot token, and stored in a separate private `connection-auth` scope. Status/Desk/data exports do not contain access tokens, PKCE verifiers, ciphertext or client secrets. Rotating the bot token requires reauthorization. A local permission revision invalidates old service continuations after disconnect/re-enable. Late token exchanges cannot recreate owner state after erase or an intervening connection change. Backups of state and bot credentials remain sensitive and require operator protection.

## Lifecycle, limits and release operations

Desk is an owner-scoped durable record under existing schema 3. Documents/tables/photos and pending proposals also bind the selected conversation/project; assistants/browser recipes are owner-wide. Local reviews expire after 10 minutes and bind token, revision, origin and source hash. Successful origins retain 1,000 identities for bounded duplicate protection. `/desk review MISSION_ID` can recreate only the local validation of a completed Desk workflow in its original scope, without another model call. Portable recipe saving rejects Desk bindings so private IDs/permissions cannot be replayed as a generic recipe.

Per owner: 30 documents, 20 assistants, 20 tables, 10 photo projects and 10 browser recipes, bounded in aggregate by `MAX_PROJECT_BYTES`. Export and remove unused material before capacity is full. `/desk export` exports retained Desk content; `/data` includes Desk and redacted connection permissions. Existing archive import intentionally does not activate source Desk profiles, service grants, browser recipes or pending voice/model reviews. Destination Desk state remains unchanged. Conversation reset invalidates its pending Desk preview and active assistant selection while retaining Desk material independently of history TTL. Explicit conversation/project deletion removes its scoped Desk documents, tables and photo projects, clears matching pending reviews and removes matching copied source excerpts from assistants (incrementing their revisions). Owner-wide assistant/browser definitions remain until explicitly removed. `/erase confirm` removes Desk and connection-auth state alongside the existing owner scopes. Provider resources and backup copies have their separate lifecycle.

The browser clients are now bundled as browser ESM entry points during the existing production build, so shared modules do not depend on unserved relative paths. Only locked compiler dependencies are used. Upgrade application/dependencies together, back up private state and configure public HTTPS Mini App/MCP/OAuth services where needed. Schema/archive formats remain unchanged. Older releases do not operate the new state: restore matching pre-upgrade application/state for rollback. OpenAI account model/tool availability and actual hosted service behavior require separate operator qualification; no live/native/deployment verification was performed as part of this unit-only release.

## API references

- [OpenAI image generation and masking](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI Realtime image inputs](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [OpenAI Realtime tools](https://developers.openai.com/api/docs/guides/realtime-mcp)
- [OpenAI custom UI-tool/MCP integration](https://developers.openai.com/api/docs/guides/tools-computer-use-integration)
