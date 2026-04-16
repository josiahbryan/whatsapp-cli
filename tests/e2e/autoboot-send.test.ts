import { describe, expect, test } from "bun:test";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

describe("e2e: auto-boot + round-trip", () => {
	test("`cursor` returns rowid=0 after daemon boots with fake client", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-e2e-"));
		const env = {
			...process.env,
			WA_CLI_HOME: root,
			WA_CLI_FAKE_CLIENT: "1",
		};
		const paths = accountPaths("default", root);
		try {
			const startRes = runCli(["daemon", "start", "--json"], env);
			expect(startRes.status).toBe(0);
			await waitForSocket(paths.socket, 30_000);
			const res = runCli(["cursor", "--json"], env);
			expect(res.status).toBe(0);
			const parsed = JSON.parse(res.stdout);
			expect(parsed.success).toBe(true);
			expect(typeof parsed.data.rowid).toBe("number");
			expect(parsed.data.rowid).toBe(0);
		} finally {
			runCli(["daemon", "stop", "--json"], env);
			await new Promise((r) => setTimeout(r, 200));
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);
});
