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

The default per-file limit is 10 MB. History and attachments have additional shared budgets. While a request is running, other requests and commands from the same user receive a busy response; wait for completion.

Text, audio, files, saved notes and relevant history are sent to OpenAI. Search queries may reach search providers. History and attachments are also stored locally; the application does not encrypt its database. The operator must protect the database and backups. Provider failures are displayed without private technical details.

For settings and retention rules, see [configuration.md](configuration.md) and [operations.md](operations.md).
