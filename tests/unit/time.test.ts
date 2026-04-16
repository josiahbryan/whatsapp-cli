import { describe, expect, test } from "bun:test";
import { parseTime } from "../../src/util/time.js";

describe("parseTime", () => {
	const now = Date.UTC(2026, 3, 16, 12, 0, 0); // 2026-04-16T12:00:00Z

	test("now → now", () => {
		expect(parseTime("now", now)).toBe(now);
	});

	test("-7d → 7 days before now", () => {
		expect(parseTime("-7d", now)).toBe(now - 7 * 86_400_000);
	});

	test("-1h → 1 hour before now", () => {
		expect(parseTime("-1h", now)).toBe(now - 3_600_000);
	});

	test("-30m → 30 minutes before now", () => {
		expect(parseTime("-30m", now)).toBe(now - 30 * 60_000);
	});

	test("-45s → 45 seconds before now", () => {
		expect(parseTime("-45s", now)).toBe(now - 45_000);
	});

	test("ISO 8601 → parsed", () => {
		expect(parseTime("2026-04-10T00:00:00Z", now)).toBe(Date.UTC(2026, 3, 10, 0, 0, 0));
	});

	test("epoch-ms number string → number", () => {
		expect(parseTime("1700000000000", now)).toBe(1_700_000_000_000);
	});

	test("bad format throws", () => {
		expect(() => parseTime("yesterday", now)).toThrow(/invalid time/i);
	});

	test("positive relative not allowed", () => {
		expect(() => parseTime("+7d", now)).toThrow(/invalid time/i);
	});
});
