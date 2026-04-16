import type { GlobalFlags } from "./types.js";

async function stub() {
	process.stderr.write("not implemented\n");
	process.exit(1);
}
export const runStart = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
export const runStop = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
export const runStatus = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
export const runLogs = (_a: Record<string, unknown>, _g: GlobalFlags) => stub();
