import { ensureDaemonForAccount } from "../ipc/auto-boot.js";
import { throwRpcEnvelopeError } from "../util/errors.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	waId: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const client = await ensureDaemonForAccount(flags);
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
			throwRpcEnvelopeError(err);
		}
	} finally {
		await client.close();
	}
}
