import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon/index.js";
import { FrameDecoder, encodeFrame } from "../../src/ipc/protocol.js";
import { openDatabase } from "../../src/storage/db.js";
import { getMaxRowid } from "../../src/storage/messages.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

async function makeDaemon() {
	const root = mkdtempSync(join(tmpdir(), "wacli-daemon-"));
	const paths = accountPaths("default", root);
	const client = new FakeWhatsAppClient();
	const daemon = new Daemon({ paths, client, backfillLimitPerChat: 0 });
	return {
		daemon,
		client,
		paths,
		cleanup: async () => {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

function rpc(path: string, method: string, params: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const conn = createConnection(path);
		const dec = new FrameDecoder();
		conn.on("data", (chunk) => {
			for (const f of dec.push(chunk as Buffer)) {
				conn.end();
				if ("result" in (f as { result?: unknown })) resolve((f as { result: unknown }).result);
				else if ("error" in (f as { error?: unknown })) reject((f as { error: unknown }).error);
			}
		});
		conn.on("error", reject);
		conn.write(encodeFrame({ id: "1", method, params }));
	});
}

describe("Daemon", () => {
	test("starts, reaches ready, and persists incoming message", async () => {
		const { daemon, client, paths, cleanup } = await makeDaemon();
		try {
			await daemon.start();
			client.emitMessage({
				wa_id: "w1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1_700_000_000_000,
				type: "chat",
				body: "hi",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 30));
			const db = openDatabase(paths.db, { readonly: true });
			try {
				expect(getMaxRowid(db)).toBe(1);
			} finally {
				db.close();
			}
		} finally {
			await cleanup();
		}
	});

	test("status method returns current state", async () => {
		const { daemon, paths, cleanup } = await makeDaemon();
		try {
			await daemon.start();
			const res = (await rpc(paths.socket, "status", {})) as { state: string };
			expect(res.state).toBe("ready");
		} finally {
			await cleanup();
		}
	});

	test("send method forwards to client and returns wa_id + rowid", async () => {
		const { daemon, paths, cleanup } = await makeDaemon();
		try {
			await daemon.start();
			const res = (await rpc(paths.socket, "send", {
				chat_id: "x@c.us",
				text: "hello",
			})) as { wa_id: string; rowid: number };
			expect(res.wa_id).toMatch(/^fake-sent-\d+$/);
			expect(res.rowid).toBeGreaterThan(0);
		} finally {
			await cleanup();
		}
	});

	test("send with chat_id='me' resolves to client.getSelfJid()", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-daemon-"));
		const paths = accountPaths("default", root);
		const client = new FakeWhatsAppClient({ selfJid: "99999@c.us" });
		const daemon = new Daemon({ paths, client, backfillLimitPerChat: 0 });
		try {
			await daemon.start();
			await rpc(paths.socket, "send", { chat_id: "me", text: "note to self" });
			expect(client.sentMessages).toHaveLength(1);
			expect(client.sentMessages[0]?.chat_id).toBe("99999@c.us");
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("send with chat_id='me' errors not_ready when self jid unavailable", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-daemon-"));
		const paths = accountPaths("default", root);
		const client = new FakeWhatsAppClient(); // no selfJid configured
		const daemon = new Daemon({ paths, client, backfillLimitPerChat: 0 });
		try {
			await daemon.start();
			await expect(rpc(paths.socket, "send", { chat_id: "me", text: "hi" })).rejects.toEqual({
				code: "not_ready",
				message: expect.stringContaining("self jid"),
			});
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("send before ready fails with not_ready", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-daemon-"));
		const paths = accountPaths("default", root);
		const client = new FakeWhatsAppClient({ needsQr: true });
		const daemon = new Daemon({ paths, client, backfillLimitPerChat: 0 });
		try {
			const startPromise = daemon.start();
			await new Promise((r) => setTimeout(r, 50));
			await expect(rpc(paths.socket, "send", { chat_id: "x@c.us", text: "hi" })).rejects.toEqual({
				code: "not_ready",
				message: expect.stringContaining("qr_required"),
			});
			client.completePairing();
			await startPromise;
		} finally {
			await daemon.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
