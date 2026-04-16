const REL = /^-(\d+)([smhd])$/;
const EPOCH_MS = /^\d{10,}$/;

export function parseTime(input: string, now: number = Date.now()): number {
	const raw = input.trim();
	if (raw === "now") return now;

	const rel = REL.exec(raw);
	if (rel) {
		const n = Number(rel[1]);
		const unit = rel[2];
		const ms = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
		return now - n * ms;
	}

	if (EPOCH_MS.test(raw)) return Number(raw);

	const parsed = Date.parse(raw);
	if (!Number.isNaN(parsed)) return parsed;

	throw new Error(`invalid time: ${input}`);
}
