import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

function run(args: string[]) {
	return spawnSync("bun", ["run", CLI, ...args], { encoding: "utf8" });
}

describe("commander wiring", () => {
	const commands = [
		"chats",
		"history",
		"show",
		"search",
		"contacts",
		"who",
		"group",
		"cursor",
		"send",
		"react",
		"tail",
		"pair",
		"daemon",
	];
	for (const cmd of commands) {
		test(`${cmd} --help exits 0`, () => {
			const res = run([cmd, "--help"]);
			expect(res.status).toBe(0);
			expect(res.stdout).toContain("Usage:");
		});
	}

	test("top-level --help lists all commands", () => {
		const res = run(["--help"]);
		expect(res.status).toBe(0);
		for (const cmd of commands) expect(res.stdout).toContain(cmd);
	});
});
