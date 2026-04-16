import { openDatabase } from "../storage/db.js";
import { getMessageByWaId } from "../storage/messages.js";
import { listReactionsForMessage } from "../storage/reactions.js";
import { NotFoundError } from "../util/errors.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	waId: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const m = getMessageByWaId(db, args.waId);
		if (!m) {
			process.stdout.write(
				formatEnvelope(envelopeError("not_found", `no message with wa_id ${args.waId}`)),
			);
			throw new NotFoundError(`no message with wa_id ${args.waId}`);
		}
		const reactions = listReactionsForMessage(db, m.wa_id);
		const quoted = m.quoted_wa_id ? getMessageByWaId(db, m.quoted_wa_id) : null;
		const out = { ...m, reactions, quoted };
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(out)));
			return;
		}
		const ts = new Date(m.timestamp).toISOString();
		process.stdout.write(`${ts}\t${m.wa_id}\t${m.from_name ?? m.from_id}\n`);
		process.stdout.write(`${m.body ?? `<${m.type}>`}\n`);
		if (quoted)
			process.stdout.write(`  ↳ quoted ${quoted.wa_id}: ${quoted.body ?? `<${quoted.type}>`}\n`);
		for (const r of reactions) process.stdout.write(`  ${r.reactor_id}: ${r.emoji}\n`);
	} finally {
		db.close();
	}
}
