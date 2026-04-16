import { describe, expect, test } from "bun:test";
import { StateMachine, isReady } from "../../src/daemon/state.js";

describe("StateMachine", () => {
	test("starts at stopped", () => {
		const sm = new StateMachine();
		expect(sm.current).toBe("stopped");
	});

	test("stopped → starting → qr_required → authenticating → ready", () => {
		const sm = new StateMachine();
		sm.transition("starting");
		sm.transition("qr_required");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(sm.current).toBe("ready");
	});

	test("warm-boot path: starting → authenticating → ready", () => {
		const sm = new StateMachine();
		sm.transition("starting");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(sm.current).toBe("ready");
	});

	test("ready → disconnected → authenticating → ready", () => {
		const sm = new StateMachine();
		sm.transition("starting");
		sm.transition("authenticating");
		sm.transition("ready");
		sm.transition("disconnected");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(sm.current).toBe("ready");
	});

	test("invalid transitions throw", () => {
		const sm = new StateMachine();
		expect(() => sm.transition("ready")).toThrow(/invalid transition/i);
	});

	test("listeners are called on every transition", () => {
		const sm = new StateMachine();
		const seen: string[] = [];
		sm.onTransition((s) => seen.push(s));
		sm.transition("starting");
		sm.transition("authenticating");
		sm.transition("ready");
		expect(seen).toEqual(["starting", "authenticating", "ready"]);
	});

	test("isReady helper", () => {
		expect(isReady("ready")).toBe(true);
		expect(isReady("starting")).toBe(false);
	});
});
