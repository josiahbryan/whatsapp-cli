import { openDatabase } from "../storage/db.js";
import { searchMessages } from "../storage/search.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import { parseTime } from "../util/time.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	query: string;
	chat?: string;
	from?: string;
	limit?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const hits = searchMessages(db, {
			query: args.query,
			chat_id: args.chat ? normalizeChatId(args.chat) : undefined,
			since_ts: args.from ? parseTime(args.from) : undefined,
			limit: args.limit ? Math.max(1, Number.parseInt(args.limit, 10)) : 50,
		});
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(hits, { count: hits.length })));
			return;
		}
		for (const h of hits) {
			const ts = new Date(h.timestamp).toISOString();
			process.stdout.write(`${ts}\t${h.wa_id}\t${h.snippet}\n`);
		}
	} finally {
		db.close();
	}
}
