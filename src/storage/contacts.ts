import type { Database } from "bun:sqlite";

export interface ContactRow {
	id: string;
	phone: string | null;
	pushname: string | null;
	verified_name: string | null;
	is_business: number;
	is_my_contact: number;
	about: string | null;
	updated_at: number;
}

export function upsertContact(db: Database, c: ContactRow): void {
	db.prepare(
		`INSERT INTO contacts (id, phone, pushname, verified_name, is_business, is_my_contact, about, updated_at)
		 VALUES (@id, @phone, @pushname, @verified_name, @is_business, @is_my_contact, @about, @updated_at)
		 ON CONFLICT(id) DO UPDATE SET
		   phone = excluded.phone,
		   pushname = excluded.pushname,
		   verified_name = excluded.verified_name,
		   is_business = excluded.is_business,
		   is_my_contact = excluded.is_my_contact,
		   about = COALESCE(excluded.about, contacts.about),
		   updated_at = CASE WHEN excluded.updated_at > contacts.updated_at
		                     THEN excluded.updated_at ELSE contacts.updated_at END`,
	).run({
		"@id": c.id,
		"@phone": c.phone,
		"@pushname": c.pushname,
		"@verified_name": c.verified_name,
		"@is_business": c.is_business,
		"@is_my_contact": c.is_my_contact,
		"@about": c.about,
		"@updated_at": c.updated_at,
	});
}

export function getContact(db: Database, id: string): ContactRow | null {
	return (
		(db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | undefined) ?? null
	);
}

export interface ListContactsOpts {
	business?: boolean;
	my_contacts?: boolean;
	group_id?: string;
	limit?: number;
}

export function listContacts(db: Database, opts: ListContactsOpts): ContactRow[] {
	const where: string[] = [];
	const params: Record<string, unknown> = {};
	if (opts.business) where.push("is_business = 1");
	if (opts.my_contacts) where.push("is_my_contact = 1");
	if (opts.group_id) {
		where.push("id IN (SELECT contact_id FROM group_participants WHERE chat_id = @group_id)");
		params["@group_id"] = opts.group_id;
	}
	const sql =
		`SELECT * FROM contacts` +
		(where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
		` ORDER BY pushname COLLATE NOCASE` +
		(opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "");
	return db.prepare(sql).all(params) as ContactRow[];
}

export function getContactByPhone(db: Database, phone: string): ContactRow | null {
	return (
		(db.prepare(`SELECT * FROM contacts WHERE phone = ?`).get(phone) as ContactRow | undefined) ??
		null
	);
}
