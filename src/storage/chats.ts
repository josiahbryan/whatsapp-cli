import type { Database } from "bun:sqlite";

export interface ChatRow {
	id: string;
	kind: "dm" | "group";
	name: string | null;
	phone: string | null;
	updated_at: number;
}

export interface ListChatsOpts {
	kind?: "dm" | "group";
	grep?: string;
	limit?: number;
}

export function upsertChat(db: Database, chat: ChatRow): void {
	db.prepare(
		`INSERT INTO chats (id, kind, name, phone, updated_at)
		 VALUES (@id, @kind, @name, @phone, @updated_at)
		 ON CONFLICT(id) DO UPDATE SET
		   kind = excluded.kind,
		   name = excluded.name,
		   phone = excluded.phone,
		   updated_at = CASE WHEN excluded.updated_at > chats.updated_at
		                     THEN excluded.updated_at ELSE chats.updated_at END`,
	).run({
		"@id": chat.id,
		"@kind": chat.kind,
		"@name": chat.name,
		"@phone": chat.phone,
		"@updated_at": chat.updated_at,
	});
}

export function listChats(db: Database, opts: ListChatsOpts): ChatRow[] {
	const where: string[] = [];
	const params: Record<string, string | number | null> = {};
	if (opts.kind) {
		where.push("kind = @kind");
		params["@kind"] = opts.kind;
	}
	if (opts.grep) {
		where.push("LOWER(name) LIKE @grep");
		params["@grep"] = `%${opts.grep.toLowerCase()}%`;
	}
	const sql = `SELECT id, kind, name, phone, updated_at FROM chats${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC${opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : ""}`;
	return db.prepare(sql).all(params) as ChatRow[];
}

export function bumpChatUpdatedAt(db: Database, chatId: string, timestamp: number): void {
	db.prepare("UPDATE chats SET updated_at = @ts WHERE id = @id AND @ts > updated_at").run({
		"@id": chatId,
		"@ts": timestamp,
	});
}
