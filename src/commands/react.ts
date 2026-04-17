import { ensureDaemonForAccount } from "../ipc/auto-boot.js";
import { throwRpcEnvelopeError } from "../util/errors.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	waId: string;
	emoji: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const client = await ensureDaemonForAccount(flags);
	try {
		try {
			await client.call("react", { message_wa_id: args.waId, emoji: args.emoji });
			process.stdout.write(formatEnvelope(envelopeOk({ wa_id: args.waId, emoji: args.emoji })));
		} catch (err) {
			throwRpcEnvelopeError(err);
		}
	} finally {
		await client.close();
	}
}
