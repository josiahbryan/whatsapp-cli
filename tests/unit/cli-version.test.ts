import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { VERSION } from "../../src/version.js";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

describe("whatsapp-cli version", () => {
	test("--version prints the VERSION constant", () => {
		const res = spawnSync("bun", ["run", CLI, "--version"], { encoding: "utf8" });
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toBe(VERSION);
		expect(res.stderr).toBe("");
	});

	test("version subcommand prints the VERSION constant", () => {
		const res = spawnSync("bun", ["run", CLI, "version"], { encoding: "utf8" });
		expect(res.status).toBe(0);
		expect(res.stdout.trim()).toBe(VERSION);
		expect(res.stderr).toBe("");
	});
});
