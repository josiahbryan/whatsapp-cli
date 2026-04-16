import type { Database } from "bun:sqlite";
import { openDatabase } from "../storage/db.js";
import { listMessagesByChat } from "../storage/messages.js";
import { parseIntOrUndefined, parsePositiveInt } from "../util/args.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import { parseTime } from "../util/time.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	chat: string;
	limit?: string;
	before?: string;
	since?: string;
	from?: string;
	to?: string;
}

function resolveChatId(db: Database, input: string): string {
	const normalized = normalizeChatId(input);
	// Check if a chat with this ID exists directly
	const direct = db.prepare("SELECT id FROM chats WHERE id = ?").get(normalized) as
		| { id: string }
		| undefined;
	if (direct) return direct.id;
	// Extract phone digits and look up by phone column
	const phoneMatch = /^(\d+)@c\.us$/.exec(normalized);
	const phoneDigits = phoneMatch?.[1];
	if (phoneDigits !== undefined) {
		const byPhone = db.prepare("SELECT id FROM chats WHERE phone = ?").get(phoneDigits) as
			| { id: string }
			| undefined;
		if (byPhone) return byPhone.id;
	}
	// Fall back to the normalized form
	return normalized;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const chatId = resolveChatId(db, args.chat);
		const rows = listMessagesByChat(db, {
			chat_id: chatId,
			limit: parsePositiveInt(args.limit, 50),
			before_rowid: parseIntOrUndefined(args.before),
			since_rowid: parseIntOrUndefined(args.since),
			from_ts: args.from ? parseTime(args.from) : undefined,
			to_ts: args.to ? parseTime(args.to) : undefined,
		});
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(rows, { count: rows.length })));
			return;
		}
		for (const r of rows.reverse()) {
			const ts = new Date(r.timestamp).toISOString();
			const who = r.from_me ? "me" : (r.from_name ?? r.from_id);
			process.stdout.write(`${ts}\t${r.wa_id}\t${who}\t${r.body ?? `<${r.type}>`}\n`);
		}
	} finally {
		db.close();
	}
}
