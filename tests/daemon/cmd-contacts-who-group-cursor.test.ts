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
			process.env.WA_CLI_HOME = undefined;
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
			process.env.WA_CLI_HOME = undefined;
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
			process.env.WA_CLI_HOME = undefined;
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
			process.env.WA_CLI_HOME = undefined;
			cleanup();
		}
	});
});
