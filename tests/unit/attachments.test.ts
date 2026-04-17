import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	attachmentExtension,
	attachmentPathFor,
	saveAttachment,
} from "../../src/storage/attachments.js";

describe("attachmentExtension", () => {
	test("prefers extension from filename when present", () => {
		expect(attachmentExtension("image/jpeg", "photo.JPG")).toBe(".JPG");
		expect(attachmentExtension(null, "doc.pdf")).toBe(".pdf");
	});

	test("falls back to mime mapping when filename has no extension", () => {
		expect(attachmentExtension("image/jpeg", "photo")).toBe(".jpg");
		expect(attachmentExtension("image/png", null)).toBe(".png");
		expect(attachmentExtension("audio/ogg", "")).toBe(".ogg");
		expect(attachmentExtension("video/mp4", null)).toBe(".mp4");
		expect(attachmentExtension("application/pdf", null)).toBe(".pdf");
	});

	test("handles mime with parameters", () => {
		expect(attachmentExtension("image/jpeg; charset=binary", null)).toBe(".jpg");
	});

	test("returns .bin for unknown mime and no filename", () => {
		expect(attachmentExtension("application/x-unknown", null)).toBe(".bin");
		expect(attachmentExtension(null, null)).toBe(".bin");
	});
});

describe("attachmentPathFor", () => {
	test("joins filesDir with sanitized wa_id plus extension", () => {
		const p = attachmentPathFor("/tmp/files", "true_1234@c.us_ABCDEF", "image/jpeg", null);
		expect(p).toBe("/tmp/files/true_1234_c.us_ABCDEF.jpg");
	});

	test("sanitization collapses forbidden chars", () => {
		const p = attachmentPathFor("/tmp/files", "a/b\\c:d*e", "image/png", null);
		expect(p).toBe("/tmp/files/a_b_c_d_e.png");
	});
});

describe("saveAttachment", () => {
	test("writes bytes to disk and returns the path", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-att-"));
		try {
			const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
			const path = saveAttachment(dir, "msg123@c.us", bytes, "image/png", null);
			expect(path).toBe(join(dir, "msg123_c.us.png"));
			const read = readFileSync(path);
			expect(read.equals(bytes)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("uses filename extension when provided", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-att-"));
		try {
			const bytes = Buffer.from("hello");
			const path = saveAttachment(dir, "w1", bytes, null, "report.pdf");
			expect(path.endsWith(".pdf")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
