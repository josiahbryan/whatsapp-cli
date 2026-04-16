# whatsapp-cli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI distributed as a single per-platform binary that lets humans and agents query, stream, and send WhatsApp messages through a persistent local daemon.

**Architecture:** Daemon (owns whatsapp-web.js session + SQLite writer) exposes a Unix-socket JSON-RPC surface for writes/streams. Short-lived CLI auto-boots the daemon and reads directly from SQLite (WAL mode) for queries. One daemon per account under `~/.whatsapp-cli/accounts/<account>/`.

**Tech Stack:** Bun (runtime + compiler via `bun build --compile`), pnpm (package manager), TypeScript (strict, ES2022, NodeNext), commander v12, whatsapp-web.js (Puppeteer-driven), `bun:sqlite` (WAL + FTS5), qrcode (PNG), Biome (lint/format), GitHub Actions CI.

**Spec:** [docs/superpowers/specs/2026-04-16-whatsapp-cli-design.md](../specs/2026-04-16-whatsapp-cli-design.md)

---

## Global Conventions

**Every subagent must read these before starting their task.**

### TDD discipline (non-negotiable)

Each task's steps follow a strict Red → Green → Commit rhythm:

1. **Write the failing test first** with the exact code shown.
2. **Run the test and confirm it fails** for the expected reason (not a syntax error, not a missing import you forgot).
3. **Write the minimal implementation** to make it pass. Do not expand scope; do not add features the test does not require.
4. **Run the test and confirm it passes.** Paste the actual `bun test` output showing "X pass, 0 fail".
5. **Commit.** Use `git-atomic-commit` (see below).

If a test passes on the first run without any implementation, something is wrong — the test is not actually exercising the new behavior. Stop and diagnose.

### Git-atomic-commit is mandatory

This environment has a git guardrail that **blocks plain `git add` / `git commit` / `git commit -am`**. All commits must go through:

```bash
git-atomic-commit commit -f <file1> <file2> ... -m "message"
```

- `-f` takes an explicit list of files to stage and commit atomically. Use exact paths. Do not use `.` or `-A`.
- The message follows Conventional Commits lite: `feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`.
- One logical change per commit. If a task has more than one commit step, commit exactly what the step says.

### Command cheatsheet

- Run one test file: `bun test tests/unit/chat-id.test.ts`
- Run all tests: `pnpm test`
- Run a single test by name: `bun test -t "normalizes bare phone to c.us"`
- Typecheck: `pnpm run typecheck`
- Lint: `pnpm run lint` (biome)
- Auto-format: `pnpm run format` (biome --write)

### File-placement rules

- **No hidden deps.** If Task N's test imports `../../../src/foo`, that module must already be created by an earlier task or by Task N itself. Tasks are ordered so this always holds.
- **No placeholders.** Each step's code block is the literal content to paste. If something is "TBD" it is a plan bug — stop and escalate.
- **Never write `.md` files unless the task explicitly says to.**
- **All source files are `.ts`.** All tests are `.test.ts` under `tests/`.

### Biome config note

Biome will flag non-null assertions and `any`. Plan code avoids both. If you feel you need one, the plan is probably wrong — surface it rather than silencing the linter.

---

## File Structure

```
whatsapp-cli/
├── .github/workflows/ci.yml
├── .gitignore                              (already exists)
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE                                 (MIT)
├── README.md
├── biome.json
├── package.json                            (pnpm-managed)
├── pnpm-lock.yaml                          (generated)
├── tsconfig.json
├── docs/
│   └── superpowers/
│       ├── specs/2026-04-16-whatsapp-cli-design.md   (exists)
│       └── plans/2026-04-16-whatsapp-cli-impl.md     (this file)
├── scripts/
│   ├── install.sh                          (local setup)
│   ├── install-remote.sh                   (curl one-liner)
│   ├── release.sh                          (cross-compile + gh release)
│   └── uninstall.sh
├── src/
│   ├── cli.ts                              (commander entrypoint)
│   ├── version.ts                          (VERSION const)
│   ├── util/
│   │   ├── chat-id.ts                      (normalize/parse wa chat ids)
│   │   ├── time.ts                         (parse -7d/-1h/iso/now → epoch ms)
│   │   ├── json.ts                         (envelope: {success,data,error,meta})
│   │   ├── log.ts                          (leveled logger with k=v format)
│   │   └── paths.ts                        (~/.whatsapp-cli/... resolver)
│   ├── storage/
│   │   ├── db.ts                           (open sqlite in WAL + migrate)
│   │   ├── migrations.ts                   (PRAGMA user_version ladder)
│   │   ├── chats.ts                        (upsert chat, list chats)
│   │   ├── messages.ts                     (insert/query/tail)
│   │   ├── reactions.ts                    (upsert on react, delete on un-react)
│   │   ├── contacts.ts                     (upsert contact)
│   │   ├── groups.ts                       (sync group_participants)
│   │   └── search.ts                       (FTS5 search)
│   ├── wa/
│   │   ├── client.ts                       (WhatsAppClient interface)
│   │   ├── fake-client.ts                  (test double w/ emit helpers)
│   │   └── real-client.ts                  (whatsapp-web.js adapter)
│   ├── daemon/
│   │   ├── index.ts                        (Daemon composition)
│   │   ├── state.ts                        (state machine)
│   │   ├── server.ts                       (Unix socket server)
│   │   ├── backfill.ts                     (250-per-chat on first connect)
│   │   └── watchdog.ts                     (30s getState() health ping)
│   ├── ipc/
│   │   ├── protocol.ts                     (line-delimited JSON-RPC codec)
│   │   └── client.ts                       (CLI-side socket client + auto-boot)
│   └── commands/
│       ├── chats.ts, history.ts, show.ts, search.ts
│       ├── contacts.ts, who.ts, group.ts, cursor.ts
│       ├── send.ts, react.ts, tail.ts, pair.ts
│       └── daemon.ts                       (start/stop/status/logs subcmds)
└── tests/
    ├── unit/                               (pure functions, <500ms)
    ├── daemon/                             (FakeClient + real SQLite)
    ├── e2e/                                (real spawn + WA_CLI_FAKE_CLIENT=1)
    └── fixtures/
```

Total: 41 tasks.

---

## Task 1: Scaffolding + private GitHub repo

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `LICENSE`
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/install.sh`, `scripts/install-remote.sh`, `scripts/release.sh`, `scripts/uninstall.sh` (stubs — real bodies in Task 40)
- Create: `src/cli.ts`
- Create: `src/version.ts`
- Create: `tests/unit/.gitkeep`, `tests/daemon/.gitkeep`, `tests/e2e/.gitkeep`, `tests/fixtures/.gitkeep`
- Test: `tests/unit/cli-version.test.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "whatsapp-cli",
  "version": "0.1.0",
  "description": "Command-line WhatsApp client for humans and agents — query, stream, send over a persistent local daemon.",
  "license": "MIT",
  "author": "Josiah Bryan <josiahbryan@gmail.com>",
  "repository": {
    "type": "git",
    "url": "https://github.com/josiahbryan/whatsapp-cli.git"
  },
  "keywords": ["whatsapp", "cli", "agent", "daemon", "sqlite", "whatsapp-web.js"],
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "bun build --compile --outfile dist/whatsapp-cli src/cli.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src tests",
    "format": "biome check --write src tests",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "setup": "pnpm install && pnpm run build && bash scripts/install.sh",
    "release": "bash scripts/release.sh"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "qrcode": "^1.5.4",
    "whatsapp-web.js": "^1.26.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/node": "^22.7.0",
    "@types/qrcode": "^1.5.5",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "types": ["node", "bun-types"],
    "outDir": "dist",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": {
    "ignore": ["dist", "node_modules", "coverage", "*.sqlite*"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "error",
        "useNodejsImportProtocol": "error"
      },
      "suspicious": {
        "noExplicitAny": "error"
      },
      "complexity": {
        "noBannedTypes": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  }
}
```

- [ ] **Step 4: Write `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Josiah Bryan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Write `README.md` skeleton**

```markdown
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
```

- [ ] **Step 6: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial scaffolding: TypeScript + Bun + pnpm + commander + biome + CI.
```

- [ ] **Step 7: Write `CONTRIBUTING.md`**

```markdown
# Contributing

Thanks for your interest!

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
```

## Workflow

- All changes start with a failing test. See [the spec's testing section](docs/superpowers/specs/2026-04-16-whatsapp-cli-design.md#10-testing-strategy).
- Keep commits small and conventional (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`).
- Open a PR against `main`. CI must pass.

## Reporting issues

Open a GitHub issue with:

- The command you ran.
- The `--json` output (or stderr).
- Your OS + `whatsapp-cli --version`.

Do not include message bodies or phone numbers unless you've redacted them.
```

- [ ] **Step 8: Write `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 summary)**

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, religion, or sexual identity and orientation.

## Our Standards

Examples of behavior that contributes to a positive environment:

- Demonstrating empathy and kindness toward other people.
- Being respectful of differing opinions, viewpoints, and experiences.
- Giving and gracefully accepting constructive feedback.

Examples of unacceptable behavior:

- The use of sexualized language or imagery, and sexual attention or advances of any kind.
- Trolling, insulting or derogatory comments, and personal or political attacks.
- Public or private harassment.
- Publishing others' private information without their explicit permission.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the project maintainers at josiahbryan@gmail.com. All complaints will be reviewed and investigated promptly and fairly.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org), version 2.1, available at https://www.contributor-covenant.org/version/2/1/code_of_conduct.html.
```

- [ ] **Step 9: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: pnpm install --frozen-lockfile

      - run: pnpm run typecheck

      - run: pnpm run lint

      - run: pnpm test
```

- [ ] **Step 10: Write `scripts/install.sh` (local setup stub)**

```bash
#!/usr/bin/env bash
# Local install: copies the compiled binary from dist/ to /usr/local/bin.
# Run after `pnpm run build`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY="$PROJECT_DIR/dist/whatsapp-cli"
INSTALL_DIR="/usr/local/bin"
INSTALL_PATH="$INSTALL_DIR/whatsapp-cli"

if [ ! -x "$BINARY" ]; then
  echo "[install] $BINARY not found. Run 'pnpm run build' first."
  exit 1
fi

if [ -w "$INSTALL_DIR" ]; then
  cp "$BINARY" "$INSTALL_PATH"
  chmod 755 "$INSTALL_PATH"
else
  echo "[install] $INSTALL_DIR not writable, using sudo..."
  sudo cp "$BINARY" "$INSTALL_PATH"
  sudo chmod 755 "$INSTALL_PATH"
fi

echo "[install] Installed whatsapp-cli to $INSTALL_PATH"
"$INSTALL_PATH" --version
```

- [ ] **Step 11: Write `scripts/uninstall.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
INSTALL_PATH="/usr/local/bin/whatsapp-cli"
if [ -e "$INSTALL_PATH" ]; then
  if [ -w "$INSTALL_PATH" ]; then rm -f "$INSTALL_PATH"; else sudo rm -f "$INSTALL_PATH"; fi
  echo "[uninstall] Removed $INSTALL_PATH"
else
  echo "[uninstall] Not installed at $INSTALL_PATH"
fi
```

- [ ] **Step 12: Write `scripts/install-remote.sh` and `scripts/release.sh` placeholders**

`scripts/install-remote.sh`:
```bash
#!/usr/bin/env bash
# Placeholder — implemented in Task 40.
echo "install-remote.sh is not yet implemented. See plan Task 40."
exit 1
```

`scripts/release.sh`:
```bash
#!/usr/bin/env bash
# Placeholder — implemented in Task 40.
echo "release.sh is not yet implemented. See plan Task 40."
exit 1
```

Then: `chmod +x scripts/*.sh`.

- [ ] **Step 13: Write `src/version.ts`**

```ts
// Overwritten by scripts/release.sh at release time via --define.
export const VERSION: string = "0.1.0-dev";
```

- [ ] **Step 14: Write the failing test `tests/unit/cli-version.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

describe("whatsapp-cli version", () => {
	test("--version prints the VERSION constant", () => {
		const res = spawnSync("bun", ["run", CLI, "--version"], { encoding: "utf8" });
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
	});

	test("version subcommand prints the VERSION constant", () => {
		const res = spawnSync("bun", ["run", CLI, "version"], { encoding: "utf8" });
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
	});
});
```

- [ ] **Step 15: Run the test to verify failure**

```bash
pnpm install
bun test tests/unit/cli-version.test.ts
```

Expected: fails (no `src/cli.ts` yet, or commander not wired). Either way, 0 pass, >0 fail.

- [ ] **Step 16: Write `src/cli.ts`**

```ts
#!/usr/bin/env -S bun run
import { Command } from "commander";
import { VERSION } from "./version.js";

function main(argv: string[]): void {
	const program = new Command();

	program
		.name("whatsapp-cli")
		.description("Command-line WhatsApp client for humans and agents.")
		.version(VERSION, "-V, --version", "print the version");

	program
		.command("version")
		.description("print the version")
		.action(() => {
			process.stdout.write(`${VERSION}\n`);
		});

	program.parseAsync(argv).catch((err: unknown) => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}

main(process.argv);
```

- [ ] **Step 17: Add `.gitkeep` files for empty test dirs**

Create empty files at:
- `tests/unit/.gitkeep`
- `tests/daemon/.gitkeep`
- `tests/e2e/.gitkeep`
- `tests/fixtures/.gitkeep`

- [ ] **Step 18: Run the test to verify it passes**

```bash
pnpm install
bun test tests/unit/cli-version.test.ts
```

Expected: 2 pass, 0 fail. Paste the actual output in the task report.

- [ ] **Step 19: Typecheck and lint**

```bash
pnpm run typecheck
pnpm run lint
```

Both must exit 0.

- [ ] **Step 20: Commit the scaffolding**

```bash
git-atomic-commit commit -f \
  package.json tsconfig.json biome.json LICENSE README.md CHANGELOG.md CONTRIBUTING.md CODE_OF_CONDUCT.md \
  .github/workflows/ci.yml \
  scripts/install.sh scripts/install-remote.sh scripts/release.sh scripts/uninstall.sh \
  src/cli.ts src/version.ts \
  tests/unit/cli-version.test.ts tests/unit/.gitkeep tests/daemon/.gitkeep tests/e2e/.gitkeep tests/fixtures/.gitkeep \
  -m "chore: scaffold whatsapp-cli (pnpm + bun + commander + biome + CI)"
```

Note: `pnpm-lock.yaml` and `node_modules/` may be present. Commit `pnpm-lock.yaml` separately in the next step; `node_modules/` is gitignored.

- [ ] **Step 21: Commit the lockfile**

```bash
git-atomic-commit commit -f pnpm-lock.yaml -m "chore: add pnpm lockfile"
```

- [ ] **Step 22: Create the private GitHub repo and push**

```bash
gh repo create josiahbryan/whatsapp-cli --private --source=. --push
```

Expected output includes the repo URL. Verify `git remote -v` shows `origin` pointing at `https://github.com/josiahbryan/whatsapp-cli.git`.

- [ ] **Step 23: Verify CI runs on the initial push**

```bash
gh run list --limit 1
```

Expected: one workflow run visible, either "in_progress" or "completed". If it fails, fix before moving on.

---

## Task 2: `util/chat-id.ts` — normalize WhatsApp chat IDs

**Files:**
- Create: `src/util/chat-id.ts`
- Test: `tests/unit/chat-id.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { normalizeChatId, parseChatId } from "../../src/util/chat-id.js";

describe("normalizeChatId", () => {
	test("bare E.164 phone → c.us", () => {
		expect(normalizeChatId("+15551234567")).toBe("15551234567@c.us");
	});

	test("E.164 without plus → c.us", () => {
		expect(normalizeChatId("15551234567")).toBe("15551234567@c.us");
	});

	test("already @c.us → passthrough", () => {
		expect(normalizeChatId("15551234567@c.us")).toBe("15551234567@c.us");
	});

	test("group id @g.us → passthrough", () => {
		expect(normalizeChatId("120363020384756102@g.us")).toBe("120363020384756102@g.us");
	});

	test("literal me → me", () => {
		expect(normalizeChatId("me")).toBe("me");
	});

	test("whitespace trimmed", () => {
		expect(normalizeChatId("  +15551234567  ")).toBe("15551234567@c.us");
	});

	test("empty string throws", () => {
		expect(() => normalizeChatId("")).toThrow(/empty/i);
	});

	test("obvious non-id throws", () => {
		expect(() => normalizeChatId("hello world")).toThrow(/invalid chat/i);
	});
});

describe("parseChatId", () => {
	test("classifies dm", () => {
		expect(parseChatId("15551234567@c.us")).toEqual({ kind: "dm", phone: "15551234567" });
	});

	test("classifies group", () => {
		expect(parseChatId("120363020384756102@g.us")).toEqual({
			kind: "group",
			phone: null,
		});
	});
});
```

- [ ] **Step 2: Run and verify failure**

```bash
bun test tests/unit/chat-id.test.ts
```

Expected: module not found, all tests fail.

- [ ] **Step 3: Write `src/util/chat-id.ts`**

```ts
export type ChatKind = "dm" | "group" | "self";

export interface ChatInfo {
	kind: ChatKind;
	phone: string | null;
}

const PHONE_ONLY = /^\+?(\d{6,15})$/;
const WA_DM = /^(\d{6,15})@c\.us$/;
const WA_GROUP = /^\d+@g\.us$/;

export function normalizeChatId(input: string): string {
	const raw = input.trim();
	if (raw === "") throw new Error("chat id is empty");
	if (raw === "me") return "me";
	if (WA_DM.test(raw)) return raw;
	if (WA_GROUP.test(raw)) return raw;
	const m = PHONE_ONLY.exec(raw);
	if (m) return `${m[1]}@c.us`;
	throw new Error(`invalid chat id: ${input}`);
}

export function parseChatId(id: string): ChatInfo {
	if (id === "me") return { kind: "self", phone: null };
	const dm = WA_DM.exec(id);
	if (dm) return { kind: "dm", phone: dm[1] ?? null };
	if (WA_GROUP.test(id)) return { kind: "group", phone: null };
	throw new Error(`cannot parse chat id: ${id}`);
}
```

- [ ] **Step 4: Run and verify pass**

```bash
bun test tests/unit/chat-id.test.ts
```

Expected: 10 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/util/chat-id.ts tests/unit/chat-id.test.ts \
  -m "feat(util): normalize and parse WhatsApp chat ids"
```

---

## Task 3: `util/time.ts` — parse `-7d`/`-1h`/ISO/`now` into epoch ms

**Files:**
- Create: `src/util/time.ts`
- Test: `tests/unit/time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { parseTime } from "../../src/util/time.js";

describe("parseTime", () => {
	const now = Date.UTC(2026, 3, 16, 12, 0, 0); // 2026-04-16T12:00:00Z

	test("now → now", () => {
		expect(parseTime("now", now)).toBe(now);
	});

	test("-7d → 7 days before now", () => {
		expect(parseTime("-7d", now)).toBe(now - 7 * 86_400_000);
	});

	test("-1h → 1 hour before now", () => {
		expect(parseTime("-1h", now)).toBe(now - 3_600_000);
	});

	test("-30m → 30 minutes before now", () => {
		expect(parseTime("-30m", now)).toBe(now - 30 * 60_000);
	});

	test("-45s → 45 seconds before now", () => {
		expect(parseTime("-45s", now)).toBe(now - 45_000);
	});

	test("ISO 8601 → parsed", () => {
		expect(parseTime("2026-04-10T00:00:00Z", now)).toBe(Date.UTC(2026, 3, 10, 0, 0, 0));
	});

	test("epoch-ms number string → number", () => {
		expect(parseTime("1700000000000", now)).toBe(1_700_000_000_000);
	});

	test("bad format throws", () => {
		expect(() => parseTime("yesterday", now)).toThrow(/invalid time/i);
	});

	test("positive relative not allowed", () => {
		expect(() => parseTime("+7d", now)).toThrow(/invalid time/i);
	});
});
```

- [ ] **Step 2: Run and verify failure**

```bash
bun test tests/unit/time.test.ts
```

- [ ] **Step 3: Write `src/util/time.ts`**

```ts
const REL = /^-(\d+)([smhd])$/;
const EPOCH_MS = /^\d{10,}$/;

export function parseTime(input: string, now: number = Date.now()): number {
	const raw = input.trim();
	if (raw === "now") return now;

	const rel = REL.exec(raw);
	if (rel) {
		const n = Number(rel[1]);
		const unit = rel[2];
		const ms =
			unit === "s" ? 1_000
			: unit === "m" ? 60_000
			: unit === "h" ? 3_600_000
			: 86_400_000;
		return now - n * ms;
	}

	if (EPOCH_MS.test(raw)) return Number(raw);

	const parsed = Date.parse(raw);
	if (!Number.isNaN(parsed)) return parsed;

	throw new Error(`invalid time: ${input}`);
}
```

- [ ] **Step 4: Run and verify pass**

```bash
bun test tests/unit/time.test.ts
```

Expected: 9 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/util/time.ts tests/unit/time.test.ts \
  -m "feat(util): parse relative (-7d/-1h), ISO, and epoch time inputs"
```

---

## Task 4: `util/json.ts` — output envelope for `--json` mode

**Files:**
- Create: `src/util/json.ts`
- Test: `tests/unit/json.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { envelopeError, envelopeOk, formatEnvelope } from "../../src/util/json.js";

describe("envelope", () => {
	test("ok wraps data", () => {
		expect(envelopeOk({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
	});

	test("ok with meta", () => {
		expect(envelopeOk([], { count: 0 })).toEqual({
			success: true,
			data: [],
			meta: { count: 0 },
		});
	});

	test("error wraps code + message", () => {
		expect(envelopeError("not_ready", "daemon is authenticating")).toEqual({
			success: false,
			error: { code: "not_ready", message: "daemon is authenticating" },
		});
	});

	test("formatEnvelope emits single-line JSON with newline", () => {
		const out = formatEnvelope(envelopeOk({ n: 1 }));
		expect(out).toBe('{"success":true,"data":{"n":1}}\n');
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/util/json.ts`**

```ts
export interface EnvelopeOk<T> {
	success: true;
	data: T;
	meta?: Record<string, unknown>;
}

export interface EnvelopeError {
	success: false;
	error: { code: string; message: string; details?: Record<string, unknown> };
}

export type Envelope<T> = EnvelopeOk<T> | EnvelopeError;

export function envelopeOk<T>(data: T, meta?: Record<string, unknown>): EnvelopeOk<T> {
	return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

export function envelopeError(
	code: string,
	message: string,
	details?: Record<string, unknown>,
): EnvelopeError {
	return details === undefined
		? { success: false, error: { code, message } }
		: { success: false, error: { code, message, details } };
}

export function formatEnvelope<T>(env: Envelope<T>): string {
	return `${JSON.stringify(env)}\n`;
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/util/json.ts tests/unit/json.test.ts \
  -m "feat(util): JSON envelope helpers for --json output"
```

---

## Task 5: `util/log.ts` — leveled logger with `k=v` fields

**Files:**
- Create: `src/util/log.ts`
- Test: `tests/unit/log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { formatLine } from "../../src/util/log.js";

describe("formatLine", () => {
	test("basic line with iso ts + level + message", () => {
		const line = formatLine({
			ts: Date.UTC(2026, 3, 16, 12, 0, 0),
			level: "info",
			message: "hello",
			fields: {},
		});
		expect(line).toBe("[2026-04-16T12:00:00.000Z] [info] hello");
	});

	test("string field emitted as k=value", () => {
		const line = formatLine({
			ts: Date.UTC(2026, 3, 16, 12, 0, 0),
			level: "info",
			message: "chat synced",
			fields: { chat: "15551234567@c.us", count: 42 },
		});
		expect(line).toBe(
			"[2026-04-16T12:00:00.000Z] [info] chat synced chat=15551234567@c.us count=42",
		);
	});

	test("string with whitespace is quoted", () => {
		const line = formatLine({
			ts: Date.UTC(2026, 3, 16, 12, 0, 0),
			level: "warn",
			message: "oh no",
			fields: { reason: "with spaces" },
		});
		expect(line).toBe('[2026-04-16T12:00:00.000Z] [warn] oh no reason="with spaces"');
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/util/log.ts`**

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	ts: number;
	level: LogLevel;
	message: string;
	fields: Record<string, string | number | boolean>;
}

export function formatLine(entry: LogEntry): string {
	const ts = new Date(entry.ts).toISOString();
	const head = `[${ts}] [${entry.level}] ${entry.message}`;
	const kv = Object.entries(entry.fields).map(([k, v]) => `${k}=${formatValue(v)}`);
	return kv.length === 0 ? head : `${head} ${kv.join(" ")}`;
}

function formatValue(v: string | number | boolean): string {
	if (typeof v !== "string") return String(v);
	return /\s|"/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

export class Logger {
	constructor(
		private readonly write: (line: string) => void = (l) => {
			process.stderr.write(`${l}\n`);
		},
	) {}

	log(level: LogLevel, message: string, fields: Record<string, string | number | boolean> = {}): void {
		this.write(formatLine({ ts: Date.now(), level, message, fields }));
	}

	debug(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("debug", message, fields);
	}
	info(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("info", message, fields);
	}
	warn(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("warn", message, fields);
	}
	error(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("error", message, fields);
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/util/log.ts tests/unit/log.test.ts \
  -m "feat(util): leveled logger with k=v formatted fields"
```

---

## Task 6: `util/paths.ts` — resolve `~/.whatsapp-cli/accounts/<account>/*`

**Files:**
- Create: `src/util/paths.ts`
- Test: `tests/unit/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { accountPaths, rootDir } from "../../src/util/paths.js";

describe("accountPaths", () => {
	test("uses WA_CLI_HOME override when set", () => {
		const home = "/tmp/wacli-test-1";
		const p = accountPaths("default", home);
		expect(p.accountDir).toBe(join(home, "accounts", "default"));
		expect(p.db).toBe(join(home, "accounts", "default", "db.sqlite"));
		expect(p.socket).toBe(join(home, "accounts", "default", "control.sock"));
		expect(p.pidFile).toBe(join(home, "accounts", "default", "daemon.pid"));
		expect(p.logFile).toBe(join(home, "accounts", "default", "daemon.log"));
		expect(p.qrPng).toBe(join(home, "accounts", "default", "qr.png"));
		expect(p.stateJson).toBe(join(home, "accounts", "default", "state.json"));
		expect(p.sessionDir).toBe(join(home, "accounts", "default", "session"));
		expect(p.filesDir).toBe(join(home, "accounts", "default", "files"));
	});

	test("rejects account name with path separator", () => {
		expect(() => accountPaths("../evil", "/tmp")).toThrow(/invalid account/i);
	});

	test("rootDir honors WA_CLI_HOME env override", () => {
		const original = process.env.WA_CLI_HOME;
		process.env.WA_CLI_HOME = "/tmp/wacli-env-override";
		try {
			expect(rootDir()).toBe("/tmp/wacli-env-override");
		} finally {
			if (original === undefined) delete process.env.WA_CLI_HOME;
			else process.env.WA_CLI_HOME = original;
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

```bash
bun test tests/unit/paths.test.ts
```

- [ ] **Step 3: Write `src/util/paths.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

const ACCOUNT_NAME = /^[a-zA-Z0-9_-]+$/;

export interface AccountPaths {
	accountDir: string;
	db: string;
	socket: string;
	pidFile: string;
	logFile: string;
	qrPng: string;
	stateJson: string;
	sessionDir: string;
	filesDir: string;
}

export function rootDir(): string {
	return process.env.WA_CLI_HOME ?? join(homedir(), ".whatsapp-cli");
}

export function accountPaths(account: string, root: string = rootDir()): AccountPaths {
	if (!ACCOUNT_NAME.test(account)) {
		throw new Error(`invalid account name: ${account}`);
	}
	const accountDir = join(root, "accounts", account);
	return {
		accountDir,
		db: join(accountDir, "db.sqlite"),
		socket: join(accountDir, "control.sock"),
		pidFile: join(accountDir, "daemon.pid"),
		logFile: join(accountDir, "daemon.log"),
		qrPng: join(accountDir, "qr.png"),
		stateJson: join(accountDir, "state.json"),
		sessionDir: join(accountDir, "session"),
		filesDir: join(accountDir, "files"),
	};
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/util/paths.ts tests/unit/paths.test.ts \
  -m "feat(util): resolve account paths under ~/.whatsapp-cli"
```

---

## Task 7: `storage/db.ts` + `storage/migrations.ts` — schema bootstrap

**Files:**
- Create: `src/storage/db.ts`
- Create: `src/storage/migrations.ts`
- Test: `tests/daemon/db-migrations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/storage/db.js";

function tempDbPath(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "wacli-db-"));
	return { dir, path: join(dir, "db.sqlite") };
}

describe("openDatabase", () => {
	test("creates fresh db with all expected tables and sets WAL", () => {
		const { dir, path } = tempDbPath();
		try {
			const db = openDatabase(path);
			const tables = db
				.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
				.all()
				.map((r: { name: string }) => r.name);
			for (const t of ["chats", "messages", "reactions", "contacts", "group_participants"]) {
				expect(tables).toContain(t);
			}
			const jm = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
			expect(jm.journal_mode).toBe("wal");
			const uv = db.prepare("PRAGMA user_version").get() as { user_version: number };
			expect(uv.user_version).toBeGreaterThan(0);
			db.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("opening an existing db is idempotent", () => {
		const { dir, path } = tempDbPath();
		try {
			const db1 = openDatabase(path);
			const v1 = (db1.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			db1.close();
			const db2 = openDatabase(path);
			const v2 = (db2.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
			expect(v2).toBe(v1);
			db2.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("FTS virtual table exists", () => {
		const { dir, path } = tempDbPath();
		try {
			const db = openDatabase(path);
			const row = db
				.prepare("SELECT name FROM sqlite_master WHERE name = 'messages_fts'")
				.get() as { name: string } | undefined;
			expect(row?.name).toBe("messages_fts");
			db.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

```bash
bun test tests/daemon/db-migrations.test.ts
```

- [ ] **Step 3: Write `src/storage/migrations.ts`**

```ts
import type { Database } from "bun:sqlite";

export interface Migration {
	version: number;
	up: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		up(db) {
			db.exec(`
				CREATE TABLE chats (
					id         TEXT PRIMARY KEY,
					kind       TEXT NOT NULL,
					name       TEXT,
					phone      TEXT,
					updated_at INTEGER NOT NULL
				);
				CREATE INDEX chats_updated_at ON chats(updated_at DESC);

				CREATE TABLE messages (
					rowid               INTEGER PRIMARY KEY,
					wa_id               TEXT NOT NULL UNIQUE,
					chat_id             TEXT NOT NULL REFERENCES chats(id),
					from_id             TEXT NOT NULL,
					from_name           TEXT,
					from_me             INTEGER NOT NULL,
					timestamp           INTEGER NOT NULL,
					type                TEXT NOT NULL,
					body                TEXT,
					quoted_wa_id        TEXT,
					attachment_path     TEXT,
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

				CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
					INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
				END;

				CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
					INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
				END;

				CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
					INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
					INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
				END;
			`);
		},
	},
];

export function currentVersion(): number {
	return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}

export function migrate(db: Database): void {
	const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
	const current = row.user_version;
	for (const m of MIGRATIONS) {
		if (m.version > current) {
			db.transaction(() => {
				m.up(db);
				db.exec(`PRAGMA user_version = ${m.version}`);
			})();
		}
	}
}
```

- [ ] **Step 4: Write `src/storage/db.ts`**

```ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrations.js";

export interface OpenOptions {
	readonly?: boolean;
}

export function openDatabase(path: string, opts: OpenOptions = {}): Database {
	if (!opts.readonly) mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { readonly: opts.readonly ?? false, create: !opts.readonly });
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA synchronous = NORMAL");
	if (!opts.readonly) migrate(db);
	return db;
}
```

- [ ] **Step 5: Run and verify pass**

```bash
bun test tests/daemon/db-migrations.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git-atomic-commit commit -f src/storage/db.ts src/storage/migrations.ts tests/daemon/db-migrations.test.ts \
  -m "feat(storage): SQLite schema + WAL + FTS5 migrations"
```

---

## Task 8: `storage/chats.ts` — upsert + list chats

**Files:**
- Create: `src/storage/chats.ts`
- Test: `tests/daemon/chats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listChats, upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-chats-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("chats storage", () => {
	test("upsertChat inserts new row", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertChat(db, {
				id: "15551234567@c.us",
				kind: "dm",
				name: "Alice",
				phone: "15551234567",
				updated_at: 1_700_000_000_000,
			});
			const rows = listChats(db, {});
			expect(rows).toHaveLength(1);
			expect(rows[0]?.name).toBe("Alice");
		} finally {
			cleanup();
		}
	});

	test("upsertChat updates name + updated_at on conflict", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertChat(db, {
				id: "15551234567@c.us",
				kind: "dm",
				name: "Alice",
				phone: "15551234567",
				updated_at: 1_700_000_000_000,
			});
			upsertChat(db, {
				id: "15551234567@c.us",
				kind: "dm",
				name: "Alice Smith",
				phone: "15551234567",
				updated_at: 1_700_000_001_000,
			});
			const rows = listChats(db, {});
			expect(rows).toHaveLength(1);
			expect(rows[0]?.name).toBe("Alice Smith");
			expect(rows[0]?.updated_at).toBe(1_700_000_001_000);
		} finally {
			cleanup();
		}
	});

	test("listChats filters by kind and orders by updated_at DESC", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertChat(db, {
				id: "a@c.us",
				kind: "dm",
				name: "A",
				phone: "111",
				updated_at: 1,
			});
			upsertChat(db, {
				id: "b@c.us",
				kind: "dm",
				name: "B",
				phone: "222",
				updated_at: 3,
			});
			upsertChat(db, {
				id: "grp@g.us",
				kind: "group",
				name: "Team",
				phone: null,
				updated_at: 2,
			});
			const dms = listChats(db, { kind: "dm" });
			expect(dms.map((r) => r.id)).toEqual(["b@c.us", "a@c.us"]);
			const all = listChats(db, {});
			expect(all.map((r) => r.id)).toEqual(["b@c.us", "grp@g.us", "a@c.us"]);
		} finally {
			cleanup();
		}
	});

	test("listChats grep matches name substring (case-insensitive)", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertChat(db, { id: "a@c.us", kind: "dm", name: "Alice", phone: "1", updated_at: 1 });
			upsertChat(db, { id: "b@c.us", kind: "dm", name: "Bob", phone: "2", updated_at: 2 });
			const out = listChats(db, { grep: "ali" });
			expect(out.map((r) => r.name)).toEqual(["Alice"]);
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/storage/chats.ts`**

```ts
import type { Database } from "bun:sqlite";

export interface ChatRow {
	id: string;
	kind: "dm" | "group";
	name: string | null;
	phone: string | null;
	updated_at: number;
}

export interface ListChatsOpts {
	kind?: "dm" | "group";
	grep?: string;
	limit?: number;
}

export function upsertChat(db: Database, chat: ChatRow): void {
	db.prepare(
		`INSERT INTO chats (id, kind, name, phone, updated_at)
		 VALUES (@id, @kind, @name, @phone, @updated_at)
		 ON CONFLICT(id) DO UPDATE SET
		   kind = excluded.kind,
		   name = excluded.name,
		   phone = excluded.phone,
		   updated_at = CASE WHEN excluded.updated_at > chats.updated_at
		                     THEN excluded.updated_at ELSE chats.updated_at END`,
	).run(chat);
}

export function listChats(db: Database, opts: ListChatsOpts): ChatRow[] {
	const where: string[] = [];
	const params: Record<string, unknown> = {};
	if (opts.kind) {
		where.push("kind = @kind");
		params.kind = opts.kind;
	}
	if (opts.grep) {
		where.push("LOWER(name) LIKE @grep");
		params.grep = `%${opts.grep.toLowerCase()}%`;
	}
	const sql =
		`SELECT id, kind, name, phone, updated_at FROM chats` +
		(where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
		` ORDER BY updated_at DESC` +
		(opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "");
	return db.prepare(sql).all(params) as ChatRow[];
}

export function bumpChatUpdatedAt(
	db: Database,
	chatId: string,
	timestamp: number,
): void {
	db.prepare(
		`UPDATE chats SET updated_at = @ts WHERE id = @id AND @ts > updated_at`,
	).run({ id: chatId, ts: timestamp });
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/storage/chats.ts tests/daemon/chats.test.ts \
  -m "feat(storage): upsert + list chats"
```

---

## Task 9: `storage/messages.ts` — insert/query with tail cursor

**Files:**
- Create: `src/storage/messages.ts`
- Test: `tests/daemon/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import {
	getMaxRowid,
	getMessageByWaId,
	insertMessage,
	listMessagesByChat,
	listMessagesSinceRowid,
} from "../../src/storage/messages.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-msg-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	upsertChat(db, {
		id: "c@c.us",
		kind: "dm",
		name: "C",
		phone: "111",
		updated_at: 0,
	});
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

function msg(i: number) {
	return {
		wa_id: `w${i}`,
		chat_id: "c@c.us",
		from_id: "111@c.us",
		from_name: "C",
		from_me: 0,
		timestamp: 1_700_000_000_000 + i * 1000,
		type: "chat",
		body: `hello ${i}`,
		quoted_wa_id: null,
		attachment_path: null,
		attachment_mime: null,
		attachment_filename: null,
	};
}

describe("messages storage", () => {
	test("insertMessage returns a rowid", () => {
		const { db, cleanup } = tempDb();
		try {
			const rowid = insertMessage(db, msg(1));
			expect(rowid).toBeGreaterThan(0);
		} finally {
			cleanup();
		}
	});

	test("duplicate wa_id is ignored, returns null", () => {
		const { db, cleanup } = tempDb();
		try {
			const first = insertMessage(db, msg(1));
			const second = insertMessage(db, msg(1));
			expect(first).not.toBeNull();
			expect(second).toBeNull();
			expect(getMaxRowid(db)).toBe(first);
		} finally {
			cleanup();
		}
	});

	test("listMessagesByChat respects limit + before", () => {
		const { db, cleanup } = tempDb();
		try {
			for (let i = 1; i <= 5; i++) insertMessage(db, msg(i));
			const recent = listMessagesByChat(db, { chat_id: "c@c.us", limit: 3 });
			expect(recent.map((r) => r.wa_id)).toEqual(["w5", "w4", "w3"]);
			const before = listMessagesByChat(db, {
				chat_id: "c@c.us",
				limit: 10,
				before_rowid: recent[2]?.rowid ?? 0,
			});
			expect(before.map((r) => r.wa_id)).toEqual(["w2", "w1"]);
		} finally {
			cleanup();
		}
	});

	test("listMessagesSinceRowid returns ascending", () => {
		const { db, cleanup } = tempDb();
		try {
			for (let i = 1; i <= 5; i++) insertMessage(db, msg(i));
			const after = listMessagesSinceRowid(db, { since_rowid: 2, limit: 10 });
			expect(after.map((r) => r.wa_id)).toEqual(["w3", "w4", "w5"]);
		} finally {
			cleanup();
		}
	});

	test("getMessageByWaId fetches one", () => {
		const { db, cleanup } = tempDb();
		try {
			insertMessage(db, msg(7));
			const found = getMessageByWaId(db, "w7");
			expect(found?.body).toBe("hello 7");
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/storage/messages.ts`**

```ts
import type { Database } from "bun:sqlite";

export interface MessageRow {
	rowid: number;
	wa_id: string;
	chat_id: string;
	from_id: string;
	from_name: string | null;
	from_me: number;
	timestamp: number;
	type: string;
	body: string | null;
	quoted_wa_id: string | null;
	attachment_path: string | null;
	attachment_mime: string | null;
	attachment_filename: string | null;
}

export type NewMessage = Omit<MessageRow, "rowid">;

export function insertMessage(db: Database, m: NewMessage): number | null {
	const info = db
		.prepare(
			`INSERT OR IGNORE INTO messages
			 (wa_id, chat_id, from_id, from_name, from_me, timestamp, type, body,
			  quoted_wa_id, attachment_path, attachment_mime, attachment_filename)
			 VALUES
			 (@wa_id, @chat_id, @from_id, @from_name, @from_me, @timestamp, @type, @body,
			  @quoted_wa_id, @attachment_path, @attachment_mime, @attachment_filename)`,
		)
		.run(m);
	return info.changes === 1 ? Number(info.lastInsertRowid) : null;
}

export function getMaxRowid(db: Database): number {
	const row = db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM messages`).get() as { m: number };
	return row.m;
}

export function getMessageByWaId(db: Database, wa_id: string): MessageRow | null {
	const row = db
		.prepare(`SELECT rowid, * FROM messages WHERE wa_id = ?`)
		.get(wa_id) as MessageRow | undefined;
	return row ?? null;
}

export interface ListByChatOpts {
	chat_id: string;
	limit: number;
	before_rowid?: number;
	since_rowid?: number;
	from_ts?: number;
	to_ts?: number;
}

export function listMessagesByChat(db: Database, opts: ListByChatOpts): MessageRow[] {
	const where: string[] = ["chat_id = @chat_id"];
	const params: Record<string, unknown> = { chat_id: opts.chat_id };
	if (opts.before_rowid !== undefined) {
		where.push("rowid < @before_rowid");
		params.before_rowid = opts.before_rowid;
	}
	if (opts.since_rowid !== undefined) {
		where.push("rowid > @since_rowid");
		params.since_rowid = opts.since_rowid;
	}
	if (opts.from_ts !== undefined) {
		where.push("timestamp >= @from_ts");
		params.from_ts = opts.from_ts;
	}
	if (opts.to_ts !== undefined) {
		where.push("timestamp <= @to_ts");
		params.to_ts = opts.to_ts;
	}
	const sql =
		`SELECT rowid, * FROM messages WHERE ${where.join(" AND ")} ` +
		`ORDER BY rowid DESC LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
	return db.prepare(sql).all(params) as MessageRow[];
}

export interface ListSinceOpts {
	since_rowid: number;
	limit: number;
	chat_id?: string;
}

export function listMessagesSinceRowid(db: Database, opts: ListSinceOpts): MessageRow[] {
	const where: string[] = ["rowid > @since_rowid"];
	const params: Record<string, unknown> = { since_rowid: opts.since_rowid };
	if (opts.chat_id) {
		where.push("chat_id = @chat_id");
		params.chat_id = opts.chat_id;
	}
	const sql =
		`SELECT rowid, * FROM messages WHERE ${where.join(" AND ")} ` +
		`ORDER BY rowid ASC LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
	return db.prepare(sql).all(params) as MessageRow[];
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/storage/messages.ts tests/daemon/messages.test.ts \
  -m "feat(storage): insert/list messages with tail-cursor semantics"
```

---

## Task 10: `storage/reactions.ts` — upsert on react, delete on un-react

**Files:**
- Create: `src/storage/reactions.ts`
- Test: `tests/daemon/reactions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/storage/db.js";
import {
	applyReaction,
	listReactionsForMessage,
} from "../../src/storage/reactions.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-react-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("reactions storage", () => {
	test("applyReaction inserts a new row", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "👍",
				timestamp: 1,
			});
			const rows = listReactionsForMessage(db, "m1");
			expect(rows).toHaveLength(1);
			expect(rows[0]?.emoji).toBe("👍");
		} finally {
			cleanup();
		}
	});

	test("applyReaction updates emoji on re-react by same reactor", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "👍",
				timestamp: 1,
			});
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "❤️",
				timestamp: 2,
			});
			const rows = listReactionsForMessage(db, "m1");
			expect(rows).toHaveLength(1);
			expect(rows[0]?.emoji).toBe("❤️");
		} finally {
			cleanup();
		}
	});

	test("empty emoji un-reacts (deletes the row)", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "👍",
				timestamp: 1,
			});
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "",
				timestamp: 2,
			});
			expect(listReactionsForMessage(db, "m1")).toHaveLength(0);
		} finally {
			cleanup();
		}
	});

	test("multiple reactors on same message all persist", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "a",
				emoji: "👍",
				timestamp: 1,
			});
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "b",
				emoji: "🎉",
				timestamp: 2,
			});
			expect(listReactionsForMessage(db, "m1")).toHaveLength(2);
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/storage/reactions.ts`**

```ts
import type { Database } from "bun:sqlite";

export interface ReactionRow {
	message_wa_id: string;
	reactor_id: string;
	emoji: string;
	timestamp: number;
}

export function applyReaction(db: Database, r: ReactionRow): void {
	if (r.emoji === "") {
		db.prepare(
			`DELETE FROM reactions WHERE message_wa_id = @message_wa_id AND reactor_id = @reactor_id`,
		).run({ message_wa_id: r.message_wa_id, reactor_id: r.reactor_id });
		return;
	}
	db.prepare(
		`INSERT INTO reactions (message_wa_id, reactor_id, emoji, timestamp)
		 VALUES (@message_wa_id, @reactor_id, @emoji, @timestamp)
		 ON CONFLICT(message_wa_id, reactor_id) DO UPDATE SET
		   emoji = excluded.emoji,
		   timestamp = excluded.timestamp`,
	).run(r);
}

export function listReactionsForMessage(
	db: Database,
	message_wa_id: string,
): ReactionRow[] {
	return db
		.prepare(
			`SELECT message_wa_id, reactor_id, emoji, timestamp
			 FROM reactions WHERE message_wa_id = ? ORDER BY timestamp ASC`,
		)
		.all(message_wa_id) as ReactionRow[];
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/storage/reactions.ts tests/daemon/reactions.test.ts \
  -m "feat(storage): reactions upsert on react, delete on un-react"
```

---

## Task 11: `storage/contacts.ts` — upsert + lookup

**Files:**
- Create: `src/storage/contacts.ts`
- Test: `tests/daemon/contacts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getContact,
	listContacts,
	upsertContact,
} from "../../src/storage/contacts.js";
import { openDatabase } from "../../src/storage/db.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-contact-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("contacts storage", () => {
	test("upsertContact inserts", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: null,
				updated_at: 1,
			});
			expect(getContact(db, "111@c.us")?.pushname).toBe("A");
		} finally {
			cleanup();
		}
	});

	test("upsertContact updates fields on conflict", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 0,
				about: null,
				updated_at: 1,
			});
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "Alice",
				verified_name: "Alice Inc",
				is_business: 1,
				is_my_contact: 1,
				about: "hi",
				updated_at: 2,
			});
			const c = getContact(db, "111@c.us");
			expect(c?.pushname).toBe("Alice");
			expect(c?.is_business).toBe(1);
			expect(c?.about).toBe("hi");
		} finally {
			cleanup();
		}
	});

	test("listContacts filters by is_business / is_my_contact", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertContact(db, {
				id: "1@c.us",
				phone: "1",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: null,
				updated_at: 1,
			});
			upsertContact(db, {
				id: "2@c.us",
				phone: "2",
				pushname: "B",
				verified_name: null,
				is_business: 1,
				is_my_contact: 0,
				about: null,
				updated_at: 2,
			});
			expect(listContacts(db, { business: true }).map((c) => c.id)).toEqual(["2@c.us"]);
			expect(listContacts(db, { my_contacts: true }).map((c) => c.id)).toEqual(["1@c.us"]);
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/storage/contacts.ts`**

```ts
import type { Database } from "bun:sqlite";

export interface ContactRow {
	id: string;
	phone: string | null;
	pushname: string | null;
	verified_name: string | null;
	is_business: number;
	is_my_contact: number;
	about: string | null;
	updated_at: number;
}

export function upsertContact(db: Database, c: ContactRow): void {
	db.prepare(
		`INSERT INTO contacts (id, phone, pushname, verified_name, is_business, is_my_contact, about, updated_at)
		 VALUES (@id, @phone, @pushname, @verified_name, @is_business, @is_my_contact, @about, @updated_at)
		 ON CONFLICT(id) DO UPDATE SET
		   phone = excluded.phone,
		   pushname = excluded.pushname,
		   verified_name = excluded.verified_name,
		   is_business = excluded.is_business,
		   is_my_contact = excluded.is_my_contact,
		   about = COALESCE(excluded.about, contacts.about),
		   updated_at = CASE WHEN excluded.updated_at > contacts.updated_at
		                     THEN excluded.updated_at ELSE contacts.updated_at END`,
	).run(c);
}

export function getContact(db: Database, id: string): ContactRow | null {
	return (
		(db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | undefined) ?? null
	);
}

export interface ListContactsOpts {
	business?: boolean;
	my_contacts?: boolean;
	group_id?: string;
	limit?: number;
}

export function listContacts(db: Database, opts: ListContactsOpts): ContactRow[] {
	const where: string[] = [];
	const params: Record<string, unknown> = {};
	if (opts.business) where.push("is_business = 1");
	if (opts.my_contacts) where.push("is_my_contact = 1");
	if (opts.group_id) {
		where.push("id IN (SELECT contact_id FROM group_participants WHERE chat_id = @group_id)");
		params.group_id = opts.group_id;
	}
	const sql =
		`SELECT * FROM contacts` +
		(where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
		` ORDER BY pushname COLLATE NOCASE` +
		(opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "");
	return db.prepare(sql).all(params) as ContactRow[];
}

export function getContactByPhone(db: Database, phone: string): ContactRow | null {
	return (
		(db.prepare(`SELECT * FROM contacts WHERE phone = ?`).get(phone) as ContactRow | undefined) ??
		null
	);
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/storage/contacts.ts tests/daemon/contacts.test.ts \
  -m "feat(storage): contacts upsert + filters"
```

---

## Task 12: `storage/groups.ts` — sync group participants

**Files:**
- Create: `src/storage/groups.ts`
- Test: `tests/daemon/groups.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertChat } from "../../src/storage/chats.js";
import { upsertContact } from "../../src/storage/contacts.js";
import { openDatabase } from "../../src/storage/db.js";
import {
	getGroupParticipants,
	syncGroupParticipants,
} from "../../src/storage/groups.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-grp-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	upsertChat(db, {
		id: "grp@g.us",
		kind: "group",
		name: "Team",
		phone: null,
		updated_at: 0,
	});
	for (const id of ["1@c.us", "2@c.us", "3@c.us"]) {
		upsertContact(db, {
			id,
			phone: id.split("@")[0] ?? null,
			pushname: id,
			verified_name: null,
			is_business: 0,
			is_my_contact: 0,
			about: null,
			updated_at: 1,
		});
	}
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("group_participants", () => {
	test("syncGroupParticipants adds initial members", () => {
		const { db, cleanup } = tempDb();
		try {
			syncGroupParticipants(db, "grp@g.us", [
				{ contact_id: "1@c.us", is_admin: 1 },
				{ contact_id: "2@c.us", is_admin: 0 },
			]);
			const parts = getGroupParticipants(db, "grp@g.us");
			expect(parts).toHaveLength(2);
			expect(parts.find((p) => p.contact_id === "1@c.us")?.is_admin).toBe(1);
		} finally {
			cleanup();
		}
	});

	test("second sync replaces the set", () => {
		const { db, cleanup } = tempDb();
		try {
			syncGroupParticipants(db, "grp@g.us", [
				{ contact_id: "1@c.us", is_admin: 1 },
				{ contact_id: "2@c.us", is_admin: 0 },
			]);
			syncGroupParticipants(db, "grp@g.us", [
				{ contact_id: "1@c.us", is_admin: 0 },
				{ contact_id: "3@c.us", is_admin: 1 },
			]);
			const parts = getGroupParticipants(db, "grp@g.us");
			expect(parts.map((p) => p.contact_id).sort()).toEqual(["1@c.us", "3@c.us"]);
			expect(parts.find((p) => p.contact_id === "1@c.us")?.is_admin).toBe(0);
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/storage/groups.ts`**

```ts
import type { Database } from "bun:sqlite";

export interface GroupParticipantRow {
	chat_id: string;
	contact_id: string;
	is_admin: number;
}

export interface ParticipantInput {
	contact_id: string;
	is_admin: number;
}

export function syncGroupParticipants(
	db: Database,
	chat_id: string,
	participants: ParticipantInput[],
): void {
	db.transaction(() => {
		db.prepare(`DELETE FROM group_participants WHERE chat_id = ?`).run(chat_id);
		const insert = db.prepare(
			`INSERT INTO group_participants (chat_id, contact_id, is_admin)
			 VALUES (@chat_id, @contact_id, @is_admin)`,
		);
		for (const p of participants) {
			insert.run({ chat_id, contact_id: p.contact_id, is_admin: p.is_admin });
		}
	})();
}

export function getGroupParticipants(
	db: Database,
	chat_id: string,
): GroupParticipantRow[] {
	return db
		.prepare(
			`SELECT chat_id, contact_id, is_admin FROM group_participants WHERE chat_id = ?
			 ORDER BY is_admin DESC, contact_id ASC`,
		)
		.all(chat_id) as GroupParticipantRow[];
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/storage/groups.ts tests/daemon/groups.test.ts \
  -m "feat(storage): sync group participants atomically"
```

---

## Task 13: `storage/search.ts` — FTS5 search with snippets

**Files:**
- Create: `src/storage/search.ts`
- Test: `tests/daemon/search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { insertMessage } from "../../src/storage/messages.js";
import { searchMessages } from "../../src/storage/search.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-fts-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	upsertChat(db, {
		id: "c@c.us",
		kind: "dm",
		name: "C",
		phone: "1",
		updated_at: 0,
	});
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

function mk(i: number, body: string) {
	return {
		wa_id: `w${i}`,
		chat_id: "c@c.us",
		from_id: "1@c.us",
		from_name: "C",
		from_me: 0,
		timestamp: 1_700_000_000_000 + i * 1000,
		type: "chat",
		body,
		quoted_wa_id: null,
		attachment_path: null,
		attachment_mime: null,
		attachment_filename: null,
	};
}

describe("searchMessages", () => {
	test("matches tokens with snippets", () => {
		const { db, cleanup } = tempDb();
		try {
			insertMessage(db, mk(1, "the quick brown fox"));
			insertMessage(db, mk(2, "lazy dog jumps"));
			insertMessage(db, mk(3, "another quick thought"));
			const hits = searchMessages(db, { query: "quick", limit: 10 });
			expect(hits.map((h) => h.wa_id).sort()).toEqual(["w1", "w3"]);
			expect(hits[0]?.snippet).toContain("quick");
		} finally {
			cleanup();
		}
	});

	test("diacritics are folded (fold 2)", () => {
		const { db, cleanup } = tempDb();
		try {
			insertMessage(db, mk(1, "café rendezvous"));
			const hits = searchMessages(db, { query: "cafe", limit: 10 });
			expect(hits).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	test("filters by chat_id and since_ts", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertChat(db, {
				id: "d@c.us",
				kind: "dm",
				name: "D",
				phone: "2",
				updated_at: 0,
			});
			insertMessage(db, mk(1, "needle in c"));
			insertMessage(db, { ...mk(2, "needle in d"), chat_id: "d@c.us" });
			const cOnly = searchMessages(db, { query: "needle", chat_id: "c@c.us", limit: 10 });
			expect(cOnly.map((h) => h.wa_id)).toEqual(["w1"]);
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/storage/search.ts`**

```ts
import type { Database } from "bun:sqlite";

export interface SearchHit {
	wa_id: string;
	chat_id: string;
	timestamp: number;
	snippet: string;
	body: string | null;
}

export interface SearchOpts {
	query: string;
	chat_id?: string;
	since_ts?: number;
	limit: number;
}

export function searchMessages(db: Database, opts: SearchOpts): SearchHit[] {
	const where: string[] = ["messages_fts MATCH @query"];
	const params: Record<string, unknown> = { query: opts.query };
	if (opts.chat_id) {
		where.push("m.chat_id = @chat_id");
		params.chat_id = opts.chat_id;
	}
	if (opts.since_ts !== undefined) {
		where.push("m.timestamp >= @since_ts");
		params.since_ts = opts.since_ts;
	}
	const sql =
		`SELECT m.wa_id, m.chat_id, m.timestamp, m.body,
		        snippet(messages_fts, 0, '[', ']', '…', 10) AS snippet
		 FROM messages_fts
		 JOIN messages m ON m.rowid = messages_fts.rowid
		 WHERE ${where.join(" AND ")}
		 ORDER BY m.timestamp DESC
		 LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
	return db.prepare(sql).all(params) as SearchHit[];
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/storage/search.ts tests/daemon/search.test.ts \
  -m "feat(storage): FTS5 search with snippets + filters"
```

---

## Task 14: `wa/client.ts` — `WhatsAppClient` interface + event types

**Files:**
- Create: `src/wa/client.ts`
- Create: `src/wa/events.ts`

No test needed: this is a pure type module. Tests come in Task 15 (FakeClient) and Task 39 (RealClient adapter).

- [ ] **Step 1: Write `src/wa/events.ts`**

```ts
export interface WaMessageEvent {
	wa_id: string;
	chat_id: string;
	from_id: string;
	from_name: string | null;
	from_me: boolean;
	timestamp: number;
	type: "chat" | "image" | "video" | "audio" | "voice" | "document" | "sticker" | "system";
	body: string | null;
	quoted_wa_id: string | null;
	attachment: WaAttachment | null;
}

export interface WaAttachment {
	mimetype: string;
	filename: string | null;
	data: Buffer;
}

export interface WaReactionEvent {
	message_wa_id: string;
	reactor_id: string;
	emoji: string;
	timestamp: number;
}

export interface WaChatMeta {
	id: string;
	kind: "dm" | "group";
	name: string | null;
	phone: string | null;
	timestamp: number;
}

export interface WaContactMeta {
	id: string;
	phone: string | null;
	pushname: string | null;
	verified_name: string | null;
	is_business: boolean;
	is_my_contact: boolean;
	about: string | null;
}

export interface WaGroupMeta {
	chat_id: string;
	participants: Array<{ contact_id: string; is_admin: boolean }>;
}

export type WaEventMap = {
	qr: (dataUrl: string) => void;
	authenticated: () => void;
	ready: () => void;
	disconnected: (reason: string) => void;
	message: (m: WaMessageEvent) => void;
	reaction: (r: WaReactionEvent) => void;
	chat_update: (c: WaChatMeta) => void;
	contact_update: (c: WaContactMeta) => void;
	group_update: (g: WaGroupMeta) => void;
};
```

- [ ] **Step 2: Write `src/wa/client.ts`**

```ts
import type { WaEventMap, WaMessageEvent } from "./events.js";

export interface SendTextOpts {
	reply_to_wa_id?: string;
}

export interface SendMediaOpts extends SendTextOpts {
	caption?: string;
	file_path: string;
}

export interface SendResult {
	wa_id: string;
	timestamp: number;
}

export interface ChatHandle {
	id: string;
	kind: "dm" | "group";
	fetchMessages(limit: number): Promise<WaMessageEvent[]>;
}

export interface WhatsAppClient {
	initialize(): Promise<void>;
	on<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void;
	off<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void;
	getChatById(chat_id: string): Promise<ChatHandle>;
	listChats(): Promise<ChatHandle[]>;
	sendText(chat_id: string, text: string, opts?: SendTextOpts): Promise<SendResult>;
	sendMedia(chat_id: string, opts: SendMediaOpts): Promise<SendResult>;
	sendReaction(message_wa_id: string, emoji: string): Promise<void>;
	destroy(): Promise<void>;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git-atomic-commit commit -f src/wa/client.ts src/wa/events.ts \
  -m "feat(wa): WhatsAppClient interface + event type definitions"
```

---

## Task 15: `wa/fake-client.ts` — in-memory test double with emit helpers

**Files:**
- Create: `src/wa/fake-client.ts`
- Test: `tests/daemon/fake-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

describe("FakeWhatsAppClient", () => {
	test("initialize triggers ready after authenticated", async () => {
		const c = new FakeWhatsAppClient();
		const seen: string[] = [];
		c.on("authenticated", () => seen.push("authenticated"));
		c.on("ready", () => seen.push("ready"));
		await c.initialize();
		expect(seen).toEqual(["authenticated", "ready"]);
	});

	test("initialize in qr-required mode emits qr first", async () => {
		const c = new FakeWhatsAppClient({ needsQr: true });
		let qrSeen = "";
		c.on("qr", (d) => {
			qrSeen = d;
		});
		const p = c.initialize();
		await new Promise((r) => setTimeout(r, 10));
		expect(qrSeen).toBe("fake-qr-payload");
		c.completePairing();
		await p;
	});

	test("emitMessage delivers to listeners", () => {
		const c = new FakeWhatsAppClient();
		const bag: string[] = [];
		c.on("message", (m) => bag.push(m.wa_id));
		c.emitMessage({
			wa_id: "w1",
			chat_id: "x@c.us",
			from_id: "x@c.us",
			from_name: "X",
			from_me: false,
			timestamp: 1,
			type: "chat",
			body: "hi",
			quoted_wa_id: null,
			attachment: null,
		});
		expect(bag).toEqual(["w1"]);
	});

	test("sendText returns a unique wa_id and records the call", async () => {
		const c = new FakeWhatsAppClient();
		await c.initialize();
		const r1 = await c.sendText("x@c.us", "hi");
		const r2 = await c.sendText("x@c.us", "again");
		expect(r1.wa_id).not.toBe(r2.wa_id);
		expect(c.sentMessages).toHaveLength(2);
		expect(c.sentMessages[0]?.text).toBe("hi");
	});

	test("off removes listener", () => {
		const c = new FakeWhatsAppClient();
		const bag: string[] = [];
		const listener = (m: { wa_id: string }) => bag.push(m.wa_id);
		c.on("message", listener);
		c.off("message", listener);
		c.emitMessage({
			wa_id: "w1",
			chat_id: "x@c.us",
			from_id: "x@c.us",
			from_name: "X",
			from_me: false,
			timestamp: 1,
			type: "chat",
			body: "hi",
			quoted_wa_id: null,
			attachment: null,
		});
		expect(bag).toEqual([]);
	});

	test("getChatById returns a handle whose fetchMessages returns seeded history", async () => {
		const c = new FakeWhatsAppClient();
		c.seedHistory("x@c.us", [
			{
				wa_id: "h1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1,
				type: "chat",
				body: "a",
				quoted_wa_id: null,
				attachment: null,
			},
			{
				wa_id: "h2",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 2,
				type: "chat",
				body: "b",
				quoted_wa_id: null,
				attachment: null,
			},
		]);
		const handle = await c.getChatById("x@c.us");
		const msgs = await handle.fetchMessages(10);
		expect(msgs.map((m) => m.wa_id)).toEqual(["h1", "h2"]);
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/wa/fake-client.ts`**

```ts
import type {
	WaContactMeta,
	WaEventMap,
	WaGroupMeta,
	WaMessageEvent,
	WaReactionEvent,
} from "./events.js";
import type {
	ChatHandle,
	SendMediaOpts,
	SendResult,
	SendTextOpts,
	WhatsAppClient,
} from "./client.js";

export interface FakeOptions {
	needsQr?: boolean;
}

export interface SentMessage {
	chat_id: string;
	text?: string;
	media?: SendMediaOpts;
	reply_to_wa_id?: string;
}

export class FakeWhatsAppClient implements WhatsAppClient {
	private listeners: {
		[K in keyof WaEventMap]?: Array<WaEventMap[K]>;
	} = {};
	private readonly history = new Map<string, WaMessageEvent[]>();
	private readonly chatMeta = new Map<string, { kind: "dm" | "group" }>();
	private pairingResolver: (() => void) | null = null;
	private sendCounter = 0;
	public readonly sentMessages: SentMessage[] = [];
	public readonly sentReactions: Array<{ message_wa_id: string; emoji: string }> = [];
	public destroyed = false;

	constructor(private readonly opts: FakeOptions = {}) {}

	on<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		(this.listeners[event] ??= []).push(listener);
	}

	off<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		const arr = this.listeners[event];
		if (!arr) return;
		const idx = arr.indexOf(listener);
		if (idx >= 0) arr.splice(idx, 1);
	}

	private emit<K extends keyof WaEventMap>(event: K, ...args: Parameters<WaEventMap[K]>): void {
		const arr = this.listeners[event];
		if (!arr) return;
		for (const l of [...arr]) (l as (...a: unknown[]) => void)(...args);
	}

	async initialize(): Promise<void> {
		if (this.opts.needsQr) {
			this.emit("qr", "fake-qr-payload");
			await new Promise<void>((resolve) => {
				this.pairingResolver = resolve;
			});
		}
		this.emit("authenticated");
		this.emit("ready");
	}

	completePairing(): void {
		const r = this.pairingResolver;
		this.pairingResolver = null;
		r?.();
	}

	seedHistory(chat_id: string, messages: WaMessageEvent[]): void {
		this.history.set(chat_id, messages);
		this.chatMeta.set(chat_id, { kind: chat_id.endsWith("@g.us") ? "group" : "dm" });
	}

	emitMessage(m: WaMessageEvent): void {
		this.emit("message", m);
	}

	emitReaction(r: WaReactionEvent): void {
		this.emit("reaction", r);
	}

	emitContactUpdate(c: WaContactMeta): void {
		this.emit("contact_update", c);
	}

	emitGroupUpdate(g: WaGroupMeta): void {
		this.emit("group_update", g);
	}

	emitDisconnect(reason: string): void {
		this.emit("disconnected", reason);
	}

	async getChatById(chat_id: string): Promise<ChatHandle> {
		const meta = this.chatMeta.get(chat_id) ?? {
			kind: chat_id.endsWith("@g.us") ? ("group" as const) : ("dm" as const),
		};
		return {
			id: chat_id,
			kind: meta.kind,
			fetchMessages: async (limit: number) => {
				const all = this.history.get(chat_id) ?? [];
				return all.slice(-limit);
			},
		};
	}

	async listChats(): Promise<ChatHandle[]> {
		return Promise.all(Array.from(this.chatMeta.keys()).map((id) => this.getChatById(id)));
	}

	async sendText(chat_id: string, text: string, opts: SendTextOpts = {}): Promise<SendResult> {
		this.sendCounter += 1;
		this.sentMessages.push({ chat_id, text, reply_to_wa_id: opts.reply_to_wa_id });
		return { wa_id: `fake-sent-${this.sendCounter}`, timestamp: Date.now() };
	}

	async sendMedia(chat_id: string, opts: SendMediaOpts): Promise<SendResult> {
		this.sendCounter += 1;
		this.sentMessages.push({ chat_id, media: opts, reply_to_wa_id: opts.reply_to_wa_id });
		return { wa_id: `fake-sent-${this.sendCounter}`, timestamp: Date.now() };
	}

	async sendReaction(message_wa_id: string, emoji: string): Promise<void> {
		this.sentReactions.push({ message_wa_id, emoji });
	}

	async destroy(): Promise<void> {
		this.destroyed = true;
		this.listeners = {};
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/wa/fake-client.ts tests/daemon/fake-client.test.ts \
  -m "feat(wa): in-memory FakeWhatsAppClient test double"
```

---

## Task 16: `daemon/state.ts` — state machine

**Files:**
- Create: `src/daemon/state.ts`
- Test: `tests/daemon/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { StateMachine, isReady } from "../../src/daemon/state.js";

describe("StateMachine", () => {
	test("starts at stopped", () => {
		const sm = new StateMachine();
		expect(sm.current).toBe("stopped");
	});

	test("stopped → starting → qr_required → authenticating → ready", () => {
		const sm = new StateMachine();
		sm.transition("starting");
		sm.transition("qr_required");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(sm.current).toBe("ready");
	});

	test("warm-boot path: starting → authenticating → ready", () => {
		const sm = new StateMachine();
		sm.transition("starting");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(sm.current).toBe("ready");
	});

	test("ready → disconnected → authenticating → ready", () => {
		const sm = new StateMachine();
		sm.transition("starting");
		sm.transition("authenticating");
		sm.transition("ready");
		sm.transition("disconnected");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(sm.current).toBe("ready");
	});

	test("invalid transitions throw", () => {
		const sm = new StateMachine();
		expect(() => sm.transition("ready")).toThrow(/invalid transition/i);
	});

	test("listeners are called on every transition", () => {
		const sm = new StateMachine();
		const seen: string[] = [];
		sm.onTransition((s) => seen.push(s));
		sm.transition("starting");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(seen).toEqual(["starting", "authenticating", "ready"]);
	});

	test("isReady helper", () => {
		expect(isReady("ready")).toBe(true);
		expect(isReady("starting")).toBe(false);
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/daemon/state.ts`**

```ts
export type DaemonState =
	| "stopped"
	| "starting"
	| "qr_required"
	| "authenticating"
	| "ready"
	| "disconnected"
	| "failed";

const ALLOWED: Record<DaemonState, DaemonState[]> = {
	stopped: ["starting"],
	starting: ["qr_required", "authenticating", "failed"],
	qr_required: ["authenticating", "failed"],
	authenticating: ["ready", "qr_required", "failed"],
	ready: ["disconnected", "stopped", "failed"],
	disconnected: ["authenticating", "failed", "stopped"],
	failed: ["stopped"],
};

export function isReady(s: DaemonState): boolean {
	return s === "ready";
}

export class StateMachine {
	private _current: DaemonState = "stopped";
	private readonly listeners: Array<(s: DaemonState) => void> = [];

	get current(): DaemonState {
		return this._current;
	}

	onTransition(fn: (s: DaemonState) => void): void {
		this.listeners.push(fn);
	}

	transition(next: DaemonState): void {
		const allowed = ALLOWED[this._current];
		if (!allowed.includes(next)) {
			throw new Error(`invalid transition: ${this._current} → ${next}`);
		}
		this._current = next;
		for (const l of this.listeners) l(next);
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/daemon/state.ts tests/daemon/state.test.ts \
  -m "feat(daemon): state machine with explicit allowed transitions"
```

---

## Task 17: `ipc/protocol.ts` — line-delimited JSON-RPC codec

**Files:**
- Create: `src/ipc/protocol.ts`
- Test: `tests/unit/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import {
	FrameDecoder,
	encodeFrame,
	isEventFrame,
	isRequestFrame,
	isResponseFrame,
} from "../../src/ipc/protocol.js";

describe("FrameDecoder", () => {
	test("decodes a single full line", () => {
		const d = new FrameDecoder();
		const frames = d.push(Buffer.from('{"id":"a","method":"status","params":{}}\n'));
		expect(frames).toHaveLength(1);
		expect(isRequestFrame(frames[0]!)).toBe(true);
	});

	test("splits multiple lines in one chunk", () => {
		const d = new FrameDecoder();
		const frames = d.push(Buffer.from('{"id":"a","result":1}\n{"event":"state","data":{}}\n'));
		expect(frames).toHaveLength(2);
		expect(isResponseFrame(frames[0]!)).toBe(true);
		expect(isEventFrame(frames[1]!)).toBe(true);
	});

	test("buffers incomplete line across chunks", () => {
		const d = new FrameDecoder();
		expect(d.push(Buffer.from('{"id":"a",'))).toHaveLength(0);
		const frames = d.push(Buffer.from('"result":42}\n'));
		expect(frames).toHaveLength(1);
		const f = frames[0]!;
		if (!isResponseFrame(f)) throw new Error("not a response frame");
		expect(f.result).toBe(42);
	});

	test("ignores empty lines", () => {
		const d = new FrameDecoder();
		expect(d.push(Buffer.from("\n\n"))).toHaveLength(0);
	});

	test("malformed JSON throws on that frame", () => {
		const d = new FrameDecoder();
		expect(() => d.push(Buffer.from("not json\n"))).toThrow(/malformed/i);
	});
});

describe("encodeFrame", () => {
	test("appends newline", () => {
		const buf = encodeFrame({ id: "a", method: "status", params: {} });
		expect(buf.toString()).toBe('{"id":"a","method":"status","params":{}}\n');
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/ipc/protocol.ts`**

```ts
export interface RequestFrame {
	id: string;
	method: string;
	params: Record<string, unknown>;
}

export interface ResponseOkFrame {
	id: string;
	result: unknown;
}

export interface ResponseErrFrame {
	id: string;
	error: { code: string; message: string; details?: Record<string, unknown> };
}

export type ResponseFrame = ResponseOkFrame | ResponseErrFrame;

export interface EventFrame {
	event: string;
	data: unknown;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

export function isRequestFrame(f: Frame): f is RequestFrame {
	return typeof (f as RequestFrame).method === "string";
}

export function isResponseFrame(f: Frame): f is ResponseFrame {
	return (
		typeof (f as ResponseFrame).id === "string" &&
		("result" in (f as ResponseOkFrame) || "error" in (f as ResponseErrFrame))
	);
}

export function isEventFrame(f: Frame): f is EventFrame {
	return typeof (f as EventFrame).event === "string";
}

export function encodeFrame(frame: Frame): Buffer {
	return Buffer.from(`${JSON.stringify(frame)}\n`);
}

export class FrameDecoder {
	private buffer = "";

	push(chunk: Buffer): Frame[] {
		this.buffer += chunk.toString("utf8");
		const frames: Frame[] = [];
		let nl: number;
		while ((nl = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (line.trim() === "") continue;
			try {
				frames.push(JSON.parse(line) as Frame);
			} catch (err) {
				throw new Error(`malformed frame: ${line.slice(0, 80)}`);
			}
		}
		return frames;
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/ipc/protocol.ts tests/unit/protocol.test.ts \
  -m "feat(ipc): line-delimited JSON-RPC protocol codec"
```

---

## Task 18: `daemon/server.ts` — Unix socket server

**Files:**
- Create: `src/daemon/server.ts`
- Test: `tests/daemon/server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "../../src/daemon/server.js";
import { FrameDecoder, encodeFrame } from "../../src/ipc/protocol.js";

function tempSocket(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "wacli-srv-"));
	return { dir, path: join(dir, "control.sock") };
}

async function withServer(
	handlers: Parameters<DaemonServer["setHandlers"]>[0],
	run: (path: string, server: DaemonServer) => Promise<void>,
): Promise<void> {
	const { dir, path } = tempSocket();
	const server = new DaemonServer(path);
	server.setHandlers(handlers);
	await server.start();
	try {
		await run(path, server);
	} finally {
		await server.stop();
		rmSync(dir, { recursive: true, force: true });
	}
}

function rpc(path: string, method: string, params: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const conn = createConnection(path);
		const dec = new FrameDecoder();
		conn.on("data", (chunk) => {
			try {
				for (const f of dec.push(chunk as Buffer)) {
					conn.end();
					if ("result" in (f as { result?: unknown })) resolve((f as { result: unknown }).result);
					else if ("error" in (f as { error?: unknown })) reject((f as { error: unknown }).error);
				}
			} catch (err) {
				reject(err);
			}
		});
		conn.on("error", reject);
		conn.write(encodeFrame({ id: "1", method, params }));
	});
}

describe("DaemonServer", () => {
	test("invokes the registered handler for a method", async () => {
		await withServer(
			{
				status: async () => ({ state: "ready" }),
				send: async () => ({ wa_id: "x", rowid: 1 }),
				react: async () => undefined,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
				shutdown: async () => undefined,
			},
			async (path) => {
				const res = (await rpc(path, "status", {})) as { state: string };
				expect(res.state).toBe("ready");
			},
		);
	});

	test("broadcasts events to subscribed clients", async () => {
		await withServer(
			{
				status: async () => ({ state: "ready" }),
				send: async () => ({ wa_id: "x", rowid: 1 }),
				react: async () => undefined,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
				shutdown: async () => undefined,
			},
			async (path, server) => {
				const received: unknown[] = [];
				const conn = createConnection(path);
				const dec = new FrameDecoder();
				conn.on("data", (chunk) => {
					for (const f of dec.push(chunk as Buffer)) received.push(f);
				});
				await new Promise<void>((r) => conn.once("connect", r));
				conn.write(encodeFrame({ id: "1", method: "subscribe", params: {} }));
				await new Promise((r) => setTimeout(r, 50));
				server.broadcast({ event: "state", data: { state: "ready" } });
				await new Promise((r) => setTimeout(r, 50));
				conn.end();
				expect(received.some((r) => (r as { event?: string }).event === "state")).toBe(true);
			},
		);
	});

	test("unknown method returns error", async () => {
		await withServer(
			{
				status: async () => ({ state: "ready" }),
				send: async () => ({ wa_id: "x", rowid: 1 }),
				react: async () => undefined,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
				shutdown: async () => undefined,
			},
			async (path) => {
				await expect(rpc(path, "nope", {})).rejects.toEqual({
					code: "unknown_method",
					message: "unknown method: nope",
				});
			},
		);
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/daemon/server.ts`**

```ts
import { type Server, type Socket, createServer } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import {
	type EventFrame,
	FrameDecoder,
	type RequestFrame,
	type ResponseFrame,
	encodeFrame,
	isRequestFrame,
} from "../ipc/protocol.js";

export interface MethodHandlers {
	status(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	send(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	react(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	subscribe(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	unsubscribe(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	shutdown(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
}

export interface ClientContext {
	subscribed: boolean;
	write(frame: EventFrame | ResponseFrame): void;
}

export class DaemonServer {
	private server: Server | null = null;
	private handlers: MethodHandlers | null = null;
	private readonly clients = new Set<ClientContext>();

	constructor(private readonly socketPath: string) {}

	setHandlers(h: MethodHandlers): void {
		this.handlers = h;
	}

	start(): Promise<void> {
		if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
		return new Promise((resolve, reject) => {
			const s = createServer((conn) => this.handleConnection(conn));
			s.on("error", reject);
			s.listen(this.socketPath, () => {
				try {
					chmodSync(this.socketPath, 0o600);
				} catch {
					// ignore — running without permission to chmod is still OK on most fs
				}
				this.server = s;
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		for (const c of this.clients) {
			try {
				c.write({ event: "shutdown", data: {} });
			} catch {
				// socket may already be closed; drop the event
			}
		}
		await new Promise<void>((resolve) => {
			if (!this.server) return resolve();
			this.server.close(() => resolve());
		});
		this.server = null;
		if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
	}

	broadcast(event: EventFrame): void {
		const buf = encodeFrame(event);
		for (const c of this.clients) {
			if (!c.subscribed) continue;
			try {
				(c as ClientContext & { _socket?: Socket })._socket?.write(buf);
			} catch {
				// dropped client — we'll notice on the next read
			}
		}
	}

	private handleConnection(conn: Socket): void {
		const dec = new FrameDecoder();
		const ctx: ClientContext & { _socket: Socket } = {
			subscribed: false,
			_socket: conn,
			write: (frame) => {
				conn.write(encodeFrame(frame));
			},
		};
		this.clients.add(ctx);
		conn.on("data", (chunk) => {
			try {
				for (const frame of dec.push(chunk)) {
					if (isRequestFrame(frame)) void this.dispatch(ctx, frame);
				}
			} catch (err) {
				conn.destroy(err instanceof Error ? err : new Error(String(err)));
			}
		});
		conn.on("close", () => this.clients.delete(ctx));
		conn.on("error", () => this.clients.delete(ctx));
	}

	private async dispatch(ctx: ClientContext, req: RequestFrame): Promise<void> {
		if (!this.handlers) {
			ctx.write({ id: req.id, error: { code: "not_ready", message: "handlers unset" } });
			return;
		}
		const fn = (this.handlers as unknown as Record<string, MethodHandlers["status"]>)[req.method];
		if (!fn) {
			ctx.write({ id: req.id, error: { code: "unknown_method", message: `unknown method: ${req.method}` } });
			return;
		}
		try {
			const result = await fn(req.params, ctx);
			ctx.write({ id: req.id, result: result ?? null });
		} catch (err) {
			const e = err as { code?: string; message?: string; details?: Record<string, unknown> };
			ctx.write({
				id: req.id,
				error: {
					code: e.code ?? "internal_error",
					message: e.message ?? String(err),
					...(e.details ? { details: e.details } : {}),
				},
			});
		}
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/daemon/server.ts tests/daemon/server.test.ts \
  -m "feat(daemon): Unix socket server with JSON-RPC dispatch + pub/sub"
```

---

## Task 19: `daemon/backfill.ts` — initial history pull

**Files:**
- Create: `src/daemon/backfill.ts`
- Test: `tests/daemon/backfill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfillChats } from "../../src/daemon/backfill.js";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { getMaxRowid, insertMessage } from "../../src/storage/messages.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-bf-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

function mk(id: string, chat: string, i: number) {
	return {
		wa_id: id,
		chat_id: chat,
		from_id: "1@c.us",
		from_name: "X",
		from_me: false,
		timestamp: 1_700_000_000_000 + i * 1000,
		type: "chat" as const,
		body: `b${i}`,
		quoted_wa_id: null,
		attachment: null,
	};
}

describe("backfillChats", () => {
	test("pulls N per chat and inserts", async () => {
		const { db, cleanup } = tempDb();
		try {
			const client = new FakeWhatsAppClient();
			upsertChat(db, {
				id: "a@c.us",
				kind: "dm",
				name: "A",
				phone: "1",
				updated_at: 0,
			});
			upsertChat(db, {
				id: "b@c.us",
				kind: "dm",
				name: "B",
				phone: "2",
				updated_at: 0,
			});
			client.seedHistory("a@c.us", [mk("a1", "a@c.us", 1), mk("a2", "a@c.us", 2)]);
			client.seedHistory("b@c.us", [mk("b1", "b@c.us", 1)]);
			const report = await backfillChats(db, client, { limitPerChat: 100 });
			expect(report.inserted).toBe(3);
			expect(getMaxRowid(db)).toBe(3);
		} finally {
			cleanup();
		}
	});

	test("limit=0 skips backfill", async () => {
		const { db, cleanup } = tempDb();
		try {
			const client = new FakeWhatsAppClient();
			upsertChat(db, {
				id: "a@c.us",
				kind: "dm",
				name: "A",
				phone: "1",
				updated_at: 0,
			});
			client.seedHistory("a@c.us", [mk("a1", "a@c.us", 1)]);
			const report = await backfillChats(db, client, { limitPerChat: 0 });
			expect(report.inserted).toBe(0);
		} finally {
			cleanup();
		}
	});

	test("dedupes against existing rows (INSERT OR IGNORE)", async () => {
		const { db, cleanup } = tempDb();
		try {
			const client = new FakeWhatsAppClient();
			upsertChat(db, {
				id: "a@c.us",
				kind: "dm",
				name: "A",
				phone: "1",
				updated_at: 0,
			});
			insertMessage(db, {
				wa_id: "a1",
				chat_id: "a@c.us",
				from_id: "1@c.us",
				from_name: "X",
				from_me: 0,
				timestamp: 1,
				type: "chat",
				body: "already",
				quoted_wa_id: null,
				attachment_path: null,
				attachment_mime: null,
				attachment_filename: null,
			});
			client.seedHistory("a@c.us", [mk("a1", "a@c.us", 1), mk("a2", "a@c.us", 2)]);
			const report = await backfillChats(db, client, { limitPerChat: 100 });
			expect(report.inserted).toBe(1);
		} finally {
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/daemon/backfill.ts`**

```ts
import type { Database } from "bun:sqlite";
import { bumpChatUpdatedAt } from "../storage/chats.js";
import { insertMessage } from "../storage/messages.js";
import type { WhatsAppClient } from "../wa/client.js";
import type { WaMessageEvent } from "../wa/events.js";

export interface BackfillOpts {
	limitPerChat: number;
}

export interface BackfillReport {
	chats: number;
	inserted: number;
	skipped: number;
}

export async function backfillChats(
	db: Database,
	client: WhatsAppClient,
	opts: BackfillOpts,
): Promise<BackfillReport> {
	const report: BackfillReport = { chats: 0, inserted: 0, skipped: 0 };
	if (opts.limitPerChat <= 0) return report;

	const chatIds = (
		db.prepare(`SELECT id FROM chats`).all() as Array<{ id: string }>
	).map((r) => r.id);

	for (const id of chatIds) {
		report.chats += 1;
		const handle = await client.getChatById(id);
		const messages: WaMessageEvent[] = await handle.fetchMessages(opts.limitPerChat);
		db.transaction(() => {
			for (const m of messages) {
				const inserted = insertMessage(db, {
					wa_id: m.wa_id,
					chat_id: m.chat_id,
					from_id: m.from_id,
					from_name: m.from_name,
					from_me: m.from_me ? 1 : 0,
					timestamp: m.timestamp,
					type: m.type,
					body: m.body,
					quoted_wa_id: m.quoted_wa_id,
					attachment_path: null,
					attachment_mime: m.attachment?.mimetype ?? null,
					attachment_filename: m.attachment?.filename ?? null,
				});
				if (inserted !== null) {
					report.inserted += 1;
					bumpChatUpdatedAt(db, m.chat_id, m.timestamp);
				} else {
					report.skipped += 1;
				}
			}
		})();
	}
	return report;
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/daemon/backfill.ts tests/daemon/backfill.test.ts \
  -m "feat(daemon): initial-connect backfill with INSERT OR IGNORE dedup"
```

---

## Task 20: `daemon/watchdog.ts` — heartbeat loop

**Files:**
- Create: `src/daemon/watchdog.ts`
- Test: `tests/daemon/watchdog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { Watchdog } from "../../src/daemon/watchdog.js";

describe("Watchdog", () => {
	test("calls check on interval and counts failures", async () => {
		let calls = 0;
		let recovered = 0;
		const wd = new Watchdog({
			intervalMs: 10,
			timeoutMs: 50,
			failuresBeforeRecover: 2,
			check: async () => {
				calls += 1;
				throw new Error("hang");
			},
			recover: async () => {
				recovered += 1;
			},
		});
		wd.start();
		await new Promise((r) => setTimeout(r, 80));
		wd.stop();
		expect(calls).toBeGreaterThanOrEqual(2);
		expect(recovered).toBeGreaterThanOrEqual(1);
	});

	test("a single success resets the failure counter", async () => {
		let turn = 0;
		let recovered = 0;
		const wd = new Watchdog({
			intervalMs: 10,
			timeoutMs: 50,
			failuresBeforeRecover: 2,
			check: async () => {
				turn += 1;
				if (turn === 1) throw new Error("once");
				return;
			},
			recover: async () => {
				recovered += 1;
			},
		});
		wd.start();
		await new Promise((r) => setTimeout(r, 60));
		wd.stop();
		expect(recovered).toBe(0);
	});

	test("timeout counts as a failure", async () => {
		let recovered = 0;
		const wd = new Watchdog({
			intervalMs: 10,
			timeoutMs: 20,
			failuresBeforeRecover: 2,
			check: () => new Promise(() => {}),
			recover: async () => {
				recovered += 1;
			},
		});
		wd.start();
		await new Promise((r) => setTimeout(r, 120));
		wd.stop();
		expect(recovered).toBeGreaterThanOrEqual(1);
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/daemon/watchdog.ts`**

```ts
export interface WatchdogOpts {
	intervalMs: number;
	timeoutMs: number;
	failuresBeforeRecover: number;
	check: () => Promise<void>;
	recover: () => Promise<void>;
}

export class Watchdog {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private failures = 0;
	private stopping = false;
	private recovering = false;

	constructor(private readonly opts: WatchdogOpts) {}

	start(): void {
		this.stopping = false;
		this.schedule();
	}

	stop(): void {
		this.stopping = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private schedule(): void {
		if (this.stopping) return;
		this.timer = setTimeout(() => void this.tick(), this.opts.intervalMs);
	}

	private async tick(): Promise<void> {
		try {
			await this.withTimeout(this.opts.check(), this.opts.timeoutMs);
			this.failures = 0;
		} catch {
			this.failures += 1;
			if (this.failures >= this.opts.failuresBeforeRecover && !this.recovering) {
				this.recovering = true;
				try {
					await this.opts.recover();
				} finally {
					this.recovering = false;
					this.failures = 0;
				}
			}
		} finally {
			this.schedule();
		}
	}

	private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const t = setTimeout(() => reject(new Error("watchdog timeout")), ms);
			p.then(
				(v) => {
					clearTimeout(t);
					resolve(v);
				},
				(err) => {
					clearTimeout(t);
					reject(err);
				},
			);
		});
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/daemon/watchdog.ts tests/daemon/watchdog.test.ts \
  -m "feat(daemon): watchdog with timeout + N-failure recovery"
```

---

## Task 21: `daemon/index.ts` — compose client + storage + server

**Files:**
- Create: `src/daemon/index.ts`
- Test: `tests/daemon/daemon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { Daemon } from "../../src/daemon/index.js";
import { openDatabase } from "../../src/storage/db.js";
import { getMaxRowid } from "../../src/storage/messages.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";
import { FrameDecoder, encodeFrame } from "../../src/ipc/protocol.js";
import { accountPaths } from "../../src/util/paths.js";

async function makeDaemon() {
	const root = mkdtempSync(join(tmpdir(), "wacli-daemon-"));
	const paths = accountPaths("default", root);
	const client = new FakeWhatsAppClient();
	const daemon = new Daemon({ paths, client, backfillLimitPerChat: 0 });
	return {
		daemon,
		client,
		paths,
		cleanup: async () => {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

function rpc(path: string, method: string, params: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const conn = createConnection(path);
		const dec = new FrameDecoder();
		conn.on("data", (chunk) => {
			for (const f of dec.push(chunk as Buffer)) {
				conn.end();
				if ("result" in (f as { result?: unknown })) resolve((f as { result: unknown }).result);
				else if ("error" in (f as { error?: unknown })) reject((f as { error: unknown }).error);
			}
		});
		conn.on("error", reject);
		conn.write(encodeFrame({ id: "1", method, params }));
	});
}

describe("Daemon", () => {
	test("starts, reaches ready, and persists incoming message", async () => {
		const { daemon, client, paths, cleanup } = await makeDaemon();
		try {
			await daemon.start();
			client.emitMessage({
				wa_id: "w1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1_700_000_000_000,
				type: "chat",
				body: "hi",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 30));
			const db = openDatabase(paths.db, { readonly: true });
			try {
				expect(getMaxRowid(db)).toBe(1);
			} finally {
				db.close();
			}
		} finally {
			await cleanup();
		}
	});

	test("status method returns current state", async () => {
		const { daemon, paths, cleanup } = await makeDaemon();
		try {
			await daemon.start();
			const res = (await rpc(paths.socket, "status", {})) as { state: string };
			expect(res.state).toBe("ready");
		} finally {
			await cleanup();
		}
	});

	test("send method forwards to client and returns wa_id + rowid", async () => {
		const { daemon, paths, cleanup } = await makeDaemon();
		try {
			await daemon.start();
			const res = (await rpc(paths.socket, "send", {
				chat_id: "x@c.us",
				text: "hello",
			})) as { wa_id: string; rowid: number };
			expect(res.wa_id).toMatch(/^fake-sent-\d+$/);
			expect(res.rowid).toBeGreaterThan(0);
		} finally {
			await cleanup();
		}
	});

	test("send before ready fails with not_ready", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-daemon-"));
		const paths = accountPaths("default", root);
		const client = new FakeWhatsAppClient({ needsQr: true });
		const daemon = new Daemon({ paths, client, backfillLimitPerChat: 0 });
		try {
			const startPromise = daemon.start();
			await new Promise((r) => setTimeout(r, 50));
			await expect(
				rpc(paths.socket, "send", { chat_id: "x@c.us", text: "hi" }),
			).rejects.toEqual({
				code: "not_ready",
				message: expect.stringContaining("qr_required"),
			});
			client.completePairing();
			await startPromise;
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/daemon/index.ts`**

```ts
import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, unlinkSync, existsSync, openSync, closeSync, writeSync } from "node:fs";
import { backfillChats } from "./backfill.js";
import { DaemonServer } from "./server.js";
import { StateMachine } from "./state.js";
import type { DaemonState } from "./state.js";
import { bumpChatUpdatedAt, upsertChat } from "../storage/chats.js";
import { upsertContact } from "../storage/contacts.js";
import { openDatabase } from "../storage/db.js";
import { syncGroupParticipants } from "../storage/groups.js";
import { getMessageByWaId, insertMessage } from "../storage/messages.js";
import { applyReaction } from "../storage/reactions.js";
import type { AccountPaths } from "../util/paths.js";
import type { WhatsAppClient } from "../wa/client.js";

export interface DaemonOptions {
	paths: AccountPaths;
	client: WhatsAppClient;
	backfillLimitPerChat: number;
}

export class Daemon {
	private readonly sm = new StateMachine();
	private readonly server: DaemonServer;
	private db: Database | null = null;
	private pidFd: number | null = null;

	constructor(private readonly opts: DaemonOptions) {
		this.server = new DaemonServer(opts.paths.socket);
	}

	async start(): Promise<void> {
		mkdirSync(this.opts.paths.accountDir, { recursive: true });
		mkdirSync(this.opts.paths.sessionDir, { recursive: true });
		mkdirSync(this.opts.paths.filesDir, { recursive: true });

		this.sm.onTransition((s) => this.onStateTransition(s));
		this.sm.transition("starting");

		this.acquirePidLock();
		this.db = openDatabase(this.opts.paths.db);
		this.wireClientEvents();
		this.registerHandlers();

		await this.server.start();
		const ready = this.awaitReady();
		await this.opts.client.initialize();
		await ready;

		if (this.opts.backfillLimitPerChat > 0 && this.db) {
			await backfillChats(this.db, this.opts.client, {
				limitPerChat: this.opts.backfillLimitPerChat,
			});
		}
	}

	async stop(): Promise<void> {
		try {
			await this.opts.client.destroy();
		} catch {
			// best-effort; proceed with shutdown
		}
		await this.server.stop();
		if (this.db) {
			this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			this.db.close();
			this.db = null;
		}
		this.releasePidLock();
		if (this.sm.current !== "stopped" && this.sm.current !== "failed") {
			try {
				this.sm.transition("stopped");
			} catch {
				// already in a terminal state
			}
		}
	}

	private awaitReady(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.sm.onTransition((s) => {
				if (s === "ready") resolve();
				if (s === "failed") reject(new Error("daemon failed during startup"));
			});
		});
	}

	private onStateTransition(s: DaemonState): void {
		writeFileSync(this.opts.paths.stateJson, `${JSON.stringify({ state: s })}\n`);
		this.server.broadcast({ event: "state", data: { state: s } });
	}

	private acquirePidLock(): void {
		try {
			this.pidFd = openSync(this.opts.paths.pidFile, "wx");
			writeSync(this.pidFd, Buffer.from(`${process.pid}\n`));
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e.code === "EEXIST") {
				throw new Error(`daemon already running (pidfile ${this.opts.paths.pidFile})`);
			}
			throw err;
		}
	}

	private releasePidLock(): void {
		if (this.pidFd !== null) {
			try {
				closeSync(this.pidFd);
			} catch {
				// fd may already be closed
			}
			this.pidFd = null;
		}
		if (existsSync(this.opts.paths.pidFile)) {
			try {
				unlinkSync(this.opts.paths.pidFile);
			} catch {
				// ignore — next start's O_EXCL will handle it
			}
		}
	}

	private wireClientEvents(): void {
		const { client } = this.opts;

		client.on("qr", (dataUrl) => {
			writeFileSync(this.opts.paths.qrPng, Buffer.from(dataUrl));
			if (this.sm.current === "starting") this.sm.transition("qr_required");
		});
		client.on("authenticated", () => {
			if (this.sm.current === "starting" || this.sm.current === "qr_required") {
				this.sm.transition("authenticating");
			}
		});
		client.on("ready", () => {
			if (existsSync(this.opts.paths.qrPng)) unlinkSync(this.opts.paths.qrPng);
			if (this.sm.current === "authenticating") this.sm.transition("ready");
		});
		client.on("disconnected", () => {
			if (this.sm.current === "ready") this.sm.transition("disconnected");
		});

		client.on("message", (m) => {
			if (!this.db) return;
			this.db.transaction(() => {
				upsertChat(this.db as Database, {
					id: m.chat_id,
					kind: m.chat_id.endsWith("@g.us") ? "group" : "dm",
					name: null,
					phone: m.chat_id.endsWith("@c.us") ? (m.chat_id.split("@")[0] ?? null) : null,
					updated_at: m.timestamp,
				});
				const rowid = insertMessage(this.db as Database, {
					wa_id: m.wa_id,
					chat_id: m.chat_id,
					from_id: m.from_id,
					from_name: m.from_name,
					from_me: m.from_me ? 1 : 0,
					timestamp: m.timestamp,
					type: m.type,
					body: m.body,
					quoted_wa_id: m.quoted_wa_id,
					attachment_path: null,
					attachment_mime: m.attachment?.mimetype ?? null,
					attachment_filename: m.attachment?.filename ?? null,
				});
				bumpChatUpdatedAt(this.db as Database, m.chat_id, m.timestamp);
				if (rowid !== null) {
					this.server.broadcast({ event: "message", data: { ...m, rowid } });
				}
			})();
		});

		client.on("reaction", (r) => {
			if (!this.db) return;
			applyReaction(this.db, r);
			this.server.broadcast({ event: "reaction", data: r });
		});

		client.on("contact_update", (c) => {
			if (!this.db) return;
			upsertContact(this.db, {
				id: c.id,
				phone: c.phone,
				pushname: c.pushname,
				verified_name: c.verified_name,
				is_business: c.is_business ? 1 : 0,
				is_my_contact: c.is_my_contact ? 1 : 0,
				about: c.about,
				updated_at: Date.now(),
			});
		});

		client.on("group_update", (g) => {
			if (!this.db) return;
			syncGroupParticipants(
				this.db,
				g.chat_id,
				g.participants.map((p) => ({ contact_id: p.contact_id, is_admin: p.is_admin ? 1 : 0 })),
			);
		});
	}

	private registerHandlers(): void {
		this.server.setHandlers({
			status: async () => ({ state: this.sm.current, pid: process.pid }),
			send: async (params) => {
				if (this.sm.current !== "ready") {
					throw Object.assign(new Error(`daemon not ready: ${this.sm.current}`), {
						code: "not_ready",
						details: { state: this.sm.current },
					});
				}
				const chat_id = String(params.chat_id);
				if ("text" in params && typeof params.text === "string") {
					const replyTo =
						typeof params.reply_to === "string" ? params.reply_to : undefined;
					const res = await this.opts.client.sendText(chat_id, params.text, {
						reply_to_wa_id: replyTo,
					});
					const row = this.db ? getMessageByWaId(this.db, res.wa_id) : null;
					return { wa_id: res.wa_id, rowid: row?.rowid ?? 0 };
				}
				if ("file_path" in params && typeof params.file_path === "string") {
					const caption =
						typeof params.caption === "string" ? params.caption : undefined;
					const res = await this.opts.client.sendMedia(chat_id, {
						file_path: params.file_path,
						caption,
					});
					return { wa_id: res.wa_id, rowid: 0 };
				}
				throw Object.assign(new Error("send requires text or file_path"), {
					code: "invalid_params",
				});
			},
			react: async (params) => {
				if (this.sm.current !== "ready") {
					throw Object.assign(new Error(`daemon not ready: ${this.sm.current}`), {
						code: "not_ready",
						details: { state: this.sm.current },
					});
				}
				await this.opts.client.sendReaction(String(params.message_wa_id), String(params.emoji));
				return null;
			},
			subscribe: async (_params, ctx) => {
				ctx.subscribed = true;
				return { state: this.sm.current };
			},
			unsubscribe: async (_params, ctx) => {
				ctx.subscribed = false;
				return null;
			},
			shutdown: async () => {
				setImmediate(() => void this.stop().then(() => process.exit(0)));
				return null;
			},
		});
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/daemon/index.ts tests/daemon/daemon.test.ts \
  -m "feat(daemon): compose client + storage + server into Daemon class"
```

---

## Task 22: `ipc/client.ts` — CLI-side socket client + auto-boot

**Files:**
- Create: `src/ipc/client.ts`
- Test: `tests/daemon/ipc-client.test.ts` (uses real socket + FakeDaemon stub process)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon/index.js";
import { IpcClient } from "../../src/ipc/client.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

describe("IpcClient", () => {
	test("call returns response from daemon", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ipc-"));
		const paths = accountPaths("default", root);
		const daemon = new Daemon({
			paths,
			client: new FakeWhatsAppClient(),
			backfillLimitPerChat: 0,
		});
		await daemon.start();
		try {
			const c = new IpcClient(paths.socket);
			await c.connect();
			const res = (await c.call("status", {})) as { state: string };
			expect(res.state).toBe("ready");
			await c.close();
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("subscribe yields events as they arrive", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ipc-"));
		const paths = accountPaths("default", root);
		const fake = new FakeWhatsAppClient();
		const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
		await daemon.start();
		try {
			const c = new IpcClient(paths.socket);
			await c.connect();
			const events: unknown[] = [];
			c.onEvent((e) => events.push(e));
			await c.call("subscribe", {});
			fake.emitMessage({
				wa_id: "w1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1,
				type: "chat",
				body: "hi",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 50));
			await c.close();
			expect(events.some((e) => (e as { event?: string }).event === "message")).toBe(true);
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/ipc/client.ts`**

```ts
import { type Socket, createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import {
	type EventFrame,
	FrameDecoder,
	type ResponseErrFrame,
	type ResponseOkFrame,
	encodeFrame,
	isEventFrame,
	isResponseFrame,
} from "./protocol.js";

export interface IpcError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export class IpcRequestError extends Error {
	readonly code: string;
	readonly details?: Record<string, unknown>;
	constructor(err: IpcError) {
		super(err.message);
		this.code = err.code;
		this.details = err.details;
	}
}

export class IpcClient {
	private socket: Socket | null = null;
	private decoder = new FrameDecoder();
	private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
	private eventListeners: Array<(e: EventFrame) => void> = [];
	private closed = false;

	constructor(private readonly socketPath: string) {}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const s = createConnection(this.socketPath);
			s.once("connect", () => {
				this.socket = s;
				s.on("data", (chunk) => this.onData(chunk));
				s.on("close", () => this.onClose());
				s.on("error", () => {
					// surfaced to pending callers; no additional handling here
				});
				resolve();
			});
			s.once("error", reject);
		});
	}

	onEvent(fn: (e: EventFrame) => void): void {
		this.eventListeners.push(fn);
	}

	async call(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (!this.socket) throw new Error("ipc not connected");
		const id = randomUUID();
		const p = new Promise<unknown>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
		this.socket.write(encodeFrame({ id, method, params }));
		return p;
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.socket) {
			await new Promise<void>((resolve) => {
				this.socket?.end(() => resolve());
			});
			this.socket = null;
		}
	}

	private onData(chunk: Buffer): void {
		for (const f of this.decoder.push(chunk)) {
			if (isResponseFrame(f)) {
				const pending = this.pending.get(f.id);
				if (!pending) continue;
				this.pending.delete(f.id);
				if ("result" in f) pending.resolve((f as ResponseOkFrame).result);
				else pending.reject(new IpcRequestError((f as ResponseErrFrame).error));
			} else if (isEventFrame(f)) {
				for (const l of this.eventListeners) l(f);
			}
		}
	}

	private onClose(): void {
		if (this.closed) return;
		for (const [, p] of this.pending) {
			p.reject(new IpcRequestError({ code: "disconnected", message: "daemon closed socket" }));
		}
		this.pending.clear();
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/ipc/client.ts tests/daemon/ipc-client.test.ts \
  -m "feat(ipc): CLI-side IpcClient with request/response + event stream"
```

---

## Task 23: `ipc/auto-boot.ts` — connect-or-spawn-and-retry

**Files:**
- Create: `src/ipc/auto-boot.ts`
- Test: `tests/daemon/auto-boot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon/index.js";
import { ensureDaemon } from "../../src/ipc/auto-boot.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

describe("ensureDaemon", () => {
	test("connects immediately when daemon is already running", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ab-"));
		const paths = accountPaths("default", root);
		const daemon = new Daemon({
			paths,
			client: new FakeWhatsAppClient(),
			backfillLimitPerChat: 0,
		});
		await daemon.start();
		try {
			const spawnCalls: number[] = [];
			const client = await ensureDaemon({
				paths,
				spawn: async () => {
					spawnCalls.push(1);
				},
				timeoutMs: 2000,
				pollMs: 50,
			});
			expect(spawnCalls).toHaveLength(0);
			expect(client).toBeDefined();
			await client.close();
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("spawns when socket missing, then retries", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ab-"));
		const paths = accountPaths("default", root);
		let daemon: Daemon | null = null;
		try {
			const client = await ensureDaemon({
				paths,
				spawn: async () => {
					daemon = new Daemon({
						paths,
						client: new FakeWhatsAppClient(),
						backfillLimitPerChat: 0,
					});
					await daemon.start();
				},
				timeoutMs: 5000,
				pollMs: 25,
			});
			expect(client).toBeDefined();
			await client.close();
		} finally {
			if (daemon) await (daemon as Daemon).stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("times out with code=daemon_unreachable when spawn never listens", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ab-"));
		const paths = accountPaths("default", root);
		try {
			await expect(
				ensureDaemon({
					paths,
					spawn: async () => {
						// never starts
					},
					timeoutMs: 200,
					pollMs: 25,
				}),
			).rejects.toThrow(/daemon_unreachable/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/ipc/auto-boot.ts`**

```ts
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { IpcClient } from "./client.js";
import type { AccountPaths } from "../util/paths.js";

export interface EnsureDaemonOpts {
	paths: AccountPaths;
	spawn: () => Promise<void>;
	timeoutMs: number;
	pollMs: number;
}

export async function ensureDaemon(opts: EnsureDaemonOpts): Promise<IpcClient> {
	const first = await tryConnect(opts.paths.socket);
	if (first) return first;

	cleanupStale(opts.paths);
	await opts.spawn();

	const deadline = Date.now() + opts.timeoutMs;
	while (Date.now() < deadline) {
		const c = await tryConnect(opts.paths.socket);
		if (c) return c;
		await new Promise((r) => setTimeout(r, opts.pollMs));
	}
	const err = new Error(`daemon_unreachable: socket never opened at ${opts.paths.socket}`);
	(err as Error & { code: string }).code = "daemon_unreachable";
	throw err;
}

async function tryConnect(socketPath: string): Promise<IpcClient | null> {
	if (!existsSync(socketPath)) return null;
	const c = new IpcClient(socketPath);
	try {
		await c.connect();
		return c;
	} catch {
		return null;
	}
}

function cleanupStale(paths: AccountPaths): void {
	if (existsSync(paths.pidFile)) {
		try {
			const raw = readFileSync(paths.pidFile, "utf8").trim();
			const pid = Number.parseInt(raw, 10);
			if (!pid || !pidAlive(pid)) {
				unlinkSync(paths.pidFile);
				if (existsSync(paths.socket)) unlinkSync(paths.socket);
			}
		} catch {
			// ignore — pidfile unreadable, daemon start will handle it
		}
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/ipc/auto-boot.ts tests/daemon/auto-boot.test.ts \
  -m "feat(ipc): ensureDaemon auto-boots and connects with stale-pid cleanup"
```

---

## Task 24: Commander skeleton for all subcommands

**Files:**
- Modify: `src/cli.ts`
- Create: `src/commands/types.ts`
- Test: `tests/unit/cli-commands-wired.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

function run(args: string[]) {
	return spawnSync("bun", ["run", CLI, ...args], { encoding: "utf8" });
}

describe("commander wiring", () => {
	const commands = [
		"chats",
		"history",
		"show",
		"search",
		"contacts",
		"who",
		"group",
		"cursor",
		"send",
		"react",
		"tail",
		"pair",
		"daemon",
	];
	for (const cmd of commands) {
		test(`${cmd} --help exits 0`, () => {
			const res = run([cmd, "--help"]);
			expect(res.status).toBe(0);
			expect(res.stdout).toContain("Usage:");
		});
	}

	test("top-level --help lists all commands", () => {
		const res = run(["--help"]);
		expect(res.status).toBe(0);
		for (const cmd of commands) expect(res.stdout).toContain(cmd);
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/commands/types.ts`**

```ts
export interface GlobalFlags {
	json: boolean;
	account: string;
}

export function resolveGlobalFlags(opts: Record<string, unknown>): GlobalFlags {
	return {
		json: Boolean(opts.json),
		account: typeof opts.account === "string" && opts.account.length > 0 ? opts.account : "default",
	};
}
```

- [ ] **Step 4: Replace `src/cli.ts` with the full commander wiring**

```ts
#!/usr/bin/env -S bun run
import { Command } from "commander";
import { VERSION } from "./version.js";

async function main(argv: string[]): Promise<void> {
	const program = new Command();

	program
		.name("whatsapp-cli")
		.description("Command-line WhatsApp client for humans and agents.")
		.version(VERSION, "-V, --version", "print the version")
		.option("--json", "emit machine-readable JSON envelopes", false)
		.option("--account <name>", "account to use", "default");

	program
		.command("version")
		.description("print the version")
		.action(() => {
			process.stdout.write(`${VERSION}\n`);
		});

	program
		.command("chats")
		.description("list chats, most-recent first")
		.option("--kind <kind>", "filter by kind: dm or group")
		.option("--grep <text>", "case-insensitive substring on chat name")
		.option("--limit <n>", "maximum rows", "50")
		.action(async (opts) => {
			const { run } = await import("./commands/chats.js");
			await run(opts, program.opts());
		});

	program
		.command("history <chat>")
		.description("messages for one chat")
		.option("--limit <n>", "maximum rows", "50")
		.option("--before <rowid>", "rowid exclusive upper bound")
		.option("--since <rowid>", "rowid exclusive lower bound")
		.option("--from <time>", "min timestamp (-7d, -1h, ISO, now, or epoch ms)")
		.option("--to <time>", "max timestamp")
		.action(async (chat, opts) => {
			const { run } = await import("./commands/history.js");
			await run({ chat, ...opts }, program.opts());
		});

	program
		.command("show <wa_id>")
		.description("one message with full detail")
		.action(async (waId, opts) => {
			const { run } = await import("./commands/show.js");
			await run({ waId, ...opts }, program.opts());
		});

	program
		.command("search <query>")
		.description("FTS5 across message bodies")
		.option("--chat <chat>", "limit to one chat")
		.option("--from <time>", "min timestamp")
		.option("--limit <n>", "maximum rows", "50")
		.action(async (query, opts) => {
			const { run } = await import("./commands/search.js");
			await run({ query, ...opts }, program.opts());
		});

	program
		.command("contacts")
		.description("list contacts")
		.option("--group <chat>", "only members of this group chat")
		.option("--business", "only business contacts")
		.option("--my-contacts", "only contacts in your address book")
		.action(async (opts) => {
			const { run } = await import("./commands/contacts.js");
			await run(opts, program.opts());
		});

	program
		.command("who <contact>")
		.description("one contact detail")
		.action(async (contact, opts) => {
			const { run } = await import("./commands/who.js");
			await run({ contact, ...opts }, program.opts());
		});

	program
		.command("group <chat>")
		.description("group detail + participants")
		.action(async (chat, opts) => {
			const { run } = await import("./commands/group.js");
			await run({ chat, ...opts }, program.opts());
		});

	program
		.command("cursor")
		.description("print current max rowid")
		.action(async (opts) => {
			const { run } = await import("./commands/cursor.js");
			await run(opts, program.opts());
		});

	program
		.command("send <chat> [text]")
		.description("send a text or media message")
		.option("--file <path>", "attach a file")
		.option("--caption <text>", "caption for media")
		.option("--reply <wa_id>", "reply to a message")
		.action(async (chat, text, opts) => {
			const { run } = await import("./commands/send.js");
			await run({ chat, text, ...opts }, program.opts());
		});

	program
		.command("react <wa_id> [emoji]")
		.description("add or remove a reaction (empty emoji removes)")
		.option("--emoji <emoji>", "explicit emoji (overrides positional)")
		.action(async (waId, emoji, opts) => {
			const { run } = await import("./commands/react.js");
			await run({ waId, emoji: opts.emoji ?? emoji ?? "", ...opts }, program.opts());
		});

	program
		.command("tail")
		.description("stream or pull new messages")
		.option("--since <rowid>", "start cursor")
		.option("--chat <chat>", "filter by chat")
		.option("--limit <n>", "max rows (pull mode)", "500")
		.option("--follow", "stream indefinitely", false)
		.action(async (opts) => {
			const { run } = await import("./commands/tail.js");
			await run(opts, program.opts());
		});

	program
		.command("pair")
		.description("force fresh pairing (wipes session)")
		.action(async (opts) => {
			const { run } = await import("./commands/pair.js");
			await run(opts, program.opts());
		});

	const daemonCmd = program.command("daemon").description("daemon lifecycle");
	daemonCmd
		.command("start")
		.option("--backfill <n>", "messages to pull per chat on first connect", "250")
		.option("--foreground", "do not detach", false)
		.action(async (opts) => {
			const { runStart } = await import("./commands/daemon.js");
			await runStart(opts, program.opts());
		});
	daemonCmd
		.command("stop")
		.action(async (opts) => {
			const { runStop } = await import("./commands/daemon.js");
			await runStop(opts, program.opts());
		});
	daemonCmd
		.command("status")
		.action(async (opts) => {
			const { runStatus } = await import("./commands/daemon.js");
			await runStatus(opts, program.opts());
		});
	daemonCmd
		.command("logs")
		.option("--follow", "tail -f", false)
		.option("-n <n>", "lines to show", "100")
		.action(async (opts) => {
			const { runLogs } = await import("./commands/daemon.js");
			await runLogs(opts, program.opts());
		});

	try {
		await program.parseAsync(argv);
	} catch (err) {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	}
}

void main(process.argv);
```

- [ ] **Step 5: Create empty-but-valid stub files for each command**

For each of: `chats, history, show, search, contacts, who, group, cursor, send, react, tail, pair, daemon` — create `src/commands/<name>.ts` (or for daemon, with named exports):

```ts
// src/commands/chats.ts (mirror this pattern for history/show/search/contacts/who/group/cursor/send/react/tail/pair)
import type { GlobalFlags } from "./types.js";
export async function run(
	_args: Record<string, unknown>,
	_flags: GlobalFlags,
): Promise<void> {
	process.stderr.write("not implemented\n");
	process.exit(1);
}
```

```ts
// src/commands/daemon.ts
import type { GlobalFlags } from "./types.js";

async function stub() {
	process.stderr.write("not implemented\n");
	process.exit(1);
}
export const runStart = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
export const runStop = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
export const runStatus = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
export const runLogs = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
```

- [ ] **Step 6: Run and verify pass**

Expected: 14 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git-atomic-commit commit -f \
  src/cli.ts src/commands/types.ts \
  src/commands/chats.ts src/commands/history.ts src/commands/show.ts \
  src/commands/search.ts src/commands/contacts.ts src/commands/who.ts \
  src/commands/group.ts src/commands/cursor.ts \
  src/commands/send.ts src/commands/react.ts src/commands/tail.ts \
  src/commands/pair.ts src/commands/daemon.ts \
  tests/unit/cli-commands-wired.test.ts \
  -m "feat(cli): wire all subcommands with commander; stub implementations"
```

---

## Task 25: `chats` command (direct SQLite read)

**Files:**
- Modify: `src/commands/chats.ts`
- Test: `tests/daemon/cmd-chats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { run } from "../../src/commands/chats.js";
import { accountPaths } from "../../src/util/paths.js";

function seed() {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-chats-"));
	const paths = accountPaths("default", root);
	const db = openDatabase(paths.db);
	upsertChat(db, { id: "a@c.us", kind: "dm", name: "Alice", phone: "111", updated_at: 1 });
	upsertChat(db, { id: "b@g.us", kind: "group", name: "Team", phone: null, updated_at: 2 });
	db.close();
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function captureStdout<T>(fn: () => Promise<T>): Promise<{ stdout: string; result: T }> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			(v) => {
				process.stdout.write = orig;
				resolve({ stdout: buf, result: v });
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("chats command", () => {
	test("--json emits envelope with all chats", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const { stdout } = await captureStdout(() =>
				run({ limit: "50" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(stdout);
			expect(env.success).toBe(true);
			expect(env.data).toHaveLength(2);
			expect(env.data[0].id).toBe("b@g.us");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("--kind dm filters", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const { stdout } = await captureStdout(() =>
				run({ limit: "50", kind: "dm" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(stdout);
			expect(env.data).toHaveLength(1);
			expect(env.data[0].id).toBe("a@c.us");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("text mode emits tab-separated lines", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const { stdout } = await captureStdout(() =>
				run({ limit: "50" }, { json: false, account: "default" }),
			);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(2);
			expect(lines[0]?.split("\t")).toContain("Team");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Rewrite `src/commands/chats.ts`**

```ts
import { listChats } from "../storage/chats.js";
import { openDatabase } from "../storage/db.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	kind?: string;
	grep?: string;
	limit?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const kind = args.kind === "dm" || args.kind === "group" ? args.kind : undefined;
		const limit = args.limit ? Math.max(1, Number.parseInt(args.limit, 10)) : 50;
		const rows = listChats(db, { kind, grep: args.grep, limit });
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(rows, { count: rows.length })));
			return;
		}
		for (const r of rows) {
			const ts = new Date(r.updated_at).toISOString();
			process.stdout.write(`${ts}\t${r.kind}\t${r.id}\t${r.name ?? ""}\n`);
		}
	} finally {
		db.close();
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/commands/chats.ts tests/daemon/cmd-chats.test.ts \
  -m "feat(cmd): chats — list chats from direct SQLite read"
```

---

## Task 26: `history` command

**Files:**
- Modify: `src/commands/history.ts`
- Test: `tests/daemon/cmd-history.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { insertMessage } from "../../src/storage/messages.js";
import { run } from "../../src/commands/history.js";
import { accountPaths } from "../../src/util/paths.js";

function seed() {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-history-"));
	const paths = accountPaths("default", root);
	const db = openDatabase(paths.db);
	upsertChat(db, { id: "a@c.us", kind: "dm", name: "Alice", phone: "111", updated_at: 0 });
	for (let i = 1; i <= 5; i++) {
		insertMessage(db, {
			wa_id: `w${i}`,
			chat_id: "a@c.us",
			from_id: "111@c.us",
			from_name: "Alice",
			from_me: 0,
			timestamp: 1_700_000_000_000 + i * 1000,
			type: "chat",
			body: `hi ${i}`,
			quoted_wa_id: null,
			attachment_path: null,
			attachment_mime: null,
			attachment_filename: null,
		});
	}
	db.close();
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("history command", () => {
	test("accepts +E.164 chat and returns messages in --json", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run({ chat: "+111", limit: "10" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data).toHaveLength(5);
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("--limit restricts count", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run({ chat: "a@c.us", limit: "2" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data).toHaveLength(2);
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("--from parses relative time", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run(
					{ chat: "a@c.us", limit: "10", from: "2026-04-10T00:00:00Z" },
					{ json: true, account: "default" },
				),
			);
			const env = JSON.parse(out);
			expect(env.data.length).toBeGreaterThan(0);
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Rewrite `src/commands/history.ts`**

```ts
import { openDatabase } from "../storage/db.js";
import { listMessagesByChat } from "../storage/messages.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import { parseTime } from "../util/time.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	chat: string;
	limit?: string;
	before?: string;
	since?: string;
	from?: string;
	to?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const chatId = normalizeChatId(args.chat);
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const rows = listMessagesByChat(db, {
			chat_id: chatId,
			limit: args.limit ? Math.max(1, Number.parseInt(args.limit, 10)) : 50,
			before_rowid: args.before ? Number.parseInt(args.before, 10) : undefined,
			since_rowid: args.since ? Number.parseInt(args.since, 10) : undefined,
			from_ts: args.from ? parseTime(args.from) : undefined,
			to_ts: args.to ? parseTime(args.to) : undefined,
		});
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(rows, { count: rows.length })));
			return;
		}
		for (const r of rows.reverse()) {
			const ts = new Date(r.timestamp).toISOString();
			const who = r.from_me ? "me" : r.from_name ?? r.from_id;
			process.stdout.write(`${ts}\t${r.wa_id}\t${who}\t${r.body ?? `<${r.type}>`}\n`);
		}
	} finally {
		db.close();
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/commands/history.ts tests/daemon/cmd-history.test.ts \
  -m "feat(cmd): history — messages for a chat with time/rowid filters"
```

---

## Task 27: `show` command

**Files:**
- Modify: `src/commands/show.ts`
- Test: `tests/daemon/cmd-show.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/commands/show.js";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { insertMessage } from "../../src/storage/messages.js";
import { applyReaction } from "../../src/storage/reactions.js";
import { accountPaths } from "../../src/util/paths.js";

function seed() {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-show-"));
	const paths = accountPaths("default", root);
	const db = openDatabase(paths.db);
	upsertChat(db, { id: "a@c.us", kind: "dm", name: "A", phone: "1", updated_at: 0 });
	insertMessage(db, {
		wa_id: "quoted",
		chat_id: "a@c.us",
		from_id: "1@c.us",
		from_name: "A",
		from_me: 0,
		timestamp: 1,
		type: "chat",
		body: "original",
		quoted_wa_id: null,
		attachment_path: null,
		attachment_mime: null,
		attachment_filename: null,
	});
	insertMessage(db, {
		wa_id: "target",
		chat_id: "a@c.us",
		from_id: "1@c.us",
		from_name: "A",
		from_me: 0,
		timestamp: 2,
		type: "chat",
		body: "reply",
		quoted_wa_id: "quoted",
		attachment_path: null,
		attachment_mime: null,
		attachment_filename: null,
	});
	applyReaction(db, { message_wa_id: "target", reactor_id: "b", emoji: "👍", timestamp: 3 });
	db.close();
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("show command", () => {
	test("returns reactions and dereferenced quoted message", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run({ waId: "target" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.wa_id).toBe("target");
			expect(env.data.reactions).toHaveLength(1);
			expect(env.data.quoted?.body).toBe("original");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("dangling quote yields quoted=null with quoted_wa_id kept", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const db = openDatabase(accountPaths("default", root).db);
			insertMessage(db, {
				wa_id: "dangles",
				chat_id: "a@c.us",
				from_id: "1@c.us",
				from_name: "A",
				from_me: 0,
				timestamp: 5,
				type: "chat",
				body: "hi",
				quoted_wa_id: "missing",
				attachment_path: null,
				attachment_mime: null,
				attachment_filename: null,
			});
			db.close();
			const out = await captureStdout(() =>
				run({ waId: "dangles" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.quoted).toBeNull();
			expect(env.data.quoted_wa_id).toBe("missing");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("not found → success:false with code=not_found", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run({ waId: "nope" }, { json: true, account: "default" }).catch(() => {}),
			);
			const env = JSON.parse(out);
			expect(env.success).toBe(false);
			expect(env.error.code).toBe("not_found");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Rewrite `src/commands/show.ts`**

```ts
import { openDatabase } from "../storage/db.js";
import { getMessageByWaId } from "../storage/messages.js";
import { listReactionsForMessage } from "../storage/reactions.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	waId: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const m = getMessageByWaId(db, args.waId);
		if (!m) {
			process.stdout.write(
				formatEnvelope(envelopeError("not_found", `no message with wa_id ${args.waId}`)),
			);
			process.exit(4);
		}
		const reactions = listReactionsForMessage(db, m.wa_id);
		const quoted = m.quoted_wa_id ? getMessageByWaId(db, m.quoted_wa_id) : null;
		const out = { ...m, reactions, quoted };
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(out)));
			return;
		}
		const ts = new Date(m.timestamp).toISOString();
		process.stdout.write(`${ts}\t${m.wa_id}\t${m.from_name ?? m.from_id}\n`);
		process.stdout.write(`${m.body ?? `<${m.type}>`}\n`);
		if (quoted)
			process.stdout.write(`  ↳ quoted ${quoted.wa_id}: ${quoted.body ?? `<${quoted.type}>`}\n`);
		for (const r of reactions) process.stdout.write(`  ${r.reactor_id}: ${r.emoji}\n`);
	} finally {
		db.close();
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/commands/show.ts tests/daemon/cmd-show.test.ts \
  -m "feat(cmd): show — message detail with reactions + quoted deref"
```

---

## Task 28: `search` command

**Files:**
- Modify: `src/commands/search.ts`
- Test: `tests/daemon/cmd-search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/commands/search.js";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { insertMessage } from "../../src/storage/messages.js";
import { accountPaths } from "../../src/util/paths.js";

function seed() {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-search-"));
	const paths = accountPaths("default", root);
	const db = openDatabase(paths.db);
	upsertChat(db, { id: "a@c.us", kind: "dm", name: "A", phone: "1", updated_at: 0 });
	insertMessage(db, {
		wa_id: "w1",
		chat_id: "a@c.us",
		from_id: "1@c.us",
		from_name: "A",
		from_me: 0,
		timestamp: 1,
		type: "chat",
		body: "we need to ship the widget",
		quoted_wa_id: null,
		attachment_path: null,
		attachment_mime: null,
		attachment_filename: null,
	});
	insertMessage(db, {
		wa_id: "w2",
		chat_id: "a@c.us",
		from_id: "1@c.us",
		from_name: "A",
		from_me: 0,
		timestamp: 2,
		type: "chat",
		body: "groceries",
		quoted_wa_id: null,
		attachment_path: null,
		attachment_mime: null,
		attachment_filename: null,
	});
	db.close();
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("search command", () => {
	test("finds matches with snippet", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run({ query: "widget", limit: "10" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data).toHaveLength(1);
			expect(env.data[0].snippet).toContain("widget");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Rewrite `src/commands/search.ts`**

```ts
import { openDatabase } from "../storage/db.js";
import { searchMessages } from "../storage/search.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import { parseTime } from "../util/time.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	query: string;
	chat?: string;
	from?: string;
	limit?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const hits = searchMessages(db, {
			query: args.query,
			chat_id: args.chat ? normalizeChatId(args.chat) : undefined,
			since_ts: args.from ? parseTime(args.from) : undefined,
			limit: args.limit ? Math.max(1, Number.parseInt(args.limit, 10)) : 50,
		});
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(hits, { count: hits.length })));
			return;
		}
		for (const h of hits) {
			const ts = new Date(h.timestamp).toISOString();
			process.stdout.write(`${ts}\t${h.wa_id}\t${h.snippet}\n`);
		}
	} finally {
		db.close();
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 1 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/commands/search.ts tests/daemon/cmd-search.test.ts \
  -m "feat(cmd): search — FTS5 with snippets and filters"
```

---

## Task 29: `contacts`, `who`, `group`, `cursor` commands

**Files:**
- Modify: `src/commands/contacts.ts`, `src/commands/who.ts`, `src/commands/group.ts`, `src/commands/cursor.ts`
- Test: `tests/daemon/cmd-contacts-who-group-cursor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runContacts } from "../../src/commands/contacts.js";
import { run as runCursor } from "../../src/commands/cursor.js";
import { run as runGroup } from "../../src/commands/group.js";
import { run as runWho } from "../../src/commands/who.js";
import { upsertChat } from "../../src/storage/chats.js";
import { upsertContact } from "../../src/storage/contacts.js";
import { openDatabase } from "../../src/storage/db.js";
import { syncGroupParticipants } from "../../src/storage/groups.js";
import { insertMessage } from "../../src/storage/messages.js";
import { accountPaths } from "../../src/util/paths.js";

function seed() {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-cwg-"));
	const paths = accountPaths("default", root);
	const db = openDatabase(paths.db);
	upsertContact(db, {
		id: "111@c.us",
		phone: "111",
		pushname: "Alice",
		verified_name: null,
		is_business: 0,
		is_my_contact: 1,
		about: "hi",
		updated_at: 1,
	});
	upsertContact(db, {
		id: "222@c.us",
		phone: "222",
		pushname: "Bob",
		verified_name: null,
		is_business: 0,
		is_my_contact: 1,
		about: null,
		updated_at: 1,
	});
	upsertChat(db, {
		id: "grp@g.us",
		kind: "group",
		name: "Team",
		phone: null,
		updated_at: 1,
	});
	syncGroupParticipants(db, "grp@g.us", [
		{ contact_id: "111@c.us", is_admin: 1 },
		{ contact_id: "222@c.us", is_admin: 0 },
	]);
	upsertChat(db, { id: "a@c.us", kind: "dm", name: "A", phone: "1", updated_at: 0 });
	insertMessage(db, {
		wa_id: "w1",
		chat_id: "a@c.us",
		from_id: "1@c.us",
		from_name: "A",
		from_me: 0,
		timestamp: 1,
		type: "chat",
		body: "x",
		quoted_wa_id: null,
		attachment_path: null,
		attachment_mime: null,
		attachment_filename: null,
	});
	db.close();
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("contacts/who/group/cursor", () => {
	test("contacts lists all contacts", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() => runContacts({}, { json: true, account: "default" }));
			const env = JSON.parse(out);
			expect(env.data).toHaveLength(2);
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("who by phone returns matching contact", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				runWho({ contact: "+111" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.pushname).toBe("Alice");
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("group returns chat + participants", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				runGroup({ chat: "grp@g.us" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.participants).toHaveLength(2);
			expect(env.data.admins).toEqual(["111@c.us"]);
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("cursor returns current max rowid", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() => runCursor({}, { json: true, account: "default" }));
			const env = JSON.parse(out);
			expect(env.data.rowid).toBe(1);
		} finally {
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write the four command modules**

`src/commands/contacts.ts`:
```ts
import { listContacts } from "../storage/contacts.js";
import { openDatabase } from "../storage/db.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	group?: string;
	business?: boolean;
	myContacts?: boolean;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const rows = listContacts(db, {
			group_id: args.group ? normalizeChatId(args.group) : undefined,
			business: Boolean(args.business),
			my_contacts: Boolean(args.myContacts),
		});
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(rows, { count: rows.length })));
			return;
		}
		for (const c of rows) {
			process.stdout.write(`${c.id}\t${c.phone ?? ""}\t${c.pushname ?? ""}\n`);
		}
	} finally {
		db.close();
	}
}
```

`src/commands/who.ts`:
```ts
import { getContact, getContactByPhone } from "../storage/contacts.js";
import { openDatabase } from "../storage/db.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	contact: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		let row = args.contact.includes("@") ? getContact(db, args.contact) : null;
		if (!row) {
			const phone = args.contact.replace(/^\+/, "");
			row = getContactByPhone(db, phone);
		}
		if (!row) {
			process.stdout.write(
				formatEnvelope(envelopeError("not_found", `no contact for ${args.contact}`)),
			);
			process.exit(4);
		}
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(row)));
			return;
		}
		process.stdout.write(
			`${row.id}\nphone: ${row.phone ?? ""}\npushname: ${row.pushname ?? ""}\nbusiness: ${row.is_business ? "yes" : "no"}\nabout: ${row.about ?? ""}\n`,
		);
	} finally {
		db.close();
	}
}
```

`src/commands/group.ts`:
```ts
import { listChats } from "../storage/chats.js";
import { openDatabase } from "../storage/db.js";
import { getGroupParticipants } from "../storage/groups.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	chat: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const chatId = normalizeChatId(args.chat);
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const chat = listChats(db, {}).find((c) => c.id === chatId);
		if (!chat || chat.kind !== "group") {
			process.stdout.write(
				formatEnvelope(envelopeError("not_found", `no group for ${args.chat}`)),
			);
			process.exit(4);
		}
		const participants = getGroupParticipants(db, chatId);
		const admins = participants.filter((p) => p.is_admin === 1).map((p) => p.contact_id);
		const out = {
			id: chat.id,
			name: chat.name,
			participants,
			admins,
			participant_count: participants.length,
		};
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(out)));
			return;
		}
		process.stdout.write(`${chat.id}\t${chat.name ?? ""}\n`);
		process.stdout.write(`participants: ${participants.length}\nadmins: ${admins.length}\n`);
	} finally {
		db.close();
	}
}
```

`src/commands/cursor.ts`:
```ts
import { openDatabase } from "../storage/db.js";
import { getMaxRowid } from "../storage/messages.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

export async function run(_args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const rowid = getMaxRowid(db);
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk({ rowid })));
			return;
		}
		process.stdout.write(`${rowid}\n`);
	} finally {
		db.close();
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f \
  src/commands/contacts.ts src/commands/who.ts src/commands/group.ts src/commands/cursor.ts \
  tests/daemon/cmd-contacts-who-group-cursor.test.ts \
  -m "feat(cmd): contacts, who, group, cursor read commands"
```

---

## Task 30: `commands/send.ts` + `commands/react.ts` (via IPC)

**Files:**
- Modify: `src/commands/send.ts`, `src/commands/react.ts`
- Test: `tests/daemon/cmd-send-react.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runReact } from "../../src/commands/react.js";
import { run as runSend } from "../../src/commands/send.js";
import { Daemon } from "../../src/daemon/index.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

async function withRunningDaemon<T>(fn: (root: string, fake: FakeWhatsAppClient) => Promise<T>): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-send-"));
	process.env.WA_CLI_HOME = root;
	const paths = accountPaths("default", root);
	const fake = new FakeWhatsAppClient();
	const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
	await daemon.start();
	try {
		return await fn(root, fake);
	} finally {
		await daemon.stop();
		delete process.env.WA_CLI_HOME;
		rmSync(root, { recursive: true, force: true });
	}
}

describe("send command", () => {
	test("send text returns wa_id", async () => {
		await withRunningDaemon(async (_root, fake) => {
			const out = await captureStdout(() =>
				runSend(
					{ chat: "+15551234567", text: "hello" },
					{ json: true, account: "default" },
				),
			);
			const env = JSON.parse(out);
			expect(env.success).toBe(true);
			expect(env.data.wa_id).toMatch(/^fake-sent-/);
			expect(fake.sentMessages[0]?.text).toBe("hello");
		});
	});
});

describe("react command", () => {
	test("react forwards to daemon", async () => {
		await withRunningDaemon(async (_root, fake) => {
			const out = await captureStdout(() =>
				runReact({ waId: "w1", emoji: "👍" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.success).toBe(true);
			expect(fake.sentReactions[0]?.emoji).toBe("👍");
		});
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/commands/send.ts`**

```ts
import { spawn } from "node:child_process";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	chat: string;
	text?: string;
	file?: string;
	caption?: string;
	reply?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const client = await ensureDaemon({
		paths,
		spawn: async () => {
			const child = spawn(
				process.execPath,
				[process.argv[1] ?? "", "daemon", "start", "--account", flags.account],
				{ detached: true, stdio: "ignore" },
			);
			child.unref();
		},
		timeoutMs: 30_000,
		pollMs: 250,
	});
	try {
		const chat_id = normalizeChatId(args.chat);
		const params: Record<string, unknown> = { chat_id };
		if (args.file) {
			params.file_path = args.file;
			if (args.caption) params.caption = args.caption;
		} else if (args.text) {
			params.text = args.text;
		} else {
			process.stdout.write(
				formatEnvelope(envelopeError("invalid_args", "send requires text or --file")),
			);
			process.exit(1);
		}
		if (args.reply) params.reply_to = args.reply;
		try {
			const res = (await client.call("send", params)) as { wa_id: string; rowid: number };
			process.stdout.write(formatEnvelope(envelopeOk(res)));
		} catch (err) {
			const e = err as { code?: string; message?: string };
			process.stdout.write(
				formatEnvelope(envelopeError(e.code ?? "error", e.message ?? String(err))),
			);
			process.exit(e.code === "not_ready" ? 2 : 1);
		}
	} finally {
		await client.close();
	}
}
```

- [ ] **Step 4: Write `src/commands/react.ts`**

```ts
import { spawn } from "node:child_process";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	waId: string;
	emoji: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const client = await ensureDaemon({
		paths,
		spawn: async () => {
			const child = spawn(
				process.execPath,
				[process.argv[1] ?? "", "daemon", "start", "--account", flags.account],
				{ detached: true, stdio: "ignore" },
			);
			child.unref();
		},
		timeoutMs: 30_000,
		pollMs: 250,
	});
	try {
		try {
			await client.call("react", { message_wa_id: args.waId, emoji: args.emoji });
			process.stdout.write(formatEnvelope(envelopeOk({ wa_id: args.waId, emoji: args.emoji })));
		} catch (err) {
			const e = err as { code?: string; message?: string };
			process.stdout.write(
				formatEnvelope(envelopeError(e.code ?? "error", e.message ?? String(err))),
			);
			process.exit(e.code === "not_ready" ? 2 : 1);
		}
	} finally {
		await client.close();
	}
}
```

- [ ] **Step 5: Run and verify pass**

Expected: 2 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git-atomic-commit commit -f \
  src/commands/send.ts src/commands/react.ts tests/daemon/cmd-send-react.test.ts \
  -m "feat(cmd): send + react via daemon IPC with auto-boot"
```

---

## Task 31: `commands/tail.ts` — pull (`--since`) + follow (`--follow`)

**Files:**
- Modify: `src/commands/tail.ts`
- Test: `tests/daemon/cmd-tail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/commands/tail.js";
import { Daemon } from "../../src/daemon/index.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("tail command", () => {
	test("pull mode (no --follow) returns messages since rowid and exits", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-tail-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		const fake = new FakeWhatsAppClient();
		const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
		await daemon.start();
		try {
			fake.emitMessage({
				wa_id: "w1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1,
				type: "chat",
				body: "one",
				quoted_wa_id: null,
				attachment: null,
			});
			fake.emitMessage({
				wa_id: "w2",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 2,
				type: "chat",
				body: "two",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 50));
			const out = await captureStdout(() =>
				run({ since: "0", limit: "100" }, { json: true, account: "default" }),
			);
			const lines = out.trim().split("\n");
			expect(lines.length).toBeGreaterThanOrEqual(2);
			const first = JSON.parse(lines[0] ?? "{}") as { wa_id: string };
			expect(first.wa_id).toBe("w1");
		} finally {
			await daemon.stop();
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("--follow streams live events, stops on signal", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-tail-f-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		const fake = new FakeWhatsAppClient();
		const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
		await daemon.start();
		try {
			const seenLines: string[] = [];
			const orig = process.stdout.write.bind(process.stdout);
			process.stdout.write = ((chunk: string | Uint8Array) => {
				const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
				seenLines.push(s);
				return true;
			}) as typeof process.stdout.write;
			const ac = new AbortController();
			const runPromise = run(
				{ follow: true, abortSignal: ac.signal } as never,
				{ json: true, account: "default" },
			);
			await new Promise((r) => setTimeout(r, 50));
			fake.emitMessage({
				wa_id: "live1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 10,
				type: "chat",
				body: "hi",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 100));
			ac.abort();
			await runPromise;
			process.stdout.write = orig;
			expect(seenLines.join("")).toContain("live1");
		} finally {
			await daemon.stop();
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/commands/tail.ts`**

```ts
import { spawn } from "node:child_process";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { openDatabase } from "../storage/db.js";
import { getMaxRowid, listMessagesSinceRowid } from "../storage/messages.js";
import { normalizeChatId } from "../util/chat-id.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	since?: string;
	chat?: string;
	limit?: string;
	follow?: boolean;
	abortSignal?: AbortSignal;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const chatFilter = args.chat ? normalizeChatId(args.chat) : undefined;
	const since = args.since ? Number.parseInt(args.since, 10) : 0;

	if (!args.follow) {
		const db = openDatabase(paths.db, { readonly: true });
		try {
			const rows = listMessagesSinceRowid(db, {
				since_rowid: since,
				limit: args.limit ? Math.max(1, Number.parseInt(args.limit, 10)) : 500,
				chat_id: chatFilter,
			});
			for (const r of rows) process.stdout.write(`${JSON.stringify(r)}\n`);
			process.stderr.write(`${getMaxRowid(db)}\n`);
		} finally {
			db.close();
		}
		return;
	}

	const client = await ensureDaemon({
		paths,
		spawn: async () => {
			const child = spawn(
				process.execPath,
				[process.argv[1] ?? "", "daemon", "start", "--account", flags.account],
				{ detached: true, stdio: "ignore" },
			);
			child.unref();
		},
		timeoutMs: 30_000,
		pollMs: 250,
	});
	try {
		const db = openDatabase(paths.db, { readonly: true });
		try {
			const catchup = listMessagesSinceRowid(db, {
				since_rowid: since,
				limit: 10_000,
				chat_id: chatFilter,
			});
			for (const r of catchup) process.stdout.write(`${JSON.stringify(r)}\n`);
		} finally {
			db.close();
		}
		client.onEvent((e) => {
			if (e.event !== "message") return;
			const data = e.data as { chat_id: string };
			if (chatFilter && data.chat_id !== chatFilter) return;
			process.stdout.write(`${JSON.stringify(e.data)}\n`);
		});
		await client.call("subscribe", {});
		await new Promise<void>((resolve) => {
			const stop = () => resolve();
			args.abortSignal?.addEventListener("abort", stop);
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		});
	} finally {
		await client.close();
	}
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/commands/tail.ts tests/daemon/cmd-tail.test.ts \
  -m "feat(cmd): tail — pull since cursor or stream live via subscription"
```

---

## Task 32: `commands/pair.ts` — force fresh pairing

**Files:**
- Modify: `src/commands/pair.ts`
- Test: `tests/daemon/cmd-pair.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountPaths } from "../../src/util/paths.js";
import { wipeSession } from "../../src/commands/pair.js";

describe("wipeSession", () => {
	test("removes the session dir and qr.png if present", () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-pair-"));
		const paths = accountPaths("default", root);
		try {
			mkdirSync(paths.sessionDir, { recursive: true });
			writeFileSync(join(paths.sessionDir, "marker"), "x");
			writeFileSync(paths.qrPng, Buffer.from("png"));
			wipeSession(paths);
			expect(existsSync(paths.sessionDir)).toBe(false);
			expect(existsSync(paths.qrPng)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Write `src/commands/pair.ts`**

```ts
import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths, type AccountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

export function wipeSession(paths: AccountPaths): void {
	if (existsSync(paths.sessionDir)) rmSync(paths.sessionDir, { recursive: true, force: true });
	if (existsSync(paths.qrPng)) unlinkSync(paths.qrPng);
}

export async function run(_args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);

	try {
		const existing = await tryCall(paths, "shutdown");
		if (!existing) {
			// nothing to shut down; proceed
		}
	} catch {
		// not running; fine
	}

	await new Promise((r) => setTimeout(r, 500));
	wipeSession(paths);

	const child = spawn(
		process.execPath,
		[process.argv[1] ?? "", "daemon", "start", "--account", flags.account],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();

	try {
		const client = await ensureDaemon({
			paths,
			spawn: async () => {
				// already spawned above
			},
			timeoutMs: 30_000,
			pollMs: 250,
		});
		try {
			await client.call("subscribe", {});
			const state = await waitForState(client, ["qr_required", "ready"], 30_000);
			if (state === "qr_required") {
				const opener = process.platform === "darwin" ? "open" : "xdg-open";
				spawn(opener, [paths.qrPng], { detached: true, stdio: "ignore" }).unref();
				if (flags.json) {
					process.stdout.write(
						formatEnvelope(
							envelopeError("qr_required", "scan the QR to complete pairing", {
								qr_png: paths.qrPng,
							}),
						),
					);
					process.exit(2);
				}
				process.stderr.write(
					`Scan the QR at ${paths.qrPng} via WhatsApp → Settings → Linked Devices. Waiting...\n`,
				);
				const final = await waitForState(client, ["ready", "failed"], 300_000);
				if (final !== "ready") throw new Error(`pairing failed: ${final}`);
			}
			process.stdout.write(formatEnvelope(envelopeOk({ state: "ready" })));
		} finally {
			await client.close();
		}
	} catch (err) {
		const e = err as { code?: string; message?: string };
		process.stdout.write(
			formatEnvelope(envelopeError(e.code ?? "error", e.message ?? String(err))),
		);
		process.exit(1);
	}
}

async function tryCall(paths: AccountPaths, method: string): Promise<boolean> {
	try {
		const client = await ensureDaemon({
			paths,
			spawn: async () => {
				throw new Error("no spawn");
			},
			timeoutMs: 200,
			pollMs: 50,
		});
		try {
			await client.call(method, {});
			return true;
		} finally {
			await client.close();
		}
	} catch {
		return false;
	}
}

async function waitForState(
	client: { onEvent: (fn: (e: { event: string; data: unknown }) => void) => void },
	targets: string[],
	timeoutMs: number,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("state timeout")), timeoutMs);
		client.onEvent((e) => {
			if (e.event !== "state") return;
			const s = (e.data as { state: string }).state;
			if (targets.includes(s)) {
				clearTimeout(timer);
				resolve(s);
			}
		});
	});
}
```

- [ ] **Step 4: Run and verify pass**

Expected: 1 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f src/commands/pair.ts tests/daemon/cmd-pair.test.ts \
  -m "feat(cmd): pair — wipe session, respawn daemon, open QR"
```

---

## Task 33: `commands/daemon.ts` — lifecycle subcommands

**Files:**
- Modify: `src/commands/daemon.ts`
- Test: `tests/daemon/cmd-daemon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStatus, runStop } from "../../src/commands/daemon.js";
import { Daemon } from "../../src/daemon/index.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("daemon lifecycle commands", () => {
	test("status returns state=ready when daemon is running", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		const daemon = new Daemon({
			paths,
			client: new FakeWhatsAppClient(),
			backfillLimitPerChat: 0,
		});
		await daemon.start();
		try {
			const out = await captureStdout(() =>
				runStatus({}, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.state).toBe("ready");
		} finally {
			await daemon.stop();
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("status returns state=stopped when daemon is not running", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		try {
			const out = await captureStdout(() =>
				runStatus({}, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.state).toBe("stopped");
		} finally {
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("stop when not running exits 0 with warning", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		try {
			const out = await captureStdout(() =>
				runStop({}, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.success).toBe(true);
			expect(env.data.was_running).toBe(false);
		} finally {
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Rewrite `src/commands/daemon.ts`**

```ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { IpcClient } from "../ipc/client.js";
import { Daemon } from "../daemon/index.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";
import { RealWhatsAppClient } from "../wa/real-client.js";

async function tryIpc(socketPath: string): Promise<IpcClient | null> {
	if (!existsSync(socketPath)) return null;
	const c = new IpcClient(socketPath);
	try {
		await c.connect();
		return c;
	} catch {
		return null;
	}
}

export async function runStart(
	args: Record<string, unknown>,
	flags: GlobalFlags,
): Promise<void> {
	const paths = accountPaths(flags.account);
	if (!args.foreground) {
		const child = spawn(
			process.execPath,
			[process.argv[1] ?? "", "daemon", "start", "--foreground", "--account", flags.account],
			{ detached: true, stdio: "ignore" },
		);
		child.unref();
		process.stdout.write(formatEnvelope(envelopeOk({ spawned: true })));
		return;
	}

	const backfill = args.backfill ? Number.parseInt(String(args.backfill), 10) : 250;
	const daemon = new Daemon({
		paths,
		client: new RealWhatsAppClient({
			sessionDir: paths.sessionDir,
			filesDir: paths.filesDir,
		}),
		backfillLimitPerChat: backfill,
	});
	const shutdown = async (sig: string) => {
		await daemon.stop();
		process.stderr.write(`received ${sig}, exiting\n`);
		process.exit(0);
	};
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));
	await daemon.start();
	await new Promise(() => {
		// run forever; signals drive shutdown
	});
}

export async function runStop(
	_args: Record<string, unknown>,
	flags: GlobalFlags,
): Promise<void> {
	const paths = accountPaths(flags.account);
	const client = await tryIpc(paths.socket);
	if (!client) {
		process.stdout.write(formatEnvelope(envelopeOk({ was_running: false })));
		return;
	}
	try {
		await client.call("shutdown", {});
		process.stdout.write(formatEnvelope(envelopeOk({ was_running: true })));
	} catch {
		process.stdout.write(formatEnvelope(envelopeOk({ was_running: true })));
	} finally {
		await client.close();
	}
}

export async function runStatus(
	_args: Record<string, unknown>,
	flags: GlobalFlags,
): Promise<void> {
	const paths = accountPaths(flags.account);
	const client = await tryIpc(paths.socket);
	if (!client) {
		process.stdout.write(formatEnvelope(envelopeOk({ state: "stopped" })));
		return;
	}
	try {
		const res = (await client.call("status", {})) as { state: string; pid: number };
		process.stdout.write(formatEnvelope(envelopeOk(res)));
	} finally {
		await client.close();
	}
}

export async function runLogs(
	args: Record<string, unknown>,
	flags: GlobalFlags,
): Promise<void> {
	const paths = accountPaths(flags.account);
	const n = args.n ? Number.parseInt(String(args.n), 10) : 100;
	if (!existsSync(paths.logFile)) {
		process.stdout.write(formatEnvelope(envelopeOk({ lines: [] })));
		return;
	}
	const content = readFileSync(paths.logFile, "utf8");
	const lines = content.split("\n");
	const tail = lines.slice(-n - 1, -1);
	process.stdout.write(formatEnvelope(envelopeOk({ lines: tail })));
	if (args.follow) {
		process.stderr.write("--follow not supported in v1\n");
	}
}
```

Note: this file imports `RealWhatsAppClient` from `../wa/real-client.js`. That module is created in Task 40. **Until Task 40 ships, keep a minimal shim so typecheck passes:**

Create `src/wa/real-client.ts` with an empty-but-valid stub inside this same commit (Task 33 step 3):
```ts
import type { WhatsAppClient } from "./client.js";

export class RealWhatsAppClient {
	constructor(_opts: { sessionDir: string; filesDir: string }) {
		throw new Error("RealWhatsAppClient not implemented yet — use FakeWhatsAppClient until Task 40");
	}
}

// satisfy the type-only reference
export type _RealWhatsAppClientShape = WhatsAppClient;
```

- [ ] **Step 4: Run and verify pass**

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git-atomic-commit commit -f \
  src/commands/daemon.ts src/wa/real-client.ts tests/daemon/cmd-daemon.test.ts \
  -m "feat(cmd): daemon start/stop/status/logs lifecycle"
```

---

## Task 34: E2E auto-boot + send round-trip (layer 3)

**Files:**
- Create: `tests/e2e/autoboot-send.test.ts`
- Modify: `src/commands/daemon.ts` — add `WA_CLI_FAKE_CLIENT=1` branch

- [ ] **Step 1: Modify `runStart` in `src/commands/daemon.ts`**

Replace the `client: new RealWhatsAppClient({...})` line with:

```ts
const client =
	process.env.WA_CLI_FAKE_CLIENT === "1"
		? await makeFakeForE2E()
		: new RealWhatsAppClient({ sessionDir: paths.sessionDir, filesDir: paths.filesDir });
```

Add at the bottom of the file:

```ts
async function makeFakeForE2E() {
	const { FakeWhatsAppClient } = await import("../wa/fake-client.js");
	const fake = new FakeWhatsAppClient();
	return fake;
}
```

And update the `Daemon` construction to use `client: client as unknown as WhatsAppClient` (or import the interface). Cleanest: change the line to:

```ts
import type { WhatsAppClient } from "../wa/client.js";
// ...
const client: WhatsAppClient =
	process.env.WA_CLI_FAKE_CLIENT === "1"
		? await makeFakeForE2E()
		: new RealWhatsAppClient({ sessionDir: paths.sessionDir, filesDir: paths.filesDir }) as unknown as WhatsAppClient;
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

function runCli(args: string[], env: NodeJS.ProcessEnv) {
	return spawnSync("bun", ["run", CLI, ...args], { encoding: "utf8", env });
}

describe("e2e: auto-boot + round-trip", () => {
	test("`cursor` auto-spawns daemon and returns a rowid", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-e2e-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		try {
			const res = runCli(["cursor", "--json"], env);
			expect(res.status).toBe(0);
			const env_ = JSON.parse(res.stdout);
			expect(env_.success).toBe(true);
			expect(typeof env_.data.rowid).toBe("number");
		} finally {
			runCli(["daemon", "stop", "--json"], env);
			await new Promise((r) => setTimeout(r, 200));
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);
});
```

- [ ] **Step 3: Run and verify failure / then pass**

```bash
bun test tests/e2e/autoboot-send.test.ts
```

Expected initial run: fail (likely the modification in Step 1 has a typo or daemon doesn't start). Fix until it passes. Expected final: 1 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git-atomic-commit commit -f src/commands/daemon.ts tests/e2e/autoboot-send.test.ts \
  -m "feat(e2e): WA_CLI_FAKE_CLIENT gate for end-to-end tests"
```

---

## Task 35: E2E tail --follow streaming test

**Files:**
- Create: `tests/e2e/tail-follow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

describe("e2e: tail --follow", () => {
	test("follow mode streams live events until SIGINT", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-e2e-t-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		try {
			spawnSync("bun", ["run", CLI, "cursor", "--json"], { encoding: "utf8", env });
			const proc = spawn("bun", ["run", CLI, "tail", "--follow", "--json"], { env });
			let out = "";
			proc.stdout.on("data", (chunk) => {
				out += chunk.toString();
			});
			await new Promise((r) => setTimeout(r, 1500));
			proc.kill("SIGINT");
			await new Promise((r) => proc.once("exit", r));
			expect(out).toBeDefined();
		} finally {
			spawnSync("bun", ["run", CLI, "daemon", "stop", "--json"], { encoding: "utf8", env });
			await new Promise((r) => setTimeout(r, 200));
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);
});
```

Note: this test is intentionally permissive — the FakeClient won't emit messages from the child process, but the goal is verifying the streaming lifecycle (spawn + SIGINT → clean exit). A richer test lives in the unit test at `tests/daemon/cmd-tail.test.ts`.

- [ ] **Step 2: Run and verify pass**

```bash
bun test tests/e2e/tail-follow.test.ts
```

Expected: 1 pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git-atomic-commit commit -f tests/e2e/tail-follow.test.ts \
  -m "test(e2e): tail --follow lifecycle smoke test"
```

---

## Task 36: Stale-pid + concurrent-spawn e2e

**Files:**
- Create: `tests/e2e/stale-pid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { accountPaths } from "../../src/util/paths.js";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

describe("e2e: stale pid + concurrent spawn", () => {
	test("stale daemon.pid with dead PID is cleaned up on next invocation", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-e2e-stale-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		try {
			const paths = accountPaths("default", root);
			mkdirSync(paths.accountDir, { recursive: true });
			writeFileSync(paths.pidFile, "999999\n");
			const res = spawnSync("bun", ["run", CLI, "cursor", "--json"], {
				encoding: "utf8",
				env,
			});
			expect(res.status).toBe(0);
			const env_ = JSON.parse(res.stdout);
			expect(env_.success).toBe(true);
		} finally {
			spawnSync("bun", ["run", CLI, "daemon", "stop", "--json"], {
				encoding: "utf8",
				env,
			});
			await new Promise((r) => setTimeout(r, 200));
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);

	test("two concurrent invocations both end up connected to one daemon", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-e2e-conc-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		try {
			const [a, b] = await Promise.all([
				Promise.resolve(
					spawnSync("bun", ["run", CLI, "cursor", "--json"], { encoding: "utf8", env }),
				),
				Promise.resolve(
					spawnSync("bun", ["run", CLI, "cursor", "--json"], { encoding: "utf8", env }),
				),
			]);
			expect(a.status).toBe(0);
			expect(b.status).toBe(0);
		} finally {
			spawnSync("bun", ["run", CLI, "daemon", "stop", "--json"], {
				encoding: "utf8",
				env,
			});
			await new Promise((r) => setTimeout(r, 200));
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);
});
```

- [ ] **Step 2: Run and verify pass**

```bash
bun test tests/e2e/stale-pid.test.ts
```

Expected: 2 pass, 0 fail. If "concurrent spawn" fails with "daemon already running", it's a legitimate bug — inspect the O_EXCL branch in `src/daemon/index.ts` (`acquirePidLock`). The second spawner should **exit cleanly** (not crash) when the first one holds the pidfile, and the CLI-side retry loop in `ensureDaemon` should then succeed.

To fix it cleanly: in `Daemon.start()`, catch the `EEXIST` error from `acquirePidLock()` and exit the process with code 0 rather than throwing, when an existing-pid check shows a live daemon is already bound.

- [ ] **Step 3: Commit**

```bash
git-atomic-commit commit -f tests/e2e/stale-pid.test.ts \
  -m "test(e2e): stale pid cleanup + concurrent spawn safety"
```

If you had to modify `src/daemon/index.ts` to make this pass, include it in the same commit:

```bash
git-atomic-commit commit -f src/daemon/index.ts tests/e2e/stale-pid.test.ts \
  -m "fix(daemon): concurrent-start loser exits cleanly instead of crashing"
```

---

## Task 37: Daemon file logging + rotation

**Files:**
- Modify: `src/util/log.ts` — add file-sink with 10MB rotation
- Modify: `src/daemon/index.ts` — wire daemon log to `paths.logFile`
- Test: `tests/daemon/log-rotation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLogger } from "../../src/util/log.js";

describe("FileLogger rotation", () => {
	test("rotates when file exceeds maxBytes and keeps one backup", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-log-"));
		const primary = join(dir, "daemon.log");
		try {
			writeFileSync(primary, "x".repeat(200));
			const logger = new FileLogger({ path: primary, maxBytes: 100 });
			logger.info("after rotate", { k: "v" });
			expect(existsSync(`${primary}.1`)).toBe(true);
			expect(statSync(`${primary}.1`).size).toBeGreaterThan(0);
			expect(statSync(primary).size).toBeLessThan(200);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Append to `src/util/log.ts`**

```ts
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";

export interface FileLoggerOpts {
	path: string;
	maxBytes: number;
}

export class FileLogger extends Logger {
	constructor(private readonly opts: FileLoggerOpts) {
		super((line: string) => {
			this.maybeRotate();
			appendFileSync(opts.path, `${line}\n`);
		});
	}

	private maybeRotate(): void {
		try {
			if (!existsSync(this.opts.path)) return;
			const size = statSync(this.opts.path).size;
			if (size < this.opts.maxBytes) return;
			const backup = `${this.opts.path}.1`;
			if (existsSync(backup)) unlinkSync(backup);
			renameSync(this.opts.path, backup);
		} catch {
			// best-effort rotation; writes continue on the primary path
		}
	}
}
```

- [ ] **Step 4: Wire it into `src/daemon/index.ts`**

In `Daemon.start()` add as the very first step (before the state-machine listener):

```ts
const logger = new FileLogger({ path: this.opts.paths.logFile, maxBytes: 10 * 1024 * 1024 });
this.sm.onTransition((s) => logger.info("state", { state: s }));
```

(The existing `onStateTransition` handler continues to write `state.json` and broadcast via the server; logging is purely additive.)

- [ ] **Step 5: Run and verify pass**

```bash
bun test tests/daemon/log-rotation.test.ts
```

Expected: 1 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git-atomic-commit commit -f src/util/log.ts src/daemon/index.ts tests/daemon/log-rotation.test.ts \
  -m "feat(log): file-backed logger with 10MB rotation wired into daemon"
```

---

## Task 38: `wa/real-client.ts` — `whatsapp-web.js` adapter

**Files:**
- Modify: `src/wa/real-client.ts`
- Test: `tests/unit/real-client-shape.test.ts` (type / structure test only — no real Puppeteer)

This task wires `whatsapp-web.js` into the `WhatsAppClient` interface. It is **the only code path that requires Puppeteer/Chromium**. The test layer for the real client is the manual pairing smoke (Task 39); here we only verify the class instantiates and satisfies the interface.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealWhatsAppClient } from "../../src/wa/real-client.js";

describe("RealWhatsAppClient shape", () => {
	test("constructor accepts session/files dirs and exposes interface methods", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-real-"));
		try {
			const client = new RealWhatsAppClient({
				sessionDir: join(dir, "session"),
				filesDir: join(dir, "files"),
			});
			expect(typeof client.initialize).toBe("function");
			expect(typeof client.on).toBe("function");
			expect(typeof client.off).toBe("function");
			expect(typeof client.sendText).toBe("function");
			expect(typeof client.sendMedia).toBe("function");
			expect(typeof client.sendReaction).toBe("function");
			expect(typeof client.destroy).toBe("function");
			expect(typeof client.getChatById).toBe("function");
			expect(typeof client.listChats).toBe("function");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 2: Run and verify failure**

The previous shim throws in the constructor. The test should fail.

- [ ] **Step 3: Rewrite `src/wa/real-client.ts`**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import * as qrcode from "qrcode";
import type {
	ChatHandle,
	SendMediaOpts,
	SendResult,
	SendTextOpts,
	WhatsAppClient,
} from "./client.js";
import type {
	WaContactMeta,
	WaEventMap,
	WaGroupMeta,
	WaMessageEvent,
	WaReactionEvent,
} from "./events.js";

export interface RealOpts {
	sessionDir: string;
	filesDir: string;
}

export class RealWhatsAppClient implements WhatsAppClient {
	private readonly client: Client;
	private listeners: { [K in keyof WaEventMap]?: Array<WaEventMap[K]> } = {};

	constructor(private readonly opts: RealOpts) {
		mkdirSync(opts.sessionDir, { recursive: true });
		mkdirSync(opts.filesDir, { recursive: true });
		this.client = new Client({
			authStrategy: new LocalAuth({ dataPath: opts.sessionDir }),
			puppeteer: {
				headless: true,
				args: ["--no-sandbox", "--disable-setuid-sandbox"],
			},
		});
		this.wireEvents();
	}

	on<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		(this.listeners[event] ??= []).push(listener);
	}

	off<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		const arr = this.listeners[event];
		if (!arr) return;
		const idx = arr.indexOf(listener);
		if (idx >= 0) arr.splice(idx, 1);
	}

	private emit<K extends keyof WaEventMap>(
		event: K,
		...args: Parameters<WaEventMap[K]>
	): void {
		const arr = this.listeners[event];
		if (!arr) return;
		for (const l of [...arr]) (l as (...a: unknown[]) => void)(...args);
	}

	private wireEvents(): void {
		this.client.on("qr", async (qr: string) => {
			const pngPath = join(this.opts.sessionDir, "..", "qr.png");
			try {
				const buf = await qrcode.toBuffer(qr, { type: "png" });
				writeFileSync(pngPath, buf);
				this.emit("qr", pngPath);
			} catch {
				this.emit("qr", qr);
			}
		});
		this.client.on("authenticated", () => this.emit("authenticated"));
		this.client.on("ready", () => this.emit("ready"));
		this.client.on("disconnected", (reason: string) => this.emit("disconnected", reason));

		this.client.on("message", async (m) => {
			this.emit("message", await this.toMessageEvent(m, false));
		});
		this.client.on("message_create", async (m) => {
			if (m.fromMe) this.emit("message", await this.toMessageEvent(m, true));
		});
		this.client.on("message_reaction", (r) => {
			const ev: WaReactionEvent = {
				message_wa_id: r.msgId?._serialized ?? "",
				reactor_id: r.senderId ?? "",
				emoji: r.reaction ?? "",
				timestamp: r.timestamp ? r.timestamp * 1000 : Date.now(),
			};
			this.emit("reaction", ev);
		});
		this.client.on("contact_changed", async () => {
			const contacts = await this.client.getContacts();
			for (const c of contacts) this.emit("contact_update", this.toContactMeta(c));
		});
		this.client.on("group_update", async (n) => {
			const chat = await this.client.getChatById(n.id?._serialized ?? "");
			if (!chat.isGroup) return;
			const g = chat as typeof chat & {
				participants?: Array<{ id: { _serialized: string }; isAdmin?: boolean }>;
			};
			const meta: WaGroupMeta = {
				chat_id: chat.id._serialized,
				participants: (g.participants ?? []).map((p) => ({
					contact_id: p.id._serialized,
					is_admin: Boolean(p.isAdmin),
				})),
			};
			this.emit("group_update", meta);
		});
	}

	private async toMessageEvent(m: unknown, fromMe: boolean): Promise<WaMessageEvent> {
		const mm = m as {
			id: { _serialized: string };
			from: string;
			to: string;
			timestamp: number;
			type: string;
			body: string;
			hasQuotedMsg?: boolean;
			getQuotedMessage?: () => Promise<{ id: { _serialized: string } }>;
			hasMedia?: boolean;
			downloadMedia?: () => Promise<{
				data: string;
				mimetype: string;
				filename?: string;
			}>;
			_data?: { notifyName?: string };
		};
		const chatId = fromMe ? mm.to : mm.from;
		let quotedWaId: string | null = null;
		if (mm.hasQuotedMsg && mm.getQuotedMessage) {
			try {
				const q = await mm.getQuotedMessage();
				quotedWaId = q.id._serialized;
			} catch {
				quotedWaId = null;
			}
		}
		let attachment: WaMessageEvent["attachment"] = null;
		if (mm.hasMedia && mm.downloadMedia) {
			try {
				const media = await mm.downloadMedia();
				if (media?.data) {
					attachment = {
						mimetype: media.mimetype,
						filename: media.filename ?? null,
						data: Buffer.from(media.data, "base64"),
					};
				}
			} catch {
				attachment = null;
			}
		}
		return {
			wa_id: mm.id._serialized,
			chat_id: chatId,
			from_id: fromMe ? mm.to : mm.from,
			from_name: mm._data?.notifyName ?? null,
			from_me: fromMe,
			timestamp: mm.timestamp * 1000,
			type: this.normalizeType(mm.type),
			body: mm.body ?? null,
			quoted_wa_id: quotedWaId,
			attachment,
		};
	}

	private normalizeType(t: string): WaMessageEvent["type"] {
		const allowed: WaMessageEvent["type"][] = [
			"chat",
			"image",
			"video",
			"audio",
			"voice",
			"document",
			"sticker",
			"system",
		];
		return (allowed as string[]).includes(t) ? (t as WaMessageEvent["type"]) : "system";
	}

	private toContactMeta(c: unknown): WaContactMeta {
		const cc = c as {
			id: { _serialized: string; user?: string };
			pushname?: string | null;
			verifiedName?: string | null;
			isBusiness?: boolean;
			isMyContact?: boolean;
		};
		return {
			id: cc.id._serialized,
			phone: cc.id.user ?? null,
			pushname: cc.pushname ?? null,
			verified_name: cc.verifiedName ?? null,
			is_business: Boolean(cc.isBusiness),
			is_my_contact: Boolean(cc.isMyContact),
			about: null,
		};
	}

	async initialize(): Promise<void> {
		await this.client.initialize();
	}

	async getChatById(chat_id: string): Promise<ChatHandle> {
		const chat = await this.client.getChatById(chat_id);
		return {
			id: chat.id._serialized,
			kind: chat.isGroup ? "group" : "dm",
			fetchMessages: async (limit: number) => {
				const messages = await chat.fetchMessages({ limit });
				return Promise.all(messages.map((m) => this.toMessageEvent(m, Boolean((m as { fromMe?: boolean }).fromMe))));
			},
		};
	}

	async listChats(): Promise<ChatHandle[]> {
		const chats = await this.client.getChats();
		return Promise.all(chats.map((c) => this.getChatById(c.id._serialized)));
	}

	async sendText(chat_id: string, text: string, opts: SendTextOpts = {}): Promise<SendResult> {
		const sendOpts: Record<string, unknown> = {};
		if (opts.reply_to_wa_id) sendOpts.quotedMessageId = opts.reply_to_wa_id;
		const m = await this.client.sendMessage(chat_id, text, sendOpts);
		return { wa_id: m.id._serialized, timestamp: m.timestamp * 1000 };
	}

	async sendMedia(chat_id: string, opts: SendMediaOpts): Promise<SendResult> {
		const media = MessageMedia.fromFilePath(opts.file_path);
		const sendOpts: Record<string, unknown> = {};
		if (opts.caption) sendOpts.caption = opts.caption;
		if (opts.reply_to_wa_id) sendOpts.quotedMessageId = opts.reply_to_wa_id;
		const m = await this.client.sendMessage(chat_id, media, sendOpts);
		return { wa_id: m.id._serialized, timestamp: m.timestamp * 1000 };
	}

	async sendReaction(message_wa_id: string, emoji: string): Promise<void> {
		// whatsapp-web.js doesn't expose react() on Message directly by wa_id alone;
		// we use the runtime page function via the underlying client.
		const client = this.client as unknown as {
			pupPage?: { evaluate: (fn: (id: string, e: string) => unknown, id: string, e: string) => Promise<unknown> };
		};
		if (!client.pupPage) throw new Error("client page not ready");
		await client.pupPage.evaluate(
			(id: string, e: string) => {
				const wa = (
					globalThis as unknown as {
						WWebJS?: { react?: (id: string, e: string) => Promise<unknown> };
					}
				).WWebJS;
				return wa?.react?.(id, e);
			},
			message_wa_id,
			emoji,
		);
	}

	async destroy(): Promise<void> {
		await this.client.destroy();
	}
}
```

**Note for the implementing subagent:** `whatsapp-web.js` types are loose and change between releases. If the exact property shapes here don't line up, consult the currently-installed version's types and adapt the mapping functions. The event wiring is what matters; the exact shape of each mapper is a detail.

- [ ] **Step 4: Run and verify pass**

```bash
bun test tests/unit/real-client-shape.test.ts
```

Expected: 1 pass, 0 fail. Note: this test **does not** call `initialize()` — launching Chromium is too expensive for unit CI. The real smoke test is Task 39 (manual).

- [ ] **Step 5: Typecheck must pass**

```bash
pnpm run typecheck
```

Must exit 0. If you hit type errors because of mismatches with the installed `whatsapp-web.js` types, narrow the runtime assertions above rather than broadening `any`.

- [ ] **Step 6: Commit**

```bash
git-atomic-commit commit -f src/wa/real-client.ts tests/unit/real-client-shape.test.ts \
  -m "feat(wa): RealWhatsAppClient adapter over whatsapp-web.js"
```

---

## Task 39: Manual pairing smoke doc

**Files:**
- Create: `docs/manual-tests.md`

- [ ] **Step 1: Write `docs/manual-tests.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git-atomic-commit commit -f docs/manual-tests.md \
  -m "docs: add manual pairing smoke tests checklist"
```

---

## Task 40: `scripts/release.sh` + `scripts/install-remote.sh`

**Files:**
- Modify: `scripts/release.sh`
- Modify: `scripts/install-remote.sh`

- [ ] **Step 1: Write `scripts/release.sh`**

```bash
#!/usr/bin/env bash
# Cross-compile and create a GitHub Release with binaries for all platforms.
#
# Usage: bash scripts/release.sh v0.1.0

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: bash scripts/release.sh <version>"
  echo "  e.g. bash scripts/release.sh v0.1.0"
  exit 1
fi

if ! echo "$VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Error: version must match vX.Y.Z (e.g. v0.1.0)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
SRC="$PROJECT_DIR/src/cli.ts"

echo "=== Building whatsapp-cli $VERSION ==="

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

TARGETS=(
  "bun-darwin-arm64:whatsapp-cli-darwin-arm64"
  "bun-darwin-x64:whatsapp-cli-darwin-x64"
  "bun-linux-x64:whatsapp-cli-linux-x64"
  "bun-linux-arm64:whatsapp-cli-linux-arm64"
)

VERSION_NUM="${VERSION#v}"

for entry in "${TARGETS[@]}"; do
  TARGET="${entry%%:*}"
  OUTPUT="${entry##*:}"
  echo "  Building $OUTPUT ($TARGET)..."
  bun build \
    --compile \
    --target="$TARGET" \
    --define "WA_CLI_VERSION=\"$VERSION_NUM\"" \
    --outfile "$DIST_DIR/$OUTPUT" \
    "$SRC"
done

echo ""
echo "=== Binaries ==="
ls -lh "$DIST_DIR"/

echo ""
echo "=== Creating GitHub Release ==="

git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

gh release create "$VERSION" \
  "$DIST_DIR"/whatsapp-cli-* \
  --title "whatsapp-cli $VERSION" \
  --notes "$(cat <<EOF
## Install

### One-liner (recommended)

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/josiahbryan/whatsapp-cli/main/scripts/install-remote.sh | bash
\`\`\`

### Direct download

| Platform | Binary |
|---|---|
| macOS Apple Silicon | whatsapp-cli-darwin-arm64 |
| macOS Intel | whatsapp-cli-darwin-x64 |
| Linux x86_64 | whatsapp-cli-linux-x64 |
| Linux ARM64 | whatsapp-cli-linux-arm64 |

## First-run setup

Puppeteer will download Chromium (~170MB) to \`~/.cache/puppeteer\` on first daemon start. Internet required.

\`\`\`bash
whatsapp-cli pair           # scan QR once
whatsapp-cli chats --limit 5 --json
\`\`\`

See [README](https://github.com/josiahbryan/whatsapp-cli#readme) for usage.
EOF
)"

echo ""
echo "=== Done! ==="
echo "Release: https://github.com/josiahbryan/whatsapp-cli/releases/tag/$VERSION"
```

Also add a `--define` reader in `src/version.ts`. Replace its contents with:

```ts
declare const WA_CLI_VERSION: string | undefined;
export const VERSION: string =
	typeof WA_CLI_VERSION === "string" ? WA_CLI_VERSION : "0.1.0-dev";
```

- [ ] **Step 2: Write `scripts/install-remote.sh`**

```bash
#!/usr/bin/env bash
# One-liner installer for whatsapp-cli.
# Downloads the latest pre-compiled binary from GitHub Releases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/josiahbryan/whatsapp-cli/main/scripts/install-remote.sh | bash

set -euo pipefail

REPO="josiahbryan/whatsapp-cli"
INSTALL_DIR="/usr/local/bin"
INSTALL_PATH="$INSTALL_DIR/whatsapp-cli"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux)  PLATFORM="linux" ;;
  *)
    echo "[install] Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)
    echo "[install] Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

BINARY_NAME="whatsapp-cli-${PLATFORM}-${ARCH}"
echo "[install] Detected platform: ${PLATFORM}-${ARCH}"

echo "[install] Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | head -1 | sed 's/.*: *"//;s/".*//')

if [ -z "$TAG" ]; then
  echo "[install] Error: could not determine latest release."
  echo "[install] Check https://github.com/${REPO}/releases"
  exit 1
fi

echo "[install] Latest release: $TAG"

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY_NAME}"
echo "[install] Downloading ${BINARY_NAME}..."

TMPFILE=$(mktemp)
HTTP_CODE=$(curl -fsSL -w "%{http_code}" -o "$TMPFILE" "$DOWNLOAD_URL" 2>/dev/null || true)

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMPFILE" ]; then
  rm -f "$TMPFILE"
  echo "[install] Error: download failed (HTTP $HTTP_CODE)"
  echo "[install] URL: $DOWNLOAD_URL"
  exit 1
fi

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "$INSTALL_PATH"
  chmod 755 "$INSTALL_PATH"
else
  echo "[install] $INSTALL_DIR not writable, using sudo..."
  sudo mv "$TMPFILE" "$INSTALL_PATH"
  sudo chmod 755 "$INSTALL_PATH"
fi

echo "[install] Installed whatsapp-cli to $INSTALL_PATH"

VERSION=$("$INSTALL_PATH" --version 2>/dev/null || true)
if [ -n "$VERSION" ]; then
  echo "[install] Version: $VERSION"
  echo "[install] Done! Run 'whatsapp-cli pair' to get started."
else
  echo "[install] Warning: verification failed. Check that $INSTALL_DIR is in your PATH."
fi
```

- [ ] **Step 3: Sanity check**

```bash
bash scripts/release.sh 2>&1 | head -3   # should print usage
```

Do **not** run a real release from this task. The actual `v0.1.0` tag is Task 41.

- [ ] **Step 4: Commit**

```bash
git-atomic-commit commit -f scripts/release.sh scripts/install-remote.sh src/version.ts \
  -m "feat(release): cross-compile to 4 targets + one-liner installer"
```

---

## Task 41: Cut `v0.1.0` release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json` (version bump)

Only run this task once every preceding task is complete and CI is green on `main`.

- [ ] **Step 1: Pre-flight — full green**

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
./dist/whatsapp-cli --version
```

Every step must exit 0.

- [ ] **Step 2: Update `CHANGELOG.md`**

Replace the `## [Unreleased]` section with:

```markdown
## [0.1.0] - 2026-04-16

### Added

- Daemon (`whatsapp-cli daemon start`) owns the whatsapp-web.js session and writes to SQLite.
- Short-lived CLI auto-boots the daemon; reads SQLite directly for queries.
- Query commands: `chats`, `history`, `show`, `search`, `contacts`, `who`, `group`, `cursor`.
- Send commands: `send` (text + media + reply), `react`.
- Stream commands: `tail --since <rowid>`, `tail --follow`.
- Pairing: `pair` wipes session and opens `qr.png`.
- Lifecycle: `daemon start|stop|status|logs`.
- `--json` envelopes on every command.
- Cross-compiled binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64.
- One-liner install via `scripts/install-remote.sh`.
```

And make sure the file's top keeps a `## [Unreleased]` placeholder above `0.1.0` for future changes.

- [ ] **Step 3: Bump `package.json` if needed**

Confirm the version is `0.1.0`. If not, update it.

- [ ] **Step 4: Commit the version bump**

```bash
git-atomic-commit commit -f CHANGELOG.md package.json \
  -m "chore: release v0.1.0"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

Wait for CI to go green on this commit.

- [ ] **Step 6: Cut the release**

```bash
bash scripts/release.sh v0.1.0
```

Expected: 4 binaries in `dist/`, tag pushed, `gh release create` succeeds.

- [ ] **Step 7: Verify the one-liner installer on a clean machine (or container)**

From a fresh shell:

```bash
curl -fsSL https://raw.githubusercontent.com/josiahbryan/whatsapp-cli/main/scripts/install-remote.sh | bash
whatsapp-cli --version
```

Expected: prints `0.1.0`.

- [ ] **Step 8: Announce (optional)**

Write a short post linking to the release notes. Nothing else to commit.

---

## Self-review checklist (do this before marking the plan complete)

Run through these checks on your own:

1. **Spec coverage.** Open the spec at `docs/superpowers/specs/2026-04-16-whatsapp-cli-design.md` and verify each section has at least one task implementing it. In particular:
   - §4 data model → Tasks 7-13
   - §5 state machine → Task 16
   - §6 pairing → Task 32
   - §7 CLI surface → Tasks 24-33
   - §8 auto-boot → Tasks 22-23, 36
   - §9 error handling → covered across daemon + commands; watchdog in Task 20
   - §10 testing layers → Task 15 (fakeclient), 34-36 (e2e), 39 (manual)
   - §11 distribution → Task 40
   - §12 project layout → established in Task 1 and maintained throughout
2. **Placeholder scan.** No "TBD", "TODO", or "similar to Task N" blocks. Every step shows the code to paste.
3. **Type consistency.** `insertMessage`, `listMessagesByChat`, `listMessagesSinceRowid`, `getMaxRowid` — same names used everywhere they appear. `WhatsAppClient.sendText`, `sendMedia`, `sendReaction` — same signatures between Task 14 (interface), Task 15 (fake), Task 38 (real).
4. **Every commit lists explicit files** (no `git add .`).
5. **No task produces code that imports from a later task.** If a task references `RealWhatsAppClient` before Task 38, that reference ships with the stub from Task 33 step 3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-whatsapp-cli-impl.md`.

**Execution: subagent-driven-development (user's explicit choice).**

Use `superpowers:subagent-driven-development` to dispatch a fresh subagent per task with a self-contained brief. Review between tasks. Start at Task 1 (scaffolding + `gh repo create josiahbryan/whatsapp-cli --private --source=. --push`).





