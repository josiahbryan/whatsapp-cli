import type { Database } from "bun:sqlite";

export interface ReactionRow {
	message_wa_id: string;
	reactor_id: string;
	emoji: string;
	timestamp: number;
}

export function applyReaction(db: Database, r: ReactionRow): void {
	if (r.emoji === "") {
		db.prepare(
			"DELETE FROM reactions WHERE message_wa_id = @message_wa_id AND reactor_id = @reactor_id",
		).run({
			"@message_wa_id": r.message_wa_id,
			"@reactor_id": r.reactor_id,
		});
		return;
	}
	db.prepare(
		`INSERT INTO reactions (message_wa_id, reactor_id, emoji, timestamp)
		 VALUES (@message_wa_id, @reactor_id, @emoji, @timestamp)
		 ON CONFLICT(message_wa_id, reactor_id) DO UPDATE SET
		   emoji = excluded.emoji,
		   timestamp = excluded.timestamp`,
	).run({
		"@message_wa_id": r.message_wa_id,
		"@reactor_id": r.reactor_id,
		"@emoji": r.emoji,
		"@timestamp": r.timestamp,
	});
}

export function listReactionsForMessage(db: Database, message_wa_id: string): ReactionRow[] {
	return db
		.prepare(
			`SELECT message_wa_id, reactor_id, emoji, timestamp
			 FROM reactions WHERE message_wa_id = ? ORDER BY timestamp ASC`,
		)
		.all(message_wa_id) as ReactionRow[];
}
