import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Daemon } from "../daemon/index.js";
import { IpcClient } from "../ipc/client.js";
import { envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import { RealWhatsAppClient } from "../wa/real-client.js";
import type { GlobalFlags } from "./types.js";

async function tryIpc(socketPath: string): Promise<IpcClient | null> {
	if (!existsSync(socketPath)) return null;
	const c = new IpcClient(socketPath);
	try {
		await c.connect();
		return c;
	} catch {
		await c.close().catch(() => {});
		return null;
	}
}

export async function runStart(args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	if (!args.foreground) {
		const child = spawn(
			process.execPath,
			[process.argv[1] ?? "", "daemon", "start", "--foreground", "--account", flags.account],
			{ detached: true, stdio: "ignore" },
		);
		child.unref();
		process.stdout.write(formatEnvelope(envelopeOk({ spawned: true })));
		return;
	}

	const backfill = args.backfill ? Number.parseInt(String(args.backfill), 10) : 250;
	const daemon = new Daemon({
		paths,
		client: new RealWhatsAppClient({
			sessionDir: paths.sessionDir,
			filesDir: paths.filesDir,
		}),
		backfillLimitPerChat: backfill,
	});
	const shutdown = async (sig: string): Promise<void> => {
		await daemon.stop();
		process.stderr.write(`received ${sig}, exiting\n`);
		process.exit(0);
	};
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));
	await daemon.start();
	await new Promise(() => {
		// run forever; signals drive shutdown
	});
}

export async function runStop(_args: Record<string, unknown>, _flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(_flags.account);
	const client = await tryIpc(paths.socket);
	if (!client) {
		process.stdout.write(formatEnvelope(envelopeOk({ was_running: false })));
		return;
	}
	try {
		await client.call("shutdown", {});
		process.stdout.write(formatEnvelope(envelopeOk({ was_running: true })));
	} catch {
		process.stdout.write(formatEnvelope(envelopeOk({ was_running: true })));
	} finally {
		await client.close();
	}
}

export async function runStatus(_args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const client = await tryIpc(paths.socket);
	if (!client) {
		process.stdout.write(formatEnvelope(envelopeOk({ state: "stopped" })));
		return;
	}
	try {
		const res = (await client.call("status", {})) as { state: string; pid: number };
		process.stdout.write(formatEnvelope(envelopeOk(res)));
	} finally {
		await client.close();
	}
}

export async function runLogs(args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const n = args.n ? Number.parseInt(String(args.n), 10) : 100;
	if (!existsSync(paths.logFile)) {
		process.stdout.write(formatEnvelope(envelopeOk({ lines: [] })));
		return;
	}
	const content = readFileSync(paths.logFile, "utf8");
	const split = content.split("\n");
	const parts = content.endsWith("\n") ? split.slice(0, -1) : split;
	const tail = parts.slice(-n);
	process.stdout.write(formatEnvelope(envelopeOk({ lines: tail })));
	if (args.follow) {
		process.stderr.write("--follow not supported in v1\n");
	}
}
