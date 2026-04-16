import { getContact, getContactByPhone } from "../storage/contacts.js";
import { openDatabase } from "../storage/db.js";
import { NotFoundError } from "../util/errors.js";
import { envelopeError, envelopeOk, formatEnvelope } from "../util/json.js";
import { accountPaths } from "../util/paths.js";
import type { GlobalFlags } from "./types.js";

interface Args {
	contact: string;
}

export async function run(args: Args, flags: GlobalFlags): Promise<void> {
	const paths = accountPaths(flags.account);
	const db = openDatabase(paths.db, { readonly: true });
	try {
		let row = args.contact.includes("@") ? getContact(db, args.contact) : null;
		if (!row) {
			const phone = args.contact.replace(/^\++/, "");
			row = getContactByPhone(db, phone);
		}
		if (!row) {
			process.stdout.write(
				formatEnvelope(envelopeError("not_found", `no contact for ${args.contact}`)),
			);
			throw new NotFoundError(`no contact for ${args.contact}`);
		}
		if (flags.json) {
			process.stdout.write(formatEnvelope(envelopeOk(row)));
			return;
		}
		process.stdout.write(
			`${row.id}\nphone: ${row.phone ?? ""}\npushname: ${row.pushname ?? ""}\nbusiness: ${row.is_business ? "yes" : "no"}\nabout: ${row.about ?? ""}\n`,
		);
	} finally {
		db.close();
	}
}
