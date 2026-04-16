import { describe, expect, test } from "bun:test";
import {
	FrameDecoder,
	encodeFrame,
	isEventFrame,
	isRequestFrame,
	isResponseFrame,
} from "../../src/ipc/protocol.js";

describe("FrameDecoder", () => {
	test("decodes a single full line", () => {
		const d = new FrameDecoder();
		const frames = d.push(Buffer.from('{"id":"a","method":"status","params":{}}\n'));
		expect(frames).toHaveLength(1);
		expect(isRequestFrame(frames[0]!)).toBe(true);
	});

	test("splits multiple lines in one chunk", () => {
		const d = new FrameDecoder();
		const frames = d.push(Buffer.from('{"id":"a","result":1}\n{"event":"state","data":{}}\n'));
		expect(frames).toHaveLength(2);
		expect(isResponseFrame(frames[0]!)).toBe(true);
		expect(isEventFrame(frames[1]!)).toBe(true);
	});

	test("buffers incomplete line across chunks", () => {
		const d = new FrameDecoder();
		expect(d.push(Buffer.from('{"id":"a",'))).toHaveLength(0);
		const frames = d.push(Buffer.from('"result":42}\n'));
		expect(frames).toHaveLength(1);
		const f = frames[0]!;
		if (!isResponseFrame(f)) throw new Error("not a response frame");
		expect(f.result).toBe(42);
	});

	test("ignores empty lines", () => {
		const d = new FrameDecoder();
		expect(d.push(Buffer.from("\n\n"))).toHaveLength(0);
	});

	test("malformed JSON throws on that frame", () => {
		const d = new FrameDecoder();
		expect(() => d.push(Buffer.from("not json\n"))).toThrow(/malformed/i);
	});
});

describe("encodeFrame", () => {
	test("appends newline", () => {
		const buf = encodeFrame({ id: "a", method: "status", params: {} });
		expect(buf.toString()).toBe('{"id":"a","method":"status","params":{}}\n');
	});
});
