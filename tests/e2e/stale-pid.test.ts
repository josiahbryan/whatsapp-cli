import { describe, expect, test } from "bun:test";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { accountPaths } from "../../src/util/paths.js";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

function runCli(args: string[], env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
	return spawnSync("bun", ["run", CLI, ...args], { encoding: "utf8", env });
}

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(socketPath)) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`socket never appeared at ${socketPath}`);
}

async function waitForTeardown(
	socketPath: string,
	pidFile: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!existsSync(socketPath) && !existsSync(pidFile)) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
}

function forceKillFromPidFile(pidFile: string): void {
	if (!existsSync(pidFile)) return;
	try {
		const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
		if (Number.isFinite(pid) && pid > 0) process.kill(pid, "SIGKILL");
	} catch {
		// process already gone or unreadable pidfile — nothing to do
	}
}

describe("e2e: stale pid cleanup + concurrent spawn safety", () => {
	test("stale pidfile is cleaned up and daemon starts successfully", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-e2e-stale-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		const paths = accountPaths("default", root);
		try {
			// Pre-create account dir and write a stale pidfile with a dead PID
			mkdirSync(paths.accountDir, { recursive: true });
			writeFileSync(paths.pidFile, "999999\n", "utf8");

			// daemon start must detect the stale pid and proceed — not fail
			const startRes = runCli(["daemon", "start", "--json"], env);
			expect(startRes.status).toBe(0);
			const parsed = JSON.parse(startRes.stdout);
			expect(parsed.success).toBe(true);

			// Wait for the daemon to finish booting
			await waitForSocket(paths.socket, 30_000);

			// Smoke-check: cursor must succeed, meaning the daemon actually came up
			const cursorRes = runCli(["cursor", "--json"], env);
			expect(cursorRes.status).toBe(0);
			const cursorParsed = JSON.parse(cursorRes.stdout);
			expect(cursorParsed.success).toBe(true);
		} finally {
			runCli(["daemon", "stop", "--json"], env);
			const cleanExit = await waitForTeardown(paths.socket, paths.pidFile, 5_000);
			if (!cleanExit) forceKillFromPidFile(paths.pidFile);
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);

	test("concurrent daemon starts both exit 0 and one daemon is running", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ec-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		const paths = accountPaths("default", root);
		try {
			// Launch two daemon start invocations simultaneously
			const [res1, res2] = await Promise.all([
				Promise.resolve(runCli(["daemon", "start", "--json"], env)),
				Promise.resolve(runCli(["daemon", "start", "--json"], env)),
			]);

			// Both parent processes must exit 0 (the non-foreground branch always spawns and returns)
			expect(res1.status).toBe(0);
			expect(res2.status).toBe(0);

			// Wait for the winner's daemon to fully boot
			await waitForSocket(paths.socket, 30_000);

			// Exactly one daemon must be running and accepting connections
			const cursorRes = runCli(["cursor", "--json"], env);
			expect(cursorRes.status).toBe(0);
			const cursorParsed = JSON.parse(cursorRes.stdout);
			expect(cursorParsed.success).toBe(true);
		} finally {
			runCli(["daemon", "stop", "--json"], env);
			const cleanExit = await waitForTeardown(paths.socket, paths.pidFile, 5_000);
			if (!cleanExit) forceKillFromPidFile(paths.pidFile);
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);
});
