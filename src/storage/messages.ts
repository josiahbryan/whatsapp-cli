import type { Database } from "bun:sqlite";

export interface MessageRow {
	rowid: number;
	wa_id: string;
	chat_id: string;
	from_id: string;
	from_name: string | null;
	from_me: number;
	timestamp: number;
	type: string;
	body: string | null;
	quoted_wa_id: string | null;
	attachment_path: string | null;
	attachment_mime: string | null;
	attachment_filename: string | null;
}

export type NewMessage = Omit<MessageRow, "rowid">;

export function insertMessage(db: Database, m: NewMessage): number | null {
	const info = db
		.prepare(
			`INSERT OR IGNORE INTO messages
			 (wa_id, chat_id, from_id, from_name, from_me, timestamp, type, body,
			  quoted_wa_id, attachment_path, attachment_mime, attachment_filename)
			 VALUES
			 (@wa_id, @chat_id, @from_id, @from_name, @from_me, @timestamp, @type, @body,
			  @quoted_wa_id, @attachment_path, @attachment_mime, @attachment_filename)`,
		)
		.run({
			"@wa_id": m.wa_id,
			"@chat_id": m.chat_id,
			"@from_id": m.from_id,
			"@from_name": m.from_name,
			"@from_me": m.from_me,
			"@timestamp": m.timestamp,
			"@type": m.type,
			"@body": m.body,
			"@quoted_wa_id": m.quoted_wa_id,
			"@attachment_path": m.attachment_path,
			"@attachment_mime": m.attachment_mime,
			"@attachment_filename": m.attachment_filename,
		});
	return info.changes > 0 ? Number(info.lastInsertRowid) : null;
}

export function getMaxRowid(db: Database): number {
	const row = db.prepare("SELECT COALESCE(MAX(rowid), 0) AS m FROM messages").get() as {
		m: number;
	};
	return row.m;
}

export function getMessageByWaId(db: Database, wa_id: string): MessageRow | null {
	const row = db.prepare("SELECT rowid, * FROM messages WHERE wa_id = ?").get(wa_id) as
		| MessageRow
		| undefined;
	return row ?? null;
}

export interface ListByChatOpts {
	chat_id: string;
	limit: number;
	before_rowid?: number;
	since_rowid?: number;
	from_ts?: number;
	to_ts?: number;
}

export function listMessagesByChat(db: Database, opts: ListByChatOpts): MessageRow[] {
	const where: string[] = ["chat_id = @chat_id"];
	const params: Record<string, string | number | null> = { "@chat_id": opts.chat_id };
	if (opts.before_rowid !== undefined) {
		where.push("rowid < @before_rowid");
		params["@before_rowid"] = opts.before_rowid;
	}
	if (opts.since_rowid !== undefined) {
		where.push("rowid > @since_rowid");
		params["@since_rowid"] = opts.since_rowid;
	}
	if (opts.from_ts !== undefined) {
		where.push("timestamp <= @from_ts");
		params["@from_ts"] = opts.from_ts;
	}
	if (opts.to_ts !== undefined) {
		where.push("timestamp >= @to_ts");
		params["@to_ts"] = opts.to_ts;
	}
	const sql =
		`SELECT rowid, * FROM messages WHERE ${where.join(" AND ")} ` +
		`ORDER BY rowid DESC LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
	return db.prepare(sql).all(params) as MessageRow[];
}

export interface ListSinceOpts {
	since_rowid: number;
	limit: number;
	chat_id?: string;
}

export function listMessagesSinceRowid(db: Database, opts: ListSinceOpts): MessageRow[] {
	const where: string[] = ["rowid > @since_rowid"];
	const params: Record<string, string | number | null> = { "@since_rowid": opts.since_rowid };
	if (opts.chat_id) {
		where.push("chat_id = @chat_id");
		params["@chat_id"] = opts.chat_id;
	}
	const sql =
		`SELECT rowid, * FROM messages WHERE ${where.join(" AND ")} ` +
		`ORDER BY rowid ASC LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
	return db.prepare(sql).all(params) as MessageRow[];
}
