import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/commands/history.js";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { insertMessage } from "../../src/storage/messages.js";
import { accountPaths } from "../../src/util/paths.js";

function seed() {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-history-"));
	const paths = accountPaths("default", root);
	const db = openDatabase(paths.db);
	upsertChat(db, {
		id: "15551234567@c.us",
		kind: "dm",
		name: "Alice",
		phone: "15551234567",
		updated_at: 0,
	});
	for (let i = 1; i <= 5; i++) {
		insertMessage(db, {
			wa_id: `w${i}`,
			chat_id: "15551234567@c.us",
			from_id: "15551234567@c.us",
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
				run({ chat: "+15551234567", limit: "10" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data).toHaveLength(5);
		} finally {
			process.env.WA_CLI_HOME = undefined;
			cleanup();
		}
	});

	test("--limit restricts count", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run({ chat: "15551234567@c.us", limit: "2" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data).toHaveLength(2);
		} finally {
			process.env.WA_CLI_HOME = undefined;
			cleanup();
		}
	});

	test("--from parses relative time", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const out = await captureStdout(() =>
				run(
					{ chat: "15551234567@c.us", limit: "10", from: "2020-01-01T00:00:00Z" },
					{ json: true, account: "default" },
				),
			);
			const env = JSON.parse(out);
			expect(env.data.length).toBeGreaterThan(0);
		} finally {
			process.env.WA_CLI_HOME = undefined;
			cleanup();
		}
	});
});
