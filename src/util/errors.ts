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
