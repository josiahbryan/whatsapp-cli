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
			upsertChat(db, { id: "a@c.us", kind: "dm", name: "A", phone: "1", updated_at: 0 });
			upsertChat(db, { id: "b@c.us", kind: "dm", name: "B", phone: "2", updated_at: 0 });
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
			upsertChat(db, { id: "a@c.us", kind: "dm", name: "A", phone: "1", updated_at: 0 });
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
			client.seedHistory("a@c.us", [mk("a1", "a@c.us", 1), mk("a2", "a@c.us", 2)]);
			const report = await backfillChats(db, client, { limitPerChat: 100 });
			expect(report.inserted).toBe(1);
		} finally {
			cleanup();
		}
	});
});
