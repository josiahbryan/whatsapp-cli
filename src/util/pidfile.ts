import { readFileSync } from "node:fs";

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// ESRCH: no such process — dead
		// EPERM: process exists but we lack permission — treat as alive
		return (err as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

export function readLivePid(pidFile: string): number | null {
	let pid: number | null;
	try {
		const raw = readFileSync(pidFile, "utf8").trim();
		const n = Number.parseInt(raw, 10);
		pid = Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
	if (pid === null) return null;
	return isProcessAlive(pid) ? pid : null;
}
