export interface EnvelopeOk<T> {
	success: true;
	data: T;
	meta?: Record<string, unknown>;
}

export interface EnvelopeError {
	success: false;
	error: { code: string; message: string; details?: Record<string, unknown> };
}

export type Envelope<T> = EnvelopeOk<T> | EnvelopeError;

export function envelopeOk<T>(data: T, meta?: Record<string, unknown>): EnvelopeOk<T> {
	return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

export function envelopeError(
	code: string,
	message: string,
	details?: Record<string, unknown>,
): EnvelopeError {
	return details === undefined
		? { success: false, error: { code, message } }
		: { success: false, error: { code, message, details } };
}

export function formatEnvelope<T>(env: Envelope<T>): string {
	return `${JSON.stringify(env)}\n`;
}
