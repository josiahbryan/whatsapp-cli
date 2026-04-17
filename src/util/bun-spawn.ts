// When running as a bun-compiled binary, process.argv[1] is Bun's virtual
// "/$bunfs/root/<binary>" path. Passing that to the spawned child makes
// commander reject it as an unknown command. In that mode, process.execPath
// is the self-contained binary and already knows to run the embedded script,
// so we skip argv[1] entirely.
export function selfSpawnArgs(subArgs: string[]): string[] {
	const script = process.argv[1] ?? "";
	if (script.startsWith("/$bunfs/")) return subArgs;
	return [script, ...subArgs];
}
