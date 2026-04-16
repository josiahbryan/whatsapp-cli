import { existsSync, readFileSync, unlinkSync } from "node:fs";
import type { AccountPaths } from "../util/paths.js";
import { IpcClient } from "./client.js";

export interface EnsureDaemonOpts {
	paths: AccountPaths;
	spawn: () => Promise<void>;
	timeoutMs: number;
	pollMs: number;
}

export async function ensureDaemon(opts: EnsureDaemonOpts): Promise<IpcClient> {
	const first = await tryConnect(opts.paths.socket);
	if (first) return first;

	cleanupStale(opts.paths);
	await opts.spawn();

	const deadline = Date.now() + opts.timeoutMs;
	while (Date.now() < deadline) {
		const c = await tryConnect(opts.paths.socket);
		if (c) return c;
		await new Promise((r) => setTimeout(r, opts.pollMs));
	}
	const err = new Error(`daemon_unreachable: socket never opened at ${opts.paths.socket}`);
	(err as Error & { code: string }).code = "daemon_unreachable";
	throw err;
}

async function tryConnect(socketPath: string): Promise<IpcClient | null> {
	if (!existsSync(socketPath)) return null;
	const c = new IpcClient(socketPath);
	try {
		await c.connect();
		return c;
	} catch {
		return null;
	}
}

function cleanupStale(paths: AccountPaths): void {
	if (existsSync(paths.pidFile)) {
		try {
			const raw = readFileSync(paths.pidFile, "utf8").trim();
			const pid = Number.parseInt(raw, 10);
			if (!pid || !pidAlive(pid)) {
				unlinkSync(paths.pidFile);
				if (existsSync(paths.socket)) unlinkSync(paths.socket);
			}
		} catch {
			// ignore — pidfile unreadable, daemon start will handle it
		}
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
