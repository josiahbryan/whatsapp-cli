import type { Database } from "bun:sqlite";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import * as qrcode from "qrcode";
import { bumpChatUpdatedAt, upsertChat } from "../storage/chats.js";
import { upsertContact } from "../storage/contacts.js";
import { openDatabase } from "../storage/db.js";
import { syncGroupParticipants } from "../storage/groups.js";
import { getMessageByWaId, insertMessage } from "../storage/messages.js";
import { applyReaction } from "../storage/reactions.js";
import { FileLogger } from "../util/log.js";
import type { AccountPaths } from "../util/paths.js";
import type { WhatsAppClient } from "../wa/client.js";
import { backfillChats } from "./backfill.js";
import { DaemonServer } from "./server.js";
import type { DaemonState } from "./state.js";
import { StateMachine } from "./state.js";

export interface DaemonOptions {
	paths: AccountPaths;
	client: WhatsAppClient;
	backfillLimitPerChat: number;
}

const SELF_ID = "self@c.us";

export class Daemon {
	private readonly sm = new StateMachine();
	private readonly server: DaemonServer;
	private db: Database | null = null;
	private pidFd: number | null = null;
	private ownsPidFile = false;
	private readonly logger: FileLogger;

	constructor(private readonly opts: DaemonOptions) {
		this.server = new DaemonServer(opts.paths.socket);
		this.logger = new FileLogger({ path: opts.paths.logFile, maxBytes: 10 * 1024 * 1024 });
		this.sm.onTransition((s) => this.logger.info("state", { state: s }));
		this.sm.onTransition((s) => this.onStateTransition(s));
	}

	async start(): Promise<void> {
		mkdirSync(this.opts.paths.accountDir, { recursive: true });
		mkdirSync(this.opts.paths.sessionDir, { recursive: true });
		mkdirSync(this.opts.paths.filesDir, { recursive: true });

		this.sm.transition("starting");

		this.acquirePidLock();
		this.db = openDatabase(this.opts.paths.db);
		this.wireClientEvents();
		this.registerHandlers();

		await this.server.start();
		const ready = this.awaitReady();
		await this.opts.client.initialize();
		await ready;

		if (this.db) {
			await backfillChats(
				this.db,
				this.opts.client,
				{ limitPerChat: this.opts.backfillLimitPerChat },
				this.logger,
			);
		}
	}

	async stop(): Promise<void> {
		try {
			await this.opts.client.destroy();
		} catch {
			// best-effort; proceed with shutdown
		}
		await this.server.stop();
		if (this.db) {
			this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			this.db.close();
			this.db = null;
		}
		this.releasePidLock();
		if (this.sm.current !== "stopped" && this.sm.current !== "failed") {
			try {
				this.sm.transition("stopped");
			} catch {
				// already in a terminal state
			}
		}
	}

	private awaitReady(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.sm.onTransition((s) => {
				if (s === "ready") resolve();
				if (s === "failed") reject(new Error("daemon failed during startup"));
			});
		});
	}

	private onStateTransition(s: DaemonState): void {
		writeFileSync(this.opts.paths.stateJson, `${JSON.stringify({ state: s })}\n`);
		this.server.broadcast({ event: "state", data: { state: s } });
	}

	private isProcessAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			// signal 0 succeeded — process exists
			return true;
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			// ESRCH: no such process — dead
			// EPERM: process exists but we lack permission — treat as alive
			return e.code !== "ESRCH";
		}
	}

	private acquirePidLock(): void {
		const tryOpen = (): void => {
			try {
				this.pidFd = openSync(this.opts.paths.pidFile, "wx");
				writeSync(this.pidFd, Buffer.from(`${process.pid}\n`));
				this.ownsPidFile = true;
			} catch (err) {
				const e = err as NodeJS.ErrnoException;
				if (e.code !== "EEXIST") throw err;

				// Pidfile exists — check if the recorded pid is still alive
				let stalePid: number | null = null;
				try {
					const contents = readFileSync(this.opts.paths.pidFile, "utf8").trim();
					const parsed = Number.parseInt(contents, 10);
					if (Number.isFinite(parsed) && parsed > 0) stalePid = parsed;
				} catch {
					// unreadable pidfile — treat as stale
				}

				// If stalePid is null (empty/malformed file), treat as alive to avoid racing
				// a concurrent process that just created the file but hasn't written its pid yet
				const alive = stalePid === null || this.isProcessAlive(stalePid);
				if (!alive) {
					// Stale pidfile — remove it and retry once
					try {
						unlinkSync(this.opts.paths.pidFile);
					} catch {
						// already removed by a concurrent process — that's fine
					}
					try {
						this.pidFd = openSync(this.opts.paths.pidFile, "wx");
						writeSync(this.pidFd, Buffer.from(`${process.pid}\n`));
						this.ownsPidFile = true;
					} catch (retryErr) {
						const re = retryErr as NodeJS.ErrnoException;
						if (re.code === "EEXIST") {
							throw new Error(`daemon already running (pidfile ${this.opts.paths.pidFile})`);
						}
						throw retryErr;
					}
					return;
				}

				throw new Error(`daemon already running (pidfile ${this.opts.paths.pidFile})`);
			}
		};
		tryOpen();
	}

	private releasePidLock(): void {
		if (this.pidFd !== null) {
			try {
				closeSync(this.pidFd);
			} catch {
				// fd may already be closed
			}
			this.pidFd = null;
		}
		if (this.ownsPidFile && existsSync(this.opts.paths.pidFile)) {
			try {
				unlinkSync(this.opts.paths.pidFile);
			} catch {
				// ignore — next start's O_EXCL will handle it
			}
			this.ownsPidFile = false;
		}
	}

	private wireClientEvents(): void {
		const { client } = this.opts;

		client.setDiagnosticLogger?.((msg, fields) => this.logger.info(msg, fields));

		client.on("qr", (qrData) => {
			void qrcode
				.toBuffer(qrData, { type: "png" })
				.then((png) => {
					writeFileSync(this.opts.paths.qrPng, png);
				})
				.catch(() => {
					// best-effort; qr.png write failure shouldn't block transition
				})
				.finally(() => {
					if (this.sm.current === "starting") this.sm.transition("qr_required");
				});
		});
		client.on("authenticated", () => {
			if (this.sm.current === "starting" || this.sm.current === "qr_required") {
				this.sm.transition("authenticating");
			}
		});
		client.on("ready", () => {
			if (existsSync(this.opts.paths.qrPng)) unlinkSync(this.opts.paths.qrPng);
			if (this.sm.current === "authenticating") this.sm.transition("ready");
		});
		client.on("disconnected", () => {
			if (this.sm.current === "ready") this.sm.transition("disconnected");
		});

		client.on("message", (m) => {
			const db = this.db;
			if (!db) return;
			db.transaction(() => {
				const phone = m.chat_id.endsWith("@c.us") ? (m.chat_id.split("@")[0] ?? null) : null;
				upsertChat(db, {
					id: m.chat_id,
					kind: m.chat_id.endsWith("@g.us") ? "group" : "dm",
					name: null,
					phone,
					updated_at: m.timestamp,
				});
				const rowid = insertMessage(db, {
					wa_id: m.wa_id,
					chat_id: m.chat_id,
					from_id: m.from_id,
					from_name: m.from_name,
					from_me: m.from_me ? 1 : 0,
					timestamp: m.timestamp,
					type: m.type,
					body: m.body,
					quoted_wa_id: m.quoted_wa_id,
					attachment_path: null,
					attachment_mime: m.attachment?.mimetype ?? null,
					attachment_filename: m.attachment?.filename ?? null,
				});
				bumpChatUpdatedAt(db, m.chat_id, m.timestamp);
				if (rowid !== null) {
					this.server.broadcast({ event: "message", data: { ...m, rowid } });
				}
			})();
		});

		client.on("reaction", (r) => {
			if (!this.db) return;
			applyReaction(this.db, r);
			this.server.broadcast({ event: "reaction", data: r });
		});

		client.on("contact_update", (c) => {
			if (!this.db) return;
			upsertContact(this.db, {
				id: c.id,
				phone: c.phone,
				pushname: c.pushname,
				verified_name: c.verified_name,
				is_business: c.is_business ? 1 : 0,
				is_my_contact: c.is_my_contact ? 1 : 0,
				about: c.about,
				updated_at: Date.now(),
			});
		});

		client.on("group_update", (g) => {
			if (!this.db) return;
			syncGroupParticipants(
				this.db,
				g.chat_id,
				g.participants.map((p) => ({
					contact_id: p.contact_id,
					is_admin: p.is_admin ? 1 : 0,
				})),
			);
		});
	}

	private recordOutgoingText(
		chat_id: string,
		wa_id: string,
		text: string,
		timestamp: number,
		reply_to?: string,
	): number {
		const db = this.db;
		if (!db) return 0;
		let rowid = 0;
		db.transaction(() => {
			const phone = chat_id.endsWith("@c.us") ? (chat_id.split("@")[0] ?? null) : null;
			upsertChat(db, {
				id: chat_id,
				kind: chat_id.endsWith("@g.us") ? "group" : "dm",
				name: null,
				phone,
				updated_at: timestamp,
			});
			const inserted = insertMessage(db, {
				wa_id,
				chat_id,
				from_id: SELF_ID,
				from_name: null,
				from_me: 1,
				timestamp,
				type: "chat",
				body: text,
				quoted_wa_id: reply_to ?? null,
				attachment_path: null,
				attachment_mime: null,
				attachment_filename: null,
			});
			bumpChatUpdatedAt(db, chat_id, timestamp);
			if (inserted !== null) rowid = inserted;
			else {
				const existing = getMessageByWaId(db, wa_id);
				rowid = existing?.rowid ?? 0;
			}
		})();
		return rowid;
	}

	private recordOutgoingMedia(
		chat_id: string,
		wa_id: string,
		file_path: string,
		caption: string | undefined,
		timestamp: number,
		reply_to?: string,
	): number {
		const db = this.db;
		if (!db) return 0;
		let rowid = 0;
		db.transaction(() => {
			const phone = chat_id.endsWith("@c.us") ? (chat_id.split("@")[0] ?? null) : null;
			upsertChat(db, {
				id: chat_id,
				kind: chat_id.endsWith("@g.us") ? "group" : "dm",
				name: null,
				phone,
				updated_at: timestamp,
			});
			const inserted = insertMessage(db, {
				wa_id,
				chat_id,
				from_id: SELF_ID,
				from_name: null,
				from_me: 1,
				timestamp,
				type: "document",
				body: caption ?? null,
				quoted_wa_id: reply_to ?? null,
				attachment_path: file_path,
				attachment_mime: null,
				attachment_filename: null,
			});
			bumpChatUpdatedAt(db, chat_id, timestamp);
			if (inserted !== null) rowid = inserted;
			else {
				const existing = getMessageByWaId(db, wa_id);
				rowid = existing?.rowid ?? 0;
			}
		})();
		return rowid;
	}

	private registerHandlers(): void {
		this.server.setHandlers({
			status: async () => ({ state: this.sm.current, pid: process.pid }),
			send: async (params) => {
				if (this.sm.current !== "ready") {
					throw Object.assign(new Error(`daemon not ready: ${this.sm.current}`), {
						code: "not_ready",
					});
				}
				let chat_id = String(params.chat_id);
				if (chat_id === "me") {
					const self = this.opts.client.getSelfJid();
					if (!self) {
						throw Object.assign(new Error("self jid not available yet"), {
							code: "not_ready",
						});
					}
					chat_id = self;
				}
				if ("text" in params && typeof params.text === "string") {
					const replyTo = typeof params.reply_to === "string" ? params.reply_to : undefined;
					const res = await this.opts.client.sendText(chat_id, params.text, {
						reply_to_wa_id: replyTo,
					});
					const rowid = this.recordOutgoingText(
						chat_id,
						res.wa_id,
						params.text,
						res.timestamp,
						replyTo,
					);
					return { wa_id: res.wa_id, rowid };
				}
				if ("file_path" in params && typeof params.file_path === "string") {
					const caption = typeof params.caption === "string" ? params.caption : undefined;
					const replyTo = typeof params.reply_to === "string" ? params.reply_to : undefined;
					const res = await this.opts.client.sendMedia(chat_id, {
						file_path: params.file_path,
						caption,
						reply_to_wa_id: replyTo,
					});
					const rowid = this.recordOutgoingMedia(
						chat_id,
						res.wa_id,
						params.file_path,
						caption,
						res.timestamp,
						replyTo,
					);
					return { wa_id: res.wa_id, rowid };
				}
				throw Object.assign(new Error("send requires text or file_path"), {
					code: "invalid_params",
				});
			},
			react: async (params) => {
				if (this.sm.current !== "ready") {
					throw Object.assign(new Error(`daemon not ready: ${this.sm.current}`), {
						code: "not_ready",
					});
				}
				await this.opts.client.sendReaction(String(params.message_wa_id), String(params.emoji));
				return null;
			},
			subscribe: async (_params, ctx) => {
				ctx.subscribed = true;
				return { state: this.sm.current };
			},
			unsubscribe: async (_params, ctx) => {
				ctx.subscribed = false;
				return null;
			},
			shutdown: async () => {
				setImmediate(() => {
					void this.stop().then(() => process.exit(0));
				});
				return null;
			},
		});
	}
}
