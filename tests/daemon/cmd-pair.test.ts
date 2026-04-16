import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wipeSession } from "../../src/commands/pair.js";
import { accountPaths } from "../../src/util/paths.js";

describe("wipeSession", () => {
	test("removes the session dir and qr.png if present", () => {
		const root = mkdtempSync(join(tmpdir(), "wacli-pair-"));
		const paths = accountPaths("default", root);
		try {
			mkdirSync(paths.sessionDir, { recursive: true });
			writeFileSync(join(paths.sessionDir, "marker"), "x");
			writeFileSync(paths.qrPng, Buffer.from("png"));
			wipeSession(paths);
			expect(existsSync(paths.sessionDir)).toBe(false);
			expect(existsSync(paths.qrPng)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
