import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { CliError } from "../util/errors.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { type AccountPaths, accountPaths } from "../util/paths.js";
import { readLivePid } from "../util/pidfile.js";
import type { GlobalFlags } from "./types.js";

export function wipeSession(paths: AccountPaths): void {
	if (existsSync(paths.sessionDir)) rmSync(paths.sessionDir, { recursive: true, force: true });
	if (existsSync(paths.qrPng)) unlinkSync(paths.qrPng);
}

async function waitForDaemonExit(paths: AccountPaths, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (readLivePid(paths.pidFile) === null) return;
		await new Promise((r) => setTimeout(r, 100));
	}
}

export async function run(_args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);

	try {
		await tryCall(paths, "shutdown");
	} catch {
		// not running; fine
	}

	// shutdown RPC returns before the old daemon's async stop() completes
	// (Puppeteer teardown can take several seconds). Wait for the pidfile
	// to clear so the new daemon's O_EXCL acquire doesn't race.
	await waitForDaemonExit(paths, 15_000);
	wipeSession(paths);

	const child = spawn(
		process.execPath,
		[process.argv[1] ?? "", "daemon", "start", "--account", flags.account],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();

	try {
		const client = await ensureDaemon({
			paths,
			spawn: async () => {
				// already spawned above
			},
			timeoutMs: 30_000,
			pollMs: 250,
		});
		try {
			await client.call("subscribe", {});
			const state = await waitForState(client, ["qr_required", "ready"], 30_000);
			if (state === "qr_required") {
				const opener = process.platform === "darwin" ? "open" : "xdg-open";
				spawn(opener, [paths.qrPng], { detached: true, stdio: "ignore" }).unref();
				if (flags.json) {
					process.stdout.write(
						formatEnvelope(
							envelopeError("qr_required", "scan the QR to complete pairing", {
								qr_png: paths.qrPng,
							}),
						),
					);
					throw new CliError("qr_required", 2, "scan the QR to complete pairing");
				}
				process.stderr.write(
					`Scan the QR at ${paths.qrPng} via WhatsApp → Settings → Linked Devices. Waiting...\n`,
				);
				const final = await waitForState(client, ["ready", "failed"], 300_000);
				if (final !== "ready") throw new Error(`pairing failed: ${final}`);
			}
			process.stdout.write(formatEnvelope(envelopeOk({ state: "ready" })));
		} finally {
			await client.close();
		}
	} catch (err) {
		if (err instanceof CliError) throw err;
		const e = err as { code?: string; message?: string };
		const code = e.code ?? "error";
		const message = e.message ?? String(err);
		process.stdout.write(formatEnvelope(envelopeError(code, message)));
		throw new CliError(code, 1, message);
	}
}

async function tryCall(paths: AccountPaths, method: string): Promise<boolean> {
	try {
		const client = await ensureDaemon({
			paths,
			spawn: async () => {
				throw new Error("no spawn");
			},
			timeoutMs: 200,
			pollMs: 50,
		});
		try {
			await client.call(method, {});
			return true;
		} finally {
			await client.close();
		}
	} catch {
		return false;
	}
}

async function waitForState(
	client: { onEvent: (fn: (e: { event: string; data: unknown }) => void) => void },
	targets: string[],
	timeoutMs: number,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error("state timeout"));
		}, timeoutMs);
		client.onEvent((e) => {
			if (settled) return;
			if (e.event !== "state") return;
			const s = (e.data as { state: string }).state;
			if (targets.includes(s)) {
				settled = true;
				clearTimeout(timer);
				resolve(s);
			}
		});
	});
}
