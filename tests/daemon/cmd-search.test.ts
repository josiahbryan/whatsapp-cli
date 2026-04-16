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
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});
});
