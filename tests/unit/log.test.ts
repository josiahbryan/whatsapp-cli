import { describe, expect, test } from "bun:test";
import { formatLine } from "../../src/util/log.js";

describe("formatLine", () => {
	test("basic line with iso ts + level + message", () => {
		const line = formatLine({
			ts: Date.UTC(2026, 3, 16, 12, 0, 0),
			level: "info",
			message: "hello",
			fields: {},
		});
		expect(line).toBe("[2026-04-16T12:00:00.000Z] [info] hello");
	});

	test("string field emitted as k=value", () => {
		const line = formatLine({
			ts: Date.UTC(2026, 3, 16, 12, 0, 0),
			level: "info",
			message: "chat synced",
			fields: { chat: "15551234567@c.us", count: 42 },
		});
		expect(line).toBe(
			"[2026-04-16T12:00:00.000Z] [info] chat synced chat=15551234567@c.us count=42",
		);
	});

	test("string with whitespace is quoted", () => {
		const line = formatLine({
			ts: Date.UTC(2026, 3, 16, 12, 0, 0),
			level: "warn",
			message: "oh no",
			fields: { reason: "with spaces" },
		});
		expect(line).toBe('[2026-04-16T12:00:00.000Z] [warn] oh no reason="with spaces"');
	});
});
