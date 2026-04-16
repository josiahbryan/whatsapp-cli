import { describe, expect, test } from "bun:test";
import { normalizeChatId, parseChatId } from "../../src/util/chat-id.js";

describe("normalizeChatId", () => {
	test("bare E.164 phone → c.us", () => {
		expect(normalizeChatId("+15551234567")).toBe("15551234567@c.us");
	});

	test("E.164 without plus → c.us", () => {
		expect(normalizeChatId("15551234567")).toBe("15551234567@c.us");
	});

	test("already @c.us → passthrough", () => {
		expect(normalizeChatId("15551234567@c.us")).toBe("15551234567@c.us");
	});

	test("group id @g.us → passthrough", () => {
		expect(normalizeChatId("120363020384756102@g.us")).toBe("120363020384756102@g.us");
	});

	test("literal me → me", () => {
		expect(normalizeChatId("me")).toBe("me");
	});

	test("whitespace trimmed", () => {
		expect(normalizeChatId("  +15551234567  ")).toBe("15551234567@c.us");
	});

	test("empty string throws", () => {
		expect(() => normalizeChatId("")).toThrow(/empty/i);
	});

	test("obvious non-id throws", () => {
		expect(() => normalizeChatId("hello world")).toThrow(/invalid chat/i);
	});
});

describe("parseChatId", () => {
	test("classifies dm", () => {
		expect(parseChatId("15551234567@c.us")).toEqual({ kind: "dm", phone: "15551234567" });
	});

	test("classifies group", () => {
		expect(parseChatId("120363020384756102@g.us")).toEqual({
			kind: "group",
			phone: null,
		});
	});
});
