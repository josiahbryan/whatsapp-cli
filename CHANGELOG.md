# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-04-16

### Changed

- Internal refactor: consolidated duplicated infrastructure across commands and daemon (net −83 lines). New helpers: `src/util/pidfile.ts` (isProcessAlive + readLivePid), `ensureDaemonForAccount` in `ipc/auto-boot.ts`, `chatKindFromId` / `chatPhoneFromId` in `util/chat-id.ts`, `RpcError` + `throwRpcEnvelopeError` in `util/errors.ts`, `getChatById` in `storage/chats.ts`. Collapsed `recordOutgoingText` + `recordOutgoingMedia` into one `recordOutgoing`. No user-facing behavior change.

### Fixed

- `pnpm run build` now bakes the package version into the compiled binary (previously reported `0.1.0-dev` unless built via `scripts/release.sh`).

## [0.1.1] - 2026-04-16

### Added

- Incoming media is now persisted to `files/<sanitized-wa_id><ext>`; DB records the path on the `messages` row (closes a spec gap where `attachment_path` was always `null`).
- `download <wa_id>` RPC + CLI command to backfill attachments for messages captured via the Store.Chat path (which delivers metadata only, no bytes).
- `show <wa_id>` non-JSON output now prints an attachment line (path or `<not downloaded>` plus mime/filename).

### Fixed

- `daemon/index.ts` message handler no longer drops the media buffer emitted by `RealWhatsAppClient`.

## [0.1.0] - 2026-04-16

### Added

- Daemon (`whatsapp-cli daemon start`) owns the whatsapp-web.js session and writes to SQLite.
- Short-lived CLI auto-boots the daemon; reads SQLite directly for queries.
- Query commands: `chats`, `history`, `show`, `search`, `contacts`, `who`, `group`, `cursor`.
- Send commands: `send` (text + media + reply, `me` resolves to self-JID), `react`.
- Stream commands: `tail --since <rowid>`, `tail --follow`.
- Pairing: `pair` wipes session and opens `qr.png`; waits for the old daemon's pidfile to clear before spawning.
- Lifecycle: `daemon start|stop|status|logs`; top-level `status` alias.
- Historical backfill bypasses the whatsapp-web.js `Chat.fetchMessages` wrapper (broken upstream since Jan 2026) via direct `Store.Chat` access.
- Diagnostic logging for whatsapp-web.js lifecycle (`loading_screen`, `change_state`, `auth_failure`) in daemon log.
- `--json` envelopes on every command.
- Cross-compiled binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64.
- One-liner install via `scripts/install-remote.sh`.
