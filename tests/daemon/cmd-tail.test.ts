import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/commands/tail.js";
import { Daemon } from "../../src/daemon/index.js";
import { accountPaths } from "../../src/util/paths.js";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

function captureStdout<T>(fn: () => Promise<T>): Promise<string> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			() => {
				process.stdout.write = orig;
				resolve(buf);
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("tail command", () => {
	test("pull mode (no --follow) returns messages since rowid and exits", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-tail-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		const fake = new FakeWhatsAppClient();
		const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
		await daemon.start();
		try {
			fake.emitMessage({
				wa_id: "w1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1,
				type: "chat",
				body: "one",
				quoted_wa_id: null,
				attachment: null,
			});
			fake.emitMessage({
				wa_id: "w2",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 2,
				type: "chat",
				body: "two",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 50));
			const out = await captureStdout(() =>
				run({ since: "0", limit: "100" }, { json: true, account: "default" }),
			);
			const lines = out.trim().split("\n");
			expect(lines.length).toBeGreaterThanOrEqual(2);
			const first = JSON.parse(lines[0] ?? "{}") as { wa_id: string };
			expect(first.wa_id).toBe("w1");
		} finally {
			await daemon.stop();
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("--follow streams live events, stops on signal", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-tail-f-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		const fake = new FakeWhatsAppClient();
		const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
		await daemon.start();
		try {
			const seenLines: string[] = [];
			const orig = process.stdout.write.bind(process.stdout);
			process.stdout.write = ((chunk: string | Uint8Array) => {
				const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
				seenLines.push(s);
				return true;
			}) as typeof process.stdout.write;
			const ac = new AbortController();
			const runPromise = run(
				{ follow: true, abortSignal: ac.signal },
				{ json: true, account: "default" },
			);
			await new Promise((r) => setTimeout(r, 50));
			fake.emitMessage({
				wa_id: "live1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 10,
				type: "chat",
				body: "hi",
				quoted_wa_id: null,
				attachment: null,
			});
			await new Promise((r) => setTimeout(r, 100));
			ac.abort();
			await runPromise;
			process.stdout.write = orig;
			expect(seenLines.join("")).toContain("live1");
		} finally {
			await daemon.stop();
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
