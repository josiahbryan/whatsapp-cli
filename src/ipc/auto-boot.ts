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
	const perAttemptMs = Math.max(opts.pollMs, 500);
	const first = await tryConnect(opts.paths.socket, perAttemptMs);
	if (first) return first;

	cleanupStale(opts.paths);
	await opts.spawn();

	const deadline = Date.now() + opts.timeoutMs;
	while (Date.now() < deadline) {
		const c = await tryConnect(opts.paths.socket, perAttemptMs);
		if (c) return c;
		await new Promise((r) => setTimeout(r, opts.pollMs));
	}
	const err = new Error(
		`daemon_unreachable: socket never opened at ${opts.paths.socket} after ${opts.timeoutMs}ms`,
	);
	(err as Error & { code: string }).code = "daemon_unreachable";
	throw err;
}

async function tryConnect(socketPath: string, timeoutMs: number): Promise<IpcClient | null> {
	if (!existsSync(socketPath)) return null;
	const c = new IpcClient(socketPath);
	try {
		await withTimeout(c.connect(), timeoutMs);
		return c;
	} catch {
		try {
			await c.close();
		} catch {
			// already closed or never opened
		}
		return null;
	}
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("connect timeout")), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(err) => {
				clearTimeout(t);
				reject(err);
			},
		);
	});
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
