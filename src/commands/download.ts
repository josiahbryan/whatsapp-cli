import { spawn } from "node:child_process";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { CliError } from "../util/errors.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	waId: string;
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
			const res = (await client.call("download", { wa_id: args.waId })) as {
				wa_id: string;
				path: string;
				mime: string | null;
				filename: string | null;
				cached: boolean;
			};
			if (flags.json) {
				process.stdout.write(formatEnvelope(envelopeOk(res)));
			} else {
				process.stdout.write(`${res.path}\n`);
			}
		} catch (err) {
			const e = err as { code?: string; message?: string };
			const code = e.code ?? "error";
			const message = e.message ?? String(err);
			process.stdout.write(formatEnvelope(envelopeError(code, message)));
			throw new CliError(code, code === "not_ready" ? 2 : 1, message);
		}
	} finally {
		await client.close();
	}
}
