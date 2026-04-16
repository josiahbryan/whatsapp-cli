import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLogger } from "../../src/util/log.js";

describe("FileLogger rotation", () => {
	test("rotates when file exceeds maxBytes and keeps one backup", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-log-"));
		const primary = join(dir, "daemon.log");
		try {
			writeFileSync(primary, "x".repeat(200));
			const logger = new FileLogger({ path: primary, maxBytes: 100 });
			logger.info("after rotate", { k: "v" });
			expect(existsSync(`${primary}.1`)).toBe(true);
			expect(statSync(`${primary}.1`).size).toBeGreaterThan(0);
			expect(statSync(primary).size).toBeLessThan(200);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
