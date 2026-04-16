import { openDatabase } from "../storage/db.js";
import { getMaxRowid } from "../storage/messages.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

export async function run(_args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const rowid = getMaxRowid(db);
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk({ rowid })));
			return;
		}
		process.stdout.write(`${rowid}\n`);
	} finally {
		db.close();
	}
}
