import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/storage/db.js";

function tempDbPath(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "wacli-db-"));
	return { dir, path: join(dir, "db.sqlite") };
}

describe("openDatabase", () => {
	test("creates fresh db with all expected tables and sets WAL", () => {
		const { dir, path } = tempDbPath();
		try {
			const db = openDatabase(path);
			const rows = db
				.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
				.all() as Array<{ name: string }>;
			const tables = rows.map((r) => r.name);
			for (const t of ["chats", "messages", "reactions", "contacts", "group_participants"]) {
				expect(tables).toContain(t);
			}
			const jm = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
			expect(jm.journal_mode).toBe("wal");
			const uv = db.prepare("PRAGMA user_version").get() as { user_version: number };
			expect(uv.user_version).toBeGreaterThan(0);
			db.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("opening an existing db is idempotent", () => {
		const { dir, path } = tempDbPath();
		try {
			const db1 = openDatabase(path);
			const v1 = (db1.prepare("PRAGMA user_version").get() as { user_version: number })
				.user_version;
			db1.close();
			const db2 = openDatabase(path);
			const v2 = (db2.prepare("PRAGMA user_version").get() as { user_version: number })
				.user_version;
			expect(v2).toBe(v1);
			db2.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("FTS virtual table exists", () => {
		const { dir, path } = tempDbPath();
		try {
			const db = openDatabase(path);
			const row = db.prepare("SELECT name FROM sqlite_master WHERE name = 'messages_fts'").get() as
				| { name: string }
				| undefined;
			expect(row?.name).toBe("messages_fts");
			db.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
