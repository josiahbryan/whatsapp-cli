export function parsePositiveInt(val: string | undefined, fallback: number): number {
	if (val === undefined || val === "") return fallback;
	const n = Number.parseInt(val, 10);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.floor(n);
}

export function parseIntOrUndefined(val: string | undefined): number | undefined {
	if (val === undefined || val === "") return undefined;
	const n = Number.parseInt(val, 10);
	return Number.isFinite(n) ? n : undefined;
}
