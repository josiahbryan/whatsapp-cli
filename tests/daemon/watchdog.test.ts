import { describe, expect, test } from "bun:test";
import { Watchdog } from "../../src/daemon/watchdog.js";

describe("Watchdog", () => {
	test("calls check on interval and counts failures", async () => {
		let calls = 0;
		let recovered = 0;
		const wd = new Watchdog({
			intervalMs: 10,
			timeoutMs: 50,
			failuresBeforeRecover: 2,
			check: async () => {
				calls += 1;
				throw new Error("hang");
			},
			recover: async () => {
				recovered += 1;
			},
		});
		wd.start();
		await new Promise((r) => setTimeout(r, 80));
		wd.stop();
		expect(calls).toBeGreaterThanOrEqual(2);
		expect(recovered).toBeGreaterThanOrEqual(1);
	});

	test("a single success resets the failure counter", async () => {
		let turn = 0;
		let recovered = 0;
		const wd = new Watchdog({
			intervalMs: 10,
			timeoutMs: 50,
			failuresBeforeRecover: 2,
			check: async () => {
				turn += 1;
				if (turn === 1) throw new Error("once");
				return;
			},
			recover: async () => {
				recovered += 1;
			},
		});
		wd.start();
		await new Promise((r) => setTimeout(r, 60));
		wd.stop();
		expect(recovered).toBe(0);
	});

	test("timeout counts as a failure", async () => {
		let recovered = 0;
		const wd = new Watchdog({
			intervalMs: 10,
			timeoutMs: 20,
			failuresBeforeRecover: 2,
			check: () => new Promise(() => {}),
			recover: async () => {
				recovered += 1;
			},
		});
		wd.start();
		await new Promise((r) => setTimeout(r, 120));
		wd.stop();
		expect(recovered).toBeGreaterThanOrEqual(1);
	});
});
