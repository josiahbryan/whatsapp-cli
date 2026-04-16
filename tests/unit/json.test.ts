import { describe, expect, test } from "bun:test";
import { envelopeError, envelopeOk, formatEnvelope } from "../../src/util/json.js";

describe("envelope", () => {
	test("ok wraps data", () => {
		expect(envelopeOk({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
	});

	test("ok with meta", () => {
		expect(envelopeOk([], { count: 0 })).toEqual({
			success: true,
			data: [],
			meta: { count: 0 },
		});
	});

	test("error wraps code + message", () => {
		expect(envelopeError("not_ready", "daemon is authenticating")).toEqual({
			success: false,
			error: { code: "not_ready", message: "daemon is authenticating" },
		});
	});

	test("formatEnvelope emits single-line JSON with newline", () => {
		const out = formatEnvelope(envelopeOk({ n: 1 }));
		expect(out).toBe('{"success":true,"data":{"n":1}}\n');
	});
});
