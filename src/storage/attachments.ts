import { writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const MIME_TO_EXT: Record<string, string> = {
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"audio/ogg": ".ogg",
	"audio/mpeg": ".mp3",
	"audio/mp4": ".m4a",
	"video/mp4": ".mp4",
	"video/quicktime": ".mov",
	"application/pdf": ".pdf",
};

export function attachmentExtension(mime: string | null, filename: string | null): string {
	if (filename) {
		const ext = extname(filename);
		if (ext) return ext;
	}
	if (mime) {
		const ext = MIME_TO_EXT[mime.split(";")[0]?.trim() ?? ""];
		if (ext) return ext;
	}
	return ".bin";
}

function sanitize(waId: string): string {
	return waId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function attachmentPathFor(
	filesDir: string,
	waId: string,
	mime: string | null,
	filename: string | null,
): string {
	return join(filesDir, `${sanitize(waId)}${attachmentExtension(mime, filename)}`);
}

export function saveAttachment(
	filesDir: string,
	waId: string,
	bytes: Buffer,
	mime: string | null,
	filename: string | null,
): string {
	const path = attachmentPathFor(filesDir, waId, mime, filename);
	writeFileSync(path, bytes);
	return path;
}
