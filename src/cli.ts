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

	program
		.command("status")
		.description("alias for `daemon status`")
		.action(async (opts) => {
			const { runStatus } = await import("./commands/daemon.js");
			await runStatus(opts, program.opts());
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
	daemonCmd.command("stop").action(async (opts) => {
		const { runStop } = await import("./commands/daemon.js");
		await runStop(opts, program.opts());
	});
	daemonCmd.command("status").action(async (opts) => {
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
