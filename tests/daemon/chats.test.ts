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
			upsertChat(db, { id: "a@c.us", kind: "dm", name: "A", phone: "111", updated_at: 1 });
			upsertChat(db, { id: "b@c.us", kind: "dm", name: "B", phone: "222", updated_at: 3 });
			upsertChat(db, { id: "grp@g.us", kind: "group", name: "Team", phone: null, updated_at: 2 });
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
