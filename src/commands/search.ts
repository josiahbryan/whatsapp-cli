import { openDatabase } from "../storage/db.js";
import { searchMessages } from "../storage/search.js";
import { parsePositiveInt } from "../util/args.js";
import { normalizeChatId } from "../util/chat-id.js";
import { InvalidArgsError, InvalidQueryError } from "../util/errors.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
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
	const query = args.query?.trim();
	if (!query) {
		process.stdout.write(formatEnvelope(envelopeError("invalid_args", "search query is required")));
		throw new InvalidArgsError("search query is required");
	}
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		let hits: ReturnType<typeof searchMessages>;
		try {
			hits = searchMessages(db, {
				query,
				chat_id: args.chat ? normalizeChatId(args.chat) : undefined,
				since_ts: args.from ? parseTime(args.from) : undefined,
				limit: parsePositiveInt(args.limit, 50),
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stdout.write(
				formatEnvelope(envelopeError("invalid_query", `invalid search query: ${msg}`)),
			);
			throw new InvalidQueryError(msg);
		}
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
