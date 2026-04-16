import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	db.prepare(
		`INSERT INTO chats (id, kind, name, phone, updated_at)
		 VALUES (@id, @kind, @name, @phone, @updated_at)`,
	).run({
		"@id": "c@c.us",
		"@kind": "dm",
		"@name": "C",
		"@phone": "111",
		"@updated_at": 0,
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
