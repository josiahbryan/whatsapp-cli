import { getChatById } from "../storage/chats.js";
import { openDatabase } from "../storage/db.js";
import { getGroupParticipants } from "../storage/groups.js";
import { NotFoundError } from "../util/errors.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	chat: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const chatId = args.chat.trim();
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		const chat = getChatById(db, chatId);
		if (!chat || chat.kind !== "group") {
			process.stdout.write(formatEnvelope(envelopeError("not_found", `no group for ${args.chat}`)));
			throw new NotFoundError(`no group for ${args.chat}`);
		}
		const participants = getGroupParticipants(db, chatId);
		const admins = participants.filter((p) => p.is_admin === 1).map((p) => p.contact_id);
		const out = {
			id: chat.id,
			name: chat.name,
			participants,
			admins,
			participant_count: participants.length,
		};
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(out)));
			return;
		}
		process.stdout.write(`${chat.id}\t${chat.name ?? ""}\n`);
		process.stdout.write(`participants: ${participants.length}\nadmins: ${admins.length}\n`);
	} finally {
		db.close();
	}
}
