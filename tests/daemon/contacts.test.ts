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
