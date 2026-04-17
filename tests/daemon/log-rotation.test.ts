import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLogger } from "../../src/util/log.js";

describe("FileLogger rotation", () => {
	test("rotates when file exceeds maxBytes and new line lands in primary", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-log-"));
		const primary = join(dir, "daemon.log");
		try {
			writeFileSync(primary, "x".repeat(200));
			const logger = new FileLogger({ path: primary, maxBytes: 100 });
			logger.info("after rotate", { k: "v" });
			expect(existsSync(`${primary}.1`)).toBe(true);
			expect(statSync(`${primary}.1`).size).toBeGreaterThan(0);
			expect(statSync(primary).size).toBeLessThan(200);
			expect(readFileSync(primary, "utf8")).toContain("after rotate");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("replaces preexisting .1 backup on rotation", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-log-"));
		const primary = join(dir, "daemon.log");
		const backup = `${primary}.1`;
		try {
			writeFileSync(backup, "stale-backup");
			writeFileSync(primary, "y".repeat(200));
			const logger = new FileLogger({ path: primary, maxBytes: 100 });
			logger.info("fresh", {});
			expect(readFileSync(backup, "utf8")).not.toContain("stale-backup");
			expect(readFileSync(backup, "utf8")).toContain("y");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("does not rotate when file is under threshold", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-log-"));
		const primary = join(dir, "daemon.log");
		try {
			writeFileSync(primary, "z".repeat(10));
			const logger = new FileLogger({ path: primary, maxBytes: 10_000 });
			logger.info("under", {});
			expect(existsSync(`${primary}.1`)).toBe(false);
			expect(readFileSync(primary, "utf8")).toContain("under");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("creates primary on first write when file is absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-log-"));
		const primary = join(dir, "daemon.log");
		try {
			const logger = new FileLogger({ path: primary, maxBytes: 100 });
			logger.info("first", {});
			expect(existsSync(primary)).toBe(true);
			expect(existsSync(`${primary}.1`)).toBe(false);
			expect(readFileSync(primary, "utf8")).toContain("first");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
