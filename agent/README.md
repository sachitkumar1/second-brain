# Mac agent

`apollo-agent.mjs` runs on your Mac every 10 minutes (launchd). It finds conversations waiting on your reply and uploads an
end-to-end encrypted list to the dashboard. One file, no dependencies, Node.js 22.13+.

```bash
node apollo-agent.mjs setup            # server URL, agent token (Settings → Mac agent), passphrase
node apollo-agent.mjs doctor           # Node version, Full Disk Access, contacts, server connection
node apollo-agent.mjs run --dry-run    # print who's waiting on you; uploads nothing
node apollo-agent.mjs run              # one sync now
node apollo-agent.mjs install          # every 10 minutes via ~/Library/LaunchAgents/com.apollo.agent.plist
node apollo-agent.mjs uninstall
```

Files: config in `~/.apollo-agent/config.json` (mode 600), passphrase in the macOS Keychain (service `apollo-agent`),
log in `~/.apollo-agent/agent.log`.

## What it reads (locally, read-only)

- `~/Library/Messages/chat.db`, your iMessage/SMS history. It needs **Full Disk Access** for the Node binary (`install` prints its path).
- `~/Library/Application Support/AddressBook/…`, to turn phone numbers into names.
- The newest `instagram-*.zip` (or folder) in `~/Downloads`, an Instagram data export in JSON format. It's unzipped into
  `~/.apollo-agent/instagram/`.

## How "waiting on you" is decided

Per conversation, newest message first: if the other person's message is the latest, the conversation is waiting, and the agent counts
their messages since your last reply. Tapbacks (❤️, 👍, …) on *your* messages don't count as messages to answer. Your own
tapback on theirs counts as a reply (turn that off in Settings → Mac agent). Short codes (verification texts), business chats and, by
default, group chats and numbers not in your contacts are skipped. The window is the last 14 days by default. All of this is
configurable in the dashboard; the agent fetches the settings each run.

Message text is used on your Mac only to tell whether they asked a question (a `?`), and is never uploaded.

## What it uploads

To `POST /api/agent/ingest`, per platform: AES-256-GCM ciphertext of
`{ name, phone/handle, waiting since, unanswered count, question?, unread? }` for each waiting conversation. The key is
PBKDF2-SHA256 (600,000 iterations) of your passphrase with a random salt. The server also receives the number of waiting
conversations (for the digest email) and the salt. Thread IDs are HMACs keyed by your passphrase, so even snooze markers
can't be linked to a person.

Lost the passphrase? Run `setup` again with a new one and enter the new one in the browser.

## Instagram API (optional)

If your Instagram account is a **professional (creator) account**, the agent can read live conversation *metadata* instead of
exports. It requests only `from` and `created_time`, never message text:

1. Create an app at [developers.facebook.com](https://developers.facebook.com) → add **Instagram** → *API setup with Instagram login*.
2. Add your account as a tester, grant `instagram_business_basic` and `instagram_business_manage_messages`, and generate a
   long-lived access token.
3. Add to `~/.apollo-agent/config.json`:
   ```json
   "instagram": { "enabled": true, "api": { "token": "IG…", "version": "v23.0" } }
   ```

The agent refreshes the token monthly. This path is untested against a live account (Meta's API changes often), so if it fails the
agent logs the error and falls back to the export.
