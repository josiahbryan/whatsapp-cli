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
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
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
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("non-JSON output includes attachment line when set", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const db = openDatabase(accountPaths("default", root).db);
			insertMessage(db, {
				wa_id: "withmedia",
				chat_id: "a@c.us",
				from_id: "1@c.us",
				from_name: "A",
				from_me: 0,
				timestamp: 7,
				type: "image",
				body: null,
				quoted_wa_id: null,
				attachment_path: "/tmp/files/withmedia.jpg",
				attachment_mime: "image/jpeg",
				attachment_filename: null,
			});
			db.close();
			const out = await captureStdout(() =>
				run({ waId: "withmedia" }, { json: false, account: "default" }),
			);
			expect(out).toContain("/tmp/files/withmedia.jpg");
			expect(out).toContain("image/jpeg");
		} finally {
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});

	test("non-JSON output shows <not downloaded> when mime but no path", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const db = openDatabase(accountPaths("default", root).db);
			insertMessage(db, {
				wa_id: "nomedia",
				chat_id: "a@c.us",
				from_id: "1@c.us",
				from_name: "A",
				from_me: 0,
				timestamp: 8,
				type: "image",
				body: null,
				quoted_wa_id: null,
				attachment_path: null,
				attachment_mime: "image/jpeg",
				attachment_filename: null,
			});
			db.close();
			const out = await captureStdout(() =>
				run({ waId: "nomedia" }, { json: false, account: "default" }),
			);
			expect(out).toContain("<not downloaded>");
		} finally {
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
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
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			cleanup();
		}
	});
});
