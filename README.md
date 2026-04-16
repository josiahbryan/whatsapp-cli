# whatsapp-cli

Command-line WhatsApp client for humans and agents. Query your message history, stream incoming messages, and send outbound — all through a persistent local daemon that mirrors your WhatsApp Web session into a local SQLite database.

> **Status:** Pre-alpha. Not yet released.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/josiahbryan/whatsapp-cli/main/scripts/install-remote.sh | bash
```

## Quick start

```bash
whatsapp-cli pair                        # scan QR once
whatsapp-cli chats                       # list recent chats
whatsapp-cli history +15551234567 -n 20  # last 20 messages
whatsapp-cli send +15551234567 "hello"   # send a text
whatsapp-cli tail --follow               # stream incoming as JSON lines
```

All commands support `--json` for agent-friendly output.

## Architecture

A background daemon (`whatsapp-cli daemon start`) owns the whatsapp-web.js session and writes to `~/.whatsapp-cli/accounts/default/db.sqlite`. The CLI is short-lived: it auto-spawns the daemon when needed, reads from SQLite directly for queries, and talks over `control.sock` for writes and streams.

See [docs/superpowers/specs/2026-04-16-whatsapp-cli-design.md](docs/superpowers/specs/2026-04-16-whatsapp-cli-design.md) for the full design.

## Disclaimer

This tool uses WhatsApp Web via [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js). Automated or bulk messaging may violate WhatsApp's Terms of Service. Use at your own risk, for personal use only. No affiliation with WhatsApp or Meta.

## License

MIT
