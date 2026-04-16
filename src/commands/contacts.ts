import { listContacts } from "../storage/contacts.js";
import { openDatabase } from "../storage/db.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	group?: string;
	business?: boolean;
	myContacts?: boolean;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const rows = listContacts(db, {
			group_id: args.group ? normalizeChatId(args.group) : undefined,
			business: Boolean(args.business),
			my_contacts: Boolean(args.myContacts),
		});
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(rows, { count: rows.length })));
			return;
		}
		for (const c of rows) {
			process.stdout.write(`${c.id}\t${c.phone ?? ""}\t${c.pushname ?? ""}\n`);
		}
	} finally {
		db.close();
	}
}
