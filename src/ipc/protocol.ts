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

export function isRequestFrame(f: Frame): f is RequestFrame {
	return typeof (f as RequestFrame).method === "string";
}

export function isResponseFrame(f: Frame): f is ResponseFrame {
	return (
		typeof (f as ResponseFrame).id === "string" &&
		("result" in (f as ResponseOkFrame) || "error" in (f as ResponseErrFrame))
	);
}

export function isEventFrame(f: Frame): f is EventFrame {
	return typeof (f as EventFrame).event === "string";
}

export function encodeFrame(frame: Frame): Buffer {
	return Buffer.from(`${JSON.stringify(frame)}\n`);
}

export class FrameDecoder {
	private buffer = "";

	push(chunk: Buffer): Frame[] {
		this.buffer += chunk.toString("utf8");
		const frames: Frame[] = [];
		let nl: number;
		while ((nl = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (line.trim() === "") continue;
			try {
				frames.push(JSON.parse(line) as Frame);
			} catch (_err) {
				throw new Error(`malformed frame: ${line.slice(0, 80)}`);
			}
		}
		return frames;
	}
}
