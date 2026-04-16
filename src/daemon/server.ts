import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import {
	type EventFrame,
	FrameDecoder,
	type RequestFrame,
	type ResponseFrame,
	encodeFrame,
	isRequestFrame,
} from "../ipc/protocol.js";

export interface MethodHandlers {
	status(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	send(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	react(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	subscribe(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	unsubscribe(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
	shutdown(params: Record<string, unknown>, ctx: ClientContext): Promise<unknown>;
}

export interface ClientContext {
	subscribed: boolean;
	write(frame: EventFrame | ResponseFrame): void;
}

export class DaemonServer {
	private server: Server | null = null;
	private handlers: MethodHandlers | null = null;
	private readonly clients = new Set<ClientContext>();

	constructor(private readonly socketPath: string) {}

	setHandlers(h: MethodHandlers): void {
		this.handlers = h;
	}

	start(): Promise<void> {
		if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
		return new Promise((resolve, reject) => {
			const s = createServer((conn) => this.handleConnection(conn));
			s.on("error", reject);
			s.listen(this.socketPath, () => {
				try {
					chmodSync(this.socketPath, 0o600);
				} catch {
					// ignore — running without permission to chmod is still OK on most fs
				}
				this.server = s;
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		for (const c of this.clients) {
			const sock = (c as ClientContext & { _socket?: Socket })._socket;
			try {
				c.write({ event: "shutdown", data: {} });
			} catch {
				// socket may already be closed; drop the event
			}
			try {
				sock?.end();
				sock?.destroy();
			} catch {
				// ignore
			}
		}
		await new Promise<void>((resolve) => {
			if (!this.server) return resolve();
			this.server.close(() => resolve());
		});
		this.server = null;
		if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
	}

	broadcast(event: EventFrame): void {
		const buf = encodeFrame(event);
		for (const c of this.clients) {
			if (!c.subscribed) continue;
			try {
				(c as ClientContext & { _socket?: Socket })._socket?.write(buf);
			} catch {
				// dropped client — we'll notice on the next read
			}
		}
	}

	private handleConnection(conn: Socket): void {
		const dec = new FrameDecoder();
		const ctx: ClientContext & { _socket: Socket } = {
			subscribed: false,
			_socket: conn,
			write: (frame) => {
				conn.write(encodeFrame(frame));
			},
		};
		this.clients.add(ctx);
		conn.on("data", (chunk) => {
			try {
				for (const frame of dec.push(chunk)) {
					if (isRequestFrame(frame)) void this.dispatch(ctx, frame);
				}
			} catch (err) {
				conn.destroy(err instanceof Error ? err : new Error(String(err)));
			}
		});
		conn.on("close", () => this.clients.delete(ctx));
		conn.on("error", () => this.clients.delete(ctx));
	}

	private async dispatch(ctx: ClientContext, req: RequestFrame): Promise<void> {
		if (!this.handlers) {
			ctx.write({ id: req.id, error: { code: "not_ready", message: "handlers unset" } });
			return;
		}
		const fn = (this.handlers as unknown as Record<string, MethodHandlers["status"]>)[req.method];
		if (!fn) {
			ctx.write({
				id: req.id,
				error: { code: "unknown_method", message: `unknown method: ${req.method}` },
			});
			return;
		}
		try {
			// side-effect: update subscription state so broadcast() knows who is listening
			if (req.method === "subscribe") ctx.subscribed = true;
			else if (req.method === "unsubscribe") ctx.subscribed = false;
			const result = await fn(req.params, ctx);
			ctx.write({ id: req.id, result: result ?? null });
		} catch (err) {
			const e = err as { code?: string; message?: string; details?: Record<string, unknown> };
			ctx.write({
				id: req.id,
				error: {
					code: e.code ?? "internal_error",
					message: e.message ?? String(err),
					...(e.details ? { details: e.details } : {}),
				},
			});
		}
	}
}
