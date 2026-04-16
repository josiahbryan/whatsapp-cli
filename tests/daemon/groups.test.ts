import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertChat } from "../../src/storage/chats.js";
import { upsertContact } from "../../src/storage/contacts.js";
import { openDatabase } from "../../src/storage/db.js";
import {
	getGroupParticipants,
	syncGroupParticipants,
} from "../../src/storage/groups.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-grp-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	upsertChat(db, {
		id: "grp@g.us",
		kind: "group",
		name: "Team",
		phone: null,
		updated_at: 0,
	});
	for (const id of ["1@c.us", "2@c.us", "3@c.us"]) {
		upsertContact(db, {
			id,
			phone: id.split("@")[0] ?? null,
			pushname: id,
			verified_name: null,
			is_business: 0,
			is_my_contact: 0,
			about: null,
			updated_at: 1,
		});
	}
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("group_participants", () => {
	test("syncGroupParticipants adds initial members", () => {
		const { db, cleanup } = tempDb();
		try {
			syncGroupParticipants(db, "grp@g.us", [
				{ contact_id: "1@c.us", is_admin: 1 },
				{ contact_id: "2@c.us", is_admin: 0 },
			]);
			const parts = getGroupParticipants(db, "grp@g.us");
			expect(parts).toHaveLength(2);
			expect(parts.find((p) => p.contact_id === "1@c.us")?.is_admin).toBe(1);
		} finally {
			cleanup();
		}
	});

	test("second sync replaces the set", () => {
		const { db, cleanup } = tempDb();
		try {
			syncGroupParticipants(db, "grp@g.us", [
				{ contact_id: "1@c.us", is_admin: 1 },
				{ contact_id: "2@c.us", is_admin: 0 },
			]);
			syncGroupParticipants(db, "grp@g.us", [
				{ contact_id: "1@c.us", is_admin: 0 },
				{ contact_id: "3@c.us", is_admin: 1 },
			]);
			const parts = getGroupParticipants(db, "grp@g.us");
			expect(parts.map((p) => p.contact_id).sort()).toEqual([
				"1@c.us",
				"3@c.us",
			]);
			expect(parts.find((p) => p.contact_id === "1@c.us")?.is_admin).toBe(0);
		} finally {
			cleanup();
		}
	});
});
