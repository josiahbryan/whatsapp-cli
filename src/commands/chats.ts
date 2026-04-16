import { listChats } from "../storage/chats.js";
import { openDatabase } from "../storage/db.js";
import { parsePositiveInt } from "../util/args.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	kind?: string;
	grep?: string;
	limit?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const kind = args.kind === "dm" || args.kind === "group" ? args.kind : undefined;
		const limit = parsePositiveInt(args.limit, 50);
		const rows = listChats(db, { kind, grep: args.grep, limit });
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(rows, { count: rows.length })));
			return;
		}
		for (const r of rows) {
			const ts = new Date(r.updated_at).toISOString();
			process.stdout.write(`${ts}\t${r.kind}\t${r.id}\t${r.name ?? ""}\n`);
		}
	} finally {
		db.close();
	}
}
