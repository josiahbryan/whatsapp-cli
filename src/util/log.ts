export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	ts: number;
	level: LogLevel;
	message: string;
	fields: Record<string, string | number | boolean>;
}

export function formatLine(entry: LogEntry): string {
	const ts = new Date(entry.ts).toISOString();
	const head = `[${ts}] [${entry.level}] ${entry.message}`;
	const kv = Object.entries(entry.fields).map(([k, v]) => `${k}=${formatValue(v)}`);
	return kv.length === 0 ? head : `${head} ${kv.join(" ")}`;
}

function formatValue(v: string | number | boolean): string {
	if (typeof v !== "string") return String(v);
	return /\s|"/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

export class Logger {
	constructor(
		private readonly write: (line: string) => void = (l) => {
			process.stderr.write(`${l}\n`);
		},
	) {}

	log(
		level: LogLevel,
		message: string,
		fields: Record<string, string | number | boolean> = {},
	): void {
		this.write(formatLine({ ts: Date.now(), level, message, fields }));
	}

	debug(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("debug", message, fields);
	}
	info(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("info", message, fields);
	}
	warn(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("warn", message, fields);
	}
	error(message: string, fields?: Record<string, string | number | boolean>): void {
		this.log("error", message, fields);
	}
}

import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";

export interface FileLoggerOpts {
	path: string;
	maxBytes: number;
}

export class FileLogger extends Logger {
	constructor(private readonly opts: FileLoggerOpts) {
		super((line: string) => {
			this.maybeRotate();
			appendFileSync(opts.path, `${line}\n`);
		});
	}

	private maybeRotate(): void {
		try {
			if (!existsSync(this.opts.path)) return;
			const size = statSync(this.opts.path).size;
			if (size < this.opts.maxBytes) return;
			const backup = `${this.opts.path}.1`;
			if (existsSync(backup)) unlinkSync(backup);
			renameSync(this.opts.path, backup);
		} catch {
			// best-effort rotation; writes continue on the primary path
		}
	}
}
