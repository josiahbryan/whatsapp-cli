import { envelopeError, formatEnvelope } from "./json.js";

export class CliError extends Error {
	readonly code: string;
	readonly exitCode: number;
	constructor(code: string, exitCode: number, message: string) {
		super(message);
		this.name = "CliError";
		this.code = code;
		this.exitCode = exitCode;
	}
}

export class NotFoundError extends CliError {
	constructor(message: string) {
		super("not_found", 4, message);
		this.name = "NotFoundError";
	}
}

export class InvalidArgsError extends CliError {
	constructor(message: string) {
		super("invalid_args", 2, message);
		this.name = "InvalidArgsError";
	}
}

export class InvalidQueryError extends CliError {
	constructor(message: string) {
		super("invalid_query", 2, message);
		this.name = "InvalidQueryError";
	}
}

export type RpcErrorCode =
	| "not_ready"
	| "not_found"
	| "no_media"
	| "invalid_params"
	| "internal_error";

export class RpcError extends Error {
	readonly code: RpcErrorCode;
	constructor(code: RpcErrorCode, message: string) {
		super(message);
		this.name = "RpcError";
		this.code = code;
	}
}

export function throwRpcEnvelopeError(err: unknown): never {
	const e = err as { code?: string; message?: string };
	const code = e.code ?? "error";
	const message = e.message ?? String(err);
	process.stdout.write(formatEnvelope(envelopeError(code, message)));
	throw new CliError(code, code === "not_ready" ? 2 : 1, message);
}
