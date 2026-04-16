import type { Database } from "bun:sqlite";

export interface SearchHit {
	wa_id: string;
	chat_id: string;
	timestamp: number;
	snippet: string;
	body: string | null;
}

export interface SearchOpts {
	query: string;
	chat_id?: string;
	since_ts?: number;
	limit: number;
}

export function searchMessages(db: Database, opts: SearchOpts): SearchHit[] {
	const where: string[] = ["messages_fts MATCH @query"];
	const params: Record<string, string | number | null> = { "@query": opts.query };
	if (opts.chat_id !== undefined) {
		where.push("m.chat_id = @chat_id");
		params["@chat_id"] = opts.chat_id;
	}
	if (opts.since_ts !== undefined) {
		where.push("m.timestamp >= @since_ts");
		params["@since_ts"] = opts.since_ts;
	}
	const sql =
		`SELECT m.wa_id, m.chat_id, m.timestamp, m.body, ` +
		`snippet(messages_fts, 0, '[', ']', '…', 10) AS snippet ` +
		`FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid ` +
		`WHERE ${where.join(" AND ")} ` +
		`ORDER BY m.timestamp DESC LIMIT ${Math.max(1, Math.floor(opts.limit))}`;
	return db.prepare(sql).all(params) as SearchHit[];
}
