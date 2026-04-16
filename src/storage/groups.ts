import type { Database } from "bun:sqlite";

export interface GroupParticipantRow {
	chat_id: string;
	contact_id: string;
	is_admin: number;
}

export interface ParticipantInput {
	contact_id: string;
	is_admin: number;
}

export function syncGroupParticipants(
	db: Database,
	chat_id: string,
	participants: ParticipantInput[],
): void {
	const del = db.prepare("DELETE FROM group_participants WHERE chat_id = @chat_id");
	const ins = db.prepare(
		`INSERT INTO group_participants (chat_id, contact_id, is_admin)
		 VALUES (@chat_id, @contact_id, @is_admin)`,
	);
	const tx = db.transaction((rows: ParticipantInput[]) => {
		del.run({ "@chat_id": chat_id });
		for (const p of rows) {
			ins.run({
				"@chat_id": chat_id,
				"@contact_id": p.contact_id,
				"@is_admin": p.is_admin,
			});
		}
	});
	tx(participants);
}

export function getGroupParticipants(
	db: Database,
	chat_id: string,
): GroupParticipantRow[] {
	return db
		.prepare(
			`SELECT chat_id, contact_id, is_admin FROM group_participants
			 WHERE chat_id = ?
			 ORDER BY is_admin DESC, contact_id ASC`,
		)
		.all(chat_id) as GroupParticipantRow[];
}
