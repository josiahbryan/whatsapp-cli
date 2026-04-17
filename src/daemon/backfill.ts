import type { Database } from "bun:sqlite";
import { bumpChatUpdatedAt, upsertChat } from "../storage/chats.js";
import { insertMessage } from "../storage/messages.js";
import type { ChatHandle, WhatsAppClient } from "../wa/client.js";
import type { WaMessageEvent } from "../wa/events.js";

export interface BackfillOpts {
	limitPerChat: number;
}

export interface BackfillReport {
	chats: number;
	inserted: number;
	skipped: number;
	failed: number;
}

export interface BackfillLogger {
	info(msg: string, fields?: Record<string, string | number | boolean>): void;
	warn(msg: string, fields?: Record<string, string | number | boolean>): void;
}

function seedChats(db: Database, handles: ChatHandle[]): void {
	db.transaction(() => {
		for (const h of handles) {
			const phone = h.id.endsWith("@c.us") ? (h.id.split("@")[0] ?? null) : null;
			upsertChat(db, {
				id: h.id,
				kind: h.kind,
				name: h.name ?? null,
				phone,
				updated_at: h.updated_at ?? Date.now(),
			});
		}
	})();
}

export async function backfillChats(
	db: Database,
	client: WhatsAppClient,
	opts: BackfillOpts,
	logger?: BackfillLogger,
): Promise<BackfillReport> {
	const report: BackfillReport = { chats: 0, inserted: 0, skipped: 0, failed: 0 };

	const handles = await client.listChats();
	seedChats(db, handles);
	logger?.info("backfill seeded chats", { count: handles.length });

	if (opts.limitPerChat <= 0) return report;

	for (const h of handles) {
		report.chats += 1;
		let messages: WaMessageEvent[];
		try {
			messages = await h.fetchMessages(opts.limitPerChat);
		} catch (err) {
			report.failed += 1;
			logger?.warn("backfill fetchMessages failed", {
				chat_id: h.id,
				error: (err as Error).message ?? String(err),
			});
			continue;
		}
		db.transaction(() => {
			for (const m of messages) {
				const inserted = insertMessage(db, {
					wa_id: m.wa_id,
					chat_id: m.chat_id,
					from_id: m.from_id,
					from_name: m.from_name,
					from_me: m.from_me ? 1 : 0,
					timestamp: m.timestamp,
					type: m.type,
					body: m.body,
					quoted_wa_id: m.quoted_wa_id,
					attachment_path: null,
					attachment_mime: m.attachment?.mimetype ?? null,
					attachment_filename: m.attachment?.filename ?? null,
				});
				if (inserted !== null) {
					report.inserted += 1;
					bumpChatUpdatedAt(db, m.chat_id, m.timestamp);
				} else {
					report.skipped += 1;
				}
			}
		})();
	}
	logger?.info("backfill complete", {
		chats: report.chats,
		inserted: report.inserted,
		skipped: report.skipped,
		failed: report.failed,
	});
	return report;
}
