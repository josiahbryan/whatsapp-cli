# whatsapp-cli — Design Spec

- **Date:** 2026-04-16
- **Author:** Josiah Bryan
- **Status:** Draft (pending user review before implementation plan)

## 1. Goal

A TypeScript command-line tool — distributed as a single self-contained binary per platform — that lets humans and AI agents **query**, **stream**, and **send** WhatsApp messages through a persistent local daemon.

### Priority of use cases

1. **C — Query history (primary).** `whatsapp-cli history`, `search`, `chats`, `who`, `group` — fast, agent-friendly reads over a local SQLite mirror of the user's WhatsApp messages.
2. **B — React to incoming (secondary).** `whatsapp-cli tail --follow` streams new messages as JSON lines; `tail --since <cursor>` for pull-based agents.
3. **A — Send (tertiary).** `whatsapp-cli send`, `react` for outbound from scripts and agents.

### Non-goals (v1)

- Windows support (WSL is fine).
- npm-published distribution (curl one-liner only).
- Edit-history tracking.
- systemd / launchd service files.
- Multi-account exposed in CLI surface (architecture supports it; only `default` is shipped).
- Homebrew tap.

## 2. Why a daemon is required

`whatsapp-web.js` drives a headless Chromium that holds an authenticated WhatsApp Web session. There is no REST endpoint to poll. If the process dies, incoming messages are not retained by WhatsApp for replay beyond a limited buffer. Therefore some process must stay running to capture messages. The daemon owns that responsibility; the CLI is short-lived and auto-boots the daemon when needed.

## 3. Architecture

### Processes

- **`whatsapp-cli`** — the compiled binary, invoked as a short-lived CLI per command.
- **`whatsapp-cli daemon start`** — the same binary, run as a long-lived background process. One daemon per account.

The CLI auto-spawns the daemon (`process.execPath` with `daemon start`) when a command requires it. Users never need to run `daemon start` manually.

### Paths

All state lives under `~/.whatsapp-cli/accounts/<account>/`:

```
session/            # whatsapp-web.js LocalAuth data (Chromium user dir)
db.sqlite           # canonical store, WAL mode
db.sqlite-wal       # WAL file
files/              # downloaded media (images, audio, docs)
control.sock        # Unix socket for daemon IPC (mode 0600)
daemon.pid          # running daemon's PID, also serves as exclusive-start lock
daemon.log          # rotating log (10MB cap, 1 generation)
qr.png              # exists only while in qr_required state
state.json          # current daemon state, updated on every transition
```

`<account>` is `default` in v1. The account name is a filesystem namespace, not a table column.

### IPC

- **Writes and streams** go over the Unix socket at `control.sock`, speaking line-delimited JSON-RPC.
- **Reads** (`chats`, `history`, `search`, `who`, `group`, `contacts`) open `db.sqlite` directly in read-only mode. This keeps the daemon out of the hot path for queries. SQLite WAL ensures readers never block the writer.

### Socket protocol

Requests:
```json
{"id": "<uuid>", "method": "<name>", "params": {...}}
```

Responses:
```json
{"id": "<uuid>", "result": ...}
{"id": "<uuid>", "error": {"code": "...", "message": "..."}}
```

Server-initiated events (for subscribers):
```json
{"event": "message", "data": {...}}
{"event": "state", "data": {"state": "qr_required"}}
{"event": "reaction", "data": {...}}
```

Methods (v1): `status`, `send`, `react`, `subscribe`, `unsubscribe`, `shutdown`.

## 4. Data model (SQLite, WAL mode, `PRAGMA user_version` migration ladder)

```sql
CREATE TABLE chats (
  id         TEXT PRIMARY KEY,       -- wa chat id ('15551234567@c.us' or '...@g.us')
  kind       TEXT NOT NULL,          -- 'dm' | 'group'
  name       TEXT,                   -- contact pushname or group subject
  phone      TEXT,                   -- E.164 for dm, null for group
  updated_at INTEGER NOT NULL        -- epoch ms of latest message
);
CREATE INDEX chats_updated_at ON chats(updated_at DESC);

CREATE TABLE messages (
  rowid               INTEGER PRIMARY KEY,          -- tail cursor
  wa_id               TEXT NOT NULL UNIQUE,         -- whatsapp id; dedup key
  chat_id             TEXT NOT NULL REFERENCES chats(id),
  from_id             TEXT NOT NULL,
  from_name           TEXT,                         -- snapshot at capture time
  from_me             INTEGER NOT NULL,             -- 0/1
  timestamp           INTEGER NOT NULL,             -- epoch ms from whatsapp
  type                TEXT NOT NULL,                -- chat|image|video|audio|voice|document|sticker|system
  body                TEXT,                         -- text body or caption
  quoted_wa_id        TEXT,                         -- wa_id of replied-to message (may dangle)
  attachment_path     TEXT,                         -- absolute path under files/
  attachment_mime     TEXT,
  attachment_filename TEXT
);
CREATE INDEX messages_chat_ts ON messages(chat_id, timestamp);

CREATE TABLE reactions (
  message_wa_id TEXT NOT NULL,
  reactor_id    TEXT NOT NULL,
  emoji         TEXT NOT NULL,
  timestamp     INTEGER NOT NULL,
  PRIMARY KEY (message_wa_id, reactor_id)
);
CREATE INDEX reactions_target ON reactions(message_wa_id);

CREATE TABLE contacts (
  id            TEXT PRIMARY KEY,
  phone         TEXT,
  pushname      TEXT,
  verified_name TEXT,
  is_business   INTEGER NOT NULL DEFAULT 0,
  is_my_contact INTEGER NOT NULL DEFAULT 0,
  about         TEXT,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE group_participants (
  chat_id    TEXT NOT NULL REFERENCES chats(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  is_admin   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, contact_id)
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  body,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
-- + AFTER INSERT / AFTER DELETE triggers to keep FTS in sync.
```

### Schema rules

- **`from_name` is a snapshot, not a FK** — captures who sent it at the time. `contacts.pushname` is the authoritative current value.
- **Reactions delete on un-react.** No reaction history.
- **Quoted references may dangle** — if the replied-to message predates backfill window, we store the `wa_id` and render "unknown, replied N days ago" in CLI output.
- **Attachments are flat columns** on `messages` (WhatsApp is 1-media-per-message).
- **Tail cursor = `rowid`.** Monotonic, never reused, exposed as the public cursor type.

### Backfill

On first connect, daemon fetches last **250** messages per chat via `chat.fetchMessages({ limit })`. Configurable via `daemon start --backfill N`; `--backfill 0` skips. Inserts use `INSERT OR IGNORE` on `wa_id` so live events and backfill coexist safely. WhatsApp Web only holds whatever history the linked phone has synced — actual backfill counts may be less than requested for older chats; logged per chat.

## 5. Daemon state machine

```
stopped -> starting -> qr_required -> authenticating -> ready
                   \-> authenticating --------------\-> ready    (warm boot, existing session)
                   \-> failed        \-> failed     \-> failed
                                                     ready -> disconnected -> authenticating
```

- `ready` is the only state in which `send`, `react`, `subscribe` succeed.
- `qr_required`: daemon has written `qr.png` and is waiting for the user to scan. Only entered on fresh install or invalidated session.
- `authenticating`: whatsapp-web.js is restoring a session or completing a fresh pair. On warm boot with a valid session, the state machine goes `starting → authenticating → ready` and `qr_required` is skipped.
- `disconnected`: phone offline or session dropped; daemon retries `initialize()` with exponential backoff (1, 2, 4, …, max 60s). If the session is invalidated, state returns to `qr_required`.
- `failed`: unrecoverable (e.g. Chromium launch failed). Daemon exits; next CLI invocation respawns.

Every transition writes `state.json` and broadcasts `{"event":"state","data":{"state":"..."}}` to socket subscribers.

## 6. Pairing flow

1. Daemon starts (cold). Emits `qr` → writes `qr.png` → state `qr_required`.
2. CLI, which subscribed after spawning, receives the state event.
3. CLI behavior:
   - **Non-`--json` mode:** `open <qr.png>` (macOS) or `xdg-open <qr.png>` (Linux); prints "Scan the QR with WhatsApp → Settings → Linked Devices. Waiting..." to stderr; waits for `ready`.
   - **`--json` mode:** prints `{"success":false,"error":{"code":"qr_required","qr_png":"/path/..."}}` and exits with code 2. The agent decides what to do.
4. User scans. Whatsapp-web.js emits `authenticated` → state `authenticating` → `ready`. Daemon deletes `qr.png`.
5. CLI resumes the original command.

## 7. CLI surface

Global flags on every command:
- `--json` — agent-friendly output `{"success": bool, "data": ..., "meta": ..., "error": ...}`.
- `--account NAME` — account selector. Defaults to `default`.

Chat-addressing forms: `+15551234567` (E.164 with `+`), `15551234567@c.us`, `<groupid>@g.us`, or literal `me` for self-chat.

### Query (use case C)

| Command | Purpose |
|---|---|
| `chats [--kind dm\|group] [--grep TEXT] [--limit N]` | List chats, most-recent first. |
| `history <chat> [--limit N] [--before ROWID] [--since ROWID] [--from TIME] [--to TIME]` | Messages for one chat. `TIME` accepts `-7d`, `-1h`, ISO, `now`. |
| `show <wa_id>` | One message with full detail: body, attachment, reactions, dereferenced quoted message. |
| `search <query> [--chat CHAT] [--from TIME] [--limit N]` | FTS5 across all message bodies. Returns stubs with snippets. |
| `contacts [--group CHAT] [--business] [--my-contacts]` | List contacts, optionally filtered. |
| `who <phone\|wa_id>` | One contact: phone, pushname, business info, about line. |
| `group <chat>` | Group detail: subject, participant count, admins, full participant list. |

### Stream (use case B)

| Command | Purpose |
|---|---|
| `tail --since ROWID [--chat CHAT] [--limit N]` | Pull new messages since cursor. Exits when caught up. Prints last rowid to stderr. |
| `tail --follow [--since ROWID] [--chat CHAT]` | Block and stream as JSON lines. Reconnects on daemon drop. |
| `cursor` | Print current max rowid. |

### Send (use case A)

| Command | Purpose |
|---|---|
| `send <chat> <text>` | Text message. stdout = `{wa_id, rowid}`. |
| `send <chat> --file PATH [--caption TEXT]` | Media message. |
| `send <chat> --reply <wa_id> <text>` | Quoted reply. |
| `react <wa_id> <emoji>` | Add reaction. `--emoji ""` removes. |

### Lifecycle

| Command | Purpose |
|---|---|
| `daemon start [--backfill N] [--foreground]` | Explicit start. Auto-invoked by other commands. |
| `daemon stop` | Graceful shutdown. |
| `daemon status` | Current state, uptime, counts. |
| `daemon logs [--follow] [-n N]` | Tail daemon log. |
| `pair` | Force fresh pairing: wipes session, restarts daemon, opens QR. |
| `version` | Binary version + short git SHA. |
| `help [COMMAND]` | Usage. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Auth / QR required |
| 3 | Daemon unreachable |
| 4 | Not found (chat/message/contact) |

## 8. Auto-boot algorithm

1. CLI connects to `control.sock`.
2. ENOENT or ECONNREFUSED → read `daemon.pid`. If the PID is dead (or the file is missing) treat as stale; unlink `daemon.pid` and `control.sock` if present.
3. Spawn `process.execPath daemon start --account <name>` detached with `stdio: 'ignore'`.
4. Poll the socket for up to 30s (250ms cadence).
5. Daemon takes an exclusive lock at startup by creating `daemon.pid` with `fs.openSync(path, 'wx')` (O_EXCL). If that fails and the PID in the existing file is alive and its socket accepts connections, the loser exits cleanly; otherwise the stale PID file is unlinked and the daemon retries once. CLI retries socket connect until a winner is up.
6. If socket never opens in 30s → exit 3 with the last 20 lines of `daemon.log` in the error body.

## 9. Error handling

- **Write atomicity**: every captured message is inserted inside `BEGIN/COMMIT` covering `messages` + any `reactions` + `chats.updated_at`. A crash mid-insert rolls back, and the `wa_id` will be re-delivered via live event or backfill with `INSERT OR IGNORE` semantics.
- **Hang detection (watchdog)**: every 30s, daemon calls `client.getState()` with a 10s timeout. Two consecutive hangs → tear down the Client, transition to `authenticating`, reinitialize.
- **Send during not-ready**: requests fail fast with `{"code":"not_ready","state":"<current>"}`. No server-side queuing; agents decide retry policy.
- **Shutdown**: `SIGTERM`/`SIGINT` → stop accepting new requests → drain inflight → `client.destroy()` (15s cap) → `PRAGMA wal_checkpoint` → close SQLite → unlink `control.sock` and `daemon.pid`.
- **Logging**: `[iso-ts] [level] message key=value ...`. 10MB rotation, 1 backup (`daemon.log.1`).

## 10. Testing strategy

### The seam

The daemon depends on a `WhatsAppClient` interface, not on `whatsapp-web.js` directly:

```ts
interface WhatsAppClient {
  initialize(): Promise<void>;
  on(event, fn): void;
  sendMessage(chatId, content, opts?): Promise<{ id: string; timestamp: number }>;
  getChatById(id): Promise<ChatHandle>;
  getContacts(): Promise<ContactData[]>;
  destroy(): Promise<void>;
}
```

- **Production**: `RealWhatsAppClient` wraps `whatsapp-web.js`.
- **Tests**: `FakeWhatsAppClient` is in-memory. Tests push synthetic events with `fake.emitMessage(...)`, `fake.emitReaction(...)`. No Chromium, no network.

### Layers

1. **Pure-function unit (`tests/unit/`)** — `parseArgs`, chat-id normalization, time parsing, SQL builders, JSON envelope. <500ms.
2. **Daemon-logic integration (`tests/daemon/`)** — FakeWhatsAppClient + real SQLite in tmpdir. Covers event→row, reactions upsert/delete, backfill de-dup, group-participant sync, FTS, state-machine transitions, rollback on mid-insert crash.
3. **End-to-end IPC (`tests/e2e/`)** — spawn real daemon process with `WA_CLI_FAKE_CLIENT=1`, talk via real socket + real CLI. Covers auto-boot, QR resolution, send round-trip, streaming tail, stale-pid cleanup, concurrent spawn safety.
4. **Manual pairing smoke (`docs/manual-tests.md`)** — QR scan, session loss, reconnect. Pre-release only.

### TDD discipline

Every feature starts with a failing test in layer 1, 2, or 3. No task is marked done without pasted `bun test` output showing passing. Every bug fix ships with a regression test.

### CI

GitHub Actions single workflow:
```yaml
- pnpm install --frozen-lockfile
- pnpm run typecheck
- pnpm run lint
- pnpm test
```

Layer 4 is skipped in CI (no real WhatsApp in the runner).

## 11. Distribution

### Cross-compile targets

```
bun-darwin-arm64 → whatsapp-cli-darwin-arm64
bun-darwin-x64   → whatsapp-cli-darwin-x64
bun-linux-x64    → whatsapp-cli-linux-x64
bun-linux-arm64  → whatsapp-cli-linux-arm64
```

### Single binary, two roles

One compiled binary. Running `whatsapp-cli daemon start` selects the daemon subcommand; anything else selects a short-lived CLI command. CLI auto-boot invokes the daemon path via `spawn(process.execPath, ['daemon', 'start', ...])`.

### Chromium

Puppeteer downloads Chromium to `~/.cache/puppeteer` on first daemon start (~170MB, requires internet). Not bundled. Keeps release artifacts small; install is still a single binary.

### Release flow (`scripts/release.sh v0.1.0`)

1. Validate version format (`^v\d+\.\d+\.\d+$`).
2. Clean `dist/`.
3. Cross-compile the four targets via `bun build --compile --target=... --define WA_CLI_VERSION='"v0.1.0"'`.
4. `git tag v0.1.0 && git push origin v0.1.0`.
5. `gh release create` attaching all four binaries + install instructions.

### One-liner install (`scripts/install-remote.sh`)

Detects OS/arch via `uname`, fetches the latest release tag from the GitHub API, downloads the matching binary, installs to `/usr/local/bin/whatsapp-cli` (sudo if needed), verifies via `--version`.

## 12. Project layout

```
whatsapp-cli/
├── .github/workflows/ci.yml
├── .gitignore
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE                                    (MIT)
├── README.md
├── biome.json
├── package.json                               (pnpm-managed)
├── pnpm-lock.yaml
├── tsconfig.json
├── scripts/
│   ├── install.sh
│   ├── install-remote.sh
│   ├── release.sh
│   └── uninstall.sh
├── src/
│   ├── cli.ts                                 (entrypoint, commander setup)
│   ├── version.ts                             (VERSION const, overwritten by release.sh)
│   ├── daemon/
│   │   ├── index.ts                           (Daemon class)
│   │   ├── state.ts                           (state machine)
│   │   ├── server.ts                          (socket + protocol)
│   │   ├── backfill.ts
│   │   └── watchdog.ts
│   ├── wa/
│   │   ├── client.ts                          (WhatsAppClient interface)
│   │   ├── real-client.ts                     (whatsapp-web.js adapter)
│   │   └── fake-client.ts                     (test double)
│   ├── storage/
│   │   ├── db.ts, migrations.ts
│   │   ├── messages.ts, chats.ts, contacts.ts
│   │   ├── reactions.ts, groups.ts, search.ts
│   ├── commands/                              (one file per command)
│   ├── ipc/
│   │   ├── client.ts, protocol.ts, paths.ts
│   └── util/
│       ├── args.ts, time.ts, chat-id.ts, log.ts, json.ts
└── tests/
    ├── unit/
    ├── daemon/
    ├── e2e/
    └── fixtures/
```

## 13. `package.json` shape

```json
{
  "name": "whatsapp-cli",
  "version": "0.1.0",
  "license": "MIT",
  "packageManager": "pnpm@9",
  "scripts": {
    "build":      "bun build --compile --outfile dist/whatsapp-cli src/cli.ts",
    "typecheck":  "tsc --noEmit",
    "lint":       "biome check src tests",
    "test":       "bun test",
    "test:watch": "bun test --watch",
    "setup":      "pnpm install && pnpm run build && bash scripts/install.sh",
    "release":    "bash scripts/release.sh"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "whatsapp-web.js": "^1.26.0",
    "better-sqlite3": "^11.0.0",
    "qrcode": "^1.5.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/better-sqlite3": "^7",
    "typescript": "^5.6",
    "@biomejs/biome": "^1.9"
  }
}
```

- **`better-sqlite3`** over `bun:sqlite` for cross-runtime consistency and tooling support.
- **`qrcode`** (not `qrcode-terminal`) — we write PNGs, not ASCII.
- **pnpm + bun runtime**: pnpm manages lockfile and `node_modules`; bun is the script runner and the cross-compiler. Supported combo.

## 14. Security & privacy notes

- All data is local to `~/.whatsapp-cli/`. No cloud, no telemetry.
- `db.sqlite` and `files/` contain full message content — document in the README that these inherit the machine's filesystem ACLs. Don't back them up to shared drives without thinking.
- `control.sock` is mode `0600` (owner-only).
- This tool uses WhatsApp Web, which is against WhatsApp's ToS for automated bulk messaging. README must carry a "personal use / build at your own risk" disclaimer mirroring what whatsapp-web.js itself says.

## 15. Open questions / deferred

- **Linter choice**: Biome by default; reconsider if team uses ESLint configs elsewhere.
- **Log format**: plain text with `k=v` fields. Revisit if structured (JSON lines) would help.
- **systemd / launchd units**: deferred to a later contrib — the auto-boot handles most cases.
- **Multi-account CLI surface**: schema and paths support it; commands ship single-account in v1.
- **Homebrew tap**: deferred to post-v1.

## 16. First-cut scope for implementation planning

The writing-plans step will break this into tasks. Suggested rough ordering:

1. Scaffolding: repo, `package.json`, `tsconfig.json`, CI, LICENSE, README skeleton, commander wiring for `version`.
2. `util/` pure helpers: `chat-id.ts`, `time.ts`, `args.ts` — layer-1 tests first.
3. `storage/` + `FakeWhatsAppClient` + layer-2 tests for the write path (messages, reactions, contacts, groups, FTS, backfill de-dup).
4. `ipc/protocol.ts` + `daemon/server.ts` + layer-2 tests for request/response and event streaming.
5. `daemon/index.ts` composing client + storage + server; state machine + watchdog + layer-2 tests.
6. CLI read commands (`chats`, `history`, `show`, `search`, `contacts`, `who`, `group`, `cursor`) — direct-SQLite, no daemon involvement.
7. CLI write commands (`send`, `react`) over socket.
8. Auto-boot + pairing flow + layer-3 e2e tests.
9. `tail --since` + `tail --follow` + layer-3 e2e tests.
10. `RealWhatsAppClient` adapter over `whatsapp-web.js`, plus manual pairing smoke.
11. `scripts/release.sh`, `install-remote.sh`, first tagged release.
