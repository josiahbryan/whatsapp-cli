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
			client.seedHistory("a@c.us", [mk("a1", "a@c.us", 1), mk("a2", "a@c.us", 2)], { name: "A" });
			client.seedHistory("b@c.us", [mk("b1", "b@c.us", 1)], { name: "B" });
			const report = await backfillChats(db, client, { limitPerChat: 100 });
			expect(report.inserted).toBe(3);
			expect(getMaxRowid(db)).toBe(3);
		} finally {
			cleanup();
		}
	});

	test("seeds chats table on fresh DB (no messages yet)", async () => {
		const { db, cleanup } = tempDb();
		try {
			const client = new FakeWhatsAppClient();
			client.seedHistory("a@c.us", [], { name: "Alice", updated_at: 123_000 });
			client.seedHistory("b@g.us", [], { name: "Group", updated_at: 456_000 });
			const report = await backfillChats(db, client, { limitPerChat: 100 });
			expect(report.inserted).toBe(0);
			const rows = db
				.prepare("SELECT id, kind, name, updated_at FROM chats ORDER BY id")
				.all() as Array<{
				id: string;
				kind: string;
				name: string | null;
				updated_at: number;
			}>;
			expect(rows).toEqual([
				{ id: "a@c.us", kind: "dm", name: "Alice", updated_at: 123_000 },
				{ id: "b@g.us", kind: "group", name: "Group", updated_at: 456_000 },
			]);
		} finally {
			cleanup();
		}
	});

	test("limit=0 seeds chats but skips message fetch", async () => {
		const { db, cleanup } = tempDb();
		try {
			const client = new FakeWhatsAppClient();
			client.seedHistory("a@c.us", [mk("a1", "a@c.us", 1)], { name: "A" });
			const report = await backfillChats(db, client, { limitPerChat: 0 });
			expect(report.inserted).toBe(0);
			expect(report.chats).toBe(0);
			const count = (db.prepare("SELECT COUNT(*) as n FROM chats").get() as { n: number }).n;
			expect(count).toBe(1);
		} finally {
			cleanup();
		}
	});

	test("dedupes against existing rows (INSERT OR IGNORE)", async () => {
		const { db, cleanup } = tempDb();
		try {
			const client = new FakeWhatsAppClient();
			upsertChat(db, { id: "a@c.us", kind: "dm", name: "A", phone: "1", updated_at: 0 });
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
			client.seedHistory("a@c.us", [mk("a1", "a@c.us", 1), mk("a2", "a@c.us", 2)], { name: "A" });
			const report = await backfillChats(db, client, { limitPerChat: 100 });
			expect(report.inserted).toBe(1);
		} finally {
			cleanup();
		}
	});
});
