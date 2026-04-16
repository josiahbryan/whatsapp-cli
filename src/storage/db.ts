import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrations.js";

export interface OpenOptions {
	readonly?: boolean;
}

export function openDatabase(path: string, opts: OpenOptions = {}): Database {
	if (!opts.readonly) mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { readonly: opts.readonly ?? false, create: !opts.readonly });
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA synchronous = NORMAL");
	if (!opts.readonly) migrate(db);
	return db;
}
