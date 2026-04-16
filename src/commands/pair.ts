import { spawn } from "node:child_process";
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { ensureDaemon } from "../ipc/auto-boot.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { type AccountPaths, accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

export function wipeSession(paths: AccountPaths): void {
	if (existsSync(paths.sessionDir)) rmSync(paths.sessionDir, { recursive: true, force: true });
	if (existsSync(paths.qrPng)) unlinkSync(paths.qrPng);
}

export async function run(_args: Record<string, unknown>, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);

	try {
		await tryCall(paths, "shutdown");
	} catch {
		// not running; fine
	}

	await new Promise((r) => setTimeout(r, 500));
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
					process.exit(2);
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
		const e = err as { code?: string; message?: string };
		process.stdout.write(
			formatEnvelope(envelopeError(e.code ?? "error", e.message ?? String(err))),
		);
		process.exit(1);
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
		const timer = setTimeout(() => reject(new Error("state timeout")), timeoutMs);
		client.onEvent((e) => {
			if (e.event !== "state") return;
			const s = (e.data as { state: string }).state;
			if (targets.includes(s)) {
				clearTimeout(timer);
				resolve(s);
			}
		});
	});
}
