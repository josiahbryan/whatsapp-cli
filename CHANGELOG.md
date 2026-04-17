# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
