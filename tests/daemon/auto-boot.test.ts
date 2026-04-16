import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon/index.js";
import { ensureDaemon } from "../../src/ipc/auto-boot.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

describe("ensureDaemon", () => {
	test("connects immediately when daemon is already running", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ab-"));
		const paths = accountPaths("default", root);
		const daemon = new Daemon({
			paths,
			client: new FakeWhatsAppClient(),
			backfillLimitPerChat: 0,
		});
		await daemon.start();
		try {
			const spawnCalls: number[] = [];
			const client = await ensureDaemon({
				paths,
				spawn: async () => {
					spawnCalls.push(1);
				},
				timeoutMs: 2000,
				pollMs: 50,
			});
			expect(spawnCalls).toHaveLength(0);
			expect(client).toBeDefined();
			await client.close();
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("spawns when socket missing, then retries", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ab-"));
		const paths = accountPaths("default", root);
		let daemon: Daemon | null = null;
		try {
			const client = await ensureDaemon({
				paths,
				spawn: async () => {
					daemon = new Daemon({
						paths,
						client: new FakeWhatsAppClient(),
						backfillLimitPerChat: 0,
					});
					await daemon.start();
				},
				timeoutMs: 5000,
				pollMs: 25,
			});
			expect(client).toBeDefined();
			await client.close();
		} finally {
			if (daemon) await (daemon as Daemon).stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("times out with code=daemon_unreachable when spawn never listens", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ab-"));
		const paths = accountPaths("default", root);
		try {
			await expect(
				ensureDaemon({
					paths,
					spawn: async () => {
						// never starts
					},
					timeoutMs: 200,
					pollMs: 25,
				}),
			).rejects.toThrow(/daemon_unreachable/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
