import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/commands/chats.js";
import { upsertChat } from "../../src/storage/chats.js";
import { openDatabase } from "../../src/storage/db.js";
import { accountPaths } from "../../src/util/paths.js";

function seed() {
	const root = mkdtempSync(join(tmpdir(), "wacli-cmd-chats-"));
	const paths = accountPaths("default", root);
	const db = openDatabase(paths.db);
	upsertChat(db, { id: "a@c.us", kind: "dm", name: "Alice", phone: "111", updated_at: 1 });
	upsertChat(db, { id: "b@g.us", kind: "group", name: "Team", phone: null, updated_at: 2 });
	db.close();
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function captureStdout<T>(fn: () => Promise<T>): Promise<{ stdout: string; result: T }> {
	return new Promise((resolve, reject) => {
		let buf = "";
		const orig = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		fn().then(
			(v) => {
				process.stdout.write = orig;
				resolve({ stdout: buf, result: v });
			},
			(err) => {
				process.stdout.write = orig;
				reject(err);
			},
		);
	});
}

describe("chats command", () => {
	test("--json emits envelope with all chats", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const { stdout } = await captureStdout(() =>
				run({ limit: "50" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(stdout);
			expect(env.success).toBe(true);
			expect(env.data).toHaveLength(2);
			expect(env.data[0].id).toBe("b@g.us");
		} finally {
			process.env.WA_CLI_HOME = undefined;
			cleanup();
		}
	});

	test("--kind dm filters", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const { stdout } = await captureStdout(() =>
				run({ limit: "50", kind: "dm" }, { json: true, account: "default" }),
			);
			const env = JSON.parse(stdout);
			expect(env.data).toHaveLength(1);
			expect(env.data[0].id).toBe("a@c.us");
		} finally {
			process.env.WA_CLI_HOME = undefined;
			cleanup();
		}
	});

	test("text mode emits tab-separated lines", async () => {
		const { root, cleanup } = seed();
		try {
			process.env.WA_CLI_HOME = root;
			const { stdout } = await captureStdout(() =>
				run({ limit: "50" }, { json: false, account: "default" }),
			);
			const lines = stdout.trim().split("\n");
			expect(lines).toHaveLength(2);
			expect(lines[0]?.split("\t")).toContain("Team");
		} finally {
			process.env.WA_CLI_HOME = undefined;
			cleanup();
		}
	});
});
