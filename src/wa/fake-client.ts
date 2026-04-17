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

export interface FakeOptions {
	needsQr?: boolean;
	selfJid?: string;
}

export interface SentMessage {
	chat_id: string;
	text?: string;
	media?: SendMediaOpts;
	reply_to_wa_id?: string;
}

type AnyListener = (...args: never[]) => void;

export class FakeWhatsAppClient implements WhatsAppClient {
	private readonly listeners = new Map<keyof WaEventMap, AnyListener[]>();
	private readonly history = new Map<string, WaMessageEvent[]>();
	private readonly chatMeta = new Map<
		string,
		{ kind: "dm" | "group"; name?: string | null; updated_at?: number }
	>();
	private pairingResolver: (() => void) | null = null;
	private sendCounter = 0;
	public readonly sentMessages: SentMessage[] = [];
	public readonly sentReactions: Array<{ message_wa_id: string; emoji: string }> = [];
	public destroyed = false;

	constructor(private readonly opts: FakeOptions = {}) {}

	on<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		let arr = this.listeners.get(event);
		if (!arr) {
			arr = [];
			this.listeners.set(event, arr);
		}
		arr.push(listener as AnyListener);
	}

	off<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void {
		const arr = this.listeners.get(event);
		if (!arr) return;
		const idx = arr.indexOf(listener as AnyListener);
		if (idx >= 0) arr.splice(idx, 1);
	}

	private emit<K extends keyof WaEventMap>(event: K, ...args: Parameters<WaEventMap[K]>): void {
		const arr = this.listeners.get(event);
		if (!arr) return;
		for (const l of [...arr]) (l as (...a: unknown[]) => void)(...args);
	}

	async initialize(): Promise<void> {
		if (this.opts.needsQr) {
			this.emit("qr", "fake-qr-payload");
			await new Promise<void>((resolve) => {
				this.pairingResolver = resolve;
			});
		}
		this.emit("authenticated");
		this.emit("ready");
	}

	completePairing(): void {
		const r = this.pairingResolver;
		this.pairingResolver = null;
		r?.();
	}

	seedHistory(
		chat_id: string,
		messages: WaMessageEvent[],
		meta?: { name?: string | null; updated_at?: number },
	): void {
		this.history.set(chat_id, messages);
		this.chatMeta.set(chat_id, {
			kind: chat_id.endsWith("@g.us") ? "group" : "dm",
			name: meta?.name ?? null,
			updated_at: meta?.updated_at,
		});
	}

	emitMessage(m: WaMessageEvent): void {
		this.emit("message", m);
	}

	emitReaction(r: WaReactionEvent): void {
		this.emit("reaction", r);
	}

	emitContactUpdate(c: WaContactMeta): void {
		this.emit("contact_update", c);
	}

	emitGroupUpdate(g: WaGroupMeta): void {
		this.emit("group_update", g);
	}

	emitDisconnect(reason: string): void {
		this.emit("disconnected", reason);
	}

	async getChatById(chat_id: string): Promise<ChatHandle> {
		const meta = this.chatMeta.get(chat_id) ?? {
			kind: chat_id.endsWith("@g.us") ? ("group" as const) : ("dm" as const),
		};
		return {
			id: chat_id,
			kind: meta.kind,
			name: meta.name ?? null,
			updated_at: meta.updated_at,
			fetchMessages: async (limit: number) => {
				const all = this.history.get(chat_id) ?? [];
				return all.slice(-limit);
			},
		};
	}

	async listChats(): Promise<ChatHandle[]> {
		return Promise.all(Array.from(this.chatMeta.keys()).map((id) => this.getChatById(id)));
	}

	getSelfJid(): string | null {
		return this.opts.selfJid ?? null;
	}

	setDiagnosticLogger(
		_fn: (msg: string, fields?: Record<string, string | number | boolean>) => void,
	): void {
		// fake client has no upstream diagnostics
	}

	async sendText(chat_id: string, text: string, opts: SendTextOpts = {}): Promise<SendResult> {
		this.sendCounter += 1;
		this.sentMessages.push({
			chat_id,
			text,
			reply_to_wa_id: opts.reply_to_wa_id,
		});
		return { wa_id: `fake-sent-${this.sendCounter}`, timestamp: Date.now() };
	}

	async sendMedia(chat_id: string, opts: SendMediaOpts): Promise<SendResult> {
		this.sendCounter += 1;
		this.sentMessages.push({
			chat_id,
			media: opts,
			reply_to_wa_id: opts.reply_to_wa_id,
		});
		return { wa_id: `fake-sent-${this.sendCounter}`, timestamp: Date.now() };
	}

	async sendReaction(message_wa_id: string, emoji: string): Promise<void> {
		this.sentReactions.push({ message_wa_id, emoji });
	}

	async destroy(): Promise<void> {
		this.destroyed = true;
		this.listeners.clear();
	}
}
