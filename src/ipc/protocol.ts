export interface RequestFrame {
	id: string;
	method: string;
	params: Record<string, unknown>;
}

export interface ResponseOkFrame {
	id: string;
	result: unknown;
}

export interface ResponseErrFrame {
	id: string;
	error: { code: string; message: string; details?: Record<string, unknown> };
}

export type ResponseFrame = ResponseOkFrame | ResponseErrFrame;

export interface EventFrame {
	event: string;
	data: unknown;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

function isObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null;
}

export function isRequestFrame(f: unknown): f is RequestFrame {
	return isObject(f) && typeof f.method === "string" && typeof f.id === "string";
}

export function isResponseFrame(f: unknown): f is ResponseFrame {
	return isObject(f) && typeof f.id === "string" && ("result" in f || "error" in f);
}

export function isEventFrame(f: unknown): f is EventFrame {
	return isObject(f) && typeof f.event === "string";
}

export function encodeFrame(frame: Frame): Buffer {
	return Buffer.from(`${JSON.stringify(frame)}\n`);
}

export class FrameDecoder {
	private buffer = "";

	push(chunk: Buffer): Frame[] {
		this.buffer += chunk.toString("utf8");
		const frames: Frame[] = [];
		for (;;) {
			const nl = this.buffer.indexOf("\n");
			if (nl < 0) break;
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (line.trim() === "") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (_err) {
				throw new Error(`malformed frame: ${line.slice(0, 80)}`);
			}
			if (!isRequestFrame(parsed) && !isResponseFrame(parsed) && !isEventFrame(parsed)) {
				throw new Error(`malformed frame: ${line.slice(0, 80)}`);
			}
			frames.push(parsed);
		}
		return frames;
	}
}
