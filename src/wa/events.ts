export interface WaMessageEvent {
	wa_id: string;
	chat_id: string;
	from_id: string;
	from_name: string | null;
	from_me: boolean;
	timestamp: number;
	type: "chat" | "image" | "video" | "audio" | "voice" | "document" | "sticker" | "system";
	body: string | null;
	quoted_wa_id: string | null;
	attachment: WaAttachment | null;
}

export interface WaAttachment {
	mimetype: string;
	filename: string | null;
	data: Buffer;
}

export interface WaReactionEvent {
	message_wa_id: string;
	reactor_id: string;
	emoji: string;
	timestamp: number;
}

export interface WaChatMeta {
	id: string;
	kind: "dm" | "group";
	name: string | null;
	phone: string | null;
	timestamp: number;
}

export interface WaContactMeta {
	id: string;
	phone: string | null;
	pushname: string | null;
	verified_name: string | null;
	is_business: boolean;
	is_my_contact: boolean;
	about: string | null;
}

export interface WaGroupMeta {
	chat_id: string;
	participants: Array<{ contact_id: string; is_admin: boolean }>;
}

export type WaEventMap = {
	qr: (dataUrl: string) => void;
	authenticated: () => void;
	ready: () => void;
	disconnected: (reason: string) => void;
	message: (m: WaMessageEvent) => void;
	reaction: (r: WaReactionEvent) => void;
	chat_update: (c: WaChatMeta) => void;
	contact_update: (c: WaContactMeta) => void;
	group_update: (g: WaGroupMeta) => void;
};
