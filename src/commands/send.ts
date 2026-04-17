import { ensureDaemonForAccount } from "../ipc/auto-boot.js";
import { normalizeChatId } from "../util/chat-id.js";
import { InvalidArgsError, throwRpcEnvelopeError } from "../util/errors.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	chat: string;
	text?: string;
	file?: string;
	caption?: string;
	reply?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const client = await ensureDaemonForAccount(flags);
	try {
		const chat_id = normalizeChatId(args.chat);
		const params: Record<string, unknown> = { chat_id };
		if (args.file) {
			params.file_path = args.file;
			if (args.caption) params.caption = args.caption;
		} else if (args.text) {
			params.text = args.text;
		} else {
			process.stdout.write(
				formatEnvelope(envelopeError("invalid_args", "send requires text or --file")),
			);
			throw new InvalidArgsError("send requires text or --file");
		}
		if (args.reply) params.reply_to = args.reply;
		try {
			const res = (await client.call("send", params)) as { wa_id: string; rowid: number };
			process.stdout.write(formatEnvelope(envelopeOk(res)));
		} catch (err) {
			throwRpcEnvelopeError(err);
		}
	} finally {
		await client.close();
	}
}
