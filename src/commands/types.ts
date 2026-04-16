export interface GlobalFlags {
	json: boolean;
	account: string;
}

export function resolveGlobalFlags(opts: Record<string, unknown>): GlobalFlags {
	return {
		json: Boolean(opts.json),
		account: typeof opts.account === "string" && opts.account.length > 0 ? opts.account : "default",
	};
}
