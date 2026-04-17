import type { WaEventMap, WaMessageEvent } from "./events.js";

export interface SendTextOpts {
	reply_to_wa_id?: string;
}

export interface SendMediaOpts extends SendTextOpts {
	caption?: string;
	file_path: string;
}

export interface SendResult {
	wa_id: string;
	timestamp: number;
}

export interface ChatHandle {
	id: string;
	kind: "dm" | "group";
	name?: string | null;
	updated_at?: number;
	fetchMessages(limit: number): Promise<WaMessageEvent[]>;
}

export interface WhatsAppClient {
	initialize(): Promise<void>;
	on<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void;
	off<K extends keyof WaEventMap>(event: K, listener: WaEventMap[K]): void;
	getChatById(chat_id: string): Promise<ChatHandle>;
	listChats(): Promise<ChatHandle[]>;
	sendText(chat_id: string, text: string, opts?: SendTextOpts): Promise<SendResult>;
	sendMedia(chat_id: string, opts: SendMediaOpts): Promise<SendResult>;
	sendReaction(message_wa_id: string, emoji: string): Promise<void>;
	destroy(): Promise<void>;
}
