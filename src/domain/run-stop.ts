/**
 * pi-subagents: a run that was stopped on purpose.
 */

export class RunStopped extends Error {
	readonly why: string;

	constructor(why: string) {
		super(`stopped: interrupted by ${why}`);
		this.name = "RunStopped";
		this.why = why;
	}
}

export function isRunStopped(err: unknown): err is RunStopped {
	return err instanceof RunStopped;
}

export function stoppedToolText(name: string, why: string): string {
	return `Subagent "${name}" stopped: interrupted by ${why}. Resume it by id, or start a new task.`;
}

export function stoppedRowNote(why: string): string {
	return `interrupted by ${why}`;
}
