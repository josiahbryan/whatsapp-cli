import { spawn } from "node:child_process";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { normalizeChatId } from "../util/chat-id.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	chat: string;
	text?: string;
	file?: string;
	caption?: string;
	reply?: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const client = await ensureDaemon({
		paths,
		spawn: async () => {
			const child = spawn(
				process.execPath,
				[process.argv[1] ?? "", "daemon", "start", "--account", flags.account],
				{ detached: true, stdio: "ignore" },
			);
			child.unref();
		},
		timeoutMs: 30_000,
		pollMs: 250,
	});
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
			process.exit(1);
		}
		if (args.reply) params.reply_to = args.reply;
		try {
			const res = (await client.call("send", params)) as { wa_id: string; rowid: number };
			process.stdout.write(formatEnvelope(envelopeOk(res)));
		} catch (err) {
			const e = err as { code?: string; message?: string };
			process.stdout.write(
				formatEnvelope(envelopeError(e.code ?? "error", e.message ?? String(err))),
			);
			process.exit(e.code === "not_ready" ? 2 : 1);
		}
	} finally {
		await client.close();
	}
}
