import { spawn } from "node:child_process";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	waId: string;
	emoji: string;
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
		try {
			await client.call("react", { message_wa_id: args.waId, emoji: args.emoji });
			process.stdout.write(formatEnvelope(envelopeOk({ wa_id: args.waId, emoji: args.emoji })));
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
