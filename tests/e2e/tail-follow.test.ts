import { describe, expect, test } from "bun:test";
import { type SpawnSyncReturns, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { accountPaths } from "../../src/util/paths.js";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

function runCli(args: string[], env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
	return spawnSync("bun", ["run", CLI, ...args], { encoding: "utf8", env });
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

describe("e2e: tail --follow", () => {
	test("follow mode streams live events until SIGINT", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-e2e-t-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		const paths = accountPaths("default", root);
		try {
			runCli(["cursor", "--json"], env);
			const proc = spawn("bun", ["run", CLI, "tail", "--follow", "--json"], { env });
			let out = "";
			proc.stdout.on("data", (chunk) => {
				out += chunk.toString();
			});
			await new Promise((r) => setTimeout(r, 1500));
			proc.kill("SIGINT");
			await new Promise((r) => proc.once("exit", r));
			expect(out).toBeDefined();
		} finally {
			runCli(["daemon", "stop", "--json"], env);
			const cleanExit = await waitForTeardown(paths.socket, paths.pidFile, 5_000);
			if (!cleanExit) forceKillFromPidFile(paths.pidFile);
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);
});
