import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

describe("whatsapp-cli version", () => {
	test("--version prints the VERSION constant", () => {
		const res = spawnSync("bun", ["run", CLI, "--version"], { encoding: "utf8" });
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
	});

	test("version subcommand prints the VERSION constant", () => {
		const res = spawnSync("bun", ["run", CLI, "version"], { encoding: "utf8" });
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
	});
});
