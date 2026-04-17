export type ChatKind = "dm" | "group" | "self";

export interface ChatInfo {
	kind: ChatKind;
	phone: string | null;
}

const PHONE_ONLY = /^\+?(\d{6,15})$/;
const WA_DM = /^(\d{6,15})@c\.us$/;
const WA_GROUP = /^\d+@g\.us$/;

export function normalizeChatId(input: string): string {
	const raw = input.trim();
	if (raw === "") throw new Error("chat id is empty");
	if (raw === "me") return "me";
	if (WA_DM.test(raw)) return raw;
	if (WA_GROUP.test(raw)) return raw;
	const m = PHONE_ONLY.exec(raw);
	if (m) return `${m[1]}@c.us`;
	throw new Error(`invalid chat id: ${input}`);
}

export function parseChatId(id: string): ChatInfo {
	if (id === "me") return { kind: "self", phone: null };
	const dm = WA_DM.exec(id);
	if (dm) return { kind: "dm", phone: dm[1] ?? null };
	if (WA_GROUP.test(id)) return { kind: "group", phone: null };
	throw new Error(`cannot parse chat id: ${id}`);
}

export function chatKindFromId(id: string): "dm" | "group" {
	return id.endsWith("@g.us") ? "group" : "dm";
}

export function chatPhoneFromId(id: string): string | null {
	if (!id.endsWith("@c.us")) return null;
	return id.split("@")[0] ?? null;
}
