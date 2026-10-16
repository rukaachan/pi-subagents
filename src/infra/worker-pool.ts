/**
 * pi-subagents: the codemode worker pool of the host process.
 */

import { CODEMODE_WORKERS_DEFAULT } from "../domain/subagent/codemode.ts";

export function effectiveCodemodeWorkers(): number {
	const raw = process.env.PI_CODEMODE_MAX_WORKERS;
	if (raw === undefined || raw === "") return CODEMODE_WORKERS_DEFAULT;
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : CODEMODE_WORKERS_DEFAULT;
}

export function applyCodemodeWorkerDefault(wanted = CODEMODE_WORKERS_DEFAULT): boolean {
	const raw = process.env.PI_CODEMODE_MAX_WORKERS;
	if (raw !== undefined && raw !== "") {
		const value = Number(raw);
		if (Number.isInteger(value) && value > 0) return false;
	}
	process.env.PI_CODEMODE_MAX_WORKERS = String(wanted);
	return true;
}
