import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "../../src/daemon/server.js";
import { FrameDecoder, encodeFrame } from "../../src/ipc/protocol.js";

function tempSocket(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "wacli-srv-"));
	return { dir, path: join(dir, "control.sock") };
}

async function withServer(
	handlers: Parameters<DaemonServer["setHandlers"]>[0],
	run: (path: string, server: DaemonServer) => Promise<void>,
): Promise<void> {
	const { dir, path } = tempSocket();
	const server = new DaemonServer(path);
	server.setHandlers(handlers);
	await server.start();
	try {
		await run(path, server);
	} finally {
		await server.stop();
		rmSync(dir, { recursive: true, force: true });
	}
}

function rpc(path: string, method: string, params: Record<string, unknown>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const conn = createConnection(path);
		const dec = new FrameDecoder();
		conn.on("data", (chunk) => {
			try {
				for (const f of dec.push(chunk as Buffer)) {
					conn.end();
					if ("result" in (f as { result?: unknown })) resolve((f as { result: unknown }).result);
					else if ("error" in (f as { error?: unknown })) reject((f as { error: unknown }).error);
				}
			} catch (err) {
				reject(err);
			}
		});
		conn.on("error", reject);
		conn.write(encodeFrame({ id: "1", method, params }));
	});
}

describe("DaemonServer", () => {
	test("invokes the registered handler for a method", async () => {
		await withServer(
			{
				status: async () => ({ state: "ready" }),
				send: async () => ({ wa_id: "x", rowid: 1 }),
				react: async () => undefined,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
				shutdown: async () => undefined,
			},
			async (path) => {
				const res = (await rpc(path, "status", {})) as { state: string };
				expect(res.state).toBe("ready");
			},
		);
	});

	test("broadcasts events to subscribed clients", async () => {
		await withServer(
			{
				status: async () => ({ state: "ready" }),
				send: async () => ({ wa_id: "x", rowid: 1 }),
				react: async () => undefined,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
				shutdown: async () => undefined,
			},
			async (path, server) => {
				const received: unknown[] = [];
				const conn = createConnection(path);
				const dec = new FrameDecoder();
				conn.on("data", (chunk) => {
					for (const f of dec.push(chunk as Buffer)) received.push(f);
				});
				await new Promise<void>((r) => conn.once("connect", r));
				conn.write(encodeFrame({ id: "1", method: "subscribe", params: {} }));
				await new Promise((r) => setTimeout(r, 50));
				server.broadcast({ event: "state", data: { state: "ready" } });
				await new Promise((r) => setTimeout(r, 50));
				conn.end();
				expect(received.some((r) => (r as { event?: string }).event === "state")).toBe(true);
			},
		);
	});

	test("unknown method returns error", async () => {
		await withServer(
			{
				status: async () => ({ state: "ready" }),
				send: async () => ({ wa_id: "x", rowid: 1 }),
				react: async () => undefined,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
				shutdown: async () => undefined,
			},
			async (path) => {
				await expect(rpc(path, "nope", {})).rejects.toEqual({
					code: "unknown_method",
					message: "unknown method: nope",
				});
			},
		);
	});
});
