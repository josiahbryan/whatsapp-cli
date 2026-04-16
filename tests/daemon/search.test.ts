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
	upsertChat(db, { id: "c@c.us", kind: "dm", name: "C", phone: "1", updated_at: 0 });
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
			upsertChat(db, { id: "d@c.us", kind: "dm", name: "D", phone: "2", updated_at: 0 });
			insertMessage(db, mk(1, "needle in c"));
			insertMessage(db, { ...mk(2, "needle in d"), chat_id: "d@c.us" });
			const cOnly = searchMessages(db, { query: "needle", chat_id: "c@c.us", limit: 10 });
			expect(cOnly.map((h) => h.wa_id)).toEqual(["w1"]);
			const recent = searchMessages(db, {
				query: "needle",
				since_ts: 1_700_000_000_000 + 1500,
				limit: 10,
			});
			expect(recent.map((h) => h.wa_id)).toEqual(["w2"]);
		} finally {
			cleanup();
		}
	});
});
