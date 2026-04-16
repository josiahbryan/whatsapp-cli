export type DaemonState =
	| "stopped"
	| "starting"
	| "qr_required"
	| "authenticating"
	| "ready"
	| "disconnected"
	| "failed";

const ALLOWED: Record<DaemonState, DaemonState[]> = {
	stopped: ["starting"],
	starting: ["qr_required", "authenticating", "failed"],
	qr_required: ["authenticating", "failed"],
	authenticating: ["ready", "qr_required", "failed"],
	ready: ["disconnected", "stopped", "failed"],
	disconnected: ["authenticating", "failed", "stopped"],
	failed: ["stopped"],
};

export function isReady(s: DaemonState): boolean {
	return s === "ready";
}

export class StateMachine {
	private _current: DaemonState = "stopped";
	private readonly listeners: Array<(s: DaemonState) => void> = [];

	get current(): DaemonState {
		return this._current;
	}

	onTransition(fn: (s: DaemonState) => void): void {
		this.listeners.push(fn);
	}

	transition(next: DaemonState): void {
		const allowed = ALLOWED[this._current];
		if (!allowed.includes(next)) {
			throw new Error(`invalid transition: ${this._current} → ${next}`);
		}
		this._current = next;
		for (const l of this.listeners) l(next);
	}
}
