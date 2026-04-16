import { randomUUID } from "node:crypto";
import { type Socket, createConnection } from "node:net";
import {
	type EventFrame,
	FrameDecoder,
	type ResponseErrFrame,
	type ResponseOkFrame,
	encodeFrame,
	isEventFrame,
	isResponseFrame,
} from "./protocol.js";

export interface IpcError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export class IpcRequestError extends Error {
	readonly code: string;
	readonly details?: Record<string, unknown>;
	constructor(err: IpcError) {
		super(err.message);
		this.code = err.code;
		this.details = err.details;
	}
}

export class IpcClient {
	private socket: Socket | null = null;
	private decoder = new FrameDecoder();
	private pending = new Map<
		string,
		{ resolve: (v: unknown) => void; reject: (e: unknown) => void }
	>();
	private eventListeners: Array<(e: EventFrame) => void> = [];
	private closed = false;

	constructor(private readonly socketPath: string) {}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const s = createConnection(this.socketPath);
			s.once("connect", () => {
				this.socket = s;
				s.on("data", (chunk) => this.onData(chunk));
				s.on("close", () => this.onClose());
				s.on("error", (err) => this.onSocketError(err));
				resolve();
			});
			s.once("error", reject);
		});
	}

	onEvent(fn: (e: EventFrame) => void): void {
		this.eventListeners.push(fn);
	}

	async call(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (!this.socket) throw new Error("ipc not connected");
		const id = randomUUID();
		const p = new Promise<unknown>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
		try {
			this.socket.write(encodeFrame({ id, method, params }));
		} catch (err) {
			this.pending.delete(id);
			throw err;
		}
		return p;
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.socket) {
			await new Promise<void>((resolve) => {
				this.socket?.end(() => resolve());
			});
			this.socket = null;
		}
	}

	private onData(chunk: Buffer): void {
		for (const f of this.decoder.push(chunk)) {
			if (isResponseFrame(f)) {
				const pending = this.pending.get(f.id);
				if (!pending) continue;
				this.pending.delete(f.id);
				if ("result" in f) pending.resolve((f as ResponseOkFrame).result);
				else pending.reject(new IpcRequestError((f as ResponseErrFrame).error));
			} else if (isEventFrame(f)) {
				for (const l of this.eventListeners) l(f);
			}
		}
	}

	private onClose(): void {
		if (this.closed) return;
		this.rejectAllPending({ code: "disconnected", message: "daemon closed socket" });
	}

	private onSocketError(err: Error): void {
		if (this.closed) return;
		this.rejectAllPending({
			code: "socket_error",
			message: err.message,
		});
	}

	private rejectAllPending(err: IpcError): void {
		for (const [, p] of this.pending) {
			p.reject(new IpcRequestError(err));
		}
		this.pending.clear();
	}
}
