import { mkdirSync } from "node:fs";
import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import type {
	ChatHandle,
	SendMediaOpts,
	SendResult,
	SendTextOpts,
	WhatsAppClient,
} from "./client.js";
import type {
	WaContactMeta,
	WaEventMap,
	WaGroupMeta,
	WaMessageEvent,
	WaReactionEvent,
} from "./events.js";

export interface RealOpts {
	sessionDir: string;
	filesDir: string;
}

export class RealWhatsAppClient implements WhatsAppClient {
	private readonly client: Client;
	private listeners: { [K in keyof WaEventMap]?: Array<WaEventMap[K]> } = {};

	constructor(private readonly opts: RealOpts) {
		mkdirSync(opts.sessionDir, { recursive: true });
		mkdirSync(opts.filesDir, { recursive: true });
		this.client = new Client({
			authStrategy: new LocalAuth({ dataPath: opts.sessionDir }),
			puppeteer: {
				headless: true,
				args: ["--no-sandbox", "--disable-setuid-sandbox"],
			},
		});
		this.wireEvents();
	}

	on<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}
		(this.listeners[event] as Array<WaEventMap[K]>).push(listener);
	}

	off<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		const arr = this.listeners[event];
		if (!arr) return;
		const idx = arr.indexOf(listener);
		if (idx >= 0) arr.splice(idx, 1);
	}

	private emit<K extends keyof WaEventMap>(event: K, ...args: Parameters<WaEventMap[K]>): void {
		const arr = this.listeners[event];
		if (!arr) return;
		for (const l of [...arr]) (l as (...a: unknown[]) => void)(...args);
	}

	private wireEvents(): void {
		this.client.on("qr", (qr: string) => {
			this.emit("qr", qr);
		});
		this.client.on("authenticated", () => this.emit("authenticated"));
		this.client.on("ready", () => this.emit("ready"));
		this.client.on("disconnected", (reason: string) => this.emit("disconnected", reason));

		this.client.on("message", async (m) => {
			this.emit("message", await this.toMessageEvent(m, false));
		});
		this.client.on("message_create", async (m) => {
			if (m.fromMe) this.emit("message", await this.toMessageEvent(m, true));
		});
		this.client.on("message_reaction", (r) => {
			const rr = r as unknown as {
				msgId?: { _serialized?: string };
				senderId?: string;
				reaction?: string;
				timestamp?: number;
			};
			const ev: WaReactionEvent = {
				message_wa_id: rr.msgId?._serialized ?? "",
				reactor_id: rr.senderId ?? "",
				emoji: rr.reaction ?? "",
				timestamp: rr.timestamp ? rr.timestamp * 1000 : Date.now(),
			};
			this.emit("reaction", ev);
		});
		this.client.on("contact_changed", async () => {
			const contacts = await this.client.getContacts();
			for (const c of contacts) this.emit("contact_update", this.toContactMeta(c));
		});
		this.client.on("group_update", async (n) => {
			const nEvent = n as unknown as { id?: { _serialized?: string } };
			const chat = await this.client.getChatById(nEvent.id?._serialized ?? "");
			if (!chat.isGroup) return;
			const g = chat as typeof chat & {
				participants?: Array<{ id: { _serialized: string }; isAdmin?: boolean }>;
			};
			const meta: WaGroupMeta = {
				chat_id: chat.id._serialized,
				participants: (g.participants ?? []).map((p) => ({
					contact_id: p.id._serialized,
					is_admin: Boolean(p.isAdmin),
				})),
			};
			this.emit("group_update", meta);
		});
	}

	private async toMessageEvent(m: unknown, fromMe: boolean): Promise<WaMessageEvent> {
		const mm = m as {
			id: { _serialized: string };
			from: string;
			to: string;
			timestamp: number;
			type: string;
			body: string;
			hasQuotedMsg?: boolean;
			getQuotedMessage?: () => Promise<{ id: { _serialized: string } }>;
			hasMedia?: boolean;
			downloadMedia?: () => Promise<{
				data: string;
				mimetype: string;
				filename?: string;
			}>;
			_data?: { notifyName?: string };
		};
		const chatId = fromMe ? mm.to : mm.from;
		let quotedWaId: string | null = null;
		if (mm.hasQuotedMsg && mm.getQuotedMessage) {
			try {
				const q = await mm.getQuotedMessage();
				quotedWaId = q.id._serialized;
			} catch {
				quotedWaId = null;
			}
		}
		let attachment: WaMessageEvent["attachment"] = null;
		if (mm.hasMedia && mm.downloadMedia) {
			try {
				const media = await mm.downloadMedia();
				if (media?.data) {
					attachment = {
						mimetype: media.mimetype,
						filename: media.filename ?? null,
						data: Buffer.from(media.data, "base64"),
					};
				}
			} catch {
				attachment = null;
			}
		}
		return {
			wa_id: mm.id._serialized,
			chat_id: chatId,
			from_id: mm.from,
			from_name: mm._data?.notifyName ?? null,
			from_me: fromMe,
			timestamp: mm.timestamp * 1000,
			type: this.normalizeType(mm.type),
			body: mm.body ?? null,
			quoted_wa_id: quotedWaId,
			attachment,
		};
	}

	private normalizeType(t: string): WaMessageEvent["type"] {
		const allowed: WaMessageEvent["type"][] = [
			"chat",
			"image",
			"video",
			"audio",
			"voice",
			"document",
			"sticker",
			"system",
		];
		return (allowed as string[]).includes(t) ? (t as WaMessageEvent["type"]) : "system";
	}

	private toContactMeta(c: unknown): WaContactMeta {
		const cc = c as {
			id: { _serialized: string; user?: string };
			pushname?: string | null;
			verifiedName?: string | null;
			isBusiness?: boolean;
			isMyContact?: boolean;
		};
		return {
			id: cc.id._serialized,
			phone: cc.id.user ?? null,
			pushname: cc.pushname ?? null,
			verified_name: cc.verifiedName ?? null,
			is_business: Boolean(cc.isBusiness),
			is_my_contact: Boolean(cc.isMyContact),
			about: null,
		};
	}

	async initialize(): Promise<void> {
		await this.client.initialize();
	}

	private toHandle(chat: unknown): ChatHandle {
		const c = chat as {
			id: { _serialized: string };
			isGroup: boolean;
			name?: string | null;
			timestamp?: number;
		};
		const chatId = c.id._serialized;
		return {
			id: chatId,
			kind: c.isGroup ? "group" : "dm",
			name: c.name ?? null,
			updated_at: typeof c.timestamp === "number" ? c.timestamp * 1000 : Date.now(),
			fetchMessages: (limit: number) => this.fetchMessagesViaStore(chatId, limit),
		};
	}

	private async fetchMessagesViaStore(chatId: string, limit: number): Promise<WaMessageEvent[]> {
		const page = (
			this.client as unknown as {
				pupPage?: {
					evaluate: (
						fn: (id: string, lim: number) => unknown,
						id: string,
						lim: number,
					) => Promise<unknown>;
				};
			}
		).pupPage;
		if (!page) return [];
		interface StoreMsgSnapshot {
			wa_id: string;
			chat_id: string;
			from_id: string;
			from_name: string | null;
			from_me: boolean;
			timestamp: number;
			type: string;
			body: string | null;
			quoted_wa_id: string | null;
			has_media: boolean;
			mimetype: string | null;
			filename: string | null;
		}
		const snaps = (await page.evaluate(
			async (id: string, lim: number) => {
				const w = globalThis as unknown as {
					Store?: {
						WidFactory?: { createWid: (s: string) => unknown };
						Chat?: { get: (wid: unknown) => unknown };
						ConversationMsgs?: {
							loadEarlierMsgs: (chat: unknown, msgs: unknown) => Promise<unknown[]>;
						};
					};
				};
				const store = w.Store;
				if (!store?.WidFactory || !store.Chat) return [];
				const wid = store.WidFactory.createWid(id);
				type M = {
					id?: { _serialized?: string; fromMe?: boolean; remote?: { _serialized?: string } };
					from?: { _serialized?: string };
					to?: { _serialized?: string };
					author?: { _serialized?: string };
					t?: number;
					type?: string;
					body?: string;
					caption?: string;
					quotedStanzaID?: string;
					quotedMsg?: { id?: { _serialized?: string } };
					mediaObject?: unknown;
					mimetype?: string;
					filename?: string;
					isNotification?: boolean;
					notifyName?: string;
				};
				const chat = store.Chat.get(wid) as {
					id?: { _serialized?: string };
					msgs?: { getModelsArray: () => M[] };
				} | null;
				const chatIdSer = chat?.id?._serialized ?? id;
				if (!chat?.msgs) return [];
				const filter = (m: M) => !m.isNotification;
				let msgs = chat.msgs.getModelsArray().filter(filter);
				if (lim > 0 && store.ConversationMsgs) {
					while (msgs.length < lim) {
						const more = (await store.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs).catch(
							() => [],
						)) as M[];
						if (!more || more.length === 0) break;
						msgs = [...more.filter(filter), ...msgs];
					}
				}
				msgs = msgs.slice(-Math.max(1, lim));
				const snap = (m: M) => {
					const fromMe = Boolean(m.id?.fromMe);
					const fromId = fromMe
						? (m.from?._serialized ?? "")
						: (m.author?._serialized ?? m.from?._serialized ?? "");
					return {
						wa_id: m.id?._serialized ?? "",
						chat_id: chatIdSer,
						from_id: fromId,
						from_name: m.notifyName ?? null,
						from_me: fromMe,
						timestamp: (m.t ?? 0) * 1000,
						type: m.type ?? "chat",
						body: m.body ?? m.caption ?? null,
						quoted_wa_id: m.quotedStanzaID ?? m.quotedMsg?.id?._serialized ?? null,
						has_media: Boolean(m.mediaObject),
						mimetype: m.mimetype ?? null,
						filename: m.filename ?? null,
					};
				};
				return msgs.map(snap);
			},
			chatId,
			limit,
		)) as StoreMsgSnapshot[];
		return snaps.map((s) => ({
			wa_id: s.wa_id,
			chat_id: s.chat_id,
			from_id: s.from_id,
			from_name: s.from_name,
			from_me: s.from_me,
			timestamp: s.timestamp,
			type: this.normalizeType(s.type),
			body: s.body,
			quoted_wa_id: s.quoted_wa_id,
			attachment:
				s.has_media && s.mimetype
					? { mimetype: s.mimetype, filename: s.filename, data: Buffer.alloc(0) }
					: null,
		}));
	}

	async getChatById(chat_id: string): Promise<ChatHandle> {
		const chat = await this.client.getChatById(chat_id);
		return this.toHandle(chat);
	}

	async listChats(): Promise<ChatHandle[]> {
		const chats = await this.client.getChats();
		return chats.map((c) => this.toHandle(c));
	}

	async sendText(chat_id: string, text: string, opts: SendTextOpts = {}): Promise<SendResult> {
		const sendOpts: Record<string, unknown> = {};
		if (opts.reply_to_wa_id) sendOpts.quotedMessageId = opts.reply_to_wa_id;
		const m = await this.client.sendMessage(chat_id, text, sendOpts);
		return { wa_id: m.id._serialized, timestamp: m.timestamp * 1000 };
	}

	async sendMedia(chat_id: string, opts: SendMediaOpts): Promise<SendResult> {
		const media = MessageMedia.fromFilePath(opts.file_path);
		const sendOpts: Record<string, unknown> = {};
		if (opts.caption) sendOpts.caption = opts.caption;
		if (opts.reply_to_wa_id) sendOpts.quotedMessageId = opts.reply_to_wa_id;
		const m = await this.client.sendMessage(chat_id, media, sendOpts);
		return { wa_id: m.id._serialized, timestamp: m.timestamp * 1000 };
	}

	async sendReaction(message_wa_id: string, emoji: string): Promise<void> {
		// whatsapp-web.js doesn't expose react() on Message directly by wa_id alone;
		// we use the runtime page function via the underlying client.
		const client = this.client as unknown as {
			pupPage?: {
				evaluate: (
					fn: (id: string, e: string) => unknown,
					id: string,
					e: string,
				) => Promise<unknown>;
			};
		};
		if (!client.pupPage) throw new Error("client page not ready");
		await client.pupPage.evaluate(
			(id: string, e: string) => {
				const wa = (
					globalThis as unknown as {
						WWebJS?: { react?: (id: string, e: string) => Promise<unknown> };
					}
				).WWebJS;
				return wa?.react?.(id, e);
			},
			message_wa_id,
			emoji,
		);
	}

	async destroy(): Promise<void> {
		await this.client.destroy();
	}
}
