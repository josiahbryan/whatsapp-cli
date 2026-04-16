import { describe, expect, test } from "bun:test";
import { FakeWhatsAppClient } from "../../src/wa/fake-client.js";

describe("FakeWhatsAppClient", () => {
	test("initialize triggers ready after authenticated", async () => {
		const c = new FakeWhatsAppClient();
		const seen: string[] = [];
		c.on("authenticated", () => seen.push("authenticated"));
		c.on("ready", () => seen.push("ready"));
		await c.initialize();
		expect(seen).toEqual(["authenticated", "ready"]);
	});

	test("initialize in qr-required mode emits qr first", async () => {
		const c = new FakeWhatsAppClient({ needsQr: true });
		let qrSeen = "";
		c.on("qr", (d) => {
			qrSeen = d;
		});
		const p = c.initialize();
		await new Promise((r) => setTimeout(r, 10));
		expect(qrSeen).toBe("fake-qr-payload");
		c.completePairing();
		await p;
	});

	test("emitMessage delivers to listeners", () => {
		const c = new FakeWhatsAppClient();
		const bag: string[] = [];
		c.on("message", (m) => bag.push(m.wa_id));
		c.emitMessage({
			wa_id: "w1",
			chat_id: "x@c.us",
			from_id: "x@c.us",
			from_name: "X",
			from_me: false,
			timestamp: 1,
			type: "chat",
			body: "hi",
			quoted_wa_id: null,
			attachment: null,
		});
		expect(bag).toEqual(["w1"]);
	});

	test("sendText returns a unique wa_id and records the call", async () => {
		const c = new FakeWhatsAppClient();
		await c.initialize();
		const r1 = await c.sendText("x@c.us", "hi");
		const r2 = await c.sendText("x@c.us", "again");
		expect(r1.wa_id).not.toBe(r2.wa_id);
		expect(c.sentMessages).toHaveLength(2);
		expect(c.sentMessages[0]?.text).toBe("hi");
	});

	test("off removes listener", () => {
		const c = new FakeWhatsAppClient();
		const bag: string[] = [];
		const listener = (m: { wa_id: string }) => bag.push(m.wa_id);
		c.on("message", listener);
		c.off("message", listener);
		c.emitMessage({
			wa_id: "w1",
			chat_id: "x@c.us",
			from_id: "x@c.us",
			from_name: "X",
			from_me: false,
			timestamp: 1,
			type: "chat",
			body: "hi",
			quoted_wa_id: null,
			attachment: null,
		});
		expect(bag).toEqual([]);
	});

	test("getChatById returns a handle whose fetchMessages returns seeded history", async () => {
		const c = new FakeWhatsAppClient();
		c.seedHistory("x@c.us", [
			{
				wa_id: "h1",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 1,
				type: "chat",
				body: "a",
				quoted_wa_id: null,
				attachment: null,
			},
			{
				wa_id: "h2",
				chat_id: "x@c.us",
				from_id: "x@c.us",
				from_name: "X",
				from_me: false,
				timestamp: 2,
				type: "chat",
				body: "b",
				quoted_wa_id: null,
				attachment: null,
			},
		]);
		const handle = await c.getChatById("x@c.us");
		const msgs = await handle.fetchMessages(10);
		expect(msgs.map((m) => m.wa_id)).toEqual(["h1", "h2"]);
	});
});
