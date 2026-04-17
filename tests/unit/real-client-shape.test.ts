import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealWhatsAppClient } from "../../src/wa/real-client.js";

describe("RealWhatsAppClient shape", () => {
	test("constructor accepts session/files dirs and exposes interface methods", () => {
		const dir = mkdtempSync(join(tmpdir(), "wacli-real-"));
		try {
			const client = new RealWhatsAppClient({
				sessionDir: join(dir, "session"),
				filesDir: join(dir, "files"),
			});
			expect(typeof client.initialize).toBe("function");
			expect(typeof client.on).toBe("function");
			expect(typeof client.off).toBe("function");
			expect(typeof client.sendText).toBe("function");
			expect(typeof client.sendMedia).toBe("function");
			expect(typeof client.sendReaction).toBe("function");
			expect(typeof client.destroy).toBe("function");
			expect(typeof client.getChatById).toBe("function");
			expect(typeof client.listChats).toBe("function");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
