import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContact, listContacts, upsertContact } from "../../src/storage/contacts.js";
import { openDatabase } from "../../src/storage/db.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-contact-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("contacts storage", () => {
	test("upsertContact inserts", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: null,
				updated_at: 1,
			});
			expect(getContact(db, "111@c.us")?.pushname).toBe("A");
		} finally {
			cleanup();
		}
	});

	test("upsertContact updates fields on conflict", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 0,
				about: null,
				updated_at: 1,
			});
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "Alice",
				verified_name: "Alice Inc",
				is_business: 1,
				is_my_contact: 1,
				about: "hi",
				updated_at: 2,
			});
			const c = getContact(db, "111@c.us");
			expect(c?.pushname).toBe("Alice");
			expect(c?.is_business).toBe(1);
			expect(c?.about).toBe("hi");
		} finally {
			cleanup();
		}
	});

	test("upsertContact preserves about via COALESCE and monotonic updated_at", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: "original",
				updated_at: 10,
			});
			upsertContact(db, {
				id: "111@c.us",
				phone: "111",
				pushname: "A2",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: null,
				updated_at: 5,
			});
			const c = getContact(db, "111@c.us");
			expect(c?.about).toBe("original");
			expect(c?.updated_at).toBe(10);
			expect(c?.pushname).toBe("A2");
		} finally {
			cleanup();
		}
	});

	test("listContacts filters by group_id via group_participants join", () => {
		const { db, cleanup } = tempDb();
		try {
			db.prepare(
				`INSERT INTO chats (id, kind, name, phone, updated_at)
				 VALUES (@id, @kind, @name, @phone, @updated_at)`,
			).run({
				"@id": "grp@g.us",
				"@kind": "group",
				"@name": "Team",
				"@phone": null,
				"@updated_at": 0,
			});
			upsertContact(db, {
				id: "1@c.us",
				phone: "1",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: null,
				updated_at: 1,
			});
			upsertContact(db, {
				id: "2@c.us",
				phone: "2",
				pushname: "B",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: null,
				updated_at: 2,
			});
			db.prepare(
				"INSERT INTO group_participants (chat_id, contact_id, is_admin) VALUES (?, ?, 0)",
			).run("grp@g.us", "1@c.us");
			const ids = listContacts(db, { group_id: "grp@g.us" }).map((c) => c.id);
			expect(ids).toEqual(["1@c.us"]);
		} finally {
			cleanup();
		}
	});

	test("listContacts filters by is_business / is_my_contact", () => {
		const { db, cleanup } = tempDb();
		try {
			upsertContact(db, {
				id: "1@c.us",
				phone: "1",
				pushname: "A",
				verified_name: null,
				is_business: 0,
				is_my_contact: 1,
				about: null,
				updated_at: 1,
			});
			upsertContact(db, {
				id: "2@c.us",
				phone: "2",
				pushname: "B",
				verified_name: null,
				is_business: 1,
				is_my_contact: 0,
				about: null,
				updated_at: 2,
			});
			expect(listContacts(db, { business: true }).map((c) => c.id)).toEqual(["2@c.us"]);
			expect(listContacts(db, { my_contacts: true }).map((c) => c.id)).toEqual(["1@c.us"]);
		} finally {
			cleanup();
		}
	});
});
