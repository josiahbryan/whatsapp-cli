# Manual tests (pre-release only)

These tests require a real phone + a linked WhatsApp account. They are **not** run in CI.

## 1. Fresh pair

```bash
rm -rf ~/.whatsapp-cli/accounts/default
whatsapp-cli pair
```

Expected:
- Puppeteer downloads Chromium on first run (one-time, ~170MB).
- `qr.png` opens in Preview / default image viewer.
- Scan with WhatsApp → Settings → Linked Devices.
- Within ~10s of scan, stderr prints: pairing complete.
- `~/.whatsapp-cli/accounts/default/db.sqlite` exists.

## 2. Backfill sanity

```bash
whatsapp-cli chats --limit 5 --json
whatsapp-cli history "$(whatsapp-cli chats --limit 1 --json | jq -r '.data[0].id')" --limit 10 --json
```

Expected: at least a handful of chats and messages.

## 3. Send round-trip

Send yourself a message from another phone / device, then:

```bash
whatsapp-cli tail --since 0 --limit 10 --json
```

Expected: your test message appears.

```bash
whatsapp-cli send me "self-test $(date)"
```

Expected: the "Me" chat shows the new message on your phone within ~2s.

## 4. Stream

```bash
whatsapp-cli tail --follow --json
```

Send another test from another phone. Expected: a JSON line appears within a couple of seconds. `Ctrl-C` exits cleanly.

## 5. Disconnect / reconnect

With the daemon running, disable wifi on your **linked phone** for 60s and re-enable it.

Expected: `daemon logs -n 50 --json` shows `state=disconnected` then `state=authenticating` then `state=ready`. No intervention required.

## 6. Session invalidation

In WhatsApp → Settings → Linked Devices, revoke the whatsapp-cli session.

Expected: within ~30s, `daemon status` transitions through `disconnected` → `qr_required`. Re-run `whatsapp-cli pair` to recover.
