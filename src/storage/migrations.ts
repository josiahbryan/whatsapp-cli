import type { Database } from "bun:sqlite";

export interface Migration {
	version: number;
	up: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		up(db) {
			db.exec(`
				CREATE TABLE chats (
					id         TEXT PRIMARY KEY,
					kind       TEXT NOT NULL,
					name       TEXT,
					phone      TEXT,
					updated_at INTEGER NOT NULL
				);
				CREATE INDEX chats_updated_at ON chats(updated_at DESC);

				CREATE TABLE messages (
					rowid               INTEGER PRIMARY KEY,
					wa_id               TEXT NOT NULL UNIQUE,
					chat_id             TEXT NOT NULL REFERENCES chats(id),
					from_id             TEXT NOT NULL,
					from_name           TEXT,
					from_me             INTEGER NOT NULL,
					timestamp           INTEGER NOT NULL,
					type                TEXT NOT NULL,
					body                TEXT,
					quoted_wa_id        TEXT,
					attachment_path     TEXT,
					attachment_mime     TEXT,
					attachment_filename TEXT
				);
				CREATE INDEX messages_chat_ts ON messages(chat_id, timestamp);

				CREATE TABLE reactions (
					message_wa_id TEXT NOT NULL,
					reactor_id    TEXT NOT NULL,
					emoji         TEXT NOT NULL,
					timestamp     INTEGER NOT NULL,
					PRIMARY KEY (message_wa_id, reactor_id)
				);
				CREATE INDEX reactions_target ON reactions(message_wa_id);

				CREATE TABLE contacts (
					id            TEXT PRIMARY KEY,
					phone         TEXT,
					pushname      TEXT,
					verified_name TEXT,
					is_business   INTEGER NOT NULL DEFAULT 0,
					is_my_contact INTEGER NOT NULL DEFAULT 0,
					about         TEXT,
					updated_at    INTEGER NOT NULL
				);

				CREATE TABLE group_participants (
					chat_id    TEXT NOT NULL REFERENCES chats(id),
					contact_id TEXT NOT NULL REFERENCES contacts(id),
					is_admin   INTEGER NOT NULL DEFAULT 0,
					PRIMARY KEY (chat_id, contact_id)
				);

				CREATE VIRTUAL TABLE messages_fts USING fts5(
					body,
					content='messages',
					content_rowid='rowid',
					tokenize='unicode61 remove_diacritics 2'
				);

				CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
					INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
				END;

				CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
					INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
				END;

				CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
					INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
					INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
				END;
			`);
		},
	},
];

export function currentVersion(): number {
	return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}

export function migrate(db: Database): void {
	const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
	const current = row.user_version;
	for (const m of MIGRATIONS) {
		if (m.version > current) {
			db.transaction(() => {
				m.up(db);
				db.exec(`PRAGMA user_version = ${m.version}`);
			})();
		}
	}
}
