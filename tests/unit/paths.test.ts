import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { accountPaths, rootDir } from "../../src/util/paths.js";

describe("accountPaths", () => {
	test("uses WA_CLI_HOME override when set", () => {
		const home = "/tmp/wacli-test-1";
		const p = accountPaths("default", home);
		expect(p.accountDir).toBe(join(home, "accounts", "default"));
		expect(p.db).toBe(join(home, "accounts", "default", "db.sqlite"));
		expect(p.socket).toBe(join(home, "accounts", "default", "control.sock"));
		expect(p.pidFile).toBe(join(home, "accounts", "default", "daemon.pid"));
		expect(p.logFile).toBe(join(home, "accounts", "default", "daemon.log"));
		expect(p.qrPng).toBe(join(home, "accounts", "default", "qr.png"));
		expect(p.stateJson).toBe(join(home, "accounts", "default", "state.json"));
		expect(p.sessionDir).toBe(join(home, "accounts", "default", "session"));
		expect(p.filesDir).toBe(join(home, "accounts", "default", "files"));
	});

	test("rejects account name with path separator", () => {
		expect(() => accountPaths("../evil", "/tmp")).toThrow(/invalid account/i);
	});

	test("rootDir honors WA_CLI_HOME env override", () => {
		const original = process.env.WA_CLI_HOME;
		process.env.WA_CLI_HOME = "/tmp/wacli-env-override";
		try {
			expect(rootDir()).toBe("/tmp/wacli-env-override");
		} finally {
			if (original === undefined) {
				// biome-ignore lint/performance/noDelete: env vars coerce to string on assignment; delete is the correct restore
				delete process.env.WA_CLI_HOME;
			} else {
				process.env.WA_CLI_HOME = original;
			}
		}
	});
});
