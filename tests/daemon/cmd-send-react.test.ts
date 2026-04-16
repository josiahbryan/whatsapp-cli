import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runReact } from "../../src/commands/react.js";
import { run as runSend } from "../../src/commands/send.js";
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

async function withRunningDaemon<T>(
	fn: (root: string, fake: FakeWhatsAppClient) => Promise<T>,
): Promise<T> {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-send-"));
	process.env.WA_CLI_HOME = root;
	const paths = accountPaths("default", root);
	const fake = new FakeWhatsAppClient();
	const daemon = new Daemon({ paths, client: fake, backfillLimitPerChat: 0 });
	await daemon.start();
	try {
		return await fn(root, fake);
	} finally {
		await daemon.stop();
		// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
		delete process.env.WA_CLI_HOME;
		rmSync(root, { recursive: true, force: true });
	}
}

describe("send command", () => {
	test("send text returns wa_id", async () => {
		await withRunningDaemon(async (_root, fake) => {
			const out = await captureStdout(() =>
				runSend({ chat: "+15551234567", text: "hello" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.success).toBe(true);
			expect(env.data.wa_id).toMatch(/^fake-sent-/);
			expect(fake.sentMessages[0]?.text).toBe("hello");
		});
	});

	test("send --file forwards file_path, caption, and reply_to", async () => {
		await withRunningDaemon(async (_root, fake) => {
			const out = await captureStdout(() =>
				runSend(
					{
						chat: "+15551234567",
						file: "/tmp/x.jpg",
						caption: "look",
						reply: "w1",
					},
					{ json: true, account: "default" },
				),
			);
			const env = JSON.parse(out);
			expect(env.success).toBe(true);
			expect(env.data.wa_id).toMatch(/^fake-sent-/);
			const sent = fake.sentMessages[0];
			expect(sent?.media?.file_path).toBe("/tmp/x.jpg");
			expect(sent?.media?.caption).toBe("look");
			expect(sent?.reply_to_wa_id).toBe("w1");
		});
	});
});

describe("react command", () => {
	test("react forwards to daemon", async () => {
		await withRunningDaemon(async (_root, fake) => {
			const out = await captureStdout(() =>
				runReact({ waId: "w1", emoji: "👍" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.success).toBe(true);
			expect(fake.sentReactions[0]?.emoji).toBe("👍");
		});
	});
});
