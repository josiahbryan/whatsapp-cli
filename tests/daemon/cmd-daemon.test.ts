import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runLogs, runStatus, runStop } from "../../src/commands/daemon.js";
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

describe("daemon lifecycle commands", () => {
	test("status returns state=ready when daemon is running", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		const daemon = new Daemon({
			paths,
			client: new FakeWhatsAppClient(),
			backfillLimitPerChat: 0,
		});
		await daemon.start();
		try {
			const out = await captureStdout(() => runStatus({}, { json: true, account: "default" }));
			const env = JSON.parse(out);
			expect(env.data.state).toBe("ready");
		} finally {
			await daemon.stop();
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("status returns state=stopped when daemon is not running", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		try {
			const out = await captureStdout(() => runStatus({}, { json: true, account: "default" }));
			const env = JSON.parse(out);
			expect(env.data.state).toBe("stopped");
		} finally {
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("logs preserves last line when file lacks trailing newline", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		try {
			mkdirSync(dirname(paths.logFile), { recursive: true });
			writeFileSync(paths.logFile, "a\nb\nc");
			const out = await captureStdout(() =>
				runLogs({ n: "10" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.lines).toEqual(["a", "b", "c"]);
		} finally {
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("logs drops trailing empty when file ends with newline", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		const paths = accountPaths("default", root);
		try {
			mkdirSync(dirname(paths.logFile), { recursive: true });
			writeFileSync(paths.logFile, "a\nb\nc\n");
			const out = await captureStdout(() =>
				runLogs({ n: "10" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.lines).toEqual(["a", "b", "c"]);
		} finally {
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("logs returns empty array when file missing", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		try {
			const out = await captureStdout(() =>
				runLogs({ n: "10" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(out);
			expect(env.data.lines).toEqual([]);
		} finally {
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("stop when not running exits 0 with warning", async () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-cmd-daemon-"));
		process.env.WA_CLI_HOME = root;
		try {
			const out = await captureStdout(() => runStop({}, { json: true, account: "default" }));
			const env = JSON.parse(out);
			expect(env.success).toBe(true);
			expect(env.data.was_running).toBe(false);
		} finally {
			// biome-ignore lint/performance/noDelete: test cleanup needs real removal, not a string assignment
			delete process.env.WA_CLI_HOME;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
