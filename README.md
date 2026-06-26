# ReplyPilot

ReplyPilot is a local Lark message copilot CLI. It polls selected Lark contacts or chats as the user, asks a local agent channel to draft a reply, notifies the owner as a bot, and only sends the reply as the user after the owner confirms it.

ReplyPilot supports local Hermes and Ollama CLI channels. It does not support a Hermes URL service yet. More channels such as `codex` or `claude` can be added later.

## Initialize

```bash
npm run cli -- config init
```

This creates:

- `.reply-pilot/config.json`
- `.reply-pilot/state.sqlite`
- `prompt.md`

Default settings:

- Poll every 30 seconds.
- Look back 10 minutes on the first poll.
- Wait for a 10-second quiet window before drafting a reply.
- Build context from up to 20 recent messages, 120 minutes, and 6000 characters.
- Use the `hermes` channel by default.
- Run Hermes as `hermes -z "<prompt>"`, or Ollama as `ollama run <model> "<prompt>"` after switching channels.
- Mark the request as `DRAFT_FAILED` if the selected local channel times out after 90 seconds.

`.reply-pilot/` and `prompt.md` are listed in `.gitignore`. The Lark App Secret and prompt persona content are stored in plaintext in this local project directory.

## Configure

```bash
npm run cli -- lark app set --app-id cli_xxx --app-secret xxx
npm run cli -- lark user set --open-id ou_me
npm run cli -- lark listeners add --open-id ou_target --alias Alice
npm run cli -- lark listeners add --open-id oc_xxx --alias project-chat
npm run cli -- channels set hermes --command hermes
```

`lark listeners add` supports both:

- `ou_xxx`: poll the P2P chat for a contact open ID.
- `oc_xxx`: poll a specific chat by chat ID.

Optional Hermes arguments:

```bash
npm run cli -- channels set hermes --command hermes --model gpt-5 --provider openai
```

Use Ollama instead:

```bash
npm run cli -- channels set ollama --model llama3.2
npm run cli -- channels set ollama --command ollama --model llama3.2
```

Inspect configuration:

```bash
npm run cli -- config show
npm run cli -- lark listeners list
npm run cli -- channels show
```

`config show` redacts `appSecret` as `***`.

`lark listeners list` tries to resolve each listener to a person or chat name. `ou_xxx` listeners are resolved through contacts. `oc_xxx` listeners use the chat name first; if a P2P chat has no name, ReplyPilot reads recent messages and displays the other sender name. It falls back to the alias or raw ID when resolution fails.

## Prompt

Reply style is controlled by `prompt.md` in the project root. You can edit this Markdown file directly without changing code.

The default template supports these placeholders:

```text
{{persona}}
{{context}}
{{currentMessage}}
{{senderId}}
{{chatId}}
```

At runtime, ReplyPilot fills in the conversation context, current message, sender, and chat information before passing the prompt to the selected channel. The goal is to make the generator imitate how the owner would reply, not to let the local agent improvise freely.

## Run

Run one polling pass for debugging:

```bash
npm run poll-once
```

Run continuously:

```bash
npm start
```

`watch` does two things:

1. Poll `ou_xxx` contacts or `oc_xxx` chats configured in `.reply-pilot/config.json`.
2. Listen for confirmation commands sent by the owner to the bot through `lark-cli event consume im.message.receive_v1 --as bot`.

`watch` hot-reloads listener configuration. After you run `lark listeners add/remove`, the next poll reloads `.reply-pilot/config.json`: added listeners start polling and removed listeners stop polling. Watermarks and pending approval requests are preserved.

## Desktop Pet

ReplyPilot V1 can run with a desktop approval surface:

```bash
export REPLY_PILOT_DESKTOP_BOOTSTRAP_TOKEN="rpb_$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')"
launchctl setenv REPLY_PILOT_DESKTOP_BOOTSTRAP_TOKEN "$REPLY_PILOT_DESKTOP_BOOTSTRAP_TOKEN"
npm run cli -- watch --desktop
npm run desktop:build
open ./src-tauri/target/release/bundle/macos/ReplyPilot.app
```

Run the watcher and the macOS app with the same `REPLY_PILOT_DESKTOP_BOOTSTRAP_TOKEN` value. `watch --desktop` keeps the Lark watcher, approval controller, desktop event bus, and local desktop API running. `ReplyPilot.app` reads the bootstrap token from the user `launchd` environment and exchanges it once for the desktop API token. The old Lark bot confirmation command path remains available as fallback when configured.

The bootstrap token is one-use. If you quit and reopen `ReplyPilot.app`, restart `watch --desktop` with a fresh bootstrap token and update `launchctl setenv` before opening the app again.

Use the built app bundle for local desktop validation on macOS. `npm run desktop:dev` is useful while iterating on code, but the app bundle path above is the expected manual verification path for the desktop pet window.

When the desktop API starts, ReplyPilot creates `.reply-pilot/desktop.json` with a local `apiToken` and owner-only file permissions. The token is used by the Tauri UI when it calls `127.0.0.1:3017`; do not paste this file into chats or docs. `.reply-pilot/` is ignored by git.

The desktop pet starts as a small transparent pixel robot window. It does not show a thinking state for the first incoming message. It waits until the suggested reply is ready, then expands into an approval bubble with the original message and suggested reply. It only shows `思考中` after the user asks for a rewrite.

The local desktop API can also be started by itself for UI development:

```bash
npm run cli -- desktop-api
curl -s http://127.0.0.1:3017/api/health
```

`desktop-api` performs the same runtime config validation as `watch`. A health response only proves the local API is reachable; it is not a real Lark E2E check.

## Message Coalescing And Context

A new message is only a trigger. ReplyPilot does not send a single raw message directly to Hermes.

Messages in the same conversation are coalesced by `chat_id`:

```text
receive A
wait 10 seconds
receive B / C / D
restart the timer
after 10 quiet seconds, draft once using D as the anchor message
```

Before drafting, ReplyPilot loads context before the latest message with three limits:

- `context.lookbackMessages`: default 20 messages.
- `context.lookbackMinutes`: default 120 minutes.
- `context.maxChars`: default 6000 characters.

If the context exceeds the character limit, ReplyPilot keeps the newest messages first and trims older content.

ReplyPilot asks the configured local agent channel to summarize that context before notifying the owner. The summary is separate from the suggested reply so the owner can quickly understand what the other person is asking about before choosing an action.

If a new message arrives while a draft is being generated for the same conversation, ReplyPilot does not generate multiple drafts concurrently. The old draft is marked stale and a new draft is generated from the latest message.

## Notification Format

Bot notifications are sent as Markdown. ReplyPilot tries to resolve the sender open ID to a display name as the user, and falls back to the raw open ID only when resolution fails.

Notification format:

````text
## New message from Alice

### Original message
```text
...
```

### Context summary
```text
...
```

### Suggested reply
```text
...
```

### Actions
- Send: send req_xxx
- Rewrite: rewrite req_xxx <instruction>
- Ignore: ignore req_xxx
````

Confirmation commands:

```text
send req_xxxx
rewrite req_xxxx make it shorter
ignore req_xxxx
```

Chinese command aliases are also accepted: `发送`, `改写`, and `忽略`.

All actions are matched exactly by `requestId`. `send req_xxx` only sends the suggestion for that request.

After a rewrite succeeds, ReplyPilot does not send it automatically. It notifies the owner again for confirmation. The rewrite notification title is:

```text
Rewritten as requested: make it shorter
```

The notification still includes all three actions:

```text
send req_xxx
rewrite req_xxx <instruction>
ignore req_xxx
```

If another message arrives in the same conversation, the old `PENDING_APPROVAL` request becomes `SUPERSEDED`. Sending or rewriting that old request will be rejected, and ReplyPilot will notify:

```text
Suggestion expired
requestId: req_xxx
A newer message has arrived in this conversation. Use the requestId from the latest notification.
```

## Logs

```bash
npm run cli -- logs list --limit 20
npm run cli -- logs show --request-id req_xxx
```

Logs and watermarks are stored in `.reply-pilot/state.sqlite`.

## Auth Check

```bash
npm run cli -- auth-check
```

This runs:

- `hermes --help` for Hermes, or `ollama --help` and `ollama show <model>` for Ollama
- `lark-cli im +chat-messages-list --as user ... --dry-run`
- `lark-cli im +messages-send --as bot ... --dry-run`
- `lark-cli im +messages-reply --as user ... --dry-run`

This only verifies dry-run command shape and local command availability. It does not mean the real integration is complete.

Before using ReplyPilot for real messages, you still need to verify user OAuth, bot event subscription, real contact polling, local channel generation, bot notification, and one confirmed reply end to end.

### Desktop Pet E2E Evidence

The desktop pet path is considered verified only when all of these are true:

- A real configured Lark message creates a pending request.
- The desktop pet shows the message and suggested reply after drafting finishes.
- A rewrite instruction shows the pet's thinking state and produces a new draft.
- Sending from the desktop pet creates a real user reply in Lark.
- `logs show` confirms `SENT` and `sentMessageId`.

Dry-run auth checks, local API health, mock tests, and Tauri window launch are separate checks and do not count as real Lark E2E completion.

## Flow

```text
poll configured listeners
  -> coalesce by chat_id quiet window
  -> load recent context
  -> summarize context with the selected channel
  -> render prompt.md
  -> selected channel drafts a reply
  -> bot notifies owner
  -> owner sends confirmation command to bot
  -> user replies to original message
```

## Test

```bash
npm test
```

The current tests cover CLI configuration, local Hermes and Ollama command invocation, polling deduplication, conversation coalescing, context construction, prompt templates, sender name resolution, Markdown notifications, confirmation commands, stale request rejection, lark-cli IM/Contact command shape, and SQLite log reads.
