export interface WatchdogOpts {
	intervalMs: number;
	timeoutMs: number;
	failuresBeforeRecover: number;
	check: () => Promise<void>;
	recover: () => Promise<void>;
}

export class Watchdog {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private inflightTimeout: ReturnType<typeof setTimeout> | null = null;
	private failures = 0;
	private stopping = false;
	private recovering = false;

	constructor(private readonly opts: WatchdogOpts) {}

	start(): void {
		this.stopping = false;
		this.schedule();
	}

	stop(): void {
		this.stopping = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.inflightTimeout) {
			clearTimeout(this.inflightTimeout);
			this.inflightTimeout = null;
		}
	}

	private schedule(): void {
		if (this.stopping) return;
		this.timer = setTimeout(() => void this.tick(), this.opts.intervalMs);
	}

	private async tick(): Promise<void> {
		try {
			await this.withTimeout(this.opts.check(), this.opts.timeoutMs);
			this.failures = 0;
		} catch {
			this.failures += 1;
			if (this.failures >= this.opts.failuresBeforeRecover && !this.recovering) {
				this.recovering = true;
				try {
					await this.opts.recover();
				} finally {
					this.recovering = false;
					this.failures = 0;
				}
			}
		} finally {
			this.schedule();
		}
	}

	private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const t = setTimeout(() => reject(new Error("watchdog timeout")), ms);
			this.inflightTimeout = t;
			p.then(
				(v) => {
					clearTimeout(t);
					if (this.inflightTimeout === t) this.inflightTimeout = null;
					resolve(v);
				},
				(err) => {
					clearTimeout(t);
					if (this.inflightTimeout === t) this.inflightTimeout = null;
					reject(err);
				},
			);
		});
	}
}
