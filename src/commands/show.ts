import type { GlobalFlags } from "./types.js";
export async function run(_args: Record<string, unknown>, _flags: GlobalFlags): Promise<void> {
	process.stderr.write("not implemented\n");
	process.exit(1);
}
