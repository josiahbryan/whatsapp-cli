import type {
	ChatHandle,
	SendMediaOpts,
	SendResult,
	SendTextOpts,
	WhatsAppClient,
} from "./client.js";
import type { WaEventMap } from "./events.js";

const NOT_IMPLEMENTED =
	"RealWhatsAppClient not implemented yet — use FakeWhatsAppClient until Task 38";

export class RealWhatsAppClient implements WhatsAppClient {
	constructor(_opts: { sessionDir: string; filesDir: string }) {
		throw new Error(NOT_IMPLEMENTED);
	}

	initialize(): Promise<void> {
		throw new Error(NOT_IMPLEMENTED);
	}

	on<K extends keyof WaEventMap>(_event: K, _listener: WaEventMap[K]): void {
		throw new Error(NOT_IMPLEMENTED);
	}

	off<K extends keyof WaEventMap>(_event: K, _listener: WaEventMap[K]): void {
		throw new Error(NOT_IMPLEMENTED);
	}

	getChatById(_chat_id: string): Promise<ChatHandle> {
		throw new Error(NOT_IMPLEMENTED);
	}

	listChats(): Promise<ChatHandle[]> {
		throw new Error(NOT_IMPLEMENTED);
	}

	sendText(_chat_id: string, _text: string, _opts?: SendTextOpts): Promise<SendResult> {
		throw new Error(NOT_IMPLEMENTED);
	}

	sendMedia(_chat_id: string, _opts: SendMediaOpts): Promise<SendResult> {
		throw new Error(NOT_IMPLEMENTED);
	}

	sendReaction(_message_wa_id: string, _emoji: string): Promise<void> {
		throw new Error(NOT_IMPLEMENTED);
	}

	destroy(): Promise<void> {
		throw new Error(NOT_IMPLEMENTED);
	}
}
