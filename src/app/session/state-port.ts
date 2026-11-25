/**
 * pi-subagents: the state port.
 */
import type { PersistedState } from "../../infra/state/index.ts";

export interface StatePort {
	load(statePath: string): PersistedState | null;
	encode(state: PersistedState): string;
	save(statePath: string, json: string): { error?: string };
	saveAsync(statePath: string, json: string, isCurrent: () => boolean): Promise<{ error?: string }>;
}
