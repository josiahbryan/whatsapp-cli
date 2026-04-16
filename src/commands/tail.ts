import { spawn } from "node:child_process";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { openDatabase } from "../storage/db.js";
import { getMaxRowid, listMessagesSinceRowid } from "../storage/messages.js";
import { parsePositiveInt } from "../util/args.js";
import { normalizeChatId } from "../util/chat-id.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	since?: string;
	chat?: string;
	limit?: string;
	follow?: boolean;
	abortSignal?: AbortSignal;
}

interface EventData {
	chat_id: string;
	wa_id: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const chatFilter = args.chat ? normalizeChatId(args.chat) : undefined;
	const since = parsePositiveInt(args.since, 0);

	if (!args.follow) {
		const db = openDatabase(paths.db, { readonly: true });
		try {
			const rows = listMessagesSinceRowid(db, {
				since_rowid: since,
				limit: parsePositiveInt(args.limit, 500),
				chat_id: chatFilter,
			});
			for (const r of rows) process.stdout.write(`${JSON.stringify(r)}\n`);
			process.stderr.write(`${getMaxRowid(db)}\n`);
		} finally {
			db.close();
		}
		return;
	}

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
		const seen = new Set<string>();
		const buffered: EventData[] = [];
		let draining = true;

		const emitLive = (data: EventData): void => {
			if (chatFilter && data.chat_id !== chatFilter) return;
			if (seen.has(data.wa_id)) return;
			seen.add(data.wa_id);
			process.stdout.write(`${JSON.stringify(data)}\n`);
		};

		client.onEvent((e) => {
			if (e.event !== "message") return;
			const data = e.data as EventData;
			if (draining) {
				buffered.push(data);
				return;
			}
			emitLive(data);
		});
		await client.call("subscribe", {});

		const db = openDatabase(paths.db, { readonly: true });
		try {
			const catchup = listMessagesSinceRowid(db, {
				since_rowid: since,
				limit: 10_000,
				chat_id: chatFilter,
			});
			for (const r of catchup) {
				seen.add(r.wa_id);
				process.stdout.write(`${JSON.stringify(r)}\n`);
			}
			process.stderr.write(`${getMaxRowid(db)}\n`);
		} finally {
			db.close();
		}

		draining = false;
		for (const data of buffered) emitLive(data);

		await new Promise<void>((resolve) => {
			const stop = (): void => {
				args.abortSignal?.removeEventListener("abort", stop);
				process.removeListener("SIGINT", stop);
				process.removeListener("SIGTERM", stop);
				resolve();
			};
			args.abortSignal?.addEventListener("abort", stop);
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		});
	} finally {
		await client.close();
	}
}
