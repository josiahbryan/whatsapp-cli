import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon/index.js";
import { IpcClient } from "../../src/ipc/client.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

describe("IpcClient", () => {
	test("call returns response from daemon", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ipc-"));
		const paths = accountPaths("default", root);
		const daemon = new Daemon({
			paths,
			client: new FakeWhatsAppClient(),
			backfillLimitPerChat: 0,
		});
		await daemon.start();
		try {
			const c = new IpcClient(paths.socket);
			await c.connect();
			const res = (await c.call("status", {})) as { state: string };
			expect(res.state).toBe("ready");
			await c.close();
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("subscribe yields events as they arrive", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-ipc-"));
		const paths = accountPaths("default", root);
		const fake = new FakeWhatsAppClient();
		const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
		await daemon.start();
		try {
			const c = new IpcClient(paths.socket);
			await c.connect();
			const events: unknown[] = [];
			c.onEvent((e) => events.push(e));
			await c.call("subscribe", {});
			fake.emitMessage({
				wa_id: "w1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1,
				type: "chat",
				body: "hi",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 50));
			await c.close();
			expect(events.some((e) => (e as { event?: string }).event === "message")).toBe(true);
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
