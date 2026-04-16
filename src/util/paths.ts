import { homedir } from "node:os";
import { join } from "node:path";

const ACCOUNT_NAME = /^[a-zA-Z0-9_-]+$/;

export interface AccountPaths {
	accountDir: string;
	db: string;
	socket: string;
	pidFile: string;
	logFile: string;
	qrPng: string;
	stateJson: string;
	sessionDir: string;
	filesDir: string;
}

export function rootDir(): string {
	return process.env.WA_CLI_HOME ?? join(homedir(), ".whatsapp-cli");
}

export function accountPaths(account: string, root: string = rootDir()): AccountPaths {
	if (!ACCOUNT_NAME.test(account)) {
		throw new Error(`invalid account name: ${account}`);
	}
	const accountDir = join(root, "accounts", account);
	return {
		accountDir,
		db: join(accountDir, "db.sqlite"),
		socket: join(accountDir, "control.sock"),
		pidFile: join(accountDir, "daemon.pid"),
		logFile: join(accountDir, "daemon.log"),
		qrPng: join(accountDir, "qr.png"),
		stateJson: join(accountDir, "state.json"),
		sessionDir: join(accountDir, "session"),
		filesDir: join(accountDir, "files"),
	};
}
