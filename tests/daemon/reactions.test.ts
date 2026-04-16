import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/storage/db.js";
import { applyReaction, listReactionsForMessage } from "../../src/storage/reactions.js";

function tempDb() {
	const dir = mkdtempSync(join(tmpdir(), "wacli-react-"));
	const db = openDatabase(join(dir, "db.sqlite"));
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

describe("reactions storage", () => {
	test("applyReaction inserts a new row", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "👍",
				timestamp: 1,
			});
			const rows = listReactionsForMessage(db, "m1");
			expect(rows).toHaveLength(1);
			expect(rows[0]?.emoji).toBe("👍");
		} finally {
			cleanup();
		}
	});

	test("applyReaction updates emoji on re-react by same reactor", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "👍",
				timestamp: 1,
			});
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "❤️",
				timestamp: 2,
			});
			const rows = listReactionsForMessage(db, "m1");
			expect(rows).toHaveLength(1);
			expect(rows[0]?.emoji).toBe("❤️");
		} finally {
			cleanup();
		}
	});

	test("empty emoji un-reacts (deletes the row)", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "👍",
				timestamp: 1,
			});
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "r1@c.us",
				emoji: "",
				timestamp: 2,
			});
			expect(listReactionsForMessage(db, "m1")).toHaveLength(0);
		} finally {
			cleanup();
		}
	});

	test("multiple reactors on same message all persist", () => {
		const { db, cleanup } = tempDb();
		try {
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "a",
				emoji: "👍",
				timestamp: 1,
			});
			applyReaction(db, {
				message_wa_id: "m1",
				reactor_id: "b",
				emoji: "🎉",
				timestamp: 2,
			});
			expect(listReactionsForMessage(db, "m1")).toHaveLength(2);
		} finally {
			cleanup();
		}
	});
});
