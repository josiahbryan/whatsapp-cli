#!/usr/bin/env -S bun run
import { Command } from "commander";
import { VERSION } from "./version.js";

function main(argv: string[]): void {
	const program = new Command();

	program
		.name("whatsapp-cli")
		.description("Command-line WhatsApp client for humans and agents.")
		.version(VERSION, "-V, --version", "print the version");

	program
		.command("version")
		.description("print the version")
		.action(() => {
			process.stdout.write(`${VERSION}\n`);
		});

	program.parseAsync(argv).catch((err: unknown) => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	});
}

main(process.argv);
